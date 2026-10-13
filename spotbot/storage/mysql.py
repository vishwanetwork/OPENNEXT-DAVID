"""Transactional MySQL storage using SQLAlchemy Core and PyMySQL."""

import hashlib
from datetime import timedelta

import sqlalchemy as sa
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError

from spotbot.models import Offer, timestamp, utcnow
from spotbot.storage.common import (
    ACTIVE_STATES,
    ORDER_FIELDS,
    dump,
    fingerprint,
    new_event,
    new_order,
)


def schema():
    metadata = sa.MetaData()

    def identity(n):
        return sa.String(n, collation="utf8mb4_bin")

    collections = sa.Table(
        "collections",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("provider", identity(32), nullable=False),
        sa.Column("observed_at", identity(40), nullable=False),
        sa.Column("status", identity(16), nullable=False),
        sa.Column("count", sa.Integer, nullable=False),
        sa.Column("error", sa.Text),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    prices = sa.Table(
        "prices",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("collection_id", sa.Integer, nullable=False),
        *(
            sa.Column(name, identity(size), nullable=False)
            for name, size in [
                ("offer_id", 24),
                ("provider", 32),
                ("cloud", 128),
                ("sku", 255),
                ("region", 128),
                ("market", 16),
                ("gpu_model", 128),
                ("observed_at", 40),
            ]
        ),
        sa.Column("payload", LONGTEXT, nullable=False),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    sa.Index("price_history", prices.c.provider, prices.c.sku, prices.c.observed_at, prices.c.id)
    sa.Index("price_offer", prices.c.offer_id, prices.c.id)
    sa.Index("price_batch", prices.c.collection_id)
    orders = sa.Table(
        "orders",
        metadata,
        sa.Column("id", identity(36), primary_key=True),
        sa.Column("idempotency_key", identity(200), unique=True, nullable=False),
        sa.Column("fingerprint", identity(64), nullable=False),
        sa.Column("state", identity(32), nullable=False),
        sa.Column("request", LONGTEXT, nullable=False),
        sa.Column("offer", LONGTEXT, nullable=False),
        sa.Column("instance_id", identity(200)),
        sa.Column("attempts", sa.Integer, nullable=False),
        *(
            sa.Column(name, identity(40), nullable=False)
            for name in ["created_at", "updated_at", "expires_at"]
        ),
        sa.Column("error", sa.Text),
        sa.Column("handoff", LONGTEXT),
        sa.Column("release_sent", sa.Integer, nullable=False),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    events = sa.Table(
        "events",
        metadata,
        sa.Column("id", identity(36), primary_key=True),
        sa.Column("order_id", identity(36), nullable=False),
        sa.Column("created_at", identity(40), nullable=False),
        sa.Column("payload", LONGTEXT, nullable=False),
        sa.Column("attempts", sa.Integer, nullable=False),
        sa.Column("delivered_at", identity(40)),
        sa.Column("next_attempt_at", identity(40), nullable=False),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    sa.Index("event_pending", events.c.delivered_at, events.c.next_attempt_at)
    sa.Index("event_order", events.c.order_id, events.c.created_at, events.c.id)
    return metadata, collections, prices, orders, events


def encode(record: dict, fields: set[str]) -> dict:
    return {k: dump(v) if k in fields and v is not None else v for k, v in record.items()}


def decode(record, fields: set[str]) -> dict | None:
    import json

    return (
        {k: json.loads(v) if k in fields and v is not None else v for k, v in record.items()}
        if record
        else None
    )


class MySQLStore:
    def __init__(self, url: str):
        parsed = make_url(url)
        if parsed.drivername != "mysql+pymysql" or not parsed.database:
            raise ValueError("MySQL requires a mysql+pymysql URL with a database name")
        self.engine = sa.create_engine(
            parsed,
            hide_parameters=True,
            pool_pre_ping=True,
            isolation_level="READ COMMITTED",
            connect_args={"connect_timeout": 10},
        )
        self.metadata, self.collections, self.prices, self.order_table, self.event_table = schema()
        self.metadata.create_all(self.engine)
        self._lock_connection = None
        self._lock_name = "spotbot:" + hashlib.sha256(parsed.database.encode()).hexdigest()[:40]

    def acquire(self):
        connection = self.engine.connect()
        try:
            acquired = connection.execute(
                sa.text("SELECT GET_LOCK(:name, 0)"), {"name": self._lock_name}
            ).scalar()
            if acquired != 1:
                raise RuntimeError(
                    "This database already has a running SpotOrderBot process; use one worker"
                )
            self._lock_connection = connection
        except Exception:
            connection.close()
            raise

    def ensure_ownership(self):
        if self._lock_connection is not None:
            owned = self._lock_connection.execute(
                sa.text("SELECT IS_USED_LOCK(:name) = CONNECTION_ID()"), {"name": self._lock_name}
            ).scalar()
            if owned != 1:
                raise RuntimeError("Storage worker lock lost; refusing resource operations")

    def close(self):
        if self._lock_connection is not None:
            try:
                self._lock_connection.execute(
                    sa.text("SELECT RELEASE_LOCK(:name)"), {"name": self._lock_name}
                )
            finally:
                self._lock_connection.close()
                self._lock_connection = None
        self.engine.dispose()

    def record_collection(self, provider, offers, error=None):
        now = timestamp()
        with self.engine.begin() as connection:
            batch = connection.execute(
                self.collections.insert().values(
                    provider=provider,
                    observed_at=now,
                    status="error" if error else "ok",
                    count=len(offers),
                    error=error,
                )
            ).inserted_primary_key[0]
            records = []
            for offer in offers:
                offer.observed_at = now
                records.append(
                    {
                        "collection_id": batch,
                        "offer_id": offer.offer_id,
                        **{
                            k: getattr(offer, k)
                            for k in ["provider", "cloud", "sku", "region", "market", "gpu_model"]
                        },
                        "observed_at": now,
                        "payload": offer.model_dump_json(),
                    }
                )
            if records:
                connection.execute(self.prices.insert(), records)

    def collection_status(self):
        subquery = sa.select(sa.func.max(self.collections.c.id)).group_by(
            self.collections.c.provider
        )
        with self.engine.connect() as connection:
            return [
                dict(r)
                for r in connection.execute(
                    sa.select(self.collections)
                    .where(self.collections.c.id.in_(subquery))
                    .order_by(self.collections.c.provider)
                ).mappings()
            ]

    def _filters(self, query, filters):
        for key in ["provider", "cloud", "sku", "region", "market", "gpu_model", "offer_id"]:
            if filters.get(key) is not None:
                query = query.where(self.prices.c[key] == filters[key])
        if filters.get("since") is not None:
            query = query.where(self.prices.c.observed_at >= filters["since"])
        if filters.get("until") is not None:
            query = query.where(self.prices.c.observed_at <= filters["until"])
        return query

    def latest(self, **filters):
        batches = (
            sa.select(sa.func.max(self.collections.c.id))
            .where(self.collections.c.status == "ok")
            .group_by(self.collections.c.provider)
        )
        query = self._filters(
            sa.select(self.prices.c.payload).where(self.prices.c.collection_id.in_(batches)),
            filters,
        )
        query = query.order_by(
            *(self.prices.c[k] for k in ["provider", "cloud", "sku", "region", "market"])
        )
        with self.engine.connect() as connection:
            return [Offer.model_validate_json(r[0]) for r in connection.execute(query)]

    def get_offer(self, offer_id):
        offers = self.latest(offer_id=offer_id)
        return offers[0] if offers else None

    def historical_offer(self, offer_id):
        with self.engine.connect() as connection:
            payload = connection.execute(
                sa.select(self.prices.c.payload)
                .where(self.prices.c.offer_id == offer_id)
                .order_by(self.prices.c.id.desc())
                .limit(1)
            ).scalar()
        return Offer.model_validate_json(payload) if payload else None

    def history(self, limit=100, offset=0, **filters):
        query = self._filters(sa.select(self.prices.c.id, self.prices.c.payload), filters)
        with self.engine.connect() as connection:
            total = connection.execute(
                self._filters(sa.select(sa.func.count()).select_from(self.prices), filters)
            ).scalar_one()
            rows = connection.execute(
                query.order_by(self.prices.c.observed_at.desc(), self.prices.c.id.desc())
                .limit(limit)
                .offset(offset)
            ).all()
        return total, [(r[0], Offer.model_validate_json(r[1])) for r in rows]

    def _insert_event(self, connection, order_id, state, now, handoff=None):
        connection.execute(
            self.event_table.insert().values(
                **encode(new_event(order_id, state, now, handoff), {"payload"})
            )
        )

    def create_order(self, request, offer, key):
        order = new_order(request, offer, key)
        try:
            with self.engine.begin() as connection:
                connection.execute(
                    self.order_table.insert().values(
                        **encode(order, {"request", "offer", "handoff"})
                    )
                )
                self._insert_event(connection, order["id"], order["state"], order["created_at"])
            return order, True
        except IntegrityError:
            existing = self.get_order_by_key(key)
            if existing is None:
                raise
            if existing["fingerprint"] != fingerprint(request):
                raise ValueError("idempotency_key_conflict") from None
            return existing, False

    def _one_order(self, condition):
        with self.engine.connect() as connection:
            row = (
                connection.execute(sa.select(self.order_table).where(condition)).mappings().first()
            )
        return decode(row, {"request", "offer", "handoff"})

    def get_order(self, order_id):
        return self._one_order(self.order_table.c.id == order_id)

    def get_order_by_key(self, key):
        return self._one_order(self.order_table.c.idempotency_key == key)

    def orders(self, limit=100, offset=0, states=None):
        query = sa.select(self.order_table)
        if states:
            query = query.where(self.order_table.c.state.in_(states))
        with self.engine.connect() as connection:
            rows = connection.execute(
                query.order_by(self.order_table.c.created_at, self.order_table.c.id)
                .limit(limit)
                .offset(offset)
            ).mappings()
            return [decode(r, {"request", "offer", "handoff"}) for r in rows]

    def active_orders(self):
        with self.engine.connect() as connection:
            return [
                decode(r, {"request", "offer", "handoff"})
                for r in connection.execute(
                    sa.select(self.order_table)
                    .where(self.order_table.c.state.in_(ACTIVE_STATES))
                    .order_by(self.order_table.c.created_at, self.order_table.c.id)
                ).mappings()
            ]

    def transition(self, order_id, state, *, expected=None, **fields):
        if not set(fields) <= ORDER_FIELDS:
            raise ValueError("invalid_order_field")
        now = timestamp()
        with self.engine.begin() as connection:
            row = (
                connection.execute(
                    sa.select(self.order_table)
                    .where(self.order_table.c.id == order_id)
                    .with_for_update()
                )
                .mappings()
                .first()
            )
            if row is None or (expected and row["state"] not in expected):
                return False
            connection.execute(
                self.order_table.update()
                .where(self.order_table.c.id == order_id)
                .values(state=state, updated_at=now, **encode(fields, {"offer", "handoff"}))
            )
            if row["state"] != state or "handoff" in fields:
                self._insert_event(connection, order_id, state, now, fields.get("handoff"))
        return True

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
        query = sa.select(self.event_table)
        if order_id:
            query = query.where(self.event_table.c.order_id == order_id)
        if pending:
            query = query.where(
                self.event_table.c.delivered_at.is_(None),
                self.event_table.c.next_attempt_at <= timestamp(),
            )
        with self.engine.connect() as connection:
            return [
                decode(r, {"payload"})
                for r in connection.execute(
                    query.order_by(self.event_table.c.created_at, self.event_table.c.id)
                    .limit(limit)
                    .offset(offset)
                ).mappings()
            ]

    def webhook_result(self, event_id, delivered, attempts):
        next_at = (utcnow() + timedelta(seconds=min(3600, 15 * 2 ** min(attempts, 8)))).isoformat()
        with self.engine.begin() as connection:
            connection.execute(
                self.event_table.update()
                .where(self.event_table.c.id == event_id)
                .values(
                    attempts=attempts,
                    delivered_at=timestamp() if delivered else None,
                    next_attempt_at=next_at,
                )
            )
