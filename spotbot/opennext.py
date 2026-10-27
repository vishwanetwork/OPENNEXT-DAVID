"""OpenNEXT backend adapter.

The OpenNEXT web app forwards every `/api/*` request to one backend (`API_ORIGIN`). This
service implements the endpoints SpotOrderBot owns and passes every other request, unchanged,
to the existing OpenNEXT API until the Python backend replaces it:

- `GET /api/admin/instances` lists protected rental allocations across tenants for the
  Operations Console. Authorization and admin-host scoping are delegated to the existing
  administrator session check (`GET /api/admin/pricing/session`), so both backends accept
  exactly the same sessions.
- With a bot API configured (`spotbot.opennext_market`), `GET /api/marketplace/public` adds the
  bot's Spot offers to the public supply rows, `POST /api/marketplace/spot-purchases` turns a
  Spot purchase into a protected rental, and `GET /api/marketplace/me` adds the signed-in
  customer's rentals to their instances. Customer sessions and CSRF tokens are verified with
  the existing API (`GET /api/auth/session`).

Serve it on a private listener reached only by the OpenNEXT web server, never through a
host-routing reverse proxy: the pass-through keeps the browser's `Host` header.
"""

import asyncio
import json
import logging
import secrets
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import ValidationError
from starlette.background import BackgroundTask

from spotbot.models import timestamp, utcnow
from spotbot.opennext_market import (
    PurchaseRequest,
    SpotMarket,
    checkout_totals,
    order_reference,
    purchased,
    rfq_for,
)
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
# Request headers not forwarded when this adapter reads and rewrites an existing API response.
REWRITE_DROPPED = {"accept-encoding", "content-type", "if-none-match", "if-modified-since"}
logger = logging.getLogger(__name__)


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


def same_origin(request):
    """The browser's Origin names the Host it sent the request to."""
    raw = request.headers.get("origin", "")
    try:
        return bool(raw) and urlsplit(raw).netloc.lower() == request.headers.get("host", "").lower()
    except ValueError:
        return False


def create_opennext_app(settings, *, origin, store=None, client=None, market=None):
    origin = legacy_origin(origin)
    db = WorkflowStore(store or create_store(settings))
    own_client = client is None
    client = client or httpx.AsyncClient(
        timeout=httpx.Timeout(60, connect=5), follow_redirects=False, trust_env=False
    )
    market = market or SpotMarket.from_settings(settings, client)

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
        return [(k, v) for k, v in request.headers.items() if k.lower() not in HOP_BY_HOP]

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
            return error(
                401, access.get("reason") or "Administrator sign-in required", access=access
            )
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

    async def legacy_get(request, path):
        """Read an existing API response for this browser request, unencoded."""
        forwarded = [(k, v) for k, v in headers(request) if k.lower() not in REWRITE_DROPPED]
        return await client.get(
            origin + path, headers=[*forwarded, ("accept-encoding", "identity")]
        )

    def relay(upstream, body=None):
        """The existing API's response; with `body`, the same status and headers, new JSON."""
        content = upstream.content if body is None else json.dumps(body).encode()
        dropped = HOP_BY_HOP | {"content-encoding"}
        if body is not None:
            dropped |= {"content-type", "etag", "last-modified"}
        out = [(k, v) for k, v in upstream.headers.multi_items() if k.lower() not in dropped]
        if body is not None:
            out.append(("content-type", "application/json; charset=utf-8"))
        response = Response(content, status_code=upstream.status_code)
        response.raw_headers = raw([*out, ("content-length", str(len(content)))])
        return response

    async def session_user(request):
        """The verified customer session, or None for signed-out and demo sessions."""
        response = await legacy_get(request, "/api/auth/session")
        if response.status_code != 200:
            raise httpx.HTTPError("session_unavailable")
        body = response.json()
        user = body.get("user") if isinstance(body, dict) else None
        if body.get("demo") or not isinstance(user, dict) or not isinstance(user.get("id"), str):
            return None
        return user

    @app.get("/api/marketplace/public")
    async def public_market(request: Request):
        try:
            upstream = await legacy_get(request, request.url.path)
        except httpx.HTTPError:
            return error(502, "The OpenNEXT service is temporarily unavailable.")
        if market is None or upstream.status_code != 200:
            return relay(upstream)
        try:
            body = upstream.json()
            offers = await market.offers()
            body["supplies"] = [*(body.get("supplies") or []), *(o.row for o in offers.values())]
        except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
            logger.exception("opennext_spot_offers_unavailable")
            return relay(upstream)
        return relay(upstream, body)

    @app.get("/api/marketplace/me")
    async def workspace(request: Request):
        try:
            upstream = await legacy_get(request, request.url.path)
        except httpx.HTTPError:
            return error(502, "The OpenNEXT service is temporarily unavailable.")
        if market is None or upstream.status_code != 200:
            return relay(upstream)
        try:
            body = upstream.json()
            user = await session_user(request)
            if user is None:
                return relay(upstream)
            body["instances"] = [
                *(body.get("instances") or []),
                *await market.instances(user["id"]),
            ]
        except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
            logger.exception("opennext_spot_instances_unavailable")
            return relay(upstream)
        return relay(upstream, body)

    def confirmation(rental):
        bought = purchased(rental)
        totals = checkout_totals(bought["cents"] / 100, bought["hours"])
        return JSONResponse(
            {
                "confirmed": True,
                "offerId": bought["offerId"],
                "orderId": rental["id"],
                "currency": "USD",
                "durationHours": bought["hours"],
                "totalCents": totals["totalCents"],
            },
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/api/marketplace/spot-purchases")
    async def spot_purchase(request: Request):
        if market is None:
            return error(503, "Spot purchasing is not available yet. No order was created.")
        try:
            user = await session_user(request)
        except (httpx.HTTPError, ValueError, AttributeError):
            return error(503, "Your session could not be verified. No order was created.")
        if user is None:
            return error(401, "Sign in to a Buyer account before purchasing capacity.")
        if (
            not same_origin(request)
            or not isinstance(user.get("csrfToken"), str)
            or not (
                secrets.compare_digest(
                    request.headers.get("x-csrf-token", "").encode(), user["csrfToken"].encode()
                )
            )
        ):
            return error(403, "Your session verification failed. Refresh and try again.")
        if user.get("role") != "buyer":
            return error(403, "A Buyer account is required to purchase capacity.")
        try:
            purchase = PurchaseRequest.model_validate_json(await request.body())
        except ValidationError as exc:
            invalid_key = any(e["loc"] == ("sshPublicKey",) for e in exc.errors())
            return error(
                400,
                "Add a valid SSH public key in the purchase review; this offer requires one. "
                "No order was created."
                if invalid_key
                else "The purchase request is invalid. No order was created.",
                code="INVALID_PURCHASE",
            )
        reference = order_reference(user["id"], purchase.idempotencyKey)
        try:
            existing = await market.find(user["id"], reference)
            if existing:
                bought = purchased(existing)
                if (bought["offerId"], bought["hours"]) != (
                    purchase.offerId,
                    purchase.durationHours,
                ):
                    return error(
                        409,
                        "This purchase reference was already used.",
                        code="IDEMPOTENCY_CONFLICT",
                    )
                return confirmation(existing)
            offer = (await market.offers()).get(purchase.offerId)
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            return error(503, "Spot offers are temporarily unavailable. No order was created.")
        if offer is None:
            return error(
                409,
                "This Spot offer is no longer available. Choose another offer.",
                code="OFFER_UNAVAILABLE",
            )
        totals = checkout_totals(offer.instance_hourly, purchase.durationHours)
        if totals != purchase.expectedPricing.model_dump():
            return error(
                409,
                "The offer price changed. Review the current price before paying.",
                code="PRICE_CHANGED",
            )
        rfq = rfq_for(offer, purchase, user["id"], utcnow(), market.storage_rate)
        try:
            response = await market.create(rfq)
            if response.status_code == 409:
                # A concurrent request with the same reference may have created it.
                existing = await market.find(user["id"], reference)
                if existing:
                    return confirmation(existing)
            if response.status_code not in {200, 201}:
                logger.error(
                    "opennext_spot_purchase_rejected status=%s body=%s",
                    response.status_code,
                    response.text[:500],
                )
                return error(502, "The Spot order was not accepted. No order was created.")
            return confirmation(response.json()["rental"])
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            # The outcome is unknown; retrying with the same reference cannot create a second order.
            return error(
                503, "The order status is uncertain. Check your instances before trying again."
            )

    @app.api_route("/api/{path:path}", methods=METHODS)
    async def passthrough(request: Request, path: str):
        target = (
            origin + request.url.path + (("?" + request.url.query) if request.url.query else "")
        )
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
        out = [(k, v) for k, v in response.headers.multi_items() if k.lower() not in HOP_BY_HOP]
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
