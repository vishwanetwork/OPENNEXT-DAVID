"""Console contracts, authorization, durable credentials and customer record projections."""

import base64
import json
from types import SimpleNamespace

import httpx
import pytest

from spotbot.config import Settings
from spotbot.models import timestamp
from spotbot.opennext import create_opennext_app
from spotbot.storage.sqlite import Store

HOST = "admin.example.test"
ADMIN = {"Cookie": "on_pricing_admin=ok", "Origin": "https://" + HOST}


@pytest.fixture
async def console(tmp_path):
    users = [
        dict(
            id=f"u{i}",
            email=f"u{i}@example.test",
            name=f"User {i}",
            role="buyer",
            onboardingCompleted=True,
            createdAt=timestamp(),
            identities=[{"secret": "private-oauth"}],
        )
        for i in range(3)
    ]
    (tmp_path / "auth-state.json").write_text(
        json.dumps({"users": users, "sessions": [{"secret": "private-session"}]})
    )
    (tmp_path / "marketplace.json").write_text(
        json.dumps(
            {
                "orders": [
                    dict(
                        id="rfq-order",
                        model="H100",
                        count=8,
                        buyerId="u1",
                        buyerTotal=42,
                        region="us-east-1",
                        status="Awaiting payment",
                        createdAt=timestamp(),
                    )
                ]
            }
        )
    )
    credentials, calls, rentals = {}, [], []
    provider = dict(
        id="lambda",
        name="Lambda",
        adapterStatus="implemented",
        credentialEnv="LAMBDA_API_KEY",
        credentialRequired=True,
        enabled=True,
        status="needs_credentials",
        recordCount=0,
        intervalMinutes=60,
        supportedTerms=["On-demand"],
    )

    def upstream(request):
        path = request.url.path
        calls.append((request.method, path))
        if path == "/api/admin/pricing/session":
            return httpx.Response(
                200,
                json={
                    "access": {
                        "mutable": "on_pricing_admin=ok" in request.headers.get("cookie", "")
                    }
                },
            )
        if path == "/api/admin/pricing/providers":
            return httpx.Response(
                200,
                json={
                    "providers": [dict(provider, credentialConfigured=bool(credentials))],
                    "access": {"mutable": True},
                },
            )
        if path.endswith("/lambda/credential"):
            credentials["lambda"] = json.loads(request.content)["credential"]
            return httpx.Response(200, json={"ok": True})
        if path == "/health":
            return httpx.Response(
                200,
                json={
                    "status": "ok",
                    "worker_running": True,
                    "rental_worker_running": True,
                    "secret": "private-health",
                },
            )
        return httpx.Response(404, json={"error": "not found"})

    upstream_client = httpx.AsyncClient(transport=httpx.MockTransport(upstream))

    async def rental_list():
        return rentals

    async def bot(method, path):
        return await upstream_client.request(method, "http://bot" + path)

    market = SimpleNamespace(rentals=rental_list, bot=bot)
    settings = Settings(
        _env_file=None,
        spotbot_opennext_legacy_data_dir=str(tmp_path),
        spotbot_opennext_console_key=base64.b64encode(bytes(32)).decode(),
    )
    store = Store(tmp_path / "adapter.db")
    app = create_opennext_app(
        settings, origin="http://127.0.0.1:4189", store=store, client=upstream_client, market=market
    )
    backend = app.state.console_backend
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="https://" + HOST
    ) as client:
        yield client, backend, credentials, rentals, calls, app, settings, store, upstream_client
    await upstream_client.aclose()


async def test_users_are_complete_paginated_and_never_expose_auth_secrets(console):
    client, backend, *_ = console
    assert (await client.get("/api/admin/users")).status_code == 401
    first = await client.get("/api/admin/users?limit=2", headers=ADMIN)
    assert first.status_code == 200
    data = first.json()
    assert data["totalUsers"] == 3 and len(data["users"]) == 2 and data["growth"]["7D"] == 3
    second = (
        await client.get("/api/admin/users?limit=2&cursor=" + data["nextCursor"], headers=ADMIN)
    ).json()
    assert len(second["users"]) == 1
    assert len({r["id"] for r in data["users"] + second["users"]}) == 3
    assert "private-session" not in first.text and "identities" not in first.text
    filtered = (await client.get("/api/admin/users?search=u1", headers=ADMIN)).json()
    assert filtered["filteredTotal"] == 1 and filtered["totalUsers"] == 3
    assert (await client.get("/api/admin/users?cursor=invalid", headers=ADMIN)).status_code == 400
    backend.snapshots.directory = None
    assert (await client.get("/api/admin/users", headers=ADMIN)).status_code == 503


async def test_orders_and_allocations_read_the_real_bot_not_the_adapter_database(console):
    client, backend, _, rentals, *_ = console
    rentals.append(
        dict(
            id="real-rental",
            tenant_id="opennext",
            state="ACTIVE",
            generation=2,
            created_at=timestamp(),
            rfq=dict(
                gpu_model="L4", gpu_count=1, regions=["us-west-2"], customer_ref="opennext:u1"
            ),
        )
    )
    backend.db.save(
        dict(
            id="charge",
            kind="opennext_charge",
            tenant_id="opennext:u1",
            rental_id="real-rental",
            cents=500,
            state="charged",
            email="u1@example.test",
        )
    )
    orders = (await client.get("/api/admin/orders", headers=ADMIN)).json()["orders"]
    assert {r["kind"] for r in orders} == {"Instance", "RFQ"}
    spot = next(r for r in orders if r["kind"] == "Instance")
    assert spot["total"] == 5 and spot["email"] == "u1@example.test"
    allocations = (await client.get("/api/admin/instances", headers=ADMIN)).json()
    assert allocations["instances"][0]["id"] == "real-rental"
    overview = (await client.get("/api/admin/overview", headers=ADMIN)).json()
    assert overview["metrics"]["liveInstances"] == 1
    billing = (await client.get("/api/admin/agent/billing", headers=ADMIN)).json()
    assert billing["heldCents"] == 500 and billing["providerInvoiceCents"] is None


async def test_credentials_are_encrypted_restored_and_same_origin(console):
    client, backend, credentials, _, calls, _, settings, store, upstream = console
    path = "/api/admin/pricing/providers/lambda/credential"
    assert (await client.post(path, json={"credential": "cloud-secret"})).status_code == 401
    wrong = await client.post(
        path, headers={**ADMIN, "Origin": "https://evil.test"}, json={"credential": "cloud-secret"}
    )
    assert wrong.status_code == 403 and not credentials
    saved = await client.post(path, headers=ADMIN, json={"credential": "cloud-secret"})
    assert saved.status_code == 200 and saved.json()["storage"] == "encrypted_database"
    docs = backend.db.list("console_credential")
    assert "cloud-secret" not in json.dumps(docs)
    assert (
        "cloud-secret"
        not in (await client.get("/api/admin/operations/activity", headers=ADMIN)).text
    )
    credentials.clear()
    restarted = create_opennext_app(
        settings,
        origin="http://127.0.0.1:4189",
        store=store,
        client=upstream,
        market=backend.market,
    )
    await restarted.state.console_backend.bridge.restore()
    assert credentials == {"lambda": "cloud-secret"}
    response = await client.get("/api/admin/pricing/providers", headers=ADMIN)
    assert "cloud-secret" not in response.text
    assert response.json()["providers"][0]["credentialConfigured"] is True
    backend.bridge.sealer.aead = None
    assert (
        await client.post(path, headers=ADMIN, json={"credential": "another-secret"})
    ).status_code == 503
    assert credentials["lambda"] == "cloud-secret"


async def test_maintenance_is_durable_idempotent_and_reports_real_health(console):
    client, backend, *_ = console
    status = await client.get("/api/admin/agent", headers=ADMIN)
    assert status.status_code == 200 and "private-health" not in status.text
    calls = []

    async def tick():
        calls.append("tick")

    backend.ctx.notifier = SimpleNamespace(tick=tick)
    body = {"action": "reconcile", "idempotencyKey": "test-once"}
    one = await client.post("/api/admin/agent/actions", headers=ADMIN, json=body)
    assert one.status_code == 200 and one.json()["state"] == "queued"
    assert (
        await client.post("/api/admin/agent/actions", headers=ADMIN, json=body)
    ).json() == one.json()
    await backend.tick()
    await backend.tick()
    assert calls == ["tick"]
    jobs = (await client.get("/api/admin/agent", headers=ADMIN)).json()["jobs"]
    assert jobs[0]["state"] == "completed"
    invalid = await client.post(
        "/api/admin/agent/actions", headers=ADMIN, json={**body, "action": "replace_code"}
    )
    assert invalid.status_code == 400


async def test_overview_keeps_authoritative_counts_when_a_dependency_is_down(console):
    client, backend, *_ = console
    backend.db.save(
        dict(
            id="payment",
            kind="opennext_transfer",
            tenant_id="opennext:u1",
            account="u1",
            purpose="order",
            status="Awaiting payment confirmation",
            created_at=timestamp(),
        )
    )
    backend.db.save(
        dict(
            id="kyb",
            kind="opennext_kyb_case",
            tenant_id="opennext:u1",
            status="Reviewing",
            submitted_at=timestamp(),
        )
    )

    async def unavailable():
        raise httpx.ConnectError("down")

    backend.market.rentals = unavailable
    response = await client.get("/api/admin/overview", headers=ADMIN)
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json()["metrics"]["pendingPayments"] == 1
    assert response.json()["metrics"]["pendingKyb"] == 1
    assert response.json()["metrics"]["liveInstances"] is None
    assert response.json()["metrics"]["pendingContacts"] is None


async def test_additional_source_routes_keep_admin_guard_and_public_price_semantics(
    console, monkeypatch
):
    client, backend, *_ = console
    assert (await client.post("/api/admin/pricing/providers/verda/run", json={})).status_code == 401
    assert (
        await client.post(
            "/api/admin/pricing/providers/verda/run",
            json={},
            headers=dict(ADMIN, Origin="https://other.example.test"),
        )
    ).status_code == 403
    assert (
        await client.post(
            "/api/admin/pricing/providers/digitalocean/credential",
            json={"credential": "private-price-token"},
            headers=ADMIN,
        )
    ).json()["storage"] == "encrypted_database"
    registry = (await client.get("/api/admin/pricing/providers", headers=ADMIN)).json()
    assert "private-price-token" not in str(registry)
    source = next(p for p in registry["providers"] if p["id"] == "digitalocean")
    assert source["credentialConfigured"] and source["validationStatus"] == "not_live_verified"
    from spotbot.price_sources.collectors import quote

    async def collect(*_):
        return [
            quote("verda", "sku", "H100", 8, 16, "zone-a", "Spot"),
            quote("verda", "other", "A100", 1, 1, "zone-b", "On-demand"),
        ]

    monkeypatch.setattr("spotbot.price_sources.service.collect", collect)
    job = (
        await client.post("/api/admin/pricing/providers/verda/run", json={}, headers=ADMIN)
    ).json()
    assert job["phase"] == "queued"
    assert (
        await client.post("/api/admin/pricing/providers/verda/run", json={}, headers=ADMIN)
    ).json()["id"] == job["id"]
    await backend.sources._process("verda")
    response = await client.get(
        "/api/pricing/prices?provider=verda&gpuModel=H100&gpuCount=8&region=zone-a&term=Spot"
    )
    assert response.status_code == 200
    assert len(response.json()["records"]) == 1
    assert response.json()["records"][0]["perGpuHourly"] == 2
    assert response.json()["records"][0]["orderable"] is False
    assert (await client.get("/api/admin/pricing/runs/" + job["id"])).status_code == 401
    assert (await client.get("/api/admin/pricing/runs/" + job["id"], headers=ADMIN)).json()[
        "status"
    ] == "completed"
    registry = (await client.get("/api/admin/pricing/providers", headers=ADMIN)).json()
    assert (
        next(p for p in registry["providers"] if p["id"] == "verda")["validationStatus"]
        == "live_verified"
    )
    assert (
        await client.get("/api/pricing/prices?provider=verda&gpuCount=invalid")
    ).status_code == 400


async def test_order_history_defaults_to_all_states_and_credit_history_is_read_only(console):
    client, backend, _, rentals, *_ = console
    now = timestamp()
    rentals.extend(
        [
            dict(
                id="ended-rental",
                state="CLOSED",
                created_at=now,
                rfq=dict(upstream_order_id="credit-order", gpu_model="T4", gpu_count=1),
            ),
            dict(
                id="direct-rental",
                state="CLOSED",
                created_at=now,
                rfq=dict(upstream_order_id="bank-order", gpu_model="H100", gpu_count=1),
            ),
        ]
    )
    for identity, ref, rental, state, cents in [
        ("credit-charge", "credit-order", "ended-rental", "billed", 100),
        ("bank-charge", "bank-order", "direct-rental", "refunded", 200),
        ("orphan-charge", "orphan-order", None, "refunded", 300),
    ]:
        backend.db.save(
            dict(
                id=identity,
                kind="opennext_charge",
                tenant_id="opennext:u1",
                reference=ref,
                rental_id=rental,
                state=state,
                cents=cents,
                hourly_cents=100,
                billed_cents=27 if state == "billed" else None,
                released_cents=73 if state == "billed" else 0,
                email="u1@example.test",
                created_at=now,
            )
        )
    from spotbot.opennext_ops import TRANSFER

    backend.db.save(
        dict(
            id="bank-transfer",
            kind=TRANSFER,
            tenant_id="opennext:u1",
            purpose="order",
            order_reference="bank-order",
            amount_cents=200,
            status="Confirmed",
            created_at=now,
            email="u1@example.test",
        )
    )
    rentals.append(
        dict(
            id="unlinked-rental",
            state="CLOSED",
            created_at=now,
            rfq=dict(gpu_model="T4", gpu_count=1),
        )
    )
    before = backend.db.list("opennext_charge")
    response = await client.get("/api/admin/orders", headers=ADMIN)
    orders = response.json()["orders"]
    assert {"credit-order", "bank-order", "orphan-order"} <= {r["id"] for r in orders}
    credit = next(r for r in orders if r["id"] == "credit-order")
    assert (
        credit["state"] == "completed" and credit["total"] == 1 and credit["settledTotal"] == 0.27
    )
    assert credit["paymentMethod"] == "Credit"
    assert next(r for r in orders if r["id"] == "unlinked-rental")["amountKnown"] is False
    assert next(r for r in orders if r["id"] == "bank-order")["paymentMethod"] == "Direct Pay"
    assert (await client.get("/api/admin/orders?state=processing", headers=ADMIN)).json()["orders"][
        0
    ]["kind"] == "RFQ"
    assert (await client.get("/api/admin/payments/credit")).status_code == 401
    payments = (await client.get("/api/admin/payments/credit", headers=ADMIN)).json()["payments"]
    assert {r["orderId"] for r in payments} == {"credit-order", "orphan-order"}
    settled = next(r for r in payments if r["orderId"] == "credit-order")
    assert (
        settled["authorizedCents"] == 100
        and settled["settledCents"] == 27
        and settled["releasedCents"] == 73
    )
    assert (
        await client.get("/api/admin/payments/credit?paymentState=refunded", headers=ADMIN)
    ).json()["total"] == 1
    assert (
        await client.get("/api/admin/payments/credit?search=orphan-order", headers=ADMIN)
    ).json()["total"] == 1
    assert (await client.get("/api/admin/payments/credit?limit=1", headers=ADMIN)).json()[
        "nextCursor"
    ] == "1"
    assert (
        await client.post("/api/admin/payments/credit", headers=ADMIN, json={})
    ).status_code in {404, 405}
    assert backend.db.list("opennext_charge") == before
