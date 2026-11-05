"""Transactional rental lookup keys; old records are indexed once before first query."""

import hashlib
import json


def scope(tenant, customer=None, reference=None):
    return hashlib.sha256(json.dumps([tenant, customer, reference]).encode()).hexdigest()


def entries(doc):
    if doc["kind"] != "rental":
        return []
    rfq = doc.get("rfq") or {}
    tenant, customer = doc["tenant_id"], rfq.get("customer_ref")
    keys = {scope(tenant)}
    if customer is not None:
        keys.add(scope(tenant, customer))
        if rfq.get("upstream_order_id") is not None:
            keys.add(scope(tenant, customer, rfq["upstream_order_id"]))
    return [
        dict(scope=k, sort_key=doc.get("created_at", "") + "#" + doc["id"], rental_id=doc["id"])
        for k in sorted(keys)
    ]


class RentalDirectory:
    def __init__(self, db):
        self.db, self.store = db, db.store
        if hasattr(self.store, "engine"):
            import sqlalchemy as sa

            metadata = sa.MetaData()
            self.table = sa.Table(
                "rental_directory",
                metadata,
                sa.Column("scope", sa.String(64, collation="utf8mb4_bin"), primary_key=True),
                sa.Column("sort_key", sa.String(100, collation="utf8mb4_bin"), primary_key=True),
                sa.Column("rental_id", sa.String(36), nullable=False),
            )
            metadata.create_all(self.store.engine)
        elif not hasattr(self.store, "client"):
            with self.store.connect() as c:
                c.execute(
                    "CREATE TABLE IF NOT EXISTS rental_directory (scope TEXT NOT NULL, sort_key TEXT NOT NULL, rental_id TEXT NOT NULL, PRIMARY KEY(scope, sort_key))"
                )

    def sql_write(self, connection, values):
        if not values:
            return
        if hasattr(self.store, "engine"):
            prefix = "IGNORE" if self.store.engine.dialect.name == "mysql" else "OR IGNORE"
            connection.execute(self.table.insert().prefix_with(prefix), values)
        else:
            connection.executemany(
                "INSERT OR IGNORE INTO rental_directory(scope,sort_key,rental_id) VALUES(:scope,:sort_key,:rental_id)",
                values,
            )

    def ddb_writes(self, values):
        return [
            {
                "Put": {
                    "TableName": self.store.table_name,
                    "Item": self.store._item(
                        "RENTALS#" + v["scope"], v["sort_key"], {"id": v["rental_id"]}
                    ),
                }
            }
            for v in values
        ]

    def ensure(self):
        # The marker is written only after every old record has been indexed. Index writes
        # are idempotent; a crash resumes safely, without changing rental versions/events.
        if getattr(self, "ready", False):
            return
        marker = "rental-directory-v1"
        if self.db.get("migration", marker):
            self.ready = True
            return
        if hasattr(self.store, "client"):
            params = dict(
                TableName=self.store.table_name,
                ConsistentRead=True,
                KeyConditionExpression="pk = :pk",
                ExpressionAttributeValues=self.store._encode({":pk": "WF#rental"}),
            )
            while True:
                page = self.store.client.query(**params)
                for item in page["Items"]:
                    doc = json.loads(self.store.deserializer.deserialize(item["body"]))
                    self.store._transaction(self.ddb_writes(entries(doc)))
                if not page.get("LastEvaluatedKey"):
                    break
                params["ExclusiveStartKey"] = page["LastEvaluatedKey"]
        else:
            # Keyset batches bound memory even on a large legacy tenant.
            last = ""
            while True:
                if hasattr(self.store, "engine"):
                    import sqlalchemy as sa

                    with self.store.engine.begin() as c:
                        rows = c.execute(
                            sa.select(self.db.table.c.id, self.db.table.c.payload)
                            .where(self.db.table.c.kind == "rental", self.db.table.c.id > last)
                            .order_by(self.db.table.c.id)
                            .limit(200)
                        ).all()
                        self.sql_write(
                            c, [v for _, payload in rows for v in entries(json.loads(payload))]
                        )
                else:
                    with self.store.connect() as c:
                        rows = c.execute(
                            "SELECT id,payload FROM workflow_records WHERE kind='rental' AND id>? ORDER BY id LIMIT 200",
                            (last,),
                        ).fetchall()
                        self.sql_write(
                            c, [v for _, payload in rows for v in entries(json.loads(payload))]
                        )
                if not rows:
                    break
                last = rows[-1][0]
        from spotbot.storage.workflows import ConflictError

        try:
            self.db.save(dict(id=marker, kind="migration", tenant_id="system", version=0))
        except ConflictError:
            pass
        self.ready = True

    def page(self, tenant, customer=None, reference=None, *, limit=100, offset=0):
        self.ensure()
        key = scope(tenant, customer, reference)
        if hasattr(self.store, "client"):
            args = dict(
                TableName=self.store.table_name,
                ConsistentRead=True,
                KeyConditionExpression="pk = :pk",
                ScanIndexForward=False,
                ExpressionAttributeValues=self.store._encode({":pk": "RENTALS#" + key}),
            )
            total = 0
            while True:
                result = self.store.client.query(**args, Select="COUNT")
                total += result["Count"]
                if not result.get("LastEvaluatedKey"):
                    break
                args["ExclusiveStartKey"] = result["LastEvaluatedKey"]
            args.pop("ExclusiveStartKey", None)
            ids, skipped = [], 0
            while len(ids) < limit and skipped < total:
                result = self.store.client.query(
                    **args, Limit=min(1000, max(1, offset - skipped + limit - len(ids)))
                )
                for item in result["Items"]:
                    if skipped >= offset and len(ids) < limit:
                        ids.append(
                            json.loads(self.store.deserializer.deserialize(item["body"]))["id"]
                        )
                    skipped += 1
                if not result.get("LastEvaluatedKey"):
                    break
                args["ExclusiveStartKey"] = result["LastEvaluatedKey"]
        elif hasattr(self.store, "engine"):
            import sqlalchemy as sa

            with self.store.engine.connect() as c:
                total = c.execute(
                    sa.select(sa.func.count())
                    .select_from(self.table)
                    .where(self.table.c.scope == key)
                ).scalar_one()
                ids = list(
                    c.execute(
                        sa.select(self.table.c.rental_id)
                        .where(self.table.c.scope == key)
                        .order_by(self.table.c.sort_key.desc())
                        .limit(limit)
                        .offset(offset)
                    ).scalars()
                )
        else:
            with self.store.connect() as c:
                total = c.execute(
                    "SELECT count(*) FROM rental_directory WHERE scope=?", (key,)
                ).fetchone()[0]
                ids = [
                    r[0]
                    for r in c.execute(
                        "SELECT rental_id FROM rental_directory WHERE scope=? ORDER BY sort_key DESC LIMIT ? OFFSET ?",
                        (key, limit, offset),
                    )
                ]
        docs = self.read(ids)
        # Indexes only accelerate selection; the rental remains the authorization authority.
        docs = [
            d
            for d in docs
            if d
            and d["tenant_id"] == tenant
            and (customer is None or d.get("rfq", {}).get("customer_ref") == customer)
            and (reference is None or d.get("rfq", {}).get("upstream_order_id") == reference)
        ]
        return dict(total=total, items=docs)

    def read(self, ids):
        if not ids:
            return []
        if hasattr(self.store, "client"):
            docs = []
            for start in range(0, len(ids), 100):
                request = {
                    self.store.table_name: dict(
                        Keys=[self.store._key("WF#rental", i) for i in ids[start : start + 100]],
                        ConsistentRead=True,
                    )
                }
                for attempt in range(6):
                    result = self.store.client.batch_get_item(RequestItems=request)
                    docs.extend(
                        json.loads(self.store.deserializer.deserialize(i["body"]))
                        for i in result.get("Responses", {}).get(self.store.table_name, [])
                    )
                    request = result.get("UnprocessedKeys")
                    if not request:
                        break
                    import time

                    time.sleep(0.05 * 2**attempt)
                else:
                    raise RuntimeError("rental_directory_read_incomplete")
        elif hasattr(self.store, "engine"):
            import sqlalchemy as sa

            with self.store.engine.connect() as c:
                docs = [
                    json.loads(p)
                    for p in c.execute(
                        sa.select(self.db.table.c.payload).where(
                            self.db.table.c.kind == "rental", self.db.table.c.id.in_(ids)
                        )
                    ).scalars()
                ]
        else:
            with self.store.connect() as c:
                docs = [
                    json.loads(r[0])
                    for r in c.execute(
                        "SELECT payload FROM workflow_records WHERE kind='rental' AND id IN ("
                        + ",".join("?" for _ in ids)
                        + ")",
                        ids,
                    )
                ]
        found = {d["id"]: d for d in docs}
        return [found[i] for i in ids if i in found]
