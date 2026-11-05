"""Committed, filtered AWS price-list versions for all supported storage backends."""

import json

from spotbot.storage.common import dump


class ListHistory:
    def __init__(self, store):
        self.store = store
        self.table = None
        if hasattr(store, "engine"):
            import sqlalchemy as sa
            from sqlalchemy.dialects.mysql import LONGTEXT

            metadata = sa.MetaData()
            self.table = sa.Table(
                "aws_list_archive",
                metadata,
                sa.Column("region", sa.String(64, collation="utf8mb4_bin"), primary_key=True),
                sa.Column("version", sa.String(32, collation="utf8mb4_bin"), primary_key=True),
                sa.Column("payload", LONGTEXT, nullable=False),
                mysql_charset="utf8mb4",
                mysql_engine="InnoDB",
            )
            metadata.create_all(store.engine)
        elif not hasattr(store, "table_name"):
            with store.connect() as c:
                c.execute(
                    "CREATE TABLE IF NOT EXISTS aws_list_archive (region TEXT NOT NULL, version TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(region,version))"
                )

    def save(self, region, version, document):
        if self.table is not None:
            from sqlalchemy.dialects.mysql import insert

            statement = insert(self.table).values(
                region=region, version=version, payload=dump(document)
            )
            with self.store.engine.begin() as c:
                c.execute(statement.on_duplicate_key_update(payload=statement.inserted.payload))
        elif hasattr(self.store, "table_name"):
            self.store.client.put_item(
                TableName=self.store.table_name,
                Item=self.store._item("AWS_LIST_ARCHIVE#" + region, version, document),
            )
        else:
            with self.store.connect() as c:
                c.execute(
                    "INSERT INTO aws_list_archive VALUES(?,?,?) ON CONFLICT(region,version) DO UPDATE SET payload=excluded.payload",
                    (region, version, dump(document)),
                )

    def get(self, region, version):
        if self.table is not None:
            import sqlalchemy as sa

            t = self.table
            with self.store.engine.connect() as c:
                row = c.execute(
                    sa.select(t.c.payload).where(t.c.region == region, t.c.version == version)
                ).scalar()
            return json.loads(row) if row else None
        if hasattr(self.store, "table_name"):
            row = self.store._get("AWS_LIST_ARCHIVE#" + region, version)
            return json.loads(row["body"]) if row else None
        with self.store.connect() as c:
            row = c.execute(
                "SELECT payload FROM aws_list_archive WHERE region=? AND version=?",
                (region, version),
            ).fetchone()
        return json.loads(row[0]) if row else None

    def query(self, region, sku, since, until):
        status = self.get(region, "STATUS")
        if not status:
            return {"coverage": None, "items": [], "pending": True}
        rows, missing = [], []
        end = min(until, status["checked_at"])
        for metadata in status["versions"]:
            if metadata["begin"] >= end or (metadata["end"] and metadata["end"] <= since):
                continue
            document = self.get(region, metadata["version"])
            if not document or document["spec_hash"] != status["spec_hash"]:
                missing.append(metadata["version"])
                continue
            for market, price in document["prices"].get(sku, {}).items():
                start = max(since, metadata["begin"], price["effective_at"])
                stop = min(end, metadata["end"] or end)
                if start < stop:
                    rows.append(
                        {
                            "market": market,
                            "price_hourly": price["price_hourly"],
                            "valid_from": start,
                            "valid_until": stop,
                            "version": metadata["version"],
                            **price,
                        }
                    )
        rows.sort(key=lambda r: (r["valid_from"], r["market"]))
        return {
            "coverage": {"since": max(since, status["since"]), "until": end},
            "items": rows,
            "pending": bool(missing),
            "missing_versions": missing,
            "checked_at": status["checked_at"],
        }
