"""Idempotent vendor price-change events, isolated from executable offer catalogs."""

import json
import time

from spotbot.storage.common import dump


def select_events(events, since, until):
    """Include the effective predecessor for each zone at the left boundary."""
    preceding, selected = {}, []
    for event in sorted(events, key=lambda e: (e["effective_at"], e["availability_zone"])):
        at = event["effective_at"]
        if at > until:
            continue
        if at < since:
            preceding[event["availability_zone"]] = event
        else:
            selected.append(event)
    return sorted(
        [*preceding.values(), *selected], key=lambda e: (e["effective_at"], e["availability_zone"])
    )


class SQLiteHistory:
    def __init__(self, store):
        self.store = store
        with store.connect() as c:
            c.executescript("""
                CREATE TABLE IF NOT EXISTS aws_spot_changes (
                    region TEXT NOT NULL, sku TEXT NOT NULL, availability_zone TEXT NOT NULL,
                    effective_at TEXT NOT NULL, price_hourly TEXT NOT NULL,
                    PRIMARY KEY(region,sku,effective_at,availability_zone)
                );
                CREATE TABLE IF NOT EXISTS aws_spot_coverage (
                    region TEXT NOT NULL, sku TEXT NOT NULL, payload TEXT NOT NULL,
                    PRIMARY KEY(region,sku)
                );
            """)

    def coverage(self, region, sku):
        with self.store.connect() as c:
            row = c.execute(
                "SELECT payload FROM aws_spot_coverage WHERE region=? AND sku=?", (region, sku)
            ).fetchone()
        return json.loads(row[0]) if row else None

    def save(self, region, sku, events, coverage):
        with self.store.connect() as c:
            c.executemany(
                "INSERT INTO aws_spot_changes VALUES(?,?,?,?,?) ON CONFLICT(region,sku,effective_at,availability_zone) DO UPDATE SET price_hourly=excluded.price_hourly",
                [
                    (region, sku, e["availability_zone"], e["effective_at"], e["price_hourly"])
                    for e in events
                ],
            )
            c.execute(
                "INSERT INTO aws_spot_coverage VALUES(?,?,?) ON CONFLICT(region,sku) DO UPDATE SET payload=excluded.payload",
                (region, sku, dump(coverage)),
            )

    def read(self, region, sku, since, until):
        with self.store.connect() as c:
            rows = c.execute(
                "SELECT availability_zone,effective_at,price_hourly FROM aws_spot_changes WHERE region=? AND sku=? AND effective_at<=?",
                (region, sku, until),
            ).fetchall()
        return select_events([dict(r) for r in rows], since, until)


class MySQLHistory:
    def __init__(self, store):
        import sqlalchemy as sa
        from sqlalchemy.dialects.mysql import LONGTEXT

        self.engine = store.engine
        metadata = sa.MetaData()
        self.events = sa.Table(
            "aws_spot_changes",
            metadata,
            sa.Column("region", sa.String(64, collation="utf8mb4_bin"), primary_key=True),
            sa.Column("sku", sa.String(128, collation="utf8mb4_bin"), primary_key=True),
            sa.Column("effective_at", sa.String(40, collation="utf8mb4_bin"), primary_key=True),
            sa.Column(
                "availability_zone", sa.String(64, collation="utf8mb4_bin"), primary_key=True
            ),
            sa.Column("price_hourly", sa.String(64), nullable=False),
            mysql_charset="utf8mb4",
            mysql_engine="InnoDB",
        )
        self.coverages = sa.Table(
            "aws_spot_coverage",
            metadata,
            sa.Column("region", sa.String(64, collation="utf8mb4_bin"), primary_key=True),
            sa.Column("sku", sa.String(128, collation="utf8mb4_bin"), primary_key=True),
            sa.Column("payload", LONGTEXT, nullable=False),
            mysql_charset="utf8mb4",
            mysql_engine="InnoDB",
        )
        metadata.create_all(self.engine)

    def coverage(self, region, sku):
        import sqlalchemy as sa

        t = self.coverages
        with self.engine.connect() as c:
            row = c.execute(
                sa.select(t.c.payload).where(t.c.region == region, t.c.sku == sku)
            ).scalar()
        return json.loads(row) if row else None

    def save(self, region, sku, events, coverage):
        from sqlalchemy.dialects.mysql import insert

        with self.engine.begin() as c:
            for start in range(0, len(events), 500):
                statement = insert(self.events).values(
                    [dict(e, region=region, sku=sku) for e in events[start : start + 500]]
                )
                c.execute(
                    statement.on_duplicate_key_update(price_hourly=statement.inserted.price_hourly)
                )
            statement = insert(self.coverages).values(
                region=region, sku=sku, payload=dump(coverage)
            )
            c.execute(statement.on_duplicate_key_update(payload=statement.inserted.payload))

    def read(self, region, sku, since, until):
        import sqlalchemy as sa

        t = self.events
        with self.engine.connect() as c:
            rows = (
                c.execute(
                    sa.select(t.c.availability_zone, t.c.effective_at, t.c.price_hourly).where(
                        t.c.region == region, t.c.sku == sku, t.c.effective_at <= until
                    )
                )
                .mappings()
                .all()
            )
        return select_events([dict(r) for r in rows], since, until)


class DynamoHistory:
    def __init__(self, store):
        self.store = store

    @staticmethod
    def key(region, sku):
        return "AWS_SPOT_HISTORY#" + region + "#" + sku

    def coverage(self, region, sku):
        row = self.store._get(self.key(region, sku), "COVERAGE")
        return json.loads(row["body"]) if row else None

    def save(self, region, sku, events, coverage):
        store, pk = self.store, self.key(region, sku)
        writes = [
            {
                "PutRequest": {
                    "Item": store._item(
                        pk, "EVENT#" + e["effective_at"] + "#" + e["availability_zone"], e
                    )
                }
            }
            for e in events
        ]
        for start in range(0, len(writes), 25):
            pending = {store.table_name: writes[start : start + 25]}
            for attempt in range(8):
                pending = store.client.batch_write_item(RequestItems=pending).get(
                    "UnprocessedItems", {}
                )
                if not pending:
                    break
                time.sleep(min(0.1 * 2**attempt, 3))
            if pending:
                raise RuntimeError("aws_spot_history_unprocessed_writes")
        # The checkpoint is published only after every event was stored successfully.
        store.client.put_item(
            TableName=store.table_name, Item=store._item(pk, "COVERAGE", coverage)
        )

    def read(self, region, sku, since, until):
        rows = self.store._query(self.key(region, sku), "EVENT#")
        return select_events([json.loads(row["body"]) for row in rows], since, until)


def create_history_store(store):
    if hasattr(store, "engine"):
        return MySQLHistory(store)
    if hasattr(store, "table_name"):
        return DynamoHistory(store)
    return SQLiteHistory(store)
