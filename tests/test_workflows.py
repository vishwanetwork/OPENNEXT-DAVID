"""Workflow CAS and outbox contracts across configured database adapters."""

import copy
from uuid import uuid4

import pytest

from spotbot.storage.workflows import ConflictError, WorkflowStore
from tests.test_storage import storage as storage  # noqa: F401


def check_workflows(store, monkeypatch):
    db = WorkflowStore(store)
    row = dict(id=str(uuid4()), kind="rental", tenant_id="tenant-a", state="QUEUED", version=0)
    db.save(row, event="accepted")
    assert row["version"] == 1
    assert db.list("rental", "tenant-b") == []
    original = copy.deepcopy(row)
    row["state"] = "ACTIVE"
    db.save(row, expected=1, event="active")
    assert row["version"] == 2
    with pytest.raises(ConflictError):
        db.save(original, expected=1, event="must_not_commit")
    assert db.get("rental", row["id"])["state"] == "ACTIVE"
    assert db.rental_directory.page("tenant-a")["items"][0]["id"] == row["id"]
    events = store.events(order_id=row["id"])
    assert len(events) == 2
    assert {e["payload"]["type"] for e in events} == {"rental.accepted", "rental.active"}
    # Deliberately collide with an existing event; the state update must roll back.
    monkeypatch.setattr(
        "spotbot.storage.workflows.new_event", lambda *args: copy.deepcopy(events[0])
    )
    with pytest.raises(ConflictError):
        db.save(dict(row, state="SHOULD_ROLL_BACK"), expected=2, event="collision")
    assert db.get("rental", row["id"])["state"] == "ACTIVE"
    assert len(store.events(order_id=row["id"])) == 2


def test_version_and_atomic_event_contract(storage, monkeypatch):
    check_workflows(storage, monkeypatch)


def test_related_history_filters_parent_and_tenant_before_returning(storage, monkeypatch):
    import json
    db = WorkflowStore(storage)
    ids = []
    for tenant, parent in [("one", "rental-a"), ("one", "rental-b"), ("two", "rental-a")]:
        row = dict(id=str(uuid4()), kind="generation", tenant_id=tenant,
                   rental_id=parent, version=0, history="x" * 10000)
        db.save(row)
        ids.append(row["id"])
    original = json.loads
    decoded = []
    def decode(value, *args, **kwargs):
        result = original(value, *args, **kwargs)
        if isinstance(result, dict) and result.get("kind") == "generation":
            decoded.append(result["id"])
        return result
    monkeypatch.setattr("spotbot.storage.workflows.json.loads", decode)
    rows = db.list("generation", "one", rental_id="rental-a")
    assert [r["id"] for r in rows] == [ids[0]]
    if not hasattr(storage, "client"):
        assert decoded == [ids[0]]  # SQL filters before decoding unrelated history.
    assert db.list("generation", "missing", rental_id="rental-a") == []
    assert db.list("generation", "one", rental_id="missing") == []


def test_rental_directory_backfills_pages_and_isolates_customers(storage, monkeypatch):
    from spotbot.storage import rental_directory as directory
    db = WorkflowStore(storage)
    rows = []
    # Simulate pre-upgrade rentals with no directory entries.
    with monkeypatch.context() as patch:
        patch.setattr(directory, "entries", lambda doc: [])
        for tenant, customer, reference in [
            ("one", "buyer-a", "order-1"), ("one", "buyer-b", "order-1"),
            ("two", "buyer-a", "order-1"), ("one", "buyer-a", "order-2"),
        ]:
            row = dict(id=str(uuid4()), kind="rental", tenant_id=tenant, version=0,
                       created_at=f"2026-10-30T00:00:0{len(rows)}+00:00",
                       rfq=dict(customer_ref=customer, upstream_order_id=reference))
            db.save(row)
            rows.append(row)
    page = db.rental_directory.page("one", "buyer-a", limit=1)
    assert page["total"] == 2 and page["items"][0]["id"] == rows[3]["id"]
    assert db.rental_directory.page("one", "buyer-a", offset=1)["items"][0]["id"] == rows[0]["id"]
    assert db.rental_directory.page("one", "buyer-a", "order-1")["total"] == 1
    assert db.rental_directory.page("one", "buyer-c")["total"] == 0
    assert db.rental_directory.page("two", "buyer-a")["total"] == 1
    assert db.rental_directory.page("one", offset=99)["items"] == []
    assert db.get("migration", "rental-directory-v1")
    # Subsequent writes are indexed transactionally, including after a restart.
    new = dict(rows[0], id=str(uuid4()), version=0, created_at="2026-10-31T00:00:00+00:00")
    db.save(new)
    restarted = WorkflowStore(storage)
    monkeypatch.setattr(restarted, "list", lambda *a, **kw: pytest.fail("must not load all rentals"))
    assert restarted.rental_directory.page("one", "buyer-a")["total"] == 3
    stale = dict(new, rfq=dict(customer_ref="wrong"))
    with pytest.raises(ConflictError):
        restarted.save(stale, expected=0)
    assert restarted.rental_directory.page("one", "wrong")["total"] == 0


def test_sqlalchemy_workflow_transaction_path(tmp_path, monkeypatch):
    """Exercise SQLAlchemy transactions locally; real MySQL is an optional fixture above."""
    import sqlalchemy as sa
    from sqlalchemy.dialects.mysql import LONGTEXT
    from sqlalchemy.ext.compiler import compiles

    from spotbot.storage.mysql import MySQLStore, schema

    @compiles(LONGTEXT, "sqlite")
    def sqlite_longtext(element, compiler, **kwargs):
        return "TEXT"

    store = MySQLStore.__new__(MySQLStore)
    store.engine = sa.create_engine("sqlite+pysqlite:///" + str(tmp_path / "sql-workflow.db"))

    @sa.event.listens_for(store.engine, "connect")
    def register_collation(connection, _):
        connection.create_collation("utf8mb4_bin", lambda a, b: (a > b) - (a < b))

    store.metadata, _, _, _, store.event_table = schema()
    store.metadata.create_all(store.engine)
    store._lock_connection = None
    try:
        check_workflows(store, monkeypatch)
    finally:
        store.engine.dispose()
