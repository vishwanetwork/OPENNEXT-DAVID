"""Durable schedules, encrypted credentials and atomic publication of collected prices."""

import asyncio
import json
import os
import uuid
from datetime import timedelta

from spotbot.models import timestamp, utcnow
from spotbot.opennext_ops import OperationError
from spotbot.rentals import at
from spotbot.storage.workflows import ConflictError

from .collectors import MAX_RECORDS, SourceError, collect
from .registry import PENDING, SOURCES

CONFIG = "price_source"
CHUNK = "price_source_chunk"
KEY = "price_source_key"


class PriceSources:
    def __init__(self, db, client, sealer, settings=None):
        self.db, self.client, self.sealer = db, client, sealer
        self.slots = asyncio.Semaphore(2)
        self.worker_error = None
        self.settings = settings

    async def config(self, provider):
        current = await asyncio.to_thread(self.db.get, CONFIG, "price-" + provider)
        return current or dict(
            id="price-" + provider,
            kind=CONFIG,
            tenant_id="operations",
            provider=provider,
            enabled=False,
            intervalMinutes=60,
            runs=[],
        )

    async def save(self, doc):
        try:
            return await asyncio.to_thread(self.db.save, doc, doc.get("version", 0))
        except ConflictError as exc:
            raise OperationError(409, "This source changed. Refresh and try again.") from exc

    async def secret(self, provider):
        doc = await asyncio.to_thread(self.db.get, KEY, "price-key-" + provider)
        if doc:
            try:
                return self.sealer.open(doc["sealed"], "price-source:" + provider)["credential"]
            except (KeyError, ValueError) as exc:
                raise OperationError(
                    503, "The Console key cannot unlock this source credential."
                ) from exc
        field = (SOURCES[provider].credential_env or "").lower()
        if self.settings is not None and field and hasattr(self.settings, field):
            return getattr(self.settings, field).get_secret_value()
        return os.environ.get(SOURCES[provider].credential_env or "", "")

    async def credential(self, provider, value):
        if not SOURCES[provider].credential_env:
            raise OperationError(400, "This public source does not require credentials.")
        if (
            not isinstance(value, str)
            or not 5 <= len(value.strip()) <= 4096
            or any(c in value for c in "\r\n\x00")
        ):
            raise OperationError(400, "Enter a valid read-only API token.")
        try:
            sealed = self.sealer.seal({"credential": value.strip()}, "price-source:" + provider)
        except ValueError as exc:
            raise OperationError(
                503, "Configure SPOTBOT_OPENNEXT_CONSOLE_KEY before saving credentials."
            ) from exc
        identity = "price-key-" + provider
        current = await asyncio.to_thread(self.db.get, KEY, identity)
        await self.save(
            dict(
                id=identity,
                kind=KEY,
                tenant_id="operations",
                provider=provider,
                sealed=sealed,
                version=(current or {}).get("version", 0),
            )
        )
        return dict(ok=True, configured=True, storage="encrypted_database")

    async def providers(self, value):
        by_id = {p["id"]: p for p in value["providers"]}
        for provider, source in SOURCES.items():
            config = await self.config(provider)
            # Readiness reports only presence; an encryption-key mismatch is not silently ignored.
            ready = not source.credential_env or bool(await self.secret(provider))
            latest = next(iter(config["runs"]), None)
            state = (latest or {}).get("status") or ("not_synced" if ready else "needs_credentials")
            row = dict(
                id=provider,
                name=source.name,
                adapter="readonly-" + source.mode,
                adapterStatus="implemented",
                enabled=config["enabled"],
                intervalMinutes=config["intervalMinutes"],
                credentialRequired=bool(source.credential_env),
                credentialEnv=source.credential_env,
                credentialConfigured=ready,
                configured=ready,
                credentialStorage="encrypted_database",
                supportedTerms=list(source.terms),
                capabilities=list(source.terms),
                pendingTerms=[
                    t for t in ["On-demand", "Spot", "Reserved"] if t not in source.terms
                ],
                endpoints=[
                    dict(
                        method="GET",
                        url=source.url,
                        auth="Bearer token" if source.credential_env else "Public",
                    )
                ],
                docsUrl=source.docs,
                scope=source.note,
                message=source.note,
                sourceType=source.mode,
                status=state,
                latestRun=latest,
                lastRun=latest,
                recordCount=config.get("recordCount", 0),
                validationStatus="live_verified"
                if config.get("published")
                else ("needs_credentials" if not ready else "not_live_verified"),
            )
            by_id[provider] = row
        for provider, (docs, message) in PENDING.items():
            if provider in by_id:
                by_id[provider].update(docsUrl=docs, scope=message, message=message)
        return dict(value, providers=list(by_id.values()))

    async def settings(self, provider, body):
        if (
            not isinstance(body, dict)
            or set(body) != {"enabled", "intervalMinutes"}
            or type(body["enabled"]) is not bool
            or type(body["intervalMinutes"]) is not int
            or not 10 <= body["intervalMinutes"] <= 1440
        ):
            raise OperationError(400, "Use an interval between 10 and 1440 minutes.")
        if body["enabled"] and SOURCES[provider].credential_env and not await self.secret(provider):
            raise OperationError(
                409, "Configure a read-only credential before enabling this source."
            )
        config = await self.config(provider)
        config.update(body)
        await self.save(config)
        return dict(ok=True, enabled=config["enabled"], intervalMinutes=config["intervalMinutes"])

    async def enqueue(self, provider, mode="incremental"):
        config = await self.config(provider)
        if config.get("active"):
            return config["runs"][0]
        if SOURCES[provider].credential_env and not await self.secret(provider):
            raise OperationError(
                409, "Configure a read-only credential before running this source."
            )
        job = dict(
            id=str(uuid.uuid4()),
            provider=provider,
            status="running",
            phase="queued",
            mode=mode,
            startedAt=timestamp(),
            finishedAt=None,
            recordCount=0,
            logs=["Read-only catalog collection queued. No instances will be created."],
        )
        config.update(active=job["id"], runs=[job] + config["runs"][:19])
        await self.save(config)
        return job

    async def runs(self):
        docs = await asyncio.to_thread(self.db.list, CONFIG, "operations")
        return sorted(
            [r for d in docs for r in d.get("runs", [])], key=lambda r: r["startedAt"], reverse=True
        )

    async def prices(self, provider=""):
        providers = [provider] if provider in SOURCES else list(SOURCES)
        records = []
        for identity in providers:
            config = await self.config(identity)
            for chunk_id in config.get("chunks", []):
                chunk = await asyncio.to_thread(self.db.get, CHUNK, chunk_id)
                if not chunk:
                    raise OperationError(503, "A published catalog is temporarily unavailable.")
                stale = utcnow() - at(config["publishedAt"]) > timedelta(
                    minutes=max(120, config["intervalMinutes"] * 3)
                )
                records.extend(dict(r, stale=stale) for r in chunk["records"])
        return records

    async def run(self):
        while True:
            try:
                await self.tick()
                self.worker_error = None
            except Exception:
                self.worker_error = "Price-source maintenance could not complete its last cycle."
            await asyncio.sleep(30)

    async def tick(self):
        async def process(provider):
            async with self.slots:
                await self._process(provider)

        results = await asyncio.gather(*(process(p) for p in SOURCES), return_exceptions=True)
        if any(isinstance(result, Exception) for result in results):
            raise OperationError(503, "A price-source maintenance cycle could not complete.")

    async def _process(self, provider):
        config = await self.config(provider)
        if not config.get("active"):
            previous = next(iter(config["runs"]), {})
            due = not previous or utcnow() - at(previous["startedAt"]) >= timedelta(
                minutes=config["intervalMinutes"]
            )
            if config["enabled"] and due:
                await self.enqueue(provider, "scheduled")
                config = await self.config(provider)
            else:
                return
        job = dict(config["runs"][0])
        if job["phase"] == "collecting":
            if utcnow() - at(job["claimedAt"]) < timedelta(minutes=5):
                return
            # A crashed worker must not leave a source running forever. Next cadence retries it.
            job.update(
                status="failed",
                phase="finished",
                finishedAt=timestamp(),
                logs=["Collection interrupted. The previous published catalog was preserved."],
            )
            config.update(active=None, runs=[job] + config["runs"][1:])
            await self.save(config)
            return
        job.update(phase="collecting", claimedAt=timestamp())
        config["runs"][0] = job
        await self.save(config)  # CAS grants one worker the read-only collection lease.
        try:
            async with asyncio.timeout(120):
                rows = await collect(provider, self.client, await self.secret(provider))
            if not rows or len(rows) > MAX_RECORDS:
                raise SourceError(
                    "No supported USD GPU prices were returned; the previous catalog was preserved."
                )
            rows = list({r["recordId"]: r for r in rows}.values())
            chunks = []
            batches, batch, size = [], [], 0
            for row in rows:
                row_size = len(json.dumps(row, ensure_ascii=False).encode())
                if row_size > 280000:
                    raise SourceError("A price record exceeds the supported document size.")
                if batch and (size + row_size > 280000 or len(batch) >= 150):
                    batches.append(batch)
                    batch, size = [], 0
                batch.append(row)
                size += row_size
            if batch:
                batches.append(batch)
            for index, batch in enumerate(batches):
                chunk_id = str(uuid.uuid5(uuid.NAMESPACE_URL, job["id"] + ":" + str(index)))
                await self.save(
                    dict(
                        id=chunk_id,
                        kind=CHUNK,
                        tenant_id="operations",
                        provider=provider,
                        runId=job["id"],
                        records=batch,
                    )
                )
                chunks.append(chunk_id)
            job.update(
                status="completed",
                recordCount=len(rows),
                logs=[
                    f"Accepted {len(rows)} USD GPU prices.",
                    SOURCES[provider].note,
                    "No Reserved prices were inferred. Account inventory was not verified.",
                ],
            )
            publication = dict(
                chunks=chunks, published=job["id"], publishedAt=timestamp(), recordCount=len(rows)
            )
        except Exception as exc:
            job.update(
                status="failed",
                logs=[
                    str(exc)
                    if isinstance(exc, SourceError)
                    else "Collection failed. Check credentials, connectivity and the documented source schema."
                ],
            )
            publication = {}
        # Configuration may have been edited during collection. Merge the result through CAS.
        for _ in range(5):
            current = await self.config(provider)
            if current.get("active") != job["id"]:
                return
            job.update(phase="finished", finishedAt=timestamp())
            current.update(publication, active=None, runs=[job] + current["runs"][1:])
            try:
                await self.save(current)
                return
            except OperationError as exc:
                if exc.status != 409:
                    raise
        raise OperationError(409, "Collection completed but publication conflicted. Retry later.")
