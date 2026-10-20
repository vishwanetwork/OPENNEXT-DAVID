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
