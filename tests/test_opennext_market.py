"""OpenNEXT Spot market: bot offers, Spot purchases as rentals, and customer instances."""

import base64
import json
import struct
from datetime import datetime
from decimal import Decimal
from uuid import uuid4

import httpx
import pytest

from spotbot.opennext import create_opennext_app
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
    "session=buyer": {"user": {"id": "U1", "role": "buyer", "csrfToken": "csrf-1"}},
    "session=other": {"user": {"id": "U2", "role": "buyer", "csrfToken": "csrf-2"}},
    "session=seller": {"user": {"id": "U3", "role": "seller", "csrfToken": "csrf-3"}},
    "session=demo": {"user": {"id": "D1", "role": "buyer", "csrfToken": "csrf-d"}, "demo": True},
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
        self.create = "ok"  # "ok", "reject" (bot refuses) or "lost" (answer never arrives)
        # Credit in the existing API: approved top-ups and promotional Credit per account.
        self.credit = {"U1": (0.50, 1.00), "U2": (100.0, 0.0)}

    def legacy(self, request):
        path = request.url.path
        if path == "/api/auth/session":
            return httpx.Response(
                200, json=USERS.get(request.headers.get("cookie"), {"user": None})
            )
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
        if request.url.path == "/v1/rentals" and request.method == "GET":
            return httpx.Response(200, json={"total": len(self.rentals), "items": self.rentals})
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
    )
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
        "feeCents": 3,
        "totalCents": 62,
    }
    assert checkout_totals(2.64, 1.5)["totalCents"] == 396 + 20
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
        "totalCents": 62,
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
        ({}, body(hours=1.005), 400, "invalid"),
        ({}, body(hours=721), 400, "invalid"),
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
    fakes.rentals[1].update(state="ACTIVE", generation=1, connection={"region": "us-west-2"})
    response = await client.get("/api/marketplace/me", headers={"Cookie": "session=buyer"})
    instances = response.json()["instances"]
    assert [i["id"] for i in instances] == ["legacy-1", fakes.rentals[1]["id"]]
    mine = instances[1]
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
        "serviceEnd": fakes.rentals[1]["rfq"]["expires_at"],
        "endedAt": None,
        "createdAt": "2026-10-28T01:01:00+00:00",
        "sshHost": "gw.example.com",
        "sshUser": "ubuntu",
        "sshPort": 22105,
        "resaleAllowed": False,
    }
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
    assert (await buy(client, body())).status_code == 200  # $0.62 total.
    after = (await balance(client)).json()
    assert (after["promotionalCredit"], after["paidCredit"], after["availableCredit"]) == (
        0,
        0.88,
        0.88,
    )
    assert (
        after["spotCharges"][0]["totalCents"] == 62
        and after["spotCharges"][0]["state"] == "charged"
    )
    assert after["spotCharges"][0]["orderId"] == fakes.rentals[0]["id"]
    # A retried purchase returns the same order and charges nothing more.
    assert (await buy(client, body())).status_code == 200
    assert (await balance(client)).json()["availableCredit"] == 0.88
    # Three hours ($1.23) cost more than is left.
    refused = await buy(
        client, {**body(hours=3, expectedPricing=checkout_totals(0.39, 3)), "idempotencyKey": "k-2"}
    )
    assert refused.status_code == 409 and refused.json()["code"] == "INSUFFICIENT_CREDIT"
    assert len(fakes.created) == 1 and (await balance(client)).json()["availableCredit"] == 0.88


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
    fakes.rentals[0].update(state="CLOSED", delivering_at="2026-10-28T01:05:00+00:00")
    assert (await balance(client)).json()["availableCredit"] == 0.88  # Delivered: no refund.


async def test_an_unanswered_order_stays_held_until_its_rental_shows_up(env, monkeypatch):
    client, fakes, _ = env
    fakes.create = "lost"
    uncertain = await buy(client, body())
    assert uncertain.status_code == 503
    held = (await balance(client)).json()
    assert held["availableCredit"] == 0.88 and held["spotCharges"][0]["state"] == "charged"
    # Lost before the bot stored it: refunded once the grace period has passed.
    fakes.rentals.clear()
    fakes.create = "lost"
    from spotbot import opennext_ledger

    later = opennext_ledger.utcnow() + opennext_ledger.HELD_GRACE * 2
    await buy(client, {**body(), "idempotencyKey": "k-2"})
    fakes.rentals.clear()
    monkeypatch.setattr(opennext_ledger, "utcnow", lambda: later)
    assert (await balance(client)).json()["availableCredit"] == 0.88


async def test_buy_now_without_a_key(env):
    client, fakes, _ = env
    assert (await buy(client, body(sshPublicKey=None))).status_code == 200
    assert fakes.created[0]["ssh_public_key"] is None
