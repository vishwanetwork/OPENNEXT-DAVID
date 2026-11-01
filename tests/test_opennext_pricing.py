"""Retail markups, guarded dynamic policy changes and immutable accepted purchases."""
# ruff: noqa: F811

import pytest
from pydantic import ValidationError

from spotbot.models import utcnow
from spotbot.opennext_market import Offer, checkout_totals, rfq_for
from spotbot.opennext_pricing import PricingPolicy, Update, snapshot
from tests.test_opennext_market import aws, body, buy, env  # noqa: F401
from tests.test_opennext_ops import ADMIN, decide, transfer

PATH = "/api/admin/pricing/retail-policy"


def test_retail_rounding_and_procurement_cost_are_separate():
    raw = aws("sku", "us-west-2", "0.4012")
    quote = snapshot(raw, dict(version=4, defaultMarkupBps=2000, rules=[]))
    assert quote["sourceCents"] == 41 and quote["retailCents"] == 49
    offer = Offer(raw, frozen=quote)
    from decimal import Decimal
    from types import SimpleNamespace

    request = rfq_for(
        offer,
        SimpleNamespace(idempotencyKey="a", durationHours=1, sshPublicKey=None),
        "user",
        utcnow(),
        Decimal(".15"),
    )
    assert (
        request["max_price_hourly"] == "0.492"
    )  # Procurement ceiling does not include retail markup.
    assert offer.instance_hourly == 0.49
    assert checkout_totals(1.20, 1)["totalCents"] == 120


def test_first_matching_rule_wins_with_normalized_gpu_names():
    policy = dict(
        version=1,
        defaultMarkupBps=2000,
        rules=[
            dict(
                id="specific", provider="aws", gpuModel="H100", region="us-west-2", markupBps=2500
            ),
            dict(id="gpu", provider=None, gpuModel="H100", region=None, markupBps=1500),
        ],
    )
    assert (
        snapshot(aws("sku", "us-west-2", "1", model="NVIDIA H100 SXM"), policy)["retailCents"]
        == 125
    )
    assert snapshot(aws("sku", "us-east-1", "1", model="H100"), policy)["retailCents"] == 115
    assert snapshot(aws("sku", "us-west-2", "1", model="T4"), policy)["retailCents"] == 120
    with pytest.raises(ValidationError):
        Update.model_validate(
            dict(expectedVersion=0, defaultMarkupBps=2000, rules=[dict(id="bad", markupBps=3000)])
        )
    with pytest.raises(ValidationError):
        Update.model_validate(dict(expectedVersion=0, defaultMarkupBps=10001, rules=[]))


async def set_policy(client, bps):
    current = (await client.get(PATH, headers=ADMIN)).json()
    response = await client.put(
        PATH,
        headers=ADMIN,
        json=dict(expectedVersion=current["version"], defaultMarkupBps=bps, rules=[]),
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_policy_auth_cas_and_cached_catalog_refresh(env):  # noqa: F811
    client, fakes, calls = env
    assert (await client.get(PATH)).status_code == 401
    initial = (await client.get("/api/marketplace/public")).json()
    assert (
        next(s for s in initial["supplies"] if s["id"] == "spotbot-us-west-2-g6.xlarge")[
            "perGpuHourly"
        ]
        == 0.39
    )
    request = dict(expectedVersion=0, defaultMarkupBps=2000, rules=[])
    assert (
        await client.put(PATH, headers={**ADMIN, "Origin": "http://attacker.test"}, json=request)
    ).status_code == 403
    before = sum(r.url.path == "/v1/prices/latest" for r in calls)
    saved = await set_policy(client, 2000)
    assert (
        saved["version"] == 1
        and saved["serviceFeeBps"] == 0
        and saved["procurementToleranceBps"] == 2000
    )
    assert (await client.put(PATH, headers=ADMIN, json=request)).status_code == 409
    current = (await client.get("/api/marketplace/public")).json()
    assert (
        next(s for s in current["supplies"] if s["id"] == "spotbot-us-west-2-g6.xlarge")[
            "perGpuHourly"
        ]
        == 0.47
    )
    assert sum(r.url.path == "/v1/prices/latest" for r in calls) == before
    assert "sourceHourly" not in str(current)  # Wholesale costs stay private.
    restored = PricingPolicy(client._transport.app.state.console_backend.db, 9999)
    assert (await restored.get())["defaultMarkupBps"] == 2000


async def test_old_confirmation_and_instance_rate_survive_policy_changes(env):  # noqa: F811
    client, fakes, _ = env
    await set_policy(client, 2000)
    purchase = body()
    purchase["durationHours"] = 1
    purchase["expectedPricing"] = checkout_totals(0.47, 1)
    accepted = await buy(client, purchase)
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["totalCents"] == 47
    assert fakes.created[-1]["max_price_hourly"] == "0.468"
    await set_policy(client, 5000)
    replay = await buy(client, purchase)
    assert replay.json() == accepted.json() and len(fakes.created) == 1
    instance = (
        await client.get("/api/marketplace/me", headers={"Cookie": "session=buyer"})
    ).json()["instances"][-1]
    assert instance["rate"] == 0.47 and instance["billing"]["hourlyCents"] == 47
    old = body()
    old["idempotencyKey"] = "new-attempt-old-price"
    assert (await buy(client, old)).json()["code"] == "PRICE_CHANGED"


async def test_direct_pay_intent_and_provisioning_keep_the_original_quote(env):  # noqa: F811
    client, fakes, _ = env
    await set_policy(client, 2000)
    payload = dict(
        purpose="order",
        amountCents=47,
        currency="USD",
        offerId="spotbot-us-west-2-g6.xlarge",
        durationHours=1,
        idempotencyKey="locked-bank-quote",
        sshPublicKey=None,
    )
    issued = await transfer(client, payload)
    assert issued.status_code == 200, issued.text
    await set_policy(client, 5000)
    assert (await transfer(client, payload)).json() == issued.json()
    queue = (await client.get("/api/admin/payment-requests?kind=direct_pay", headers=ADMIN)).json()[
        "records"
    ]
    assert (await decide(client, queue[0], "Confirm")).status_code == 200
    await client._transport.app.state.notifier.tick()
    assert len(fakes.created) == 1 and fakes.created[0]["max_price_hourly"] == "0.468"
    charges = client._transport.app.state.console_backend.db.list("opennext_charge")
    assert len(charges) == 1 and charges[0]["hourly_cents"] == 47 and charges[0]["cents"] == 47


async def test_uncertain_hold_reuses_original_quote_without_reserving_credit_twice(
    env, monkeypatch
):  # noqa: F811
    import httpx

    client, fakes, _ = env
    await set_policy(client, 2000)
    fakes.credit["U1"] = (0, 0.49)
    app = client._transport.app
    market = app.state.console_backend.market
    original = market.create

    async def lost(_):
        raise httpx.ReadTimeout("unknown outcome")

    monkeypatch.setattr(market, "create", lost)
    purchase = body()
    purchase["durationHours"] = 1
    purchase["expectedPricing"] = checkout_totals(0.47, 1)
    assert (await buy(client, purchase)).status_code == 503
    await set_policy(client, 5000)
    monkeypatch.setattr(market, "create", original)
    retry = await buy(client, purchase)
    assert retry.status_code == 200, retry.text
    assert retry.json()["totalCents"] == 47 and len(fakes.created) == 1
    assert len(app.state.console_backend.db.list("opennext_charge")) == 1


async def test_refunded_direct_pay_hold_cannot_acquire_another_instance(env):
    client, fakes, _ = env
    await set_policy(client, 2000)
    payload = dict(
        purpose="order",
        amountCents=47,
        currency="USD",
        offerId="spotbot-us-west-2-g6.xlarge",
        durationHours=1,
        idempotencyKey="closed-bank-attempt",
        sshPublicKey=None,
    )
    assert (await transfer(client, payload)).status_code == 200
    app = client._transport.app
    ops = app.state.ops
    doc = await ops.find_transfer("U1", payload["idempotencyKey"])
    # Persist the state left by an interrupted older worker after its hold was refunded.
    doc.update(status="Confirmed", provisioning=dict(state="held"))
    doc = await ops._save(doc)
    ledger = app.state.notifier.ledger
    charge = await ledger.hold("U1", doc["order_reference"], 49, doc["offer_id"], hourly_cents=47)
    await ledger.refund(charge, "rental_not_created")
    result = await app.state.notifier.provision(doc)
    assert result["provisioning"]["state"] == "failed"
    assert not fakes.created
    assert (await ledger.find("U1", doc["order_reference"]))["state"] == "refunded"


async def test_new_and_historical_usage_charges_keep_separate_fee_terms(env):
    """Old persisted holds keep their fee even when no explicit fee snapshot existed."""
    client, _, _ = env
    ledger = client._transport.app.state.notifier.ledger
    new = await ledger.hold("U1", "new-free", 300, "offer", hourly_cents=100)
    assert new["service_fee_bps"] == 0
    old = await ledger.hold("U1", "old-fee", 315, "offer", hourly_cents=100)
    old.pop("service_fee_bps")
    old.pop("pricing_snapshot")
    ledger.db.save(old, old["version"])
    old = await ledger.find("U1", "old-fee")
    new = await ledger.settle(new, "new-rental")
    old = await ledger.settle(old, "old-rental")
    assert (await ledger.bill(new, 75 * 60))["billed_cents"] == 125
    assert (await ledger.bill(old, 75 * 60))["billed_cents"] == 131
    # Replaying an old reference must not replace its original held amount or fee policy.
    replay = await ledger.hold("U1", "old-fee", 300, "offer", hourly_cents=100)
    assert replay["cents"] == 315 and replay["billed_cents"] == 131


async def test_obsolete_fee_confirmation_cannot_create_a_new_charge(env):
    client, fakes, _ = env
    purchase = body()
    purchase["expectedPricing"] = checkout_totals(0.39, 1.5, 500)
    result = await buy(client, purchase)
    assert result.status_code == 409 and result.json()["code"] == "PRICE_CHANGED"
    assert not fakes.created
    assert not client._transport.app.state.console_backend.db.list("opennext_charge")


async def test_frozen_historical_hold_retry_uses_its_original_five_percent_fee(env):
    client, fakes, _ = env
    purchase = body()
    from spotbot.opennext_market import order_reference

    ledger = client._transport.app.state.notifier.ledger
    offer = (await client._transport.app.state.console_backend.market.offers())[purchase["offerId"]]
    reference = order_reference("U1", purchase["idempotencyKey"])
    original = dict(offer.pricing, serviceFeeBps=500, durationHours=1.5)
    await ledger.hold(
        "U1",
        reference,
        62,
        offer.id,
        hourly_cents=39,
        pricing_snapshot=original,
        offer_snapshot=offer.raw,
    )
    purchase["expectedPricing"] = checkout_totals(0.39, 1.5, 500)
    result = await buy(client, purchase)
    assert result.status_code == 200, result.text
    assert result.json()["totalCents"] == 62 and len(fakes.created) == 1
