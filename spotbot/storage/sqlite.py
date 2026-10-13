import fcntl
import hashlib
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

from spotbot.models import Offer, OrderRequest, timestamp, utcnow


def dump(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


class Store:
    def __init__(self, path: Path):
        self.path = path
        self._process_lock = None
        path.parent.mkdir(parents=True, exist_ok=True)
        # Persisted launch bootstrap may contain secrets; restrict data files at creation.
        fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(fd)
        os.chmod(path, 0o600)
        with self.connect() as c:
            c.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS collections (
                    id INTEGER PRIMARY KEY, provider TEXT NOT NULL, observed_at TEXT NOT NULL,
                    status TEXT NOT NULL, count INTEGER NOT NULL, error TEXT
                );
                CREATE TABLE IF NOT EXISTS prices (
                    id INTEGER PRIMARY KEY, collection_id INTEGER NOT NULL,
                    offer_id TEXT NOT NULL, provider TEXT NOT NULL, cloud TEXT NOT NULL,
                    sku TEXT NOT NULL, region TEXT NOT NULL, market TEXT NOT NULL,
                    gpu_model TEXT NOT NULL, observed_at TEXT NOT NULL, payload TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS price_history ON prices(provider,sku,observed_at,id);
                CREATE INDEX IF NOT EXISTS price_offer ON prices(offer_id,id);
                CREATE INDEX IF NOT EXISTS price_batch ON prices(collection_id);
                CREATE TABLE IF NOT EXISTS orders (
                    id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE NOT NULL,
                    fingerprint TEXT NOT NULL, state TEXT NOT NULL, request TEXT NOT NULL,
                    offer TEXT NOT NULL, instance_id TEXT, attempts INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL,
                    error TEXT, handoff TEXT, release_sent INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS events (
                    id TEXT PRIMARY KEY, order_id TEXT NOT NULL, created_at TEXT NOT NULL,
                    payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
                    delivered_at TEXT, next_attempt_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS event_pending ON events(delivered_at,next_attempt_at);
            """)

    @contextmanager
    def connect(self):
        c = sqlite3.connect(self.path, timeout=10)
        c.row_factory = sqlite3.Row
        try:
            with c:
                yield c
        finally:
            c.close()

    def record_collection(self, provider: str, offers: list[Offer], error: str | None = None):
        now = timestamp()
        with self.connect() as c:
            batch = c.execute(
                "INSERT INTO collections(provider,observed_at,status,count,error) VALUES(?,?,?,?,?)",
                (provider, now, "error" if error else "ok", len(offers), error),
            ).lastrowid
            for offer in offers:
                offer.observed_at = now
                c.execute(
                    "INSERT INTO prices(collection_id,offer_id,provider,cloud,sku,region,market,gpu_model,observed_at,payload) VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (
                        batch,
                        offer.offer_id,
                        offer.provider,
                        offer.cloud,
                        offer.sku,
                        offer.region,
                        offer.market,
                        offer.gpu_model,
                        now,
                        offer.model_dump_json(),
                    ),
                )

    def collection_status(self):
        with self.connect() as c:
            return [
                dict(r)
                for r in c.execute(
                    "SELECT * FROM collections WHERE id IN (SELECT MAX(id) FROM collections GROUP BY provider) ORDER BY provider"
                )
            ]

    def latest(self, **filters) -> list[Offer]:
        clauses, values = self._filters(filters)
        query = """SELECT p.payload FROM prices p WHERE p.collection_id IN (
                    SELECT MAX(id) FROM collections WHERE status='ok' GROUP BY provider)"""
        if clauses:
            query += " AND " + " AND ".join(clauses)
        with self.connect() as c:
            return [
                Offer.model_validate_json(r[0])
                for r in c.execute(query + " ORDER BY provider,cloud,sku,region,market", values)
            ]

    def get_offer(self, offer_id: str) -> Offer | None:
        offers = self.latest(offer_id=offer_id)
        return offers[0] if offers else None

    def historical_offer(self, offer_id: str) -> Offer | None:
        with self.connect() as c:
            r = c.execute(
                "SELECT payload FROM prices WHERE offer_id=? ORDER BY id DESC LIMIT 1", (offer_id,)
            ).fetchone()
            return Offer.model_validate_json(r[0]) if r else None

    @staticmethod
    def _filters(filters):
        clauses, values = [], []
        for k in ["provider", "cloud", "sku", "region", "market", "gpu_model", "offer_id"]:
            if filters.get(k) is not None:
                clauses.append(f"p.{k}=?")
                values.append(filters[k])
        for key, op in [("since", ">="), ("until", "<=")]:
            if filters.get(key) is not None:
                clauses.append(f"p.observed_at{op}?")
                values.append(filters[key])
        return clauses, values

    def history(self, limit=100, offset=0, **filters):
        clauses, values = self._filters(filters)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with self.connect() as c:
            total = c.execute("SELECT COUNT(*) FROM prices p" + where, values).fetchone()[0]
            rows = c.execute(
                "SELECT p.id,p.payload FROM prices p"
                + where
                + " ORDER BY p.observed_at DESC,p.id DESC LIMIT ? OFFSET ?",
                [*values, limit, offset],
            ).fetchall()
        return total, [(r["id"], Offer.model_validate_json(r["payload"])) for r in rows]

    def create_order(self, request: OrderRequest, offer: Offer, key: str):
        payload = request.model_dump(mode="json")
        fingerprint = hashlib.sha256(dump(payload).encode()).hexdigest()
        now = timestamp()
        order_id = str(uuid4())
        state = "planned" if request.dry_run else "queued"
        with self.connect() as c:
            c.execute("BEGIN IMMEDIATE")
            existing = c.execute("SELECT * FROM orders WHERE idempotency_key=?", (key,)).fetchone()
            if existing:
                if existing["fingerprint"] != fingerprint:
                    raise ValueError("idempotency_key_conflict")
                return self._order(existing), False
            c.execute(
                "INSERT INTO orders(id,idempotency_key,fingerprint,state,request,offer,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    order_id,
                    key,
                    fingerprint,
                    state,
                    dump(payload),
                    offer.model_dump_json(),
                    now,
                    now,
                    (utcnow() + timedelta(seconds=request.wait_seconds)).isoformat(),
                ),
            )
            self._event(c, order_id, state, now)
        return self.get_order(order_id), True

    @staticmethod
    def _order(row):
        result = dict(row)
        for key in ["request", "offer", "handoff"]:
            result[key] = json.loads(result[key]) if result[key] else None
        return result

    def get_order(self, order_id: str):
        with self.connect() as c:
            r = c.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
        return self._order(r) if r else None

    def get_order_by_key(self, key: str):
        with self.connect() as c:
            row = c.execute("SELECT * FROM orders WHERE idempotency_key=?", (key,)).fetchone()
        return self._order(row) if row else None

    def acquire(self):
        self._process_lock = open(self.path.with_suffix(".lock"), "a+")
        try:
            fcntl.flock(self._process_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            self._process_lock.close()
            self._process_lock = None
            raise RuntimeError(
                "This database already has a running SpotOrderBot process; use one worker"
            ) from exc

    def ensure_ownership(self):
        return None  # The OS releases flock only when the handle closes or the process exits.

    def close(self):
        if self._process_lock:
            self._process_lock.close()
            self._process_lock = None

    def orders(self, limit=100, offset=0, states=None):
        with self.connect() as c:
            where, values = "", []
            if states:
                where = " WHERE state IN (" + ",".join("?" for _ in states) + ")"
                values = list(states)
            return [
                self._order(r)
                for r in c.execute(
                    "SELECT * FROM orders" + where + " ORDER BY created_at LIMIT ? OFFSET ?",
                    [*values, limit, offset],
                )
            ]

    def active_orders(self):
        # No pagination limit for worker processing; avoid starving older active orders.
        with self.connect() as c:
            return [
                self._order(r)
                for r in c.execute(
                    "SELECT * FROM orders WHERE state IN ('queued','provisioning','ready','releasing') ORDER BY created_at"
                )
            ]

    def transition(self, order_id: str, state: str, *, expected=None, **fields) -> bool:
        allowed = {"instance_id", "error", "handoff", "attempts", "release_sent", "offer"}
        if not set(fields) <= allowed:
            raise ValueError("invalid_order_field")
        now = timestamp()
        with self.connect() as c:
            c.execute("BEGIN IMMEDIATE")
            row = c.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
            if not row or (expected and row["state"] not in expected):
                return False
            values = [state, now]
            assignments = ["state=?", "updated_at=?"]
            for k, v in fields.items():
                assignments.append(f"{k}=?")
                values.append(dump(v) if k in {"handoff", "offer"} and v is not None else v)
            c.execute(
                "UPDATE orders SET " + ",".join(assignments) + " WHERE id=?", [*values, order_id]
            )
            if row["state"] != state or "handoff" in fields:
                handoff = fields.get("handoff")
                self._event(c, order_id, state, now, handoff)
        return True

    @staticmethod
    def _event(c, order_id, state, now, handoff=None):
        event_id = str(uuid4())
        payload = {
            "event_id": event_id,
            "type": f"order.{state}",
            "order_id": order_id,
            "occurred_at": now,
            "handoff": handoff,
        }
        c.execute(
            "INSERT INTO events(id,order_id,created_at,payload,next_attempt_at) VALUES(?,?,?,?,?)",
            (event_id, order_id, now, dump(payload), now),
        )

    def recover(self):
        # Recover through guarded transitions so state changes and events stay atomic.
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
        clauses, values = [], []
        if order_id:
            clauses.append("order_id=?")
            values.append(order_id)
        if pending:
            clauses.append("delivered_at IS NULL AND next_attempt_at<=?")
            values.append(timestamp())
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with self.connect() as c:
            rows = c.execute(
                "SELECT * FROM events" + where + " ORDER BY created_at,id LIMIT ? OFFSET ?",
                [*values, limit, offset],
            ).fetchall()
        return [dict(r, payload=json.loads(r["payload"])) for r in rows]

    def webhook_result(self, event_id: str, delivered: bool, attempts: int):
        next_at = (utcnow() + timedelta(seconds=min(3600, 15 * 2 ** min(attempts, 8)))).isoformat()
        with self.connect() as c:
            c.execute(
                "UPDATE events SET attempts=?,delivered_at=?,next_attempt_at=? WHERE id=?",
                (attempts, timestamp() if delivered else None, next_at, event_id),
            )
