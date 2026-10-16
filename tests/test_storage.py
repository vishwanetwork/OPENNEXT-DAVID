"""Shared storage contracts, plus real MySQL and DynamoDB Local integration tests."""

import copy
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from decimal import Decimal
from urllib.parse import urlparse
from uuid import uuid4

import boto3
import httpx
import pytest
import sqlalchemy as sa
from botocore.config import Config
from moto import mock_aws

from spotbot.config import Settings
from spotbot.models import LaunchOptions, Offer, OrderRequest, utcnow
from spotbot.service import Service
from spotbot.storage.dynamodb import DynamoDBStore
from spotbot.storage.mysql import MySQLStore
from spotbot.storage.sqlite import Store
from tests.test_orders import FakeShade


@pytest.fixture(params=["sqlite", "mysql", "dynamodb", "dynamodb-local"])
def storage(request, tmp_path):
    if request.param == "sqlite":
        store = Store(tmp_path / "contract.sqlite3")
        yield store
        store.close()
    elif request.param == "mysql":
        url = os.environ.get("SPOTBOT_TEST_MYSQL_URL")
        if not url:
            pytest.skip("SPOTBOT_TEST_MYSQL_URL is not configured")
        parsed = sa.engine.make_url(url)
        # Only databases created by this fixture are dropped; existing data is never touched.
        database = "spotbot_test_" + uuid4().hex
        admin = sa.create_engine(parsed.set(database=None), hide_parameters=True)
        with admin.begin() as c:
            c.exec_driver_sql(f"CREATE DATABASE `{database}` CHARACTER SET utf8mb4")
        store = MySQLStore(str(parsed.set(database=database).render_as_string(hide_password=False)))
        try:
            yield store
        finally:
            store.close()
            with admin.begin() as c:
                c.exec_driver_sql(f"DROP DATABASE `{database}`")
            admin.dispose()
    else:
        table = "SpotbotTest_" + uuid4().hex
        if request.param == "dynamodb":
            with mock_aws():
                client = boto3.client(
                    "dynamodb",
                    region_name="us-east-1",
                    aws_access_key_id="testing",
                    aws_secret_access_key="testing",
                )
                store = DynamoDBStore(table, client=client, create_table=True)
                try:
                    yield store
                finally:
                    store.close()
        else:
            endpoint = os.environ.get("SPOTBOT_TEST_DYNAMODB_ENDPOINT")
            if not endpoint:
                pytest.skip("SPOTBOT_TEST_DYNAMODB_ENDPOINT is not configured")
            assert urlparse(endpoint).hostname in {"localhost", "127.0.0.1", "::1"}
            client = boto3.client(
                "dynamodb",
                region_name="us-east-1",
                endpoint_url=endpoint,
                aws_access_key_id="testing",
                aws_secret_access_key="testing",
                config=Config(connect_timeout=5, read_timeout=30),
            )
            store = DynamoDBStore(table, client=client, create_table=True)
            try:
                yield store
            finally:
                store.close()
                client.delete_table(TableName=table)


@pytest.fixture
def offer():
    return Offer(
        provider="shadeform",
        cloud="excesssupply",
        sku="H100_sxm5",
        region="us-central-1",
        market="spot",
        gpu_model="H100",
        gpu_description="H100 SXM 80GB",
        gpu_count=1,
        vcpus=16,
        memory_gb=128,
        storage_gb=100,
        price_hourly="1.50",
        available=True,
        source_url="https://api.shadeform.ai/v1/instances/types",
    )


@pytest.fixture
def order_request(offer):
    return OrderRequest(
        offer_id=offer.offer_id,
        max_price_hourly="2.00",
        dry_run=False,
        launch=LaunchOptions(ssh_key_id="key"),
        inference_port=8000,
    )


def test_aws_zonal_catalog_round_trip_across_backends(storage, offer):
    west = offer.model_copy(
        update={
            "provider": "aws",
            "cloud": "aws",
            "region": "us-west-2",
            "availability_zone": "us-west-2a",
        }
    )
    east = west.model_copy(update={"availability_zone": "us-west-2b"})
    assert west.offer_id != east.offer_id
    storage.record_collection("aws", [west, east])
    rows = storage.latest(provider="aws")
    assert {o.availability_zone for o in rows} == {"us-west-2a", "us-west-2b"}
    assert len([o for o in storage.latest() if o.provider == "aws"]) == 2
    assert storage.history(provider="aws", offer_id=west.offer_id)[0] == 1


def test_catalog_history_latest_failure_and_empty_batch(storage, offer):
    storage.record_collection("shadeform", [copy.deepcopy(offer)])
    storage.record_collection(
        "shadeform", [offer.model_copy(update={"price_hourly": Decimal("1.75")})]
    )
    assert str(storage.get_offer(offer.offer_id).price_hourly) == "1.75"
    total, rows = storage.history(provider="shadeform", sku=offer.sku, market="spot", limit=1)
    assert total == 2 and len(rows) == 1 and str(rows[0][1].price_hourly) == "1.75"
    assert len(storage.history(provider="shadeform", offset=1)[1]) == 1
    assert storage.history(provider="lambda")[0] == 0
    assert storage.history(gpu_model="A100")[0] == 0
    storage.record_collection("shadeform", [], "http_429")
    assert storage.collection_status()[0]["error"] == "http_429"
    assert str(storage.get_offer(offer.offer_id).price_hourly) == "1.75"
    storage.record_collection("shadeform", [])
    assert storage.get_offer(offer.offer_id) is None
    assert storage.historical_offer(offer.offer_id) is not None
    assert storage.history()[0] == 2


def test_mysql_latest_resolves_batches_before_reading_prices(offer):
    # Exercise the adapter's relational reads without requiring a live MySQL server.
    # The deployed MySQL EXPLAIN check separately verifies price_batch range access.
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    collections = sa.Table(
        "collections",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("provider", sa.String),
        sa.Column("status", sa.String),
    )
    prices = sa.Table(
        "prices",
        metadata,
        sa.Column("collection_id", sa.Integer),
        sa.Column("payload", sa.Text),
        *(
            sa.Column(name, sa.String)
            for name in ["provider", "cloud", "sku", "region", "market", "offer_id"]
        ),
    )
    metadata.create_all(engine)
    adapter = MySQLStore.__new__(MySQLStore)
    adapter.engine, adapter.collections, adapter.prices = engine, collections, prices
    try:
        assert adapter.latest() == []
        old = offer.model_copy(update={"price_hourly": Decimal("3")})
        current = offer.model_copy(update={"price_hourly": Decimal("2")})
        with engine.begin() as connection:
            connection.execute(
                collections.insert(),
                [
                    {"id": 1, "provider": offer.provider, "status": "ok"},
                    {"id": 2, "provider": offer.provider, "status": "ok"},
                    {"id": 3, "provider": offer.provider, "status": "error"},
                ],
            )
            for batch, value in [(1, old), (2, current)]:
                connection.execute(
                    prices.insert().values(
                        collection_id=batch,
                        payload=value.model_dump_json(),
                        offer_id=value.offer_id,
                        **{
                            key: getattr(value, key)
                            for key in ["provider", "cloud", "sku", "region", "market"]
                        },
                    )
                )
        assert adapter.latest()[0].price_hourly == Decimal("2")
        assert adapter.latest(provider="lambda") == []
        assert adapter.get_offer(current.offer_id).price_hourly == Decimal("2")
        with engine.begin() as connection:
            connection.execute(
                collections.insert().values(id=4, provider=offer.provider, status="ok")
            )
        assert adapter.latest() == []
    finally:
        engine.dispose()


def test_history_time_bounds(storage, offer):
    before = (utcnow() - timedelta(seconds=1)).isoformat()
    storage.record_collection("shadeform", [offer])
    after = (utcnow() + timedelta(seconds=1)).isoformat()
    assert storage.history(since=before, until=after)[0] == 1
    assert storage.history(since=after)[0] == 0
    assert storage.history(until=before)[0] == 0


def test_idempotency_case_sensitivity_and_atomic_initial_event(storage, offer, order_request):
    original, created = storage.create_order(order_request, offer, "Job-A")
    replay, created_again = storage.create_order(order_request, offer, "Job-A")
    assert created and not created_again and replay["id"] == original["id"]
    assert storage.get_order_by_key("Job-A")["id"] == original["id"]
    other, created = storage.create_order(order_request, offer, "job-a")
    assert created and other["id"] != original["id"]
    with pytest.raises(ValueError, match="idempotency_key_conflict"):
        storage.create_order(order_request.model_copy(update={"wait_seconds": 10}), offer, "Job-A")
    assert len(storage.events(original["id"])) == 1
    assert storage.get_order_by_key("missing") is None


def test_concurrent_idempotent_create_and_state_claim(storage, offer, order_request):
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(
            pool.map(lambda _: storage.create_order(order_request, offer, "parallel"), range(4))
        )
    ids = {r[0]["id"] for r in results}
    assert len(ids) == 1 and sum(r[1] for r in results) == 1
    order_id = ids.pop()
    with ThreadPoolExecutor(max_workers=4) as pool:
        claimed = list(
            pool.map(
                lambda _: storage.transition(order_id, "checking", expected={"queued"}), range(4)
            )
        )
    assert sum(claimed) == 1
    assert len(storage.events(order_id)) == 2


def test_transition_event_handoff_and_delivery(storage, offer, order_request):
    order, _ = storage.create_order(order_request, offer, "state")
    assert storage.transition(
        order["id"], "provisioning", expected={"queued"}, instance_id="instance-test"
    )
    handoff = {"ssh": {"host": "203.0.113.1"}, "inference": {"status": "unverified"}}
    assert storage.transition(order["id"], "ready", expected={"provisioning"}, handoff=handoff)
    assert storage.get_order(order["id"])["handoff"] == handoff
    event = storage.events(order["id"])[-1]
    assert event["payload"]["handoff"] == handoff
    storage.webhook_result(event["id"], True, 1)
    assert storage.events(order["id"])[-1]["delivered_at"]
    assert event["id"] not in {e["id"] for e in storage.events(pending=True)}
    storage.transition(order["id"], "ready", error="transient")
    assert len(storage.events(order["id"])) == 3
    with pytest.raises(ValueError, match="invalid_order_field"):
        storage.transition(order["id"], "ready", untrusted="value")
    assert not storage.transition("missing", "ready")


def test_recovery_preserves_uncertain_creation(storage, offer, order_request):
    one, _ = storage.create_order(order_request, offer, "check")
    two, _ = storage.create_order(order_request, offer, "submit")
    storage.transition(one["id"], "checking")
    storage.transition(two["id"], "submitting")
    storage.recover()
    assert storage.get_order(one["id"])["state"] == "queued"
    assert storage.events(one["id"])[-1]["payload"]["type"] == "order.queued"
    assert storage.get_order(two["id"])["state"] == "needs_reconciliation"
    assert {o["id"] for o in storage.active_orders()} == {one["id"]}
    storage.recover()
    assert storage.get_order(two["id"])["state"] == "needs_reconciliation"


def test_database_worker_lock(storage):
    if isinstance(storage, Store):
        other = Store(storage.path)
    elif isinstance(storage, MySQLStore):
        other = MySQLStore(storage.engine.url.render_as_string(hide_password=False))
    else:
        other = DynamoDBStore(storage.table_name, client=storage.client)
    try:
        storage.acquire()
        storage.ensure_ownership()
        with pytest.raises(RuntimeError, match="lock is held|already has a running"):
            other.acquire()
        storage.close()
        other.acquire()
        other.ensure_ownership()
    finally:
        storage.close()
        other.close()


async def test_service_procurement_and_release_on_each_backend(storage, tmp_path):
    settings = Settings(
        _env_file=None,
        spotbot_database_path=tmp_path / "unused.sqlite3",
        spotbot_background_enabled=False,
        spotbot_api_key="service-test",
        shadeform_api_key="vendor-test",
        spotbot_live_orders_enabled=True,
    )
    fake = FakeShade()
    client = httpx.AsyncClient(transport=httpx.MockTransport(fake))
    svc = Service(settings, client)
    svc.store.close()
    svc.store = storage
    storage.acquire()
    for p in svc.providers.values():
        p.read_interval = p.create_interval = 0
    await svc.collect("shadeform")
    selected = next(o for o in storage.latest() if o.market == "spot")
    req = OrderRequest(
        offer_id=selected.offer_id,
        max_price_hourly="2",
        dry_run=False,
        launch=LaunchOptions(ssh_key_id="key"),
    )
    order, _ = svc.create_order(req, "lifecycle")
    await svc.tick()
    await svc.tick()
    assert storage.get_order(order["id"])["state"] == "ready"
    assert len(fake.creates) == 1
    svc.release(order["id"])
    await svc.tick()
    await svc.tick()
    assert storage.get_order(order["id"])["state"] == "released"
    await svc.close()
    await client.aclose()


def test_dynamodb_incomplete_bulk_write_never_publishes(storage, offer, monkeypatch):
    if not isinstance(storage, DynamoDBStore):
        pytest.skip("DynamoDB-specific batch publication check")
    storage.record_collection("shadeform", [offer])
    original = storage.client.batch_write_item

    def write_then_fail(**kwargs):
        original(**kwargs)
        raise RuntimeError("simulated interrupted catalog write")

    monkeypatch.setattr(storage.client, "batch_write_item", write_then_fail)
    with pytest.raises(RuntimeError, match="simulated"):
        storage.record_collection(
            "shadeform", [offer.model_copy(update={"price_hourly": Decimal("9.99")})]
        )
    assert str(storage.get_offer(offer.offer_id).price_hourly) == "1.50"
    assert storage.history()[0] == 1


def test_dynamodb_lock_loss_blocks_transaction(storage, offer, order_request):
    if not isinstance(storage, DynamoDBStore):
        pytest.skip("DynamoDB-specific ownership check")
    storage.acquire()
    storage.client.delete_item(TableName=storage.table_name, Key=storage._key("WORKER", "LOCK"))
    with pytest.raises(RuntimeError, match="lock lost"):
        storage.ensure_ownership()
    with pytest.raises(RuntimeError, match="lock lost"):
        storage.create_order(order_request, offer, "no-owner")
    assert storage.orders() == []


def test_legacy_sqlite_schema_remains_readable(tmp_path, offer, order_request):
    path = tmp_path / "legacy.sqlite3"
    store = Store(path)
    store.record_collection("shadeform", [offer])
    order, _ = store.create_order(order_request, offer, "legacy-key")
    store.close()
    reopened = Store(path)
    assert reopened.history()[0] == 1
    assert reopened.get_order_by_key("legacy-key")["id"] == order["id"]


def test_mysql_requires_the_supported_driver():
    with pytest.raises(ValueError, match="mysql.pymysql"):
        MySQLStore("sqlite://")


def test_unknown_storage_backend_and_mysql_configuration():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        Settings(_env_file=None, spotbot_storage_backend="unknown")
    with pytest.raises(ValidationError, match="SPOTBOT_MYSQL_URL"):
        Settings(_env_file=None, spotbot_storage_backend="mysql")


def test_large_catalog_batch_and_query_pagination(storage, offer):
    # More than 100 writes and 1 MB of data exercise real DynamoDB limits.
    offers = [
        offer.model_copy(update={"sku": f"gpu-spec-{i:04}", "details": {"note": "x" * 12000}})
        for i in range(120)
    ]
    storage.record_collection("shadeform", offers)
    assert len(storage.latest(provider="shadeform")) == 120
    total, rows = storage.history(provider="shadeform", limit=1, offset=119)
    assert total == 120 and len(rows) == 1


def test_sql_order_and_event_roll_back_together(storage, offer, order_request, monkeypatch):
    if isinstance(storage, DynamoDBStore):
        pytest.skip("SQL transaction rollback check; DynamoDB uses conditional transaction tests")

    def fail_event(*args, **kwargs):
        raise RuntimeError("simulated event persistence failure")

    monkeypatch.setattr(
        storage, "_event" if isinstance(storage, Store) else "_insert_event", fail_event
    )
    with pytest.raises(RuntimeError, match="simulated"):
        storage.create_order(order_request, offer, "rollback")
    assert storage.get_order_by_key("rollback") is None
    assert storage.events() == []
