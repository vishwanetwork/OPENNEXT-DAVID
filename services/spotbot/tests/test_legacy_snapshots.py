"""The adapter reads the legacy API's state documents from files or from MySQL in the same way."""

import json
import os
from uuid import uuid4

import pytest
import sqlalchemy as sa

from spotbot.opennext_console_data import LegacySnapshots
from spotbot.opennext_ops import OperationError

AUTH = {"version": 1, "users": [{"id": "user-1", "email": "a@example.test", "createdAt": "2026-11-01T00:00:00Z"}], "sessions": []}


@pytest.fixture(params=["files", "mysql"])
def snapshots(request, tmp_path):
    """Returns (reader, write) where write(name, body) stores a document as the legacy API would."""
    if request.param == "files":

        def write(name, body):
            (tmp_path / name).write_text(body)

        yield LegacySnapshots(tmp_path), write
        return
    url = os.environ.get("SPOTBOT_TEST_MYSQL_URL")
    if not url:
        pytest.skip("SPOTBOT_TEST_MYSQL_URL is not configured")
    parsed = sa.engine.make_url(url)
    database = "spotbot_test_" + uuid4().hex
    admin = sa.create_engine(parsed.set(database=None), hide_parameters=True)
    with admin.begin() as c:
        c.exec_driver_sql(f"CREATE DATABASE `{database}` CHARACTER SET utf8mb4")
    engine = sa.create_engine(parsed.set(database=database), hide_parameters=True)
    reader = LegacySnapshots("", engine=engine)

    def write(name, body):
        # The same statement legacy/OpenNEXT-document-store.cjs uses.
        with engine.begin() as c:
            c.exec_driver_sql(
                "INSERT INTO legacy_documents (name, body, updated_at) VALUES (%s, %s, UTC_TIMESTAMP(3))"
                " ON DUPLICATE KEY UPDATE body = VALUES(body), updated_at = VALUES(updated_at)",
                (name, body),
            )

    try:
        yield reader, write
    finally:
        engine.dispose()
        with admin.begin() as c:
            c.exec_driver_sql(f"DROP DATABASE `{database}`")
        admin.dispose()


def test_reads_users_and_reports_missing_documents(snapshots):
    reader, write = snapshots
    assert reader.available
    assert not reader.exists("credit-topups.json")
    with pytest.raises(OperationError):
        reader.read("auth-state.json")
    write("auth-state.json", json.dumps(AUTH))
    write("credit-topups.initialized", '{"version":1,"demo":false}')
    assert reader.exists("credit-topups.initialized")
    assert [row["id"] for row in reader.users()] == ["user-1"]


def test_rejects_documents_that_are_not_objects(snapshots):
    reader, write = snapshots
    write("marketplace.json", "[]")
    with pytest.raises(OperationError):
        reader.read("marketplace.json")
