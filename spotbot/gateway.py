"""Stable, generation-fenced SSH and HTTP entry points for protected rentals."""

import asyncio
import hashlib
import hmac
import json
import logging
import secrets
import time
from contextlib import asynccontextmanager, suppress
from datetime import datetime
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse

from spotbot.gateway_config import GatewaySettings
from spotbot.models import timestamp, utcnow
from spotbot.storage import create_store
from spotbot.storage.workflows import WorkflowStore

logger = logging.getLogger(__name__)
HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


def proxy_headers(headers, *, request=False, bearer_access=False):
    connection = {p.strip().lower() for p in headers.get("connection", "").split(",")}
    excluded = HOP_HEADERS | connection
    if request:
        excluded |= {"host", "forwarded", "x-spotbot-access-token"}
        if bearer_access:
            excluded.add("authorization")
    return [
        (k, v)
        for k, v in (headers.multi_items() if hasattr(headers, "multi_items") else headers.items())
        if k.lower() not in excluded and not (request and k.lower().startswith("x-forwarded-"))
    ]


class GatewayHosts:
    """Customer paths such as /health must never resolve to control-plane routes."""

    def __init__(self, app, customer_app, domain):
        self.app, self.customer_app, self.domain = app, customer_app, domain

    async def __call__(self, scope, receive, send):
        host = (
            dict(scope.get("headers", [])).get(b"host", b"").decode("latin-1").split(":")[0].lower()
        )
        customer = bool(self.domain and host.startswith("r-") and host.endswith("." + self.domain))
        await (
            self.customer_app if customer and scope["type"] in {"http", "websocket"} else self.app
        )(scope, receive, send)


class Gateway:
    def __init__(self, settings, *, store=None, client=None, backend_client=None):
        self.settings = settings
        self.store = store or create_store(settings.storage_settings())
        self.db = WorkflowStore(self.store)
        self.client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(60, connect=5), follow_redirects=False, trust_env=False
        )
        self.own_client = client is None
        # Long HTTP streams must not exhaust the control-plane connection pool.
        self.backend_client = backend_client or httpx.AsyncClient(
            timeout=httpx.Timeout(60, connect=5), follow_redirects=False, trust_env=False
        )
        self.own_backend_client = backend_client is None
        self.locks, self.listeners, self.live, self.sessions = {}, {}, {}, {}
        self.expirations = {}
        self.ports_lock = asyncio.Lock()
        self.last_cycle_at = None
        self.worker_error = None

    def lock(self, rental_id):
        return self.locks.setdefault(rental_id, asyncio.Lock())

    def save(self, row):
        self.store.ensure_ownership()
        return self.db.save(row, row["version"])

    def access_token(self, rental_id):
        return hmac.new(
            self.settings.api_key.get_secret_value().encode(),
            ("rental-http:" + rental_id).encode(),
            hashlib.sha256,
        ).hexdigest()

    def authorized(self, rental_id):
        value = self.live.get(rental_id)
        return bool(value and time.monotonic() < value["lease"] and utcnow() < value["expiry"])

    def revoke(self, rental_id):
        self.live.pop(rental_id, None)
        timer = self.expirations.pop(rental_id, None)
        if timer:
            timer.cancel()
        for task in list(self.sessions.get(rental_id, ())):
            task.cancel()

    async def ingest(self, event):
        # The same outbox carries legacy orders and backup records.
        if (
            not str(event.get("type", "")).startswith("rental.")
            or event.get("resource_type") != "rental"
        ):
            return
        if not isinstance(event.get("rental_id"), str):
            raise ValueError("invalid_rental_id")
        rental_id = str(UUID(event["rental_id"]))
        tenant = event["tenant_id"]
        import re

        if not isinstance(tenant, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", tenant):
            raise ValueError("invalid_tenant")
        version, generation = event["state_version"], event["generation"]
        if type(version) is not int or version < 1 or type(generation) is not int or generation < 0:
            raise ValueError("invalid_event_version")
        async with self.lock(rental_id):
            row = self.db.get("gateway", rental_id)
            if row and row["tenant_id"] != tenant:
                raise ValueError("tenant_mismatch")
            if row and (
                version <= max(row["desired_version"], row["bot_version"])
                or generation < row["generation"]
            ):
                return
            if not row:
                row = dict(
                    id=rental_id,
                    kind="gateway",
                    tenant_id=tenant,
                    version=0,
                    port=None,
                    generation=0,
                    bot_version=0,
                    ready=False,
                    error=None,
                    created_at=timestamp(),
                )
            row.update(desired_version=version, desired_generation=generation)
            if event.get("state") not in {"ACTIVE", "DELIVERING"}:
                self.revoke(rental_id)
                row.update(ready=False, error="rental_unavailable")
            self.save(row)

    async def bot(self, row, path="", *, payload=None):
        headers = {
            "Authorization": "Bearer " + self.settings.bot_token.get_secret_value(),
            "X-SpotBot-Tenant": row["tenant_id"],
        }
        response = await self.client.request(
            "GET" if payload is None else "POST",
            self.settings.bot_url + "/v1/rentals/" + row["id"] + path,
            headers=headers,
            json=payload,
            timeout=10,
        )
        response.raise_for_status()
        return response.json()

    def target(self, rental):
        connection, rules = rental["connection"], rental["rfq"]
        ssh = connection["ssh"]
        host = ssh["host"]
        if (
            connection["rental_id"] != rental["id"]
            or connection["generation"] != rental["generation"]
            or ssh["port"] != 22
            or not self.settings.target_allowed(host)
            or ssh["user"] != rules["ssh_user"]
        ):
            raise ValueError("target_not_allowed")
        http = connection.get("http")
        if rules.get("http_port"):
            url = urlsplit(http or "")
            if (
                url.scheme != "http"
                or url.hostname != host
                or url.port != rules["http_port"]
                or url.username
                or url.password
                or url.path not in {"", "/"}
                or url.query
                or url.fragment
                or not self.settings.public_http_domain
            ):
                raise ValueError("http_target_not_allowed")
        elif http:
            raise ValueError("unexpected_http_target")
        return dict(host=host, port=22, user=ssh["user"], http=http)

    async def probe(self, target, rules):
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(target["host"], target["port"]), 3
        )
        try:
            if not (await asyncio.wait_for(reader.readline(), 3)).startswith(b"SSH-"):
                raise ValueError("ssh_banner_missing")
        finally:
            writer.close()
            with suppress(OSError):
                await writer.wait_closed()
        if target["http"]:
            response = await self.backend_client.get(
                target["http"].rstrip("/") + rules["http_health_path"], timeout=5
            )
            if response.status_code != 200:
                raise ValueError("http_health_check_failed")

    async def listener(self, row):
        if row["id"] in self.listeners:
            return
        async with self.ports_lock:
            if row["port"] is None:
                assigned = {r["port"] for r in self.db.list("gateway") if r["port"] is not None}
                row["port"] = next(
                    (
                        p
                        for p in range(self.settings.ssh_port_start, self.settings.ssh_port_end + 1)
                        if p not in assigned
                    ),
                    None,
                )
                if row["port"] is None:
                    raise ValueError("ssh_port_range_exhausted")
                self.save(row)
            # Bind failure is an error, not permission to pick a different stable port.
            server = await asyncio.start_server(
                lambda r, w: self.forward_ssh(row["id"], r, w),
                self.settings.ssh_bind,
                row["port"],
            )
            self.listeners[row["id"]] = server

    def public(self, row, *, include_token=False):
        ready = self.authorized(row["id"])
        result = dict(
            rental_id=row["id"],
            generation=row["generation"],
            ready=ready,
            error=row.get("error"),
            ssh={
                "host": self.settings.public_ssh_host,
                "port": row["port"],
                "user": row.get("ssh_user"),
            },
            http=(
                f"https://r-{row['id']}.{self.settings.public_http_domain}"
                if row.get("has_http")
                else None
            ),
        )
        if include_token and ready and result["http"]:
            result["http_access_token"] = self.access_token(row["id"])
        return result

    async def reconcile(self, rental_id):
        async with self.lock(rental_id):
            row = self.db.get("gateway", rental_id)
            if not row:
                return
            try:
                self.store.ensure_ownership()
                rental = await self.bot(row)
                if rental["id"] != rental_id or rental["tenant_id"] != row["tenant_id"]:
                    raise ValueError("bot_identity_mismatch")
                if rental["version"] < max(row["desired_version"], row["bot_version"]) or rental[
                    "generation"
                ] < max(row["generation"], row.get("desired_generation", 0)):
                    raise ValueError("bot_state_stale")
                expiry = datetime.fromisoformat(rental["rfq"]["expires_at"])
                if (
                    rental["state"] not in {"ACTIVE", "DELIVERING"}
                    or rental["end_requested"]
                    or expiry <= utcnow()
                ):
                    self.revoke(rental_id)
                    row.update(
                        ready=False,
                        error="rental_unavailable",
                        bot_version=rental["version"],
                        generation=rental["generation"],
                        terminal=rental["state"] == "CLOSED",
                    )
                    self.save(row)
                    if row["terminal"]:
                        server = self.listeners.pop(rental_id, None)
                        if server:
                            server.close()
                            await server.wait_closed()
                    return
                target = self.target(rental)
                previous = self.live.get(rental_id)
                changed = (
                    not previous
                    or previous["target"] != target
                    or previous["generation"] != rental["generation"]
                )
                if changed:
                    self.revoke(rental_id)
                    await self.probe(target, rental["rfq"])
                await self.listener(row)
                row.update(
                    generation=rental["generation"],
                    ssh_user=target["user"],
                    has_http=bool(target["http"]),
                )
                if rental["state"] == "DELIVERING":
                    rental = await self.bot(
                        row,
                        "/gateway-ack",
                        payload={
                            "generation": row["generation"],
                            "accepted": True,
                        },
                    )
                    if (
                        rental["state"] != "ACTIVE"
                        or rental["id"] != rental_id
                        or rental["generation"] != row["generation"]
                        or rental["end_requested"]
                        or rental["tenant_id"] != row["tenant_id"]
                    ):
                        raise ValueError("handoff_acknowledgement_rejected")
                    if self.target(rental) != target:
                        raise ValueError("handoff_target_changed")
                    # The acknowledged response is authoritative, including expiry revisions.
                    expiry = datetime.fromisoformat(rental["rfq"]["expires_at"])
                if expiry <= utcnow():
                    raise ValueError("rental_expired")
                self.live[rental_id] = dict(
                    target=target,
                    generation=row["generation"],
                    expiry=expiry,
                    lease=time.monotonic() + self.settings.route_lease_seconds,
                )
                row.update(
                    ready=True,
                    error=None,
                    bot_version=rental["version"],
                    last_authorized_at=timestamp(),
                )
                self.save(row)
                timer = self.expirations.pop(rental_id, None)
                if timer:
                    timer.cancel()
                self.expirations[rental_id] = asyncio.get_running_loop().call_later(
                    min(
                        self.settings.route_lease_seconds,
                        max(0, (expiry - utcnow()).total_seconds()),
                    ),
                    self.revoke,
                    rental_id,
                )
            except (httpx.HTTPError, OSError, TimeoutError):
                # Existing authorization remains valid only until its bounded lease expires.
                row.update(
                    error="gateway_reconciliation_unavailable", ready=self.authorized(rental_id)
                )
                self.save(row)
            except (ValueError, KeyError, TypeError) as exc:
                self.revoke(rental_id)
                safe_codes = {
                    "ssh_port_range_exhausted",
                    "target_not_allowed",
                    "http_target_not_allowed",
                    "bot_state_stale",
                    "bot_identity_mismatch",
                    "ssh_banner_missing",
                    "http_health_check_failed",
                    "rental_expired",
                }
                row.update(
                    ready=False,
                    error=str(exc) if str(exc) in safe_codes else "gateway_handoff_invalid",
                )
                self.save(row)

    async def tick(self):
        try:
            self.store.ensure_ownership()
        except Exception:
            for rental_id in list(self.live):
                self.revoke(rental_id)
            raise
        for rental_id in list(self.live):
            if not self.authorized(rental_id):
                self.revoke(rental_id)
        semaphore = asyncio.Semaphore(16)

        async def one(row):
            async with semaphore:
                await self.reconcile(row["id"])

        await asyncio.gather(
            *(
                one(row)
                for row in self.db.list("gateway")
                if not row.get("terminal") or row["desired_version"] > row["bot_version"]
            )
        )
        self.last_cycle_at = timestamp()

    async def run(self):
        while True:
            try:
                await self.tick()
                self.worker_error = None
            except Exception:
                for rental_id in list(self.live):
                    self.revoke(rental_id)
                self.worker_error = "gateway_worker_failed"
                logger.warning("Gateway worker cycle failed; retrying")
            await asyncio.sleep(self.settings.poll_seconds)

    async def forward_ssh(self, rental_id, reader, writer):
        task = asyncio.current_task()
        self.sessions.setdefault(rental_id, set()).add(task)
        upstream = None
        try:
            if not self.authorized(rental_id):
                return
            target = self.live[rental_id]["target"]
            remote, upstream = await asyncio.wait_for(
                asyncio.open_connection(target["host"], target["port"]), 5
            )

            async def pump(source, destination):
                while True:
                    data = await asyncio.wait_for(source.read(65536), 300)
                    if not data:
                        if destination.can_write_eof():
                            destination.write_eof()
                        return
                    if not self.authorized(rental_id):
                        return
                    destination.write(data)
                    await destination.drain()

            async with asyncio.TaskGroup() as group:
                group.create_task(pump(reader, upstream))
                group.create_task(pump(remote, writer))
        except (OSError, TimeoutError, ExceptionGroup):
            pass
        finally:
            self.sessions[rental_id].discard(task)
            for stream in (writer, upstream):
                if stream:
                    stream.close()
                    with suppress(OSError, asyncio.CancelledError):
                        await stream.wait_closed()

    async def close(self):
        for timer in self.expirations.values():
            timer.cancel()
        self.expirations.clear()
        for rental_id in list(self.sessions):
            self.revoke(rental_id)
        for server in self.listeners.values():
            server.close()
            await server.wait_closed()
        tasks = [task for group in self.sessions.values() for task in group]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        if self.own_client:
            await self.client.aclose()
        if self.own_backend_client:
            await self.backend_client.aclose()
        self.store.close()


def create_gateway_app(settings=None, gateway=None):
    config = settings or GatewaySettings()
    svc = gateway or Gateway(config)

    @asynccontextmanager
    async def lifespan(app):
        task = None
        try:
            svc.store.acquire()
            task = asyncio.create_task(svc.run())
            app.state.worker = task
            yield
        finally:
            if task:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
            await svc.close()

    app = FastAPI(title="SpotOrderBot Gateway", lifespan=lifespan)
    customer_app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(GatewayHosts, customer_app=customer_app, domain=config.public_http_domain)
    app.state.gateway = svc

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse(status_code=422, content={"detail": "invalid_gateway_request"})

    @app.get("/health")
    def health():
        task = getattr(app.state, "worker", None)
        healthy = bool(task and not task.done() and not svc.worker_error and svc.last_cycle_at)
        return JSONResponse(
            status_code=200 if healthy else 503,
            content={
                "worker_running": healthy,
                "last_cycle_at": svc.last_cycle_at,
                "error": svc.worker_error,
            },
        )

    @app.post("/v1/gateway/events", status_code=204)
    async def events(request: Request):
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 32768:
                raise HTTPException(413, "event_too_large")
        sent = request.headers.get("x-spotbot-timestamp", "")
        signature = request.headers.get("x-spotbot-signature", "")
        try:
            valid_time = abs(time.time() - int(sent)) <= 300
        except ValueError:
            valid_time = False
        expected = (
            "sha256="
            + hmac.new(
                config.webhook_secret.get_secret_value().encode(),
                sent.encode() + b"." + body,
                hashlib.sha256,
            ).hexdigest()
        )
        if not valid_time or not secrets.compare_digest(signature.encode(), expected.encode()):
            raise HTTPException(401, "invalid_webhook_signature")
        try:
            event = json.loads(body)
            if (
                not isinstance(event, dict)
                or not event.get("event_id")
                or event["event_id"] != request.headers.get("x-spotbot-event-id")
            ):
                raise ValueError("event_identity_mismatch")
            await svc.ingest(event)
        except (ValueError, KeyError, TypeError):
            raise HTTPException(400, "invalid_gateway_event") from None

    @app.get("/v1/gateway/rentals/{rental_id}/connection")
    def connection(
        rental_id: UUID, authorization: str = Header(""), x_spotbot_tenant: str = Header("")
    ):
        if not secrets.compare_digest(
            authorization.encode(), ("Bearer " + config.api_key.get_secret_value()).encode()
        ):
            raise HTTPException(401, "invalid_gateway_api_token")
        row = svc.db.get("gateway", str(rental_id))
        if not row or row["tenant_id"] != x_spotbot_tenant:
            raise HTTPException(404, "gateway_rental_not_found")
        return svc.public(row, include_token=True)

    @customer_app.api_route(
        "/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
    )
    async def proxy(request: Request, path: str):
        host = request.headers.get("host", "").split(":")[0].lower()
        suffix = "." + config.public_http_domain
        try:
            if (
                not config.public_http_domain
                or not host.startswith("r-")
                or not host.endswith(suffix)
            ):
                raise ValueError()
            rental_id = str(UUID(host[2 : -len(suffix)]))
        except ValueError:
            raise HTTPException(404, "gateway_route_not_found") from None
        authorization = request.headers.get("authorization", "")
        header_token = request.headers.get("x-spotbot-access-token")
        bearer_access = header_token is None
        scheme, _, credential = authorization.partition(" ")
        access = (
            header_token
            if header_token is not None
            else (credential if scheme.lower() == "bearer" else "")
        )
        if not secrets.compare_digest(access.encode(), svc.access_token(rental_id).encode()):
            raise HTTPException(401, "invalid_rental_access_token")
        if not svc.authorized(rental_id) or not svc.live[rental_id]["target"]["http"]:
            raise HTTPException(503, "gateway_route_unavailable")
        if request.headers.get("upgrade"):
            raise HTTPException(400, "http_upgrades_not_supported")
        target = svc.live[rental_id]["target"]["http"]
        # Preserve escaped paths and queries without resolving user input as a URL.
        url = httpx.URL(target).copy_with(
            raw_path=request.scope["raw_path"]
            + (b"?" + request.scope["query_string"] if request.scope["query_string"] else b"")
        )
        task = asyncio.current_task()
        svc.sessions.setdefault(rental_id, set()).add(task)
        upstream = None
        try:

            async def body():
                async for chunk in request.stream():
                    if not svc.authorized(rental_id):
                        raise httpx.RequestError("Gateway route revoked during upload")
                    yield chunk

            outbound = svc.backend_client.build_request(
                request.method,
                url,
                headers=proxy_headers(request.headers, request=True, bearer_access=bearer_access)
                + [("Host", host), ("X-Forwarded-Host", host), ("X-Forwarded-Proto", "https")],
                content=body(),
                timeout=60,
            )
            upstream = await svc.backend_client.send(outbound, stream=True)
        except httpx.HTTPError:
            svc.sessions[rental_id].discard(task)
            raise HTTPException(502, "gateway_backend_unreachable") from None
        except BaseException:
            svc.sessions[rental_id].discard(task)
            if upstream:
                await upstream.aclose()
            raise

        async def stream():
            try:
                async for chunk in upstream.aiter_raw():
                    if not svc.authorized(rental_id):
                        break
                    yield chunk
            finally:
                svc.sessions[rental_id].discard(task)
                await upstream.aclose()

        response = StreamingResponse(stream(), status_code=upstream.status_code)
        response.raw_headers = [
            (k.encode("latin-1"), v.encode("latin-1")) for k, v in proxy_headers(upstream.headers)
        ]
        return response

    return app
