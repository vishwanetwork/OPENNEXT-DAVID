"""DynamoDB storage with committed catalog batches and atomic order/outbox writes."""

import hashlib
import json
from datetime import timedelta
from uuid import uuid4

import boto3
from boto3.dynamodb.types import TypeDeserializer, TypeSerializer
from botocore.config import Config
from botocore.exceptions import ClientError

from spotbot.models import Offer, timestamp, utcnow
from spotbot.storage.common import (
    ACTIVE_STATES,
    ORDER_FIELDS,
    PROVIDERS,
    dump,
    fingerprint,
    new_event,
    new_order,
)


class DynamoDBStore:
    def __init__(
        self, table_name, *, region=None, endpoint_url=None, create_table=False, client=None
    ):
        self.table_name = table_name
        self.client = client or boto3.client(
            "dynamodb",
            region_name=region,
            endpoint_url=endpoint_url,
            config=Config(
                connect_timeout=10, read_timeout=30, retries={"mode": "standard", "max_attempts": 3}
            ),
        )
        self.serializer, self.deserializer = TypeSerializer(), TypeDeserializer()
        self._owner = None
        try:
            description = self.client.describe_table(TableName=table_name)["Table"]
        except ClientError as exc:
            if exc.response["Error"]["Code"] != "ResourceNotFoundException" or not create_table:
                raise
            self.client.create_table(
                TableName=table_name,
                KeySchema=[
                    {"AttributeName": "pk", "KeyType": "HASH"},
                    {"AttributeName": "sk", "KeyType": "RANGE"},
                ],
                AttributeDefinitions=[
                    {"AttributeName": "pk", "AttributeType": "S"},
                    {"AttributeName": "sk", "AttributeType": "S"},
                ],
                BillingMode="PAY_PER_REQUEST",
            )
            self.client.get_waiter("table_exists").wait(TableName=table_name)
            description = self.client.describe_table(TableName=table_name)["Table"]
        expected = {(item["AttributeName"], item["KeyType"]) for item in description["KeySchema"]}
        attributes = {
            item["AttributeName"]: item["AttributeType"]
            for item in description["AttributeDefinitions"]
        }
        if (
            expected != {("pk", "HASH"), ("sk", "RANGE")}
            or attributes.get("pk") != "S"
            or attributes.get("sk") != "S"
        ):
            raise ValueError("DynamoDB table requires string pk (HASH) and sk (RANGE) keys")

    def _encode(self, values):
        return {k: self.serializer.serialize(v) for k, v in values.items()}

    def _key(self, pk, sk):
        return self._encode({"pk": pk, "sk": sk})

    def _get(self, pk, sk):
        item = self.client.get_item(
            TableName=self.table_name, Key=self._key(pk, sk), ConsistentRead=True
        ).get("Item")
        return {k: self.deserializer.deserialize(v) for k, v in item.items()} if item else None

    def _item(self, pk, sk, record, version=1):
        item = self._encode({"pk": pk, "sk": sk, "body": dump(record), "version": version})
        if len(json.dumps(item).encode()) > 380000:
            raise ValueError("DynamoDB record exceeds the supported item size")
        return item

    def _query(self, pk, prefix=None):
        params = {
            "TableName": self.table_name,
            "ConsistentRead": True,
            "KeyConditionExpression": "pk = :pk",
            "ExpressionAttributeValues": self._encode({":pk": pk}),
        }
        if prefix is not None:
            params["KeyConditionExpression"] += " AND begins_with(sk, :prefix)"
            params["ExpressionAttributeValues"].update(self._encode({":prefix": prefix}))
        records = []
        while True:
            response = self.client.query(**params)
            records.extend(
                {k: self.deserializer.deserialize(v) for k, v in row.items()}
                for row in response["Items"]
            )
            last = response.get("LastEvaluatedKey")
            if not last:
                return records
            params["ExclusiveStartKey"] = last

    def _put(self, pk, sk, body, old=None):
        result = {
            "TableName": self.table_name,
            "Item": self._item(pk, sk, body, int(old["version"]) + 1 if old else 1),
        }
        if old:
            result.update(
                ConditionExpression="#revision = :revision",
                ExpressionAttributeNames={"#revision": "version"},
                ExpressionAttributeValues=self._encode({":revision": int(old["version"])}),
            )
        else:
            result["ConditionExpression"] = "attribute_not_exists(pk)"
        return {"Put": result}

    def _transaction(self, writes):
        if self._owner:
            writes = [
                *writes,
                {
                    "ConditionCheck": {
                        "TableName": self.table_name,
                        "Key": self._key("WORKER", "LOCK"),
                        "ConditionExpression": "#owner = :owner",
                        "ExpressionAttributeNames": {"#owner": "owner"},
                        "ExpressionAttributeValues": self._encode({":owner": self._owner}),
                    }
                },
            ]
        self.client.transact_write_items(TransactItems=writes, ClientRequestToken=str(uuid4()))

    @staticmethod
    def _conflict(exc):
        return exc.response["Error"]["Code"] in {
            "TransactionCanceledException",
            "ConditionalCheckFailedException",
            "TransactionConflictException",
        }

    def acquire(self):
        owner = str(uuid4())
        try:
            self.client.put_item(
                TableName=self.table_name,
                Item=self._encode(
                    {"pk": "WORKER", "sk": "LOCK", "owner": owner, "created_at": timestamp()}
                ),
                ConditionExpression="attribute_not_exists(pk)",
            )
        except ClientError as exc:
            if self._conflict(exc):
                raise RuntimeError(
                    "DynamoDB worker lock is held; stop the owning process before clearing a stale WORKER/LOCK item"
                ) from None
            raise
        self._owner = owner

    def ensure_ownership(self):
        if self._owner:
            lock = self._get("WORKER", "LOCK")
            if not lock or lock.get("owner") != self._owner:
                raise RuntimeError("Storage worker lock lost; refusing resource operations")

    def close(self):
        if self._owner:
            try:
                self.client.delete_item(
                    TableName=self.table_name,
                    Key=self._key("WORKER", "LOCK"),
                    ConditionExpression="#owner = :owner",
                    ExpressionAttributeNames={"#owner": "owner"},
                    ExpressionAttributeValues=self._encode({":owner": self._owner}),
                )
            except ClientError as exc:
                if not self._conflict(exc):
                    raise
            finally:
                self._owner = None

    def record_collection(self, provider, offers, error=None):
        now, batch = timestamp(), str(uuid4())
        prefix = now + "#" + batch + "#"
        # Bulk writes finish BEFORE the pointer/commit marker transaction becomes visible.
        pending = []
        for index, offer in enumerate(offers):
            offer.observed_at = now
            record = {
                "id": prefix + f"{index:08}",
                "collection_id": batch,
                "offer_id": offer.offer_id,
                **{
                    k: getattr(offer, k)
                    for k in ["provider", "cloud", "sku", "region", "market", "gpu_model"]
                },
                "observed_at": now,
                "payload": offer.model_dump(mode="json"),
            }
            pending.append(
                {"PutRequest": {"Item": self._item("PRICE#" + provider, record["id"], record)}}
            )
        for start in range(0, len(pending), 25):
            requests = {self.table_name: pending[start : start + 25]}
            for attempt in range(8):
                response = self.client.batch_write_item(RequestItems=requests)
                requests = response.get("UnprocessedItems", {})
                if not any(requests.values()):
                    break
                import time

                time.sleep(min(0.1 * 2**attempt, 2))
            else:
                raise RuntimeError(
                    "DynamoDB catalog batch has unprocessed writes; it was not published"
                )
        collection = {
            "id": batch,
            "provider": provider,
            "observed_at": now,
            "status": "error" if error else "ok",
            "count": len(offers),
            "error": error,
            "prefix": prefix,
        }
        for _ in range(10):
            current = self._get("PROVIDER#" + provider, "META")
            body = json.loads(current["body"]) if current else {}
            if not body.get("status") or body["status"]["observed_at"] <= now:
                body["status"] = collection
            if not error and (not body.get("success") or body["success"]["observed_at"] <= now):
                body["success"] = collection
            try:
                self._transaction(
                    [
                        self._put("PROVIDER#" + provider, "META", body, current),
                        self._put("COLLECTION#" + provider, prefix, collection),
                    ]
                )
                return
            except ClientError as exc:
                if not self._conflict(exc):
                    raise
                self.ensure_ownership()
        raise RuntimeError("DynamoDB catalog publish conflicted repeatedly")

    def collection_status(self):
        result = []
        for provider in sorted(PROVIDERS):
            item = self._get("PROVIDER#" + provider, "META")
            if item:
                status = dict(json.loads(item["body"])["status"])
                status.pop("prefix", None)
                result.append(status)
        return result

    @staticmethod
    def _matches(record, filters):
        for key in ["provider", "cloud", "sku", "region", "market", "gpu_model", "offer_id"]:
            if filters.get(key) is not None and record[key] != filters[key]:
                return False
        return not (
            (filters.get("since") is not None and record["observed_at"] < filters["since"])
            or (filters.get("until") is not None and record["observed_at"] > filters["until"])
        )

    def latest(self, **filters):
        records = []
        for provider in PROVIDERS:
            if filters.get("provider") is not None and filters["provider"] != provider:
                continue
            metadata = self._get("PROVIDER#" + provider, "META")
            success = json.loads(metadata["body"]).get("success") if metadata else None
            if success:
                records.extend(
                    json.loads(item["body"])
                    for item in self._query("PRICE#" + provider, success["prefix"])
                )
        records = [r for r in records if self._matches(r, filters)]
        records.sort(
            key=lambda r: tuple(r[k] for k in ["provider", "cloud", "sku", "region", "market"])
        )
        return [Offer.model_validate(r["payload"]) for r in records]

    def get_offer(self, offer_id):
        rows = self.latest(offer_id=offer_id)
        return rows[0] if rows else None

    def history(self, limit=100, offset=0, **filters):
        records = []
        for provider in PROVIDERS:
            if filters.get("provider") is not None and filters["provider"] != provider:
                continue
            # Unpublished partial batches are deliberately excluded from history as well.
            committed = {
                json.loads(item["body"])["id"] for item in self._query("COLLECTION#" + provider)
            }
            for item in self._query("PRICE#" + provider):
                record = json.loads(item["body"])
                if record["collection_id"] in committed and self._matches(record, filters):
                    records.append(record)
        records.sort(key=lambda r: (r["observed_at"], r["id"]), reverse=True)
        return len(records), [
            (r["id"], Offer.model_validate(r["payload"])) for r in records[offset : offset + limit]
        ]

    def historical_offer(self, offer_id):
        _, rows = self.history(offer_id=offer_id, limit=1)
        return rows[0][1] if rows else None

    def _event_writes(self, order_id, state, now, handoff=None):
        event = new_event(order_id, state, now, handoff)
        sk = now + "#" + event["id"]
        return [
            self._put("EVENT#" + order_id, sk, event),
            self._put("OUTBOX", sk, event),
            self._put("EVENTID#" + event["id"], "META", {"sk": sk, "order_id": order_id}),
        ]

    def create_order(self, request, offer, key):
        existing = self.get_order_by_key(key)
        if existing:
            if existing["fingerprint"] != fingerprint(request):
                raise ValueError("idempotency_key_conflict")
            return existing, False
        order = new_order(request, offer, key)
        identity = "IDEMP#" + hashlib.sha256(key.encode()).hexdigest()
        for _ in range(10):
            try:
                self._transaction(
                    [
                        self._put("ORDERS", order["id"], order),
                        self._put(identity, "META", {"order_id": order["id"]}),
                        *self._event_writes(order["id"], order["state"], order["created_at"]),
                    ]
                )
                return order, True
            except ClientError as exc:
                if not self._conflict(exc):
                    raise
                self.ensure_ownership()
                existing = self.get_order_by_key(key)
                if existing:
                    if existing["fingerprint"] != fingerprint(request):
                        raise ValueError("idempotency_key_conflict") from None
                    return existing, False
        raise RuntimeError("DynamoDB order creation conflicted repeatedly")

    def get_order(self, order_id):
        item = self._get("ORDERS", order_id)
        return json.loads(item["body"]) if item else None

    def get_order_by_key(self, key):
        item = self._get("IDEMP#" + hashlib.sha256(key.encode()).hexdigest(), "META")
        return self.get_order(json.loads(item["body"])["order_id"]) if item else None

    def orders(self, limit=100, offset=0, states=None):
        rows = [json.loads(item["body"]) for item in self._query("ORDERS")]
        rows = [r for r in rows if not states or r["state"] in states]
        rows.sort(key=lambda r: (r["created_at"], r["id"]))
        return rows[offset : offset + limit]

    def active_orders(self):
        return self.orders(limit=2**31 - 1, states=ACTIVE_STATES)

    def transition(self, order_id, state, *, expected=None, **fields):
        if not set(fields) <= ORDER_FIELDS:
            raise ValueError("invalid_order_field")
        for _ in range(10):
            item = self._get("ORDERS", order_id)
            if not item:
                return False
            order = json.loads(item["body"])
            if expected and order["state"] not in expected:
                return False
            now = timestamp()
            updated = {**order, "state": state, "updated_at": now, **fields}
            writes = [self._put("ORDERS", order_id, updated, item)]
            if order["state"] != state or "handoff" in fields:
                writes.extend(self._event_writes(order_id, state, now, fields.get("handoff")))
            try:
                self._transaction(writes)
                return True
            except ClientError as exc:
                if not self._conflict(exc):
                    raise
                self.ensure_ownership()
        raise RuntimeError("DynamoDB order transition conflicted repeatedly")

    def recover(self):
        for order in self.orders(limit=2**31 - 1, states={"checking", "submitting"}):
            if order["state"] == "checking":
                self.transition(order["id"], "queued", expected={"checking"})
            else:
                self.transition(
                    order["id"],
                    "needs_reconciliation",
                    expected={"submitting"},
                    error="process_stopped_during_create",
                )

    def events(self, order_id=None, pending=False, limit=100, offset=0):
        rows = [
            json.loads(item["body"])
            for item in self._query("EVENT#" + order_id if order_id else "OUTBOX")
        ]
        if pending:
            now = timestamp()
            rows = [r for r in rows if r["delivered_at"] is None and r["next_attempt_at"] <= now]
        rows.sort(key=lambda r: (r["created_at"], r["id"]))
        return rows[offset : offset + limit]

    def webhook_result(self, event_id, delivered, attempts):
        pointer = self._get("EVENTID#" + event_id, "META")
        if not pointer:
            return
        location = json.loads(pointer["body"])
        for _ in range(10):
            outbox = self._get("OUTBOX", location["sk"])
            per_order = self._get("EVENT#" + location["order_id"], location["sk"])
            if not outbox or not per_order:
                raise RuntimeError("DynamoDB outbox event is incomplete")
            event = json.loads(outbox["body"])
            next_at = (
                utcnow() + timedelta(seconds=min(3600, 15 * 2 ** min(attempts, 8)))
            ).isoformat()
            event.update(
                attempts=attempts,
                delivered_at=timestamp() if delivered else None,
                next_attempt_at=next_at,
            )
            try:
                self._transaction(
                    [
                        self._put("OUTBOX", location["sk"], event, outbox),
                        self._put(
                            "EVENT#" + location["order_id"], location["sk"], event, per_order
                        ),
                    ]
                )
                return
            except ClientError as exc:
                if not self._conflict(exc):
                    raise
                self.ensure_ownership()
        raise RuntimeError("DynamoDB webhook update conflicted repeatedly")
