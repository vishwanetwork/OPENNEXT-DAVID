"""OpenNEXT backend adapter.

The OpenNEXT web app forwards every `/api/*` request to one backend (`API_ORIGIN`). This
service implements the endpoints SpotOrderBot owns and passes every other request, unchanged,
to the existing OpenNEXT API until the Python backend replaces it:

- `GET /api/admin/instances` lists protected rental allocations across tenants for the
  Operations Console. Authorization and admin-host scoping are delegated to the existing
  administrator session check (`GET /api/admin/pricing/session`), so both backends accept
  exactly the same sessions.

Serve it on a private listener reached only by the OpenNEXT web server, never through a
host-routing reverse proxy: the pass-through keeps the browser's `Host` header.
"""

import asyncio
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.background import BackgroundTask

from spotbot.models import timestamp
from spotbot.storage import create_store
from spotbot.storage.workflows import WorkflowStore

HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "content-length",
}
METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
# Console lifecycle: Running excludes Connecting and End (docs/API_CONTRACT.md in OpenNEXT).
LIFECYCLE = {
    "QUEUED": "Connecting",
    "WAITING_CAPACITY": "Connecting",
    "PROVISIONING": "Connecting",
    "VERIFYING": "Connecting",
    "DELIVERING": "Connecting",
    "RECOVERING": "Connecting",
    "ACTIVE": "Running",
    "ACTION_REQUIRED": "Attention",
    "NEEDS_RECONCILIATION": "Attention",
    "ENDING": "End",
    "CLOSED": "End",
}
MAX_PAGE = 200


def legacy_origin(value):
    url = urlsplit(value or "")
    if (
        url.scheme not in {"http", "https"}
        or not url.hostname
        or url.path not in {"", "/"}
        or url.query
        or url.fragment
        or url.username
    ):
        raise ValueError("SPOTBOT_OPENNEXT_LEGACY_ORIGIN must be an http(s) origin without a path")
    return value.rstrip("/")


def instance_view(row, gen):
    """Safe administrator view of one rental: no agent tokens, server IPs or credentials."""
    rfq = row.get("rfq", {})
    offer = (gen or {}).get("offer") or {}
    return {
        "id": row["id"],
        "tenantId": row["tenant_id"],
        "orderId": rfq.get("upstream_order_id"),
        "rfqId": rfq.get("rfq_id"),
        "model": rfq.get("gpu_model"),
        "gpuCount": rfq.get("gpu_count"),
        "term": "Spot",
        "region": (gen or {}).get("region") or (rfq.get("regions") or [None])[0],
        "zone": offer.get("availability_zone"),
        "instanceType": offer.get("sku"),
        "instanceId": (gen or {}).get("instance_id"),
        "generation": row.get("generation", 0),
        "state": row["state"],
        "lifecycle": LIFECYCLE.get(row["state"], "Attention"),
        "error": row.get("error"),
        "degraded": row.get("degraded"),
        "priceCeilingHourlyUsd": rfq.get("max_price_hourly"),
        "estimatedCostUsd": row.get("estimated_cost_usd"),
        "budgetUsd": rfq.get("budget_usd"),
        "createdAt": row["created_at"],
        "expiresAt": rfq.get("expires_at"),
        "closedAt": row.get("closed_at"),
    }


def create_opennext_app(settings, *, origin, store=None, client=None):
    origin = legacy_origin(origin)
    db = WorkflowStore(store or create_store(settings))
    own_client = client is None
    client = client or httpx.AsyncClient(
        timeout=httpx.Timeout(60, connect=5), follow_redirects=False, trust_env=False
    )

    @asynccontextmanager
    async def lifespan(_app):
        yield
        if own_client:
            await client.aclose()

    app = FastAPI(
        title="SpotOrderBot OpenNEXT API",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )

    def raw(items):
        # Raw pairs keep repeated headers such as several Set-Cookie values.
        return [(k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in items]

    def headers(request):
        # Keep the browser's Host, Origin, cookies and CSRF header; the existing API checks them.
        return [
            (k, v) for k, v in request.headers.items() if k.lower() not in HOP_BY_HOP
        ]

    def error(status, message, **extra):
        return JSONResponse(
            {"error": message, **extra}, status_code=status, headers={"Cache-Control": "no-store"}
        )

    def rentals():
        rows = sorted(db.list("rental"), key=lambda r: r["created_at"], reverse=True)
        return [
            instance_view(
                row,
                db.get("generation", row["current_generation_id"])
                if row.get("current_generation_id")
                else None,
            )
            for row in rows
        ]

    @app.get("/api/admin/instances")
    async def admin_instances(
        request: Request, status: str = "", cursor: str = "", limit: int = 50
    ):
        try:
            session = await client.get(
                origin + "/api/admin/pricing/session", headers=headers(request)
            )
        except httpx.HTTPError:
            return error(503, "The administrator session service is unavailable.")
        if session.status_code == 404:
            return error(404, "Not found")  # Not the admin host.
        if session.status_code != 200:
            return error(503, "The administrator session service is unavailable.")
        access = session.json().get("access") or {}
        if access.get("mutable") is not True:
            return error(401, access.get("reason") or "Administrator sign-in required", access=access)
        wanted = status.strip().lower()
        if wanted and wanted not in {v.lower() for v in LIFECYCLE.values()}:
            return error(400, "Unknown status filter", code="INVALID_STATUS")
        if not (1 <= limit <= MAX_PAGE) or (cursor and not cursor.isdigit()):
            return error(400, "Invalid cursor or limit", code="INVALID_PAGE")
        views = await asyncio.to_thread(rentals)
        if wanted:
            views = [v for v in views if v["lifecycle"].lower() == wanted]
        start = int(cursor or 0)
        page = views[start : start + limit]
        return JSONResponse(
            {
                "instances": page,
                "nextCursor": str(start + limit) if start + limit < len(views) else None,
                "asOf": timestamp(),
            },
            headers={"Cache-Control": "no-store"},
        )

    @app.api_route("/api/{path:path}", methods=METHODS)
    async def passthrough(request: Request, path: str):
        target = origin + request.url.path + (("?" + request.url.query) if request.url.query else "")
        upstream = client.build_request(
            request.method,
            target,
            headers=headers(request),
            content=request.stream() if request.method not in {"GET", "HEAD"} else None,
        )
        try:
            response = await client.send(upstream, stream=True)
        except httpx.HTTPError:
            return error(502, "The OpenNEXT service is temporarily unavailable.")
        out = [
            (k, v) for k, v in response.headers.multi_items() if k.lower() not in HOP_BY_HOP
        ]
        if request.method == "HEAD" or response.status_code in {204, 304}:
            await response.aclose()
            empty = Response(status_code=response.status_code)
            empty.raw_headers = raw(out)
            return empty
        async def body():
            # Raw bytes keep any content encoding the existing API applied.
            if response.is_stream_consumed:
                yield response.content
                return
            async for chunk in response.aiter_raw():
                yield chunk

        streamed = StreamingResponse(
            body(),
            status_code=response.status_code,
            background=BackgroundTask(response.aclose),
        )
        streamed.raw_headers = raw(out)
        return streamed

    return app
