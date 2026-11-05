"""Atomic finance-record CAS transactions across SQLite, MySQL and DynamoDB."""

import json

from spotbot.models import timestamp
from spotbot.storage.common import dump
from spotbot.storage.workflows import ConflictError

ALLOWED = {"opennext_charge", "opennext_transfer", "opennext_credit_guard"}


def atomic(db, documents):
    """Commit all records or none; callers include one shared account guard.

    These are finance documents, not rental lifecycle records: they have no rental
    directory entries. Native rental mutations remain in the existing engine.
    """
    if not documents or len(documents) > 24:
        raise ValueError("invalid_finance_transaction_size")
    if len({d["id"] for d in documents}) != len(documents):
        raise ValueError("duplicate_finance_record")
    owners = {d["tenant_id"] for d in documents}
    if len(owners) != 1 or not next(iter(owners)).startswith("opennext:"):
        raise ValueError("finance_transaction_owner_mismatch")
    if any(d["kind"] not in ALLOWED and not d["kind"].startswith("spot_") for d in documents):
        raise ValueError("finance_transaction_kind_not_allowed")
    now = timestamp()
    values = [dict(d, version=d.get("version", 0) + 1, updated_at=now) for d in documents]
    if hasattr(db.store, "client"):
        _ddb(db, documents, values)
    elif hasattr(db.store, "engine"):
        _mysql(db, documents, values)
    else:
        _sqlite(db, documents, values)
    # Never mutate the caller's records before a successful commit.
    for old, value in zip(documents, values, strict=True):
        old.update(value)
    return documents


def _record(value):
    return dict(
        id=value["id"], kind=value["kind"], tenant_id=value["tenant_id"],
        version=value["version"], payload=dump(value),
    )


def _sqlite(db, documents, values):
    import sqlite3

    try:
        with db.store.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            for old, value in zip(documents, values, strict=True):
                record = _record(value)
                if old.get("version", 0):
                    result = connection.execute(
                        "UPDATE workflow_records SET version=?,payload=? "
                        "WHERE id=? AND kind=? AND tenant_id=? AND version=?",
                        (record["version"], record["payload"], record["id"], record["kind"],
                         record["tenant_id"], old["version"]),
                    )
                    if result.rowcount != 1:
                        raise ConflictError()
                else:
                    connection.execute(
                        "INSERT INTO workflow_records(id,kind,tenant_id,version,payload) "
                        "VALUES(:id,:kind,:tenant_id,:version,:payload)", record,
                    )
    except sqlite3.IntegrityError as exc:
        raise ConflictError() from exc


def _mysql(db, documents, values):
    import sqlalchemy as sa

    try:
        with db.store.engine.begin() as connection:
            for old, value in zip(documents, values, strict=True):
                record = _record(value)
                if old.get("version", 0):
                    result = connection.execute(
                        db.table.update().where(
                            db.table.c.id == old["id"], db.table.c.kind == old["kind"],
                            db.table.c.tenant_id == old["tenant_id"],
                            db.table.c.version == old["version"],
                        ).values(version=record["version"], payload=record["payload"])
                    )
                    if result.rowcount != 1:
                        raise ConflictError()
                else:
                    connection.execute(db.table.insert().values(**record))
    except sa.exc.IntegrityError as exc:
        raise ConflictError() from exc


def _ddb(db, documents, values):
    from botocore.exceptions import ClientError

    writes = []
    for old, value in zip(documents, values, strict=True):
        version = old.get("version", 0)
        previous = db.store._get("WF#" + old["kind"], old["id"]) if version else None
        if version and (
            not previous or int(previous["version"]) != version
            or json.loads(previous["body"])["tenant_id"] != old["tenant_id"]
        ):
            raise ConflictError()
        writes.append(db.store._put("WF#" + value["kind"], value["id"], value, previous))
    try:
        db.store._transaction(writes)
    except ClientError as exc:
        if db.store._conflict(exc):
            raise ConflictError() from exc
        raise
