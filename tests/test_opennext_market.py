"""OpenNEXT Spot market: bot offers, Spot purchases as rentals, and customer instances."""

import base64
import json
import struct
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import httpx
import pytest

from spotbot.opennext import create_opennext_app
from spotbot.opennext_files import Vault
from spotbot.opennext_market import (
    Offer,
    SpotMarket,
    checkout_totals,
    js_int,
    js_round,
    nominal_gb,
)
from spotbot.storage.sqlite import Store

HOST = "terminal.example.com"
KEY = (
    "ssh-ed25519 "
    + base64.b64encode(
        struct.pack(">I", 11) + b"ssh-ed25519" + struct.pack(">I", 32) + bytes(range(32))
    ).decode()
    + " buyer@laptop"
)
USERS = {
    "session=buyer": {
        "user": {"id": "U1", "role": "buyer", "csrfToken": "csrf-1", "email": "u1@example.com"}
    },
    "session=other": {"user": {"id": "U2", "role": "buyer", "csrfToken": "csrf-2"}},
    "session=seller": {"user": {"id": "U3", "role": "seller", "csrfToken": "csrf-3"}},
    "session=demo": {"user": {"id": "D1", "role": "buyer", "csrfToken": "csrf-d"}, "demo": True},
    "session=fresh": {
        "user": {"id": "U4", "role": "buyer", "csrfToken": "csrf-4", "email": "u4@example.com"}
    },
}


def aws(sku, region, price, *, model="L4", count=1, zone="a", mib=22888, **extra):
    details = {
        "gpu_specifications": [{"Name": model, "Count": count, "MemoryInfo": {"SizeInMiB": mib}}],
        "gpu_count_kind": extra.pop("kind", "physical"),
        "architecture": extra.pop("architecture", "x86_64"),
    }
    return {
        "provider": "aws",
        "market": "spot",
        "sku": sku,
        "region": region,
        "availability_zone": region + zone,
        "gpu_model": model,
        "gpu_count": count,
        "vcpus": 4 * count,
        "memory_gb": str(16 * count),
        "price_hourly": price,
        "observed_at": "2026-10-28T01:00:00+00:00",
        "can_attempt": True,
        "details": details,
        **extra,
    }


CATALOG = [
    aws("g6.xlarge", "us-west-2", "0.4012"),
    aws("g6.xlarge", "us-west-2", "0.3900", zone="b"),  # The cheapest zone sets the price.
    aws("g4dn.12xlarge", "us-east-1", "2.636200", model="T4", count=4, mib=16384),
    aws("g6.xlarge", "ap-northeast-1", "0.30"),  # Not a rental Region.
    aws("g6.2xlarge", "us-west-2", "0.50", can_attempt=False),
    aws("g6f.large", "us-west-2", "0.10", kind="logical"),  # Fractional GPU.
    aws("g5g.xlarge", "us-west-2", "0.13", model="T4G", architecture="arm64"),  # Arm.
]


class Fakes:
    def __init__(self):
        self.rentals, self.created, self.bot_up = [], [], True
        self.tasks = []
        self.create = "ok"  # "ok", "reject" (bot refuses) or "lost" (answer never arrives)
        # Credit in the existing API: approved top-ups and promotional Credit per account.
        self.credit = {"U1": (0.50, 1.00), "U2": (100.0, 0.0)}

    def legacy(self, request):
        path = request.url.path
        if path == "/api/auth/session":
            return httpx.Response(
                200, json=USERS.get(request.headers.get("cookie"), {"user": None})
            )
        if path == "/api/admin/pricing/session":
            signed_in = "on_pricing_admin=ok" in request.headers.get("cookie", "")
            return httpx.Response(200, json={"access": {"mutable": signed_in, "reason": "Sign in"}})
        if path == "/api/billing/account":
            user = USERS.get(request.headers.get("cookie"), {}).get("user")
            if not user:
                return httpx.Response(401, json={"error": "Sign in to continue."})
            promotional, paid = self.credit.get(user["id"], (0.0, 0.0))
            return httpx.Response(
                200,
                json={
                    "confirmed": True,
                    "accountId": user["id"],
                    "currency": "USD",
                    "availableCredit": promotional + paid,
                    "paidCredit": paid,
                    "promotionalCredit": promotional,
                    "requests": [],
                    "notifications": [],
                },
            )
        if path == "/api/marketplace/public":
            return httpx.Response(
                200,
                json={"rfqs": [], "supplies": [{"id": "S1", "kind": "rental", "model": "H100"}]},
                headers=[("ETag", '"v1"'), ("Set-Cookie", "a=1"), ("Cache-Control", "no-store")],
            )
        if path == "/api/marketplace/me":
            return httpx.Response(200, json={"orders": [], "instances": [{"id": "legacy-1"}]})
        return httpx.Response(404, json={"error": "Not found"})

    def bot(self, request):
        if not self.bot_up:
            raise httpx.ConnectError("refused")
        assert request.headers["authorization"] == "Bearer bot-key"
        assert request.headers["x-spotbot-tenant"] == "opennext"
        if request.url.path == "/v1/prices/latest":
            assert request.url.params["can_attempt_only"] == "true"
            groups = [{"provider": "aws", "offers": CATALOG}]
            return httpx.Response(200, json={"total": len(CATALOG), "groups": groups})
        parts = request.url.path.split("/")
        if len(parts) >= 5 and parts[4] == "task":
            row = next(r for r in self.rentals if r["id"] == parts[3])
            if request.method == "PUT":
                if row.get("task", {}).get("state") == "running":
                    return httpx.Response(409, json={"detail": "task_started"})
                body = json.loads(request.content)
                self.tasks.append(body)
                row["task"] = dict(
                    state="waiting", on_success=body["on_success"], on_failure=body["on_failure"]
                )
                row["task_detail"] = dict(body, version=1, secret_names=sorted(body["secrets"]))
            summary = row.get("task")
            task = row.get("task_detail")
            if task:
                task = {k: v for k, v in task.items() if k != "secrets"}
            return httpx.Response(200, json={"task": task, "summary": summary, "log_tail": None})
        if len(parts) == 5 and parts[4] in {"ssh-keys", "release"}:
            row = next(r for r in self.rentals if r["id"] == parts[3])
            if parts[4] == "release":
                row.update(state="ENDING", end_requested=True)
                return httpx.Response(200, json=row)
            keys = row.setdefault("ssh_keys", {"version": 1, "keys": []})
            if request.method == "PUT":
                if row.get("end_requested"):
                    return httpx.Response(409, json={"detail": "rental_ended"})
                keys.update(version=keys["version"] + 1, keys=json.loads(request.content)["keys"])
            return httpx.Response(200, json={**keys, "applied_version": None, "installed": False})
        if request.url.path == "/v1/rentals" and request.method == "GET":
            rows = self.rentals
            for key in ("customer_ref", "upstream_order_id"):
                if key in request.url.params:
                    rows = [r for r in rows if r["rfq"].get(key) == request.url.params[key]]
            offset, limit = (
                int(request.url.params.get("offset", 0)),
                int(request.url.params.get("limit", 100)),
            )
            return httpx.Response(
                200,
                json={
                    "query_version": 1,
                    "total": len(rows),
                    "items": rows[offset : offset + limit],
                },
            )
        if len(parts) == 4 and parts[2] == "rentals" and request.method == "GET":
            row = next((r for r in self.rentals if r["id"] == parts[3]), None)
            return httpx.Response(200, json=row) if row else httpx.Response(404)
        if request.url.path == "/v1/rentals":
            rfq = json.loads(request.content)["rfq"]
            assert request.headers["idempotency-key"] == rfq["rfq_id"]
            if self.create == "reject":
                return httpx.Response(422, json={"detail": "invalid_rfq"})
            self.created.append(rfq)
            row = dict(
                id=str(uuid4()),
                state="QUEUED",
                generation=0,
                rfq=rfq,
                connection=None,
                created_at="2026-10-28T01:01:00+00:00",
            )
            self.rentals.insert(0, row)
            if self.create == "lost":
                raise httpx.ReadTimeout("no answer")
            return httpx.Response(200, json={"created": True, "rental": row})
        return httpx.Response(404)

    def gateway(self, request):
        assert request.headers["authorization"] == "Bearer gw-key"
        rental_id = request.url.path.split("/")[-2]
        ssh = {"host": "gw.example.com", "port": 22105, "user": "ubuntu"}
        return httpx.Response(200, json={"rental_id": rental_id, "ready": True, "ssh": ssh})


def approve_kyb(app, user_id):
    """An approved Buyer KYB case, as an operator decision would leave it."""
    ops = app.state.ops
    ops.db.save(
        dict(
            id=ops.case_id(user_id),
            kind="opennext_kyb_case",
            tenant_id="opennext:" + user_id,
            account=user_id,
            email=user_id.lower() + "@example.com",
            mode="Auto",
            status="Approved",
            revision=2,
            company={},
            documents=[],
            submitted_at="2026-10-28T00:00:00+00:00",
            submission_keys={},
            decisions=[],
            notices=[],
            emails=[],
            version=0,
        ),
        0,
    )


@pytest.fixture
async def env(tmp_path):
    fakes, calls = Fakes(), []

    async def handler(request):
        await request.aread()
        calls.append(request)
        host = request.url.host
        return (
            fakes.bot(request)
            if host == "bot.test"
            else fakes.gateway(request)
            if host == "gw.test"
            else fakes.legacy(request)
        )

    upstream = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    market = SpotMarket(
        upstream,
        bot_url="http://bot.test",
        token="bot-key",
        tenant="opennext",
        regions=["us-west-2", "us-east-1"],
        gateway_url="http://gw.test",
        gateway_token="gw-key",
    )
    app = create_opennext_app(
        None,
        origin="http://127.0.0.1:4189",
        store=Store(tmp_path / "b.db"),
        client=upstream,
        market=market,
        vault=Vault(tmp_path / "kyb", base64.b64encode(bytes(32)).decode(), allow_unscanned=True),
    )
    for user_id in ("U1", "U2"):
        approve_kyb(app, user_id)
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://" + HOST)
    try:
        yield client, fakes, calls
    finally:
        await client.aclose()
        await upstream.aclose()


def body(offer_id="spotbot-us-west-2-g6.xlarge", hours=1.5, cents=39, **overrides):
    return {
        "pricingVersion": "duration-v1",
        "offerId": offer_id,
        "durationHours": hours,
        "expectedPricing": checkout_totals(cents / 100, hours),
        "sshPublicKey": KEY,
        "idempotencyKey": "k-1",
        **overrides,
    }


def buy(client, payload, cookie="session=buyer", csrf="csrf-1", origin="http://" + HOST):
    headers = {"Cookie": cookie, "X-CSRF-Token": csrf, "Origin": origin}
    return client.post("/api/marketplace/spot-purchases", json=payload, headers=headers)


def test_prices_follow_the_web_apps_rounding():
    # Math.round rounds half up; Python's round would give 58 here.
    assert checkout_totals(0.39, 1.5) == {
        "currency": "USD",
        "durationHours": 1.5,
        "hourlyCents": 39,
        "baseCents": 59,
        "feeCents": 0,
        "totalCents": 59,
    }
    assert checkout_totals(2.64, 1.5)["totalCents"] == 396
    # Every whole-cent instance price survives the web app's per-GPU round trip.
    for count in (1, 2, 4, 8):
        for cents in range(1, 50000, 7):
            assert js_int(js_round(cents / 100 / count * count) * 100) == cents
    assert [nominal_gb(m) for m in (16384, 22888, 45776, 98304)] == [16, 24, 48, 96]


def test_offer_rounds_the_spot_quote_up_to_whole_cents():
    offer = Offer(aws("g4dn.12xlarge", "us-east-1", "2.636200", model="T4", count=4, mib=16384))
    assert offer.cents == 264 and offer.instance_hourly == 2.64 and offer.gpu_memory == 16


async def test_public_market_adds_orderable_spot_offers(env):
    client, _, calls = env
    response = await client.get("/api/marketplace/public")
    assert response.status_code == 200
    supplies = response.json()["supplies"]
    assert [s["id"] for s in supplies] == [
        "S1",
        "spotbot-us-east-1-g4dn.12xlarge",
        "spotbot-us-west-2-g6.xlarge",
    ]
    t4, l4 = supplies[1], supplies[2]
    assert l4 == {
        "id": "spotbot-us-west-2-g6.xlarge",
        "kind": "rental",
        "side": "supply",
        "term": "Spot",
        "model": "L4",
        "title": "1 × L4",
        "region": "us-west-2",
        "gpuCount": 1,
        "vcpu": 4,
        "memory": 24,
        "perGpuHourly": 0.39,
        "listedAt": "2026-10-28T01:00:00+00:00",
        "status": "Published",
        "serverRecord": True,
        "agentStatus": "Succeeded",
        "sourceType": "spotbot",
    }
    assert t4["perGpuHourly"] == 0.66 and t4["gpuCount"] == 4 and t4["memory"] == 16
    # The body changed, so the existing API's validator is dropped; its cookies are kept.
    assert "etag" not in response.headers and response.headers["set-cookie"] == "a=1"
    legacy = [c for c in calls if c.url.path == "/api/marketplace/public"][0]
    assert legacy.headers["accept-encoding"] == "identity" and legacy.headers["host"] == HOST


async def test_offers_are_cached(env):
    client, _, calls = env
    await client.get("/api/marketplace/public")
    await client.get("/api/marketplace/public")
    assert len([c for c in calls if c.url.path == "/v1/prices/latest"]) == 1


async def test_buy_now_creates_a_rental_for_the_customers_key(env):
    client, fakes, _ = env
    response = await buy(client, body())
    assert response.status_code == 200, response.text
    rental = fakes.rentals[0]
    assert response.json() == {
        "confirmed": True,
        "offerId": "spotbot-us-west-2-g6.xlarge",
        "orderId": rental["id"],
        "currency": "USD",
        "durationHours": 1.5,
        "totalCents": 59,
    }
    rfq = fakes.created[0]
    assert rfq["regions"] == ["us-west-2"] and rfq["instance_types"] == ["g6.xlarge"]
    assert (rfq["gpu_model"], rfq["gpu_count"], rfq["min_gpu_memory_gib"]) == ("L4", 1, 24)
    assert rfq["max_price_hourly"] == "0.468"  # Listed $0.39 plus 20%.
    assert rfq["ssh_public_key"] == KEY and rfq["customer_ref"] == "opennext:U1"
    assert rfq["rfq_id"] == rfq["upstream_order_id"] and rfq["rfq_id"].startswith("opennext-")
    window = datetime.fromisoformat(rfq["expires_at"]) - datetime.fromisoformat(
        rfq["acquisition_deadline"]
    )
    assert window.total_seconds() == 5400
    assert rfq["service_seconds"] == 5400  # The paid 1.5 hours start at delivery.
    assert Decimal(rfq["budget_usd"]) > Decimal("0.468") * Decimal("1.5")
    # A retry with the same purchase reference returns the same order without a new rental.
    again = await buy(client, body())
    assert again.json() == response.json() and len(fakes.created) == 1
    reused = await buy(client, body(hours=2, expectedPricing=checkout_totals(0.39, 2)))
    assert reused.status_code == 409 and reused.json()["code"] == "IDEMPOTENCY_CONFLICT"


@pytest.mark.parametrize(
    ("kwargs", "payload", "status", "message"),
    [
        ({"cookie": ""}, body(), 401, "Sign in to a Buyer account"),
        ({"cookie": "session=demo", "csrf": "csrf-d"}, body(), 401, "Sign in"),
        ({"cookie": "session=seller", "csrf": "csrf-3"}, body(), 403, "Buyer account is required"),
        ({"csrf": "wrong"}, body(), 403, "verification failed"),
        ({"origin": "https://evil.example"}, body(), 403, "verification failed"),
        ({}, body(cents=38), 409, "price changed"),
        ({}, body(offer_id="spotbot-us-west-2-g6.2xlarge"), 409, "no longer available"),
        ({}, body(sshPublicKey="ssh-ed25519 AAAA"), 400, "OpenSSH public key"),
        ({}, body(hours=1.005), 400, "from 1 to 720 hours"),
        ({}, body(hours=721), 400, "from 1 to 720 hours"),
        ({}, body(hours=0.5), 400, "from 1 to 720 hours"),  # Below the one-hour minimum.
    ],
)
async def test_purchases_are_refused_without_creating_rentals(
    env, kwargs, payload, status, message
):
    client, fakes, _ = env
    response = await buy(client, payload, **kwargs)
    assert response.status_code == status and message in response.json()["error"]
    assert fakes.created == []


async def test_workspace_adds_the_customers_own_rentals(env):
    client, fakes, _ = env
    assert (await buy(client, body())).status_code == 200
    other = {**body(), "idempotencyKey": "k-2"}
    other_buy = await buy(client, other, cookie="session=other", csrf="csrf-2")
    assert other_buy.status_code == 200
    fakes.rentals[1].update(
        state="ACTIVE",
        generation=1,
        connection={"region": "us-west-2"},
        service_intervals=[
            dict(
                start="2026-10-28T01:06:00+00:00",
                end="2026-10-28T01:20:00+00:00",
                end_reason="interrupted",
            ),
            dict(start="2026-10-28T01:31:00+00:00", end=None),
        ],
    )
    response = await client.get("/api/marketplace/me", headers={"Cookie": "session=buyer"})
    instances = response.json()["instances"]
    assert [i["id"] for i in instances] == ["legacy-1", fakes.rentals[1]["id"]]
    mine = instances[1]
    billing = mine["billing"]
    assert mine == {
        "id": fakes.rentals[1]["id"],
        "name": "1 × L4",
        "model": "L4",
        "region": "us-west-2",
        "term": "Spot",
        "count": 1,
        "rate": 0.39,
        "status": "active",
        "connectionStatus": "connected",
        "orderId": fakes.rentals[1]["id"],
        "durationHours": 1.5,
        "serviceStart": "2026-10-28T01:06:00+00:00",
        "serviceEnd": fakes.rentals[1]["rfq"]["expires_at"],
        "endedAt": None,
        "createdAt": "2026-10-28T01:01:00+00:00",
        "sshHost": "gw.example.com",
        "sshUser": "ubuntu",
        "sshPort": 22105,
        "resaleAllowed": False,
        "usage": [
            {"start": "2026-10-28T01:06:00+00:00", "end": "2026-10-28T01:20:00+00:00"},
            {"start": "2026-10-28T01:31:00+00:00", "end": None},
        ],
        # The Spot replacement is history; nothing the customer did is.
        "history": [
            {
                "interruptedAt": "2026-10-28T01:20:00+00:00",
                "reconnectedAt": "2026-10-28T01:31:00+00:00",
            }
        ],
        "billing": {
            "mode": "usage",
            "state": "charged",
            "final": False,
            "heldCents": 59,
            "hourlyCents": 39,
            "feePercent": 0,
            "minimumMinutes": 60,
            "usedSeconds": billing["usedSeconds"],
            "chargedCents": 59,  # Usage so far, never above the hold.
            "releasedCents": None,
            "startedAt": "2026-10-28T01:06:00+00:00",
        },
        "autopilot": None,
        "endedBy": None,
    }
    assert billing["usedSeconds"] > 14 * 60
    theirs = await client.get("/api/marketplace/me", headers={"Cookie": "session=other"})
    pending = theirs.json()["instances"][1]
    assert pending["status"] == "pending" and pending["sshHost"] is None
    # Retried launches raise the generation; only a replacement after delivery reconnects.
    fakes.rentals[0].update(state="PROVISIONING", generation=3)
    retried = await client.get("/api/marketplace/me", headers={"Cookie": "session=other"})
    assert retried.json()["instances"][1]["status"] == "pending"
    fakes.rentals[0]["recovery_started_at"] = "2026-10-28T02:00:00+00:00"
    replacing = await client.get("/api/marketplace/me", headers={"Cookie": "session=other"})
    assert replacing.json()["instances"][1]["status"] == "recovering"
    signed_out = await client.get("/api/marketplace/me")
    assert signed_out.json()["instances"] == [{"id": "legacy-1"}]


async def test_existing_api_answers_unchanged_while_the_bot_is_down(env):
    client, fakes, _ = env
    fakes.bot_up = False
    public = await client.get("/api/marketplace/public")
    assert [s["id"] for s in public.json()["supplies"]] == ["S1"]
    assert public.headers["etag"] == '"v1"'
    me = await client.get("/api/marketplace/me", headers={"Cookie": "session=buyer"})
    assert me.json()["instances"] == [{"id": "legacy-1"}]
    response = await buy(client, body())
    assert response.status_code == 503 and "No order was created" in response.json()["error"]


async def test_purchases_are_unavailable_without_a_bot_api(tmp_path):
    upstream = httpx.AsyncClient(transport=httpx.MockTransport(Fakes().legacy))
    app = create_opennext_app(
        None, origin="http://127.0.0.1:4189", store=Store(tmp_path / "b.db"), client=upstream
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://" + HOST
    ) as client:
        assert (await buy(client, body())).status_code == 503
        public = await client.get("/api/marketplace/public")
        assert [s["id"] for s in public.json()["supplies"]] == ["S1"]
    await upstream.aclose()


def balance(client, cookie="session=buyer"):
    return client.get("/api/billing/account", headers={"Cookie": cookie})


async def test_purchases_are_paid_from_credit_promotional_first(env):
    client, fakes, _ = env
    before = (await balance(client)).json()
    assert before["availableCredit"] == 1.5 and before["spotCharges"] == []
    assert (await buy(client, body())).status_code == 200  # $0.59 total.
    after = (await balance(client)).json()
    assert (after["promotionalCredit"], after["paidCredit"], after["availableCredit"]) == (
        0,
        0.91,
        0.91,
    )
    assert (
        after["spotCharges"][0]["totalCents"] == 59
        and after["spotCharges"][0]["state"] == "charged"
    )
    assert after["spotCharges"][0]["orderId"] == fakes.rentals[0]["id"]
    # A retried purchase returns the same order and charges nothing more.
    assert (await buy(client, body())).status_code == 200
    assert (await balance(client)).json()["availableCredit"] == 0.91
    # Three hours ($1.17) cost more than is left.
    refused = await buy(
        client, {**body(hours=3, expectedPricing=checkout_totals(0.39, 3)), "idempotencyKey": "k-2"}
    )
    assert refused.status_code == 409 and refused.json()["code"] == "INSUFFICIENT_CREDIT"
    assert len(fakes.created) == 1 and (await balance(client)).json()["availableCredit"] == 0.91


async def test_refused_or_undelivered_orders_are_refunded(env, monkeypatch):
    client, fakes, _ = env
    fakes.create = "reject"
    rejected = await buy(client, body())
    assert rejected.status_code == 502 and "No Credit was charged" in rejected.json()["error"]
    assert (await balance(client)).json()["availableCredit"] == 1.5
    fakes.create = "ok"
    assert (await buy(client, {**body(), "idempotencyKey": "k-2"})).status_code == 200
    fakes.rentals[0].update(state="CLOSED")  # Never handed to the customer.
    assert (await balance(client)).json()["availableCredit"] == 1.5
    assert (await buy(client, {**body(), "idempotencyKey": "k-3"})).status_code == 200
    # Handed to the gateway but never usable: still refunded.
    fakes.rentals[0].update(state="CLOSED", delivering_at="2026-10-28T01:05:00+00:00")
    assert (await balance(client)).json()["availableCredit"] == 1.5


async def test_delivered_orders_are_billed_by_usage_with_a_one_hour_minimum(env):
    client, fakes, _ = env
    start = datetime.fromisoformat("2026-10-28T01:06:00+00:00")

    async def order(key, minutes):
        assert (await buy(client, {**body(), "idempotencyKey": key})).status_code == 200
        held = (await balance(client)).json()
        end = start + timedelta(minutes=minutes)
        fakes.rentals[0].update(  # The newest order.
            state="CLOSED",
            delivering_at="2026-10-28T01:05:00+00:00",
            service_intervals=[dict(start=start.isoformat(), end=end.isoformat())],
        )
        return held, (await balance(client)).json()

    # 1.5 h at $0.39 holds 59 cents; 10 minutes of use bills the 1-hour minimum: 39 cents, with no fee.
    held, account = await order("k-1", 10)
    assert held["availableCredit"] == 0.91 and held["spotCharges"][0]["state"] == "charged"
    assert account["availableCredit"] == 1.11
    assert account["spotCharges"][0] == {
        "orderId": fakes.rentals[0]["id"],
        "totalCents": 39,
        "heldCents": 59,
        "billing": "usage",
        "state": "billed",
        "createdAt": account["spotCharges"][0]["createdAt"],
    }
    # Usage beyond the hold is never billed: the hold is the order's maximum.
    _, account = await order("k-2", 180)
    assert account["availableCredit"] == 0.52
    assert [(c["state"], c["totalCents"]) for c in account["spotCharges"]] == [
        ("billed", 59),
        ("billed", 39),
    ]


def test_usage_is_billed_per_started_minute_after_the_first_hour():
    from spotbot.opennext_ledger import usage_cents

    assert usage_cents(39, 0) == usage_cents(39, 3600) == 39
    assert usage_cents(39, 75 * 60) == 49  # ceil(39 * 75 / 60)
    assert usage_cents(39, 3601) == 40  # A started minute counts: ceil(39 * 61 / 60)


async def test_an_unanswered_order_stays_held_until_its_rental_shows_up(env, monkeypatch):
    client, fakes, _ = env
    fakes.create = "lost"
    uncertain = await buy(client, body())
    assert uncertain.status_code == 503
    held = (await balance(client)).json()
    assert held["availableCredit"] == 0.91 and held["spotCharges"][0]["state"] == "charged"
    # Lost before the bot stored it: refunded once the grace period has passed.
    fakes.rentals.clear()
    fakes.create = "lost"
    from spotbot import opennext_ledger

    later = opennext_ledger.utcnow() + opennext_ledger.HELD_GRACE * 2
    await buy(client, {**body(), "idempotencyKey": "k-2"})
    fakes.rentals.clear()
    monkeypatch.setattr(opennext_ledger, "utcnow", lambda: later)
    assert (await balance(client)).json()["availableCredit"] == 0.91


async def test_buy_now_without_a_key(env):
    client, fakes, _ = env
    assert (await buy(client, body(sshPublicKey=None))).status_code == 200
    assert fakes.created[0]["ssh_public_key"] is None


KEY_B = (
    "ssh-ed25519 "
    + base64.b64encode(
        struct.pack(">I", 11) + b"ssh-ed25519" + struct.pack(">I", 32) + bytes(range(1, 33))
    ).decode()
    + " second@laptop"
)


def write(client, method, path, payload=None, cookie="session=buyer", csrf="csrf-1"):
    headers = {"Cookie": cookie, "X-CSRF-Token": csrf, "Origin": "http://" + HOST}
    return client.request(method, path, json=payload, headers=headers)


async def test_account_key_library(env):
    client, _, _ = env
    path = "/api/account/ssh-keys"
    assert (await client.get(path)).status_code == 401
    added = await write(client, "POST", path, {"label": "Laptop", "publicKey": KEY})
    assert added.status_code == 200 and added.json()["key"]["fingerprint"].startswith("SHA256:")
    again = await write(client, "POST", path, {"label": "Again", "publicKey": " " + KEY})
    assert again.json()["key"]["id"] == added.json()["key"]["id"]  # Saved once.
    bad = await write(client, "POST", path, {"label": "Bad", "publicKey": "ssh-ed25519 AAAA"})
    assert bad.status_code == 400 and "OpenSSH" in bad.json()["error"]
    assert (
        await write(client, "POST", path, {"label": "x", "publicKey": KEY}, csrf="no")
    ).status_code == 403
    listed = await client.get(path, headers={"Cookie": "session=buyer"})
    assert [k["label"] for k in listed.json()["keys"]] == ["Laptop"]
    other = await client.get(path, headers={"Cookie": "session=other"})
    assert other.json()["keys"] == []
    key_id = added.json()["key"]["id"]
    assert (
        await write(client, "DELETE", path + "/" + key_id, cookie="session=other", csrf="csrf-2")
    ).status_code == 404
    assert (await write(client, "DELETE", path + "/" + key_id)).json() == {
        "confirmed": True,
        "id": key_id,
    }
    assert (await client.get(path, headers={"Cookie": "session=buyer"})).json()["keys"] == []


async def test_instance_keys_and_end_for_the_owner_only(env):
    client, fakes, calls = env
    order = (await buy(client, body(sshPublicKey=None))).json()["orderId"]
    path = f"/api/marketplace/instances/{order}/ssh-keys"
    calls.clear()
    keys = await client.get(path, headers={"Cookie": "session=buyer"})
    assert keys.json() == {"keys": [], "version": 1, "installed": False}
    assert not any(r.url.path == "/v1/rentals" for r in calls)
    assert any(r.url.path == f"/v1/rentals/{order}" for r in calls)
    put = await write(client, "PUT", path, {"keys": [KEY, KEY_B, KEY]})
    assert put.status_code == 200 and put.json()["version"] == 2
    assert [k["comment"] for k in put.json()["keys"]] == ["buyer@laptop", "second@laptop"]
    assert (await write(client, "PUT", path, {"keys": ["nope"]})).status_code == 400
    # Another customer cannot see or change it, nor end it.
    assert (await client.get(path, headers={"Cookie": "session=other"})).status_code == 404
    end = f"/api/marketplace/instances/{order}/end"
    assert (
        await write(
            client, "POST", end, {"confirmation": "END"}, cookie="session=other", csrf="csrf-2"
        )
    ).status_code == 404
    assert (await write(client, "POST", end, {"confirmation": "end"})).status_code == 400
    ended = await write(client, "POST", end, {"confirmation": "END"})
    assert ended.status_code == 200 and ended.json()["confirmed"] is True
    assert ended.json()["instance"]["id"] == order and ended.json()["instance"]["status"] == "ended"
    late = await write(client, "POST", path, {"keys": [KEY]})  # POST is accepted as PUT.
    assert late.status_code == 409


async def test_autopilot_for_the_owner_only(env):
    client, fakes, _ = env
    order = (await buy(client, body())).json()["orderId"]
    path = f"/api/marketplace/instances/{order}/autopilot"
    task = {
        "script": "python train.py",
        "env": {"EPOCHS": "3"},
        "secrets": {"HF_TOKEN": "hf_value"},
        "onFailure": "keep",
        "maxMinutes": 90,
    }
    assert (await client.get(path, headers={"Cookie": "session=other"})).status_code == 404
    assert (
        await write(client, "PUT", path, task, cookie="session=other", csrf="csrf-2")
    ).status_code == 404
    assert (await write(client, "PUT", path, dict(task, onFailure=None))).status_code == 400
    assert (await write(client, "PUT", path, dict(task, env={"1X": "y"}))).status_code == 400
    saved = await write(client, "PUT", path, task)
    assert saved.status_code == 200 and "hf_value" not in saved.text
    assert saved.json()["task"]["secretNames"] == ["HF_TOKEN"]
    assert fakes.tasks[-1] == {
        "script": "python train.py",
        "env": {"EPOCHS": "3"},
        "secrets": {"HF_TOKEN": "hf_value"},
        "on_success": "end",
        "on_failure": "keep",
        "on_replacement": "rerun",
        "max_minutes": 90,
    }
    me = await client.get("/api/marketplace/me", headers={"Cookie": "session=buyer"})
    mine = next(i for i in me.json()["instances"] if i["id"] == order)
    assert mine["autopilot"]["state"] == "waiting" and mine["autopilot"]["onFailure"] == "keep"
    fakes.rentals[0]["task"]["state"] = "running"
    late = await write(client, "PUT", path, task)
    assert late.status_code == 409 and late.json()["code"] == "TASK_STARTED"


async def test_notifier_reports_the_task_outcome(env):
    from spotbot.opennext_notify import due

    client, fakes, _ = env
    assert (await buy(client, body())).status_code == 200
    rental = dict(fakes.rentals[0], state="ACTIVE", service_intervals=[{"start": "x", "end": None}])
    rental["task"] = {
        "state": "failed",
        "outcome": {
            "version": 1,
            "attempt": 1,
            "state": "failed",
            "exit_code": 2,
            "action": "keep",
            "log_tail": "Traceback\nCUDA out of memory\n",
        },
    }
    charge = {"state": "charged"}
    now = datetime.fromisoformat("2026-10-28T01:20:00+00:00")
    notices = {key: (subject, lines) for key, subject, lines in due(rental, charge, now)}
    subject, lines = notices["task-1-1"]
    assert subject == "Your task on 1 × L4 failed"
    assert "Exit code: 2." in lines and lines[-1].endswith("CUDA out of memory")
    assert any("keeps running" in line for line in lines)


class Outbox:
    def __init__(self):
        self.messages, self.fail = [], False

    def send(self, to, subject, text):
        if self.fail:
            raise OSError("smtp down")
        self.messages.append((to, subject, text))


async def test_notifier_bills_and_emails_orders_while_the_customer_is_away(env, monkeypatch):
    from spotbot import opennext_notify

    client, fakes, _ = env
    notifier = client._transport.app.state.notifier
    outbox = notifier.mailer = Outbox()
    notifier.public_url = "https://opennext.example"
    assert (await buy(client, body())).status_code == 200
    rental = fakes.rentals[0]
    now = datetime.fromisoformat("2026-10-28T01:20:00+00:00")
    start = "2026-10-28T01:10:00+00:00"
    rental.update(
        state="ACTIVE",
        end_requested=False,
        delivering_at=start,
        service_intervals=[dict(start=start, end=None)],
        ssh_keys={"version": 1, "keys": [KEY]},
    )
    rental["rfq"]["expires_at"] = "2026-10-28T02:40:00+00:00"
    await notifier.tick(now)
    await notifier.tick(now)  # Sent once.
    [(to, subject, text)] = outbox.messages
    assert to == "u1@example.com" and subject == "Your 1 × L4 Spot server is running"
    assert "ssh -p 22105 ubuntu@gw.example.com" in text
    assert "Paid time ends 2026-10-28 02:40 UTC" in text
    assert "https://opennext.example/terminal" in text

    # An interruption pauses the service; the replacement is announced too.
    rental.update(state="RECOVERING")
    rental["service_intervals"][0]["end"] = "2026-10-28T01:30:00+00:00"
    await notifier.tick(now + timedelta(minutes=11))
    rental.update(state="ACTIVE")
    rental["service_intervals"].append(dict(start="2026-10-28T01:40:00+00:00", end=None))
    await notifier.tick(now + timedelta(minutes=21))
    # A failed send is retried on the next pass.
    outbox.fail = True
    await notifier.tick(now + timedelta(minutes=65))
    outbox.fail = False
    await notifier.tick(now + timedelta(minutes=66))
    assert [m[1] for m in outbox.messages[1:]] == [
        "Your 1 × L4 Spot server is being replaced",
        "Your 1 × L4 Spot server is running again",
        "Your 1 × L4 Spot server ends soon",
    ]

    # Closing bills the usage without the customer visiting: 20 + 30 minutes, 1-hour minimum.
    rental.update(state="CLOSED", end_requested=True, closed_at="2026-10-28T02:10:00+00:00")
    rental["service_intervals"][1]["end"] = "2026-10-28T02:10:00+00:00"
    await notifier.tick(now + timedelta(minutes=70))
    to, subject, text = outbox.messages[-1]
    assert subject == "Your 1 × L4 Spot server has ended"
    assert "Time used: 50 minutes. Billed for 60 minutes" in text
    assert "Billed $0.39 of the $0.59 held; $0.20 returned to your Credit." in text
    assert (await balance(client)).json()["availableCredit"] == 1.11
    # Long-closed orders are skipped entirely.
    monkeypatch.setattr(opennext_notify, "due", lambda *a, **k: 1 / 0)
    await notifier.tick(now + timedelta(days=3))


async def test_notifier_announces_refunds_and_skips_orders_without_an_email(env):
    client, fakes, _ = env
    notifier = client._transport.app.state.notifier
    outbox = notifier.mailer = Outbox()
    assert (await buy(client, body())).status_code == 200
    other = {**body(), "idempotencyKey": "k-2"}
    assert (await buy(client, other, cookie="session=other", csrf="csrf-2")).status_code == 200
    for rental in fakes.rentals:
        rental.update(state="CLOSED", closed_at="2026-10-28T02:01:00+00:00")
    await notifier.tick(datetime.fromisoformat("2026-10-28T02:02:00+00:00"))
    [(to, subject, text)] = outbox.messages  # U2's session has no email.
    assert to == "u1@example.com" and subject == "Your 1 × L4 Spot order was not filled"
    assert "The full $0.59 was returned to your Credit." in text


def test_history_lists_only_interruptions_the_customer_did_not_ask_for():
    from spotbot.opennext_market import interruptions

    def row(state, *periods, end_requested=False):
        return dict(state=state, end_requested=end_requested, service_intervals=list(periods))

    a = dict(start="T1", end="T2", end_reason="interrupted")
    b = dict(start="T3", end="T4", end_reason="ended")
    assert interruptions(row("CLOSED", a, b, end_requested=True)) == [
        {"interruptedAt": "T2", "reconnectedAt": "T3"}
    ]
    # Still being replaced.
    assert interruptions(row("RECOVERING", a)) == [{"interruptedAt": "T2", "reconnectedAt": None}]
    # Ended while being replaced: the interruption stays in the history.
    assert interruptions(row("CLOSED", a, end_requested=True)) == [
        {"interruptedAt": "T2", "reconnectedAt": None}
    ]
    # Periods recorded before end reasons: the last one of an ended order is its end.
    old = dict(start="T1", end="T2")
    assert interruptions(row("CLOSED", old, end_requested=True)) == []
    assert interruptions(row("RECOVERING", old)) == [{"interruptedAt": "T2", "reconnectedAt": None}]


def test_orders_delivered_before_service_periods_show_one_period_from_the_handoff():
    from spotbot.opennext_market import instance_view

    row = dict(
        id="R1",
        state="CLOSED",
        created_at="2026-10-28T01:00:00+00:00",
        delivering_at="2026-10-28T01:05:00+00:00",
        closed_at="2026-10-28T02:00:00+00:00",
        service_intervals=[],
        rfq=dict(
            gpu_count=1,
            gpu_model="T4",
            regions=["us-west-2"],
            max_price_hourly="0.336",
            acquisition_deadline="2026-10-28T02:00:00+00:00",
            expires_at="2026-10-28T03:00:00+00:00",
        ),
    )
    view = instance_view(row)
    assert view["usage"] == [
        {"start": "2026-10-28T01:05:00+00:00", "end": "2026-10-28T02:00:00+00:00"}
    ]
    assert view["serviceStart"] == "2026-10-28T01:05:00+00:00" and view["history"] == []
