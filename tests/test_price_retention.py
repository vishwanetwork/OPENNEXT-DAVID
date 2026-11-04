"""Tiered retention of price collection snapshots."""

from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from pydantic import ValidationError

from spotbot.config import Settings
from spotbot.price_retention import plan
from spotbot.storage.mysql import MySQLStore
from spotbot.storage.sqlite import Store as SQLiteStore
from tests.test_storage import offer as offer  # noqa: F401

NOW = datetime(2026, 11, 4, 12, 0, tzinfo=UTC)
TIERS = dict(raw_days=3, hourly_days=30, daily_days=90)


def at(**ago):
    return (NOW - timedelta(**ago)).isoformat()


def test_plan_thins_each_tier_and_keeps_every_newest_collection():
    # Collection ids grow with time, as the database assigns them.
    collections = [
        (1, "vultr", at(days=300), "ok"),  # too old: removed
        (2, "aws", at(days=100), "ok"),  # too old: removed
        (3, "vultr", at(days=200), "ok"),  # too old, but vultr's newest: kept
        (4, "aws", at(days=40, hours=3), "ok"),  # daily: first of that day kept
        (5, "aws", at(days=40, hours=2), "ok"),  # same day: removed
        (6, "aws", at(days=5, minutes=50), "error"),  # hourly, failed: removed
        (7, "aws", at(days=5, minutes=40), "ok"),  # first success of the hour: kept
        (8, "aws", at(days=5, minutes=35), "ok"),  # same hour: removed
        (9, "aws", at(hours=2), "error"),  # raw: kept
        (10, "aws", at(hours=1), "ok"),  # raw and newest: kept
    ]
    assert plan(collections, NOW, **TIERS) == [1, 2, 5, 6, 8]


def test_newest_collection_is_kept_even_inside_a_thinned_bucket():
    collections = [
        (1, "aws", at(days=5, minutes=50), "ok"),
        (2, "aws", at(days=5, minutes=40), "ok"),
    ]
    # Collection 2 is aws's newest; collection 1 keeps the hour.
    assert plan(collections, NOW, **TIERS) == []


def test_sqlite_retention_removes_rows_and_keeps_latest(tmp_path, offer):
    store = SQLiteStore(tmp_path / "prices.sqlite3")
    for _ in range(4):
        store.record_collection(offer.provider, [offer])
    ages = {1: at(days=100), 2: at(days=40, hours=3), 3: at(days=40, hours=2)}
    with store.connect() as c:
        for cid, observed in ages.items():
            c.execute("UPDATE collections SET observed_at=? WHERE id=?", (observed, cid))
    remove = plan(store.collection_index(), datetime.now(UTC), **TIERS)
    assert remove == [1, 3]
    assert store.remove_collections(remove, pause=0) == 2
    assert [row[0] for row in store.collection_index()] == [2, 4]
    assert store.latest()[0].offer_id == offer.offer_id
    with store.connect() as c:
        assert c.execute("SELECT count(*) FROM prices").fetchone()[0] == 2


def test_mysql_remove_collections_deletes_both_tables(offer):
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    collections = sa.Table(
        "collections",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("provider", sa.String),
        sa.Column("observed_at", sa.String),
        sa.Column("status", sa.String),
    )
    prices = sa.Table(
        "prices", metadata, sa.Column("collection_id", sa.Integer), sa.Column("payload", sa.Text)
    )
    metadata.create_all(engine)
    adapter = MySQLStore.__new__(MySQLStore)
    adapter.engine, adapter.collections, adapter.prices = engine, collections, prices
    with engine.begin() as c:
        c.execute(
            collections.insert(),
            [dict(id=i, provider="aws", observed_at=at(days=i), status="ok") for i in (1, 2)],
        )
        c.execute(prices.insert(), [dict(collection_id=i, payload="{}") for i in (1, 1, 2)])
    assert sorted(adapter.collection_index())[0][:2] == (1, "aws")
    assert adapter.remove_collections([1], pause=0) == 2
    assert [row[0] for row in adapter.collection_index()] == [2]


def test_retention_days_must_be_ordered():
    with pytest.raises(ValidationError, match="raw <= hourly <= daily"):
        Settings(_env_file=None, spotbot_price_retention_raw_days=40)
    assert Settings(_env_file=None).spotbot_price_retention_enabled is False
