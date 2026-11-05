"""Versioned workflow documents with atomic writes to the existing event outbox."""

import json

from spotbot.models import timestamp
from spotbot.storage.common import dump, new_event


class ConflictError(ValueError):
    def __init__(self):
        super().__init__("workflow_version_conflict")


class WorkflowStore:
    """Use the configured database; never create a separate local state database."""

    def __init__(self, store):
        self.store = store
        if hasattr(store, "engine"):
            import sqlalchemy as sa
            from sqlalchemy.dialects.mysql import LONGTEXT

            metadata = sa.MetaData()
            self.table = sa.Table(
                "workflow_records",
                metadata,
                sa.Column("id", sa.String(60), primary_key=True),
                sa.Column("kind", sa.String(24), nullable=False),
                sa.Column("tenant_id", sa.String(100), nullable=False),
                sa.Column("version", sa.Integer, nullable=False),
                sa.Column("payload", LONGTEXT, nullable=False),
                mysql_engine="InnoDB",
                mysql_charset="utf8mb4",
            )
            sa.Index("workflow_owner", self.table.c.kind, self.table.c.tenant_id)
            metadata.create_all(store.engine)
        elif not hasattr(store, "client"):
            with store.connect() as c:
                c.executescript("""
                    CREATE TABLE IF NOT EXISTS workflow_records (
                        id TEXT PRIMARY KEY, kind TEXT NOT NULL, tenant_id TEXT NOT NULL,
                        version INTEGER NOT NULL, payload TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS workflow_owner ON workflow_records(kind,tenant_id);
                """)
        from spotbot.storage.rental_directory import RentalDirectory
        self.rental_directory = RentalDirectory(self)

    def get(self, kind, identity):
        if hasattr(self.store, "engine"):
            import sqlalchemy as sa

            with self.store.engine.connect() as c:
                value = c.execute(
                    sa.select(self.table.c.payload).where(
                        self.table.c.id == identity, self.table.c.kind == kind
                    )
                ).scalar()
            return json.loads(value) if value else None
        if hasattr(self.store, "client"):
            item = self.store._get("WF#" + kind, identity)
            return json.loads(item["body"]) if item else None
        with self.store.connect() as c:
            row = c.execute(
                "SELECT payload FROM workflow_records WHERE id=? AND kind=?", (identity, kind)
            ).fetchone()
        return json.loads(row[0]) if row else None

    def list(self, kind, tenant_id=None, *, rental_id=None):
        if hasattr(self.store, "engine"):
            import sqlalchemy as sa

            q = sa.select(self.table.c.payload).where(self.table.c.kind == kind)
            if tenant_id is not None:
                q = q.where(self.table.c.tenant_id == tenant_id)
            if rental_id is not None:
                parent = sa.func.json_extract(self.table.c.payload, "$.rental_id")
                if self.store.engine.dialect.name == "mysql":
                    parent = sa.func.json_unquote(parent)
                q = q.where(parent == rental_id)
            with self.store.engine.connect() as c:
                values = list(c.execute(q).scalars())
        elif hasattr(self.store, "client"):
            values = [row["body"] for row in self.store._query("WF#" + kind)]
        else:
            with self.store.connect() as c:
                q, params = "SELECT payload FROM workflow_records WHERE kind=?", [kind]
                if tenant_id is not None:
                    q += " AND tenant_id=?"
                    params.append(tenant_id)
                if rental_id is not None:
                    q += " AND json_extract(payload, '$.rental_id')=?"
                    params.append(rental_id)
                values = [r[0] for r in c.execute(q, params)]
        docs = [json.loads(value) for value in values]
        return [
            d for d in docs
            if (tenant_id is None or d["tenant_id"] == tenant_id)
            and (rental_id is None or d.get("rental_id") == rental_id)
        ]

    def save(self, doc, expected=0, *, event=None):
        """Compare-and-swap and an optional outbox event commit together."""
        value = dict(doc, version=expected + 1, updated_at=timestamp())
        record = dict(
            id=value["id"],
            kind=value["kind"],
            tenant_id=value["tenant_id"],
            version=value["version"],
            payload=dump(value),
        )
        outbox = None
        if event:
            outbox = new_event(value.get("rental_id", value["id"]), event, value["updated_at"])
            outbox["payload"] = {
                "event_id": outbox["id"],
                "type": "rental." + event,
                "rental_id": outbox["order_id"],
                "tenant_id": value["tenant_id"],
                "occurred_at": value["updated_at"],
                "state_version": value["version"] if value["kind"] == "rental" else None,
                "resource_type": value["kind"],
                "resource_id": value["id"],
                "resource_version": value["version"],
                "generation": value.get("generation", 0),
                "state": value.get("state"),
                "error": value.get("error"),
                "handoff": value.get("connection"),
            }
        if hasattr(self.store, "engine"):
            self._sql_save(record, expected, outbox)
        elif hasattr(self.store, "client"):
            self._ddb_save(value, expected, outbox)
        else:
            self._sqlite_save(record, expected, outbox)
        doc.update(value)
        return doc

    def _sqlite_save(self, record, expected, event):
        import sqlite3

        try:
            with self.store.connect() as c:
                c.execute("BEGIN IMMEDIATE")
                if expected:
                    result = c.execute(
                        "UPDATE workflow_records SET version=?,payload=? WHERE id=? AND version=? AND kind=? AND tenant_id=?",
                        (
                            record["version"],
                            record["payload"],
                            record["id"],
                            expected,
                            record["kind"],
                            record["tenant_id"],
                        ),
                    )
                    if result.rowcount != 1:
                        raise ConflictError()
                else:
                    c.execute(
                        "INSERT INTO workflow_records(id,kind,tenant_id,version,payload) VALUES(:id,:kind,:tenant_id,:version,:payload)",
                        record,
                    )
                if event:
                    c.execute(
                        "INSERT INTO events(id,order_id,created_at,payload,attempts,next_attempt_at) VALUES(?,?,?,?,?,?)",
                        (
                            event["id"],
                            event["order_id"],
                            event["created_at"],
                            dump(event["payload"]),
                            0,
                            event["next_attempt_at"],
                        ),
                    )
                from spotbot.storage.rental_directory import entries
                self.rental_directory.sql_write(c, entries(json.loads(record["payload"])))
        except sqlite3.IntegrityError as exc:
            raise ConflictError() from exc

    def _sql_save(self, record, expected, event):
        import sqlalchemy as sa

        try:
            with self.store.engine.begin() as c:
                if expected:
                    result = c.execute(
                        self.table.update()
                        .where(
                            self.table.c.id == record["id"],
                            self.table.c.version == expected,
                            self.table.c.kind == record["kind"],
                            self.table.c.tenant_id == record["tenant_id"],
                        )
                        .values(version=record["version"], payload=record["payload"])
                    )
                    if result.rowcount != 1:
                        raise ConflictError()
                else:
                    c.execute(self.table.insert().values(**record))
                if event:
                    c.execute(
                        self.store.event_table.insert().values(
                            **dict(event, payload=dump(event["payload"]))
                        )
                    )
                from spotbot.storage.rental_directory import entries
                self.rental_directory.sql_write(c, entries(json.loads(record["payload"])))
        except sa.exc.IntegrityError as exc:
            raise ConflictError() from exc

    def _ddb_save(self, value, expected, event):
        from botocore.exceptions import ClientError

        old = self.store._get("WF#" + value["kind"], value["id"]) if expected else None
        if expected and (
            not old
            or int(old["version"]) != expected
            or json.loads(old["body"])["tenant_id"] != value["tenant_id"]
        ):
            raise ConflictError()
        writes = [self.store._put("WF#" + value["kind"], value["id"], value, old)]
        from spotbot.storage.rental_directory import entries
        writes.extend(self.rental_directory.ddb_writes(entries(value)))
        if event:
            sk = event["created_at"] + "#" + event["id"]
            writes.extend(
                [
                    self.store._put("EVENT#" + event["order_id"], sk, event),
                    self.store._put("OUTBOX", sk, event),
                    self.store._put(
                        "EVENTID#" + event["id"], "META", {"sk": sk, "order_id": event["order_id"]}
                    ),
                ]
            )
        try:
            self.store._transaction(writes)
        except ClientError as exc:
            if self.store._conflict(exc):
                raise ConflictError() from exc
            raise
