"""Additional source routes, installed ahead of the legacy proxy."""

from collections import defaultdict
from itertools import zip_longest

from fastapi import Request

from spotbot.opennext_ops import OperationError

from .registry import SOURCES


def install(app, ctx, backend, guard):
    @app.get("/api/admin/pricing/runs")
    async def runs(request: Request):
        _, failed = await guard(request)
        if failed:
            return failed
        try:
            legacy = await backend.bridge.call(request, "GET", "/api/admin/pricing/runs")
            merged = legacy.get("runs", []) + await backend.sources.runs()
            merged.sort(key=lambda r: r.get("startedAt") or "", reverse=True)
            return ctx.no_store(dict(legacy, runs=merged[:200]))
        except OperationError as exc:
            return ctx.error(exc.status, exc.message)

    @app.get("/api/admin/pricing/runs/{identity}")
    async def run(request: Request, identity: str):
        _, failed = await guard(request)
        if failed:
            return failed
        try:
            job = next((r for r in await backend.sources.runs() if r["id"] == identity), None)
            if job:
                return ctx.no_store(job)
            if len(identity) > 100 or not identity.replace("-", "").replace("_", "").isalnum():
                return ctx.error(404, "Collection run not found.")
            return ctx.no_store(
                await backend.bridge.call(request, "GET", "/api/admin/pricing/runs/" + identity)
            )
        except OperationError as exc:
            return ctx.error(exc.status, exc.message)

    @app.get("/api/pricing/prices")
    async def prices(request: Request):
        # Public catalog data only. Credentials and private account objects never enter this projection.
        try:
            params = request.query_params
            provider = params.get("provider", "")
            limit = max(1, min(10000, int(params.get("limit", "5000"))))
            additional = (
                await backend.sources.prices(provider)
                if not provider or provider in SOURCES
                else []
            )
            legacy = (
                dict(records=[], meta={})
                if provider in SOURCES
                else await backend.bridge.call(request, "GET", "/api/pricing/prices?" + str(params))
            )
            records = legacy.get("records", []) + additional
            for field in ("provider", "gpuModel", "region", "term", "instanceType", "formFactor"):
                if params.get(field) and params[field] != "all":
                    records = [r for r in records if r.get(field) == params[field]]
            for field in ("gpuCount", "gpuMemoryGb"):
                if params.get(field):
                    records = [r for r in records if r.get(field) == float(params[field])]
            if params.get("model"):
                records = [r for r in records if r.get("gpuModel") == params["model"]]
            grouped = defaultdict(list)
            for record in records:
                grouped[record["provider"]].append(record)
            balanced = [
                row for batch in zip_longest(*grouped.values()) for row in batch if row is not None
            ]
            return ctx.no_store(
                dict(
                    legacy,
                    records=balanced[:limit],
                    meta=dict(
                        legacy.get("meta") or {},
                        total=len(records),
                        truncated=len(records) > limit,
                        message="Collected prices include labeled catalog references. No stock or account quota is implied.",
                    ),
                )
            )
        except OperationError as exc:
            return ctx.error(exc.status, exc.message)
        except (ValueError, TypeError):
            return ctx.error(400, "Invalid price filter.")
