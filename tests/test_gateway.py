"""Gateway acceptance: durable fencing, real TCP forwarding, HTTP and tenant isolation."""

import asyncio
import copy
import hashlib
import hmac
import json
import socket
import time
from datetime import timedelta
from uuid import uuid4

import httpx
import pytest
from pydantic import ValidationError

from spotbot.gateway import Gateway, create_gateway_app
from spotbot.gateway_config import GatewaySettings
from spotbot.models import utcnow


class Body(httpx.AsyncByteStream):
    def __init__(self, data):
        self.data = data

    async def __aiter__(self):
        yield self.data


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture
async def environment(tmp_path):
    port = free_port()
    config = GatewaySettings(
        _env_file=None,
        bot_url="http://127.0.0.1:8000",
        bot_token="b" * 40,
        api_key="a" * 40,
        webhook_secret="w" * 40,
        public_ssh_host="ssh.example.com",
        public_http_domain="gpu.example.com",
        ssh_bind="127.0.0.1",
        ssh_port_start=port,
        ssh_port_end=port,
        allowed_target_cidrs="127.0.0.1/32",
        database_path=tmp_path / "gateway.db",
    )
    rental_id = str(uuid4())
    rental = dict(
        authorization_scope="gateway_delivery",
        id=rental_id,
        tenant_id="tenant-a",
        version=10,
        generation=1,
        state="DELIVERING",
        end_requested=False,
        rfq=dict(
            ssh_user="ubuntu",
            http_port=8000,
            http_health_path="/health",
            expires_at=(utcnow() + timedelta(hours=1)).isoformat(),
        ),
        connection=dict(
            rental_id=rental_id,
            generation=1,
            ssh=dict(host="127.0.0.1", port=22, user="ubuntu"),
            http="http://127.0.0.1:8000",
        ),
    )
    state = dict(rental=rental, requests=[], outage=False, ack_failure=False)

    async def upstream(request):
        state["requests"].append(request)
        if request.url.path.startswith("/v1/rentals/"):
            assert request.headers["x-spotbot-tenant"] == "tenant-a"
            assert request.headers["authorization"] == "Bearer " + "b" * 40
            if state["outage"]:
                return httpx.Response(503)
            if request.url.path.endswith("/gateway-ack"):
                assert json.loads(request.content)["generation"] == state["rental"]["generation"]
                if state["ack_failure"]:
                    return httpx.Response(409)
                state["rental"].update(state="ACTIVE", version=state["rental"]["version"] + 1)
            return httpx.Response(200, json=copy.deepcopy(state["rental"]))
        if request.url.path == "/health":
            return httpx.Response(200)
        if request.url.path == "/redirect":
            return httpx.Response(
                302, stream=Body(b""), headers={"location": "http://169.254.169.254/secret"}
            )
        return httpx.Response(
            200,
            stream=Body(await request.aread() or b"backend-data"),
            headers=[("set-cookie", "a=1"), ("set-cookie", "b=2")],
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    gateway = Gateway(config, client=client, backend_client=client)
    gateway.store.acquire()

    async def probe(*args):
        pass

    gateway.probe = probe
    state.update(gateway=gateway, config=config, id=rental_id)
    try:
        yield state
    finally:
        await gateway.close()
        await client.aclose()


def event(env, *, version=10, generation=1, state="DELIVERING", **extra):
    return dict(
        event_id=str(uuid4()),
        type="rental.handoff",
        resource_type="rental",
        rental_id=env["id"],
        tenant_id="tenant-a",
        state_version=version,
        generation=generation,
        state=state,
        **extra,
    )


async def activate(env):
    await env["gateway"].ingest(event(env))
    await env["gateway"].tick()
    assert env["gateway"].authorized(env["id"])


def sign(config, value, sent=None):
    raw = json.dumps(value).encode()
    sent = str(int(time.time()) if sent is None else sent)
    signature = hmac.new(
        config.webhook_secret.get_secret_value().encode(),
        sent.encode() + b"." + raw,
        hashlib.sha256,
    ).hexdigest()
    return raw, {
        "X-SpotBot-Timestamp": sent,
        "X-SpotBot-Signature": "sha256=" + signature,
        "X-SpotBot-Event-ID": value["event_id"],
        "Content-Type": "application/json",
    }


async def test_signed_events_tenant_lookup_and_http_proxy(environment):
    env = environment
    app = create_gateway_app(env["config"], env["gateway"])
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="https://gateway.example.com"
    ) as client:
        value = event(env)
        raw, headers = sign(env["config"], value)
        assert (
            await client.post("/v1/gateway/events", content=raw, headers=headers)
        ).status_code == 204
        assert (
            await client.post("/v1/gateway/events", content=raw + b" ", headers=headers)
        ).status_code == 401
        old_raw, old_headers = sign(env["config"], value, sent=time.time() - 1000)
        assert (
            await client.post("/v1/gateway/events", content=old_raw, headers=old_headers)
        ).status_code == 401
        await env["gateway"].tick()
        url = f"/v1/gateway/rentals/{env['id']}/connection"
        assert (await client.get(url)).status_code == 401
        auth = {"Authorization": "Bearer " + "a" * 40, "X-SpotBot-Tenant": "tenant-b"}
        assert (await client.get(url, headers=auth)).status_code == 404
        auth["X-SpotBot-Tenant"] = "tenant-a"
        result = (await client.get(url, headers=auth)).json()
        assert result["ready"] and result["ssh"]["host"] == "ssh.example.com"
        host = f"r-{env['id']}.gpu.example.com"
        assert (await client.get("/predict", headers={"Host": host})).status_code == 401
        token = result["http_access_token"]
        response = await client.post(
            "/predict?a=1",
            content=b"model-request",
            headers={
                "Host": host,
                "X-SpotBot-Access-Token": token,
                "Authorization": "Bearer customer-application-token",
                "X-Forwarded-Host": "evil",
            },
        )
        assert response.content == b"model-request"
        assert response.headers.get_list("set-cookie") == ["a=1", "b=2"]
        forwarded = env["requests"][-1]
        assert forwarded.url.query == b"a=1"
        assert "x-spotbot-access-token" not in forwarded.headers
        assert forwarded.headers["x-forwarded-host"] == host
        assert forwarded.headers["host"] == host
        assert forwarded.headers["x-forwarded-proto"] == "https"
        assert forwarded.headers["authorization"] == "Bearer customer-application-token"
        response = await client.get(
            "/redirect", headers={"Host": host, "Authorization": "Bearer " + token}
        )
        assert response.status_code == 302
        assert "authorization" not in env["requests"][-1].headers
        assert not any(r.url.host == "169.254.169.254" for r in env["requests"])


async def test_stale_events_backups_and_replacement_keep_port(environment):
    env, gw = environment, environment["gateway"]
    await activate(env)
    port = gw.db.get("gateway", env["id"])["port"]
    await gw.ingest(event(env, version=9, state="RECOVERING"))
    ignored = event(env, version=100, state="CLOSED")
    ignored.update(resource_type="backup", state_version=None)
    await gw.ingest(ignored)
    assert gw.authorized(env["id"])
    await gw.ingest(event(env, version=12, state="RECOVERING"))
    assert not gw.authorized(env["id"])
    # An older authoritative read cannot reinstate a revoked route.
    await gw.tick()
    assert not gw.authorized(env["id"])
    env["rental"].update(version=14, generation=2, state="DELIVERING")
    env["rental"]["connection"]["generation"] = 2
    await gw.ingest(event(env, version=14, generation=2))
    await gw.tick()
    assert gw.authorized(env["id"])
    assert gw.db.get("gateway", env["id"])["port"] == port
    # Poll/ack may have observed a newer version than the last webhook watermark.
    await gw.ingest(event(env, version=15, generation=2, state="ENDING"))
    assert gw.authorized(env["id"])
    await gw.ingest(event(env, version=13, generation=1, state="ENDING"))
    assert gw.authorized(env["id"])


async def test_ack_failure_expiry_and_authorization_lease(environment):
    env, gw = environment, environment["gateway"]
    env["ack_failure"] = True
    await gw.ingest(event(env))
    await gw.tick()
    assert not gw.authorized(env["id"])
    env["ack_failure"] = False
    await gw.tick()
    assert gw.authorized(env["id"])
    env["outage"] = True
    await gw.tick()
    assert gw.authorized(env["id"])
    gw.live[env["id"]]["lease"] = time.monotonic() - 1
    await gw.tick()
    assert not gw.authorized(env["id"])
    env["outage"] = False
    await gw.tick()
    assert gw.authorized(env["id"])
    env["rental"]["rfq"]["expires_at"] = (utcnow() - timedelta(seconds=1)).isoformat()
    await gw.tick()
    assert not gw.authorized(env["id"])


async def test_real_ssh_bytes_and_revoke_closes_session(environment):
    env, gw = environment, environment["gateway"]

    async def echo(reader, writer):
        writer.write(b"SSH-2.0-test-server\r\n")
        await writer.drain()
        try:
            while data := await reader.read(1024):
                writer.write(data)
                await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(echo, "127.0.0.1", 0)
    target_port = server.sockets[0].getsockname()[1]
    try:
        await Gateway.probe(gw, dict(host="127.0.0.1", port=target_port, http=None), {})
        await activate(env)
        gw.live[env["id"]]["target"]["port"] = target_port
        port = gw.db.get("gateway", env["id"])["port"]
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        assert await asyncio.wait_for(reader.readline(), 2) == b"SSH-2.0-test-server\r\n"
        writer.write(b"encrypted-ssh-bytes")
        await writer.drain()
        assert await asyncio.wait_for(reader.readexactly(19), 2) == b"encrypted-ssh-bytes"
        await gw.ingest(event(env, version=12, state="ENDING"))
        assert await asyncio.wait_for(reader.read(), 2) == b""
        writer.close()
        await writer.wait_closed()
    finally:
        server.close()
        await server.wait_closed()


async def test_restart_requires_reauthorization_and_keeps_assigned_port(environment):
    env, gw = environment, environment["gateway"]
    await activate(env)
    port = gw.db.get("gateway", env["id"])["port"]
    await gw.close()
    restarted = Gateway(env["config"], client=gw.client)
    restarted.store.acquire()
    restarted.probe = gw.probe
    try:
        assert not restarted.authorized(env["id"])
        await restarted.tick()
        assert restarted.authorized(env["id"])
        assert restarted.db.get("gateway", env["id"])["port"] == port
    finally:
        await restarted.close()


async def test_port_exhaustion_and_target_policy(environment):
    env, gw = environment, environment["gateway"]
    await activate(env)
    env["id"] = str(uuid4())
    env["rental"].update(id=env["id"], state="DELIVERING")
    env["rental"]["connection"].update(rental_id=env["id"])
    await gw.ingest(event(env))
    await gw.reconcile(env["id"])
    assert not gw.authorized(env["id"])
    assert gw.db.get("gateway", env["id"])["error"] == "ssh_port_range_exhausted"
    assert not env["config"].target_allowed("169.254.169.254")
    assert not env["config"].target_allowed("backend.example.com")
    assert env["config"].target_allowed("127.0.0.1")
    public = env["config"].model_copy(update={"allowed_target_cidrs": ""})
    assert public.target_allowed("8.8.8.8")
    assert not public.target_allowed("127.0.0.1")
    assert not public.target_allowed("10.0.0.1")
    bad = copy.deepcopy(env["rental"])
    bad["connection"]["ssh"]["host"] = "169.254.169.254"
    with pytest.raises(ValueError, match="target_not_allowed"):
        gw.target(bad)


def test_gateway_config_uses_independent_storage_and_credentials(tmp_path, monkeypatch):
    values = dict(
        _env_file=None,
        bot_url="https://bot.example.com",
        bot_token="b" * 40,
        api_key="a" * 40,
        webhook_secret="w" * 40,
        public_ssh_host="ssh.example.com",
    )
    monkeypatch.setenv("SPOTBOT_STORAGE_BACKEND", "mysql")
    monkeypatch.setenv("SPOTBOT_DATABASE_PATH", "/some/bot/database")
    settings = GatewaySettings(**values)
    assert settings.storage_settings().spotbot_storage_backend == "sqlite"
    assert settings.storage_settings().spotbot_database_path.name == "gateway.sqlite3"
    with pytest.raises(ValidationError):
        GatewaySettings(**dict(values, bot_url="http://metadata.internal"))
    with pytest.raises(ValidationError):
        GatewaySettings(**dict(values, api_key=values["bot_token"]))


async def test_expiry_timer_enforces_revocation_without_worker_tick(environment):
    env, gw = environment, environment["gateway"]
    await activate(env)
    env["rental"]["rfq"]["expires_at"] = (utcnow() + timedelta(milliseconds=80)).isoformat()
    await gw.tick()
    assert gw.authorized(env["id"])
    await asyncio.sleep(0.12)
    assert env["id"] not in gw.live


async def test_polling_recovers_missing_events_and_ownership_loss_revokes(environment, monkeypatch):
    env, gw = environment, environment["gateway"]
    await activate(env)
    env["rental"].update(state="RECOVERING", version=12)
    await gw.tick()
    assert not gw.authorized(env["id"])
    env["rental"].update(state="ACTIVE", version=13)
    await gw.tick()
    assert gw.authorized(env["id"])

    def lost():
        raise RuntimeError("Storage ownership lost")

    monkeypatch.setattr(gw.store, "ensure_ownership", lost)
    with pytest.raises(RuntimeError):
        await gw.tick()
    assert not gw.authorized(env["id"])


async def test_failed_bind_does_not_acknowledge_delivery(environment):
    env, gw = environment, environment["gateway"]
    occupied = await asyncio.start_server(
        lambda r, w: w.close(), "127.0.0.1", env["config"].ssh_port_start
    )
    try:
        await gw.ingest(event(env))
        await gw.tick()
        assert not gw.authorized(env["id"])
        assert not any(r.url.path.endswith("gateway-ack") for r in env["requests"])
        assert env["rental"]["state"] == "DELIVERING"
    finally:
        occupied.close()
        await occupied.wait_closed()


async def test_gateway_handoff_cannot_cross_tenants(environment):
    env, gw = environment, environment["gateway"]
    await activate(env)
    value = event(env, version=12)
    value["tenant_id"] = "tenant-b"
    with pytest.raises(ValueError, match="tenant_mismatch"):
        await gw.ingest(value)
    assert gw.authorized(env["id"])
    env["rental"]["tenant_id"] = "tenant-b"
    await gw.tick()
    assert not gw.authorized(env["id"])


async def test_gateway_refuses_an_administrator_delivery_response(environment):
    env, gw = environment, environment["gateway"]
    env["rental"].pop("authorization_scope")
    await gw.ingest(event(env))
    await gw.tick()
    assert not gw.authorized(env["id"])
    assert gw.db.get("gateway", env["id"])["error"] == "restricted_gateway_credential_required"
    assert not any(r.url.path.endswith("gateway-ack") for r in env["requests"])


async def test_real_http_stream_and_customer_paths_do_not_hit_control_api(environment):
    env, gw = environment, environment["gateway"]
    received = []

    async def serve(reader, writer):
        try:
            received.append(await reader.readuntil(b"\r\n\r\n"))
            writer.write(
                b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
            )
            writer.write(b"6\r\nhello-\r\n")
            await writer.drain()
            await asyncio.sleep(0)
            writer.write(b"5\r\nworld\r\n0\r\n\r\n")
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(serve, "127.0.0.1", 0)
    backend_port = server.sockets[0].getsockname()[1]
    original = gw.backend_client
    real_client = httpx.AsyncClient(trust_env=False, follow_redirects=False)
    try:
        await activate(env)
        gw.backend_client = real_client
        gw.live[env["id"]]["target"]["http"] = f"http://127.0.0.1:{backend_port}"
        app = create_gateway_app(env["config"], gw)
        headers = {
            "Host": f"r-{env['id']}.gpu.example.com",
            "Authorization": "Bearer " + gw.access_token(env["id"]),
        }
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="https://gateway.example.com"
        ) as client:
            response = await client.get("/health?name=a%20b", headers=headers)
            assert response.content == b"hello-world"
            assert received[0].startswith(b"GET /health?name=a%20b HTTP/1.1\r\n")
            assert b"authorization:" not in received[0].lower()
            assert (
                await client.get("/health", headers={"Host": headers["Host"]})
            ).status_code == 401
            response = await client.get("/v1/gateway/events", headers=headers)
            assert response.content == b"hello-world"
    finally:
        gw.backend_client = original
        await real_client.aclose()
        server.close()
        await server.wait_closed()
