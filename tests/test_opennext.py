"""OpenNEXT adapter: admin rental instances and transparent pass-through to the existing API."""

import json

import httpx
import pytest

from spotbot.opennext import create_opennext_app, legacy_origin
from spotbot.storage.sqlite import Store
from spotbot.storage.workflows import WorkflowStore

ADMIN = "on_pricing_admin=valid"


def legacy(request):
    """Stand-in for the existing OpenNEXT API with its administrator session rules."""
    if request.url.path == "/api/admin/pricing/session":
        if request.headers["host"] == "terminal.example.com":
            return httpx.Response(404, json={"error": "Not found"})
        authorized = ADMIN in request.headers.get("cookie", "")
        reason = "Authorized pricing operations" if authorized else "Administrator sign-in required"
        return httpx.Response(200, json={"access": {"mutable": authorized, "local": False, "reason": reason}})
    return httpx.Response(
        201,
        json={
            "method": request.method,
            "path": request.url.path,
            "query": request.url.query.decode(),
            "host": request.headers["host"],
            "cookie": request.headers.get("cookie"),
            "csrf": request.headers.get("x-csrf-token"),
            "body": request.content.decode(),
        },
        headers=[("Set-Cookie", "a=1; HttpOnly"), ("Set-Cookie", "b=2; HttpOnly")],
    )


def rental(db, rental_id, tenant, state, created, *, generation=None, **extra):
    row = dict(
        id=rental_id,
        kind="rental",
        tenant_id=tenant,
        state=state,
        generation=1 if generation else 0,
        current_generation_id=generation["id"] if generation else None,
        created_at=created,
        estimated_cost_usd="0.420000",
        rfq=dict(
            rfq_id="rfq-" + rental_id,
            upstream_order_id="order-" + rental_id,
            gpu_model="L4",
            gpu_count=1,
            regions=["us-east-1"],
            max_price_hourly="0.95",
            budget_usd="3.00",
            expires_at="2026-10-28T00:00:00+00:00",
        ),
        **extra,
    )
    if generation:
        db.save(generation)
    db.save(row)


@pytest.fixture
async def env(tmp_path):
    db = WorkflowStore(Store(tmp_path / "bot.db"))
    gen = dict(
        id="gen-a", kind="generation", tenant_id="tenant-a", region="us-west-2",
        instance_id="i-0abc", agent_token="secret-agent-token",
        offer={"sku": "g6.2xlarge", "availability_zone": "us-west-2c"},
        connection={"ssh": {"host": "203.0.113.7"}},
    )
    rental(db, "a", "tenant-a", "ACTIVE", "2026-10-27T03:00:00+00:00", generation=gen)
    rental(db, "b", "tenant-b", "RECOVERING", "2026-10-27T02:00:00+00:00")
    rental(db, "c", "tenant-a", "CLOSED", "2026-10-27T01:00:00+00:00", closed_at="2026-10-27T01:30:00+00:00")
    rental(db, "d", "tenant-c", "ACTION_REQUIRED", "2026-10-27T00:00:00+00:00", error="gateway_ack_timeout")
    calls = []

    async def handler(request):
        await request.aread()  # Bodies arrive as a stream, as from a real browser.
        calls.append(request)
        return legacy(request)

    upstream = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app = create_opennext_app(None, origin="http://127.0.0.1:4189", store=db.store, client=upstream)
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://admin.example.com")
    try:
        yield client, calls, upstream
    finally:
        await client.aclose()
        await upstream.aclose()


async def test_instances_require_an_administrator_session_on_the_admin_host(env):
    client, calls, _ = env
    denied = await client.get("/api/admin/instances")
    assert denied.status_code == 401 and denied.json()["access"]["mutable"] is False
    hidden = await client.get("/api/admin/instances", headers={"Host": "terminal.example.com", "Cookie": ADMIN})
    assert hidden.status_code == 404
    # The existing API decides, from the browser's own Host and cookies.
    assert calls[-1].headers["host"] == "terminal.example.com" and ADMIN in calls[-1].headers["cookie"]


async def test_admin_sees_every_tenants_rentals_newest_first_without_secrets(env):
    client, _, _ = env
    response = await client.get("/api/admin/instances", headers={"Cookie": ADMIN})
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    body = response.json()
    assert [i["id"] for i in body["instances"]] == ["a", "b", "c", "d"]
    assert [i["lifecycle"] for i in body["instances"]] == ["Running", "Connecting", "End", "Attention"]
    first = body["instances"][0]
    assert first == {
        "id": "a", "tenantId": "tenant-a", "orderId": "order-a", "rfqId": "rfq-a",
        "model": "L4", "gpuCount": 1, "term": "Spot", "region": "us-west-2", "zone": "us-west-2c",
        "instanceType": "g6.2xlarge", "instanceId": "i-0abc", "generation": 1, "state": "ACTIVE",
        "lifecycle": "Running", "error": None, "degraded": None, "priceCeilingHourlyUsd": "0.95",
        "estimatedCostUsd": "0.420000", "budgetUsd": "3.00", "createdAt": "2026-10-27T03:00:00+00:00",
        "expiresAt": "2026-10-28T00:00:00+00:00", "closedAt": None,
    }
    assert "secret-agent-token" not in response.text and "203.0.113.7" not in response.text
    assert body["instances"][1]["region"] == "us-east-1"  # No server yet: the RFQ's first Region.
    assert body["nextCursor"] is None and body["asOf"]


async def test_status_filter_and_cursor_pagination(env):
    client, _, _ = env
    running = await client.get("/api/admin/instances?status=running", headers={"Cookie": ADMIN})
    assert [i["id"] for i in running.json()["instances"]] == ["a"]
    first = await client.get("/api/admin/instances?limit=3", headers={"Cookie": ADMIN})
    assert len(first.json()["instances"]) == 3 and first.json()["nextCursor"] == "3"
    rest = await client.get("/api/admin/instances?limit=3&cursor=3", headers={"Cookie": ADMIN})
    assert [i["id"] for i in rest.json()["instances"]] == ["d"] and rest.json()["nextCursor"] is None
    for query in ("status=paused", "cursor=x", "limit=0", "limit=500"):
        bad = await client.get("/api/admin/instances?" + query, headers={"Cookie": ADMIN})
        assert bad.status_code == 400


async def test_other_routes_pass_through_with_host_cookies_csrf_and_set_cookies(env):
    client, _, _ = env
    response = await client.post(
        "/api/marketplace/rfqs?draft=1",
        content=json.dumps({"model": "L4"}),
        headers={"Cookie": "session=s", "X-CSRF-Token": "t", "Content-Type": "application/json"},
    )
    assert response.status_code == 201
    echoed = response.json()
    assert echoed == {
        "method": "POST", "path": "/api/marketplace/rfqs", "query": "draft=1",
        "host": "admin.example.com", "cookie": "session=s", "csrf": "t", "body": '{"model": "L4"}',
    }
    assert response.headers.get_list("set-cookie") == ["a=1; HttpOnly", "b=2; HttpOnly"]
    # Other methods on the instances path are the existing API's business, not this adapter's.
    assert (await client.delete("/api/admin/instances")).json()["method"] == "DELETE"


async def test_unavailable_existing_api_is_reported_without_details(tmp_path):
    def down(request):
        raise httpx.ConnectError("refused")

    upstream = httpx.AsyncClient(transport=httpx.MockTransport(down))
    app = create_opennext_app(None, origin="http://127.0.0.1:4189", store=Store(tmp_path / "b.db"), client=upstream)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://admin.example.com") as client:
        assert (await client.get("/api/admin/instances")).status_code == 503
        failed = await client.get("/api/auth/session")
        assert failed.status_code == 502 and "refused" not in failed.text
    await upstream.aclose()


@pytest.mark.parametrize("value", ["", "ftp://x", "http://127.0.0.1:4189/api", "http://u@h", "http://h?x=1"])
def test_legacy_origin_must_be_a_bare_http_origin(value):
    with pytest.raises(ValueError):
        legacy_origin(value)
    assert legacy_origin("http://127.0.0.1:4189/") == "http://127.0.0.1:4189"
