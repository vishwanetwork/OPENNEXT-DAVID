"""Storage contract shared by SQL and DynamoDB adapters."""

import hashlib
import json
from datetime import timedelta
from typing import Protocol
from uuid import uuid4

from spotbot.models import Offer, OrderRequest, timestamp, utcnow


def dump(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def fingerprint(request: OrderRequest) -> str:
    payload = request.model_dump(mode="json")
    # Preserve business-key replays for orders persisted before AWS launch fields existed.
    for key in {"image_id", "subnet_id", "security_group_ids", "key_name", "root_volume_gb"}:
        if payload["launch"].get(key) in (None, []):
            payload["launch"].pop(key, None)
    return hashlib.sha256(dump(payload).encode()).hexdigest()


def new_order(request: OrderRequest, offer: Offer, key: str) -> dict:
    now = timestamp()
    return {
        "id": str(uuid4()),
        "idempotency_key": key,
        "fingerprint": fingerprint(request),
        "state": "planned" if request.dry_run else "queued",
        "request": request.model_dump(mode="json"),
        "offer": offer.model_dump(mode="json"),
        "instance_id": None,
        "attempts": 0,
        "created_at": now,
        "updated_at": now,
        "expires_at": (utcnow() + timedelta(seconds=request.wait_seconds)).isoformat(),
        "error": None,
        "handoff": None,
        "release_sent": 0,
    }


def new_event(order_id: str, state: str, now: str, handoff=None) -> dict:
    event_id = str(uuid4())
    return {
        "id": event_id,
        "order_id": order_id,
        "created_at": now,
        "payload": {
            "event_id": event_id,
            "type": f"order.{state}",
            "order_id": order_id,
            "occurred_at": now,
            "handoff": handoff,
        },
        "attempts": 0,
        "delivered_at": None,
        "next_attempt_at": now,
    }


ORDER_FIELDS = {"instance_id", "error", "handoff", "attempts", "release_sent", "offer"}
ACTIVE_STATES = {"queued", "provisioning", "ready", "releasing"}
PROVIDERS = ("lambda", "tensordock", "vultr", "shadeform", "aws")


class Storage(Protocol):
    def record_collection(self, provider: str, offers: list[Offer], error: str | None = None): ...
    def collection_status(self) -> list[dict]: ...
    def latest(self, **filters) -> list[Offer]: ...
    def get_offer(self, offer_id: str) -> Offer | None: ...
    def historical_offer(self, offer_id: str) -> Offer | None: ...
    def history(self, limit=100, offset=0, **filters) -> tuple[int, list]: ...
    def create_order(self, request: OrderRequest, offer: Offer, key: str) -> tuple[dict, bool]: ...
    def get_order(self, order_id: str) -> dict | None: ...
    def get_order_by_key(self, key: str) -> dict | None: ...
    def orders(self, limit=100, offset=0, states=None) -> list[dict]: ...
    def active_orders(self) -> list[dict]: ...
    def transition(self, order_id: str, state: str, *, expected=None, **fields) -> bool: ...
    def recover(self): ...
    def events(self, order_id=None, pending=False, limit=100, offset=0) -> list[dict]: ...
    def webhook_result(self, event_id: str, delivered: bool, attempts: int): ...
    def acquire(self): ...
    def ensure_ownership(self): ...
    def close(self): ...
