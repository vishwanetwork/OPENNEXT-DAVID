"""Real API and durable worker acceptance with a simulated cloud; no paid resources."""

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from spotbot.funding_ledger import guard
from spotbot.models import utcnow
from spotbot.opennext_market import Offer, SpotMarket
from tests.test_opennext_market import CATALOG, HOST, body
from tests.test_opennext_market import env as env  # noqa: F401


@pytest.fixture
async def floating(env, monkeypatch):
    client, fakes, calls = env
    app = client._transport.app
    service = app.state.funding
    service.ctx.settings = SimpleNamespace(spotbot_floating_enabled=True,
                                           spotbot_floating_grant_seconds=120)
    monkeypatch.setattr(service, "capabilities", AsyncMock(return_value=dict(enabled=True, pricingVersion="spot-hourly-v1")))
    offer = Offer(CATALOG[0])
    monkeypatch.setattr(service.market, "offers", AsyncMock(return_value={offer.id: offer}))
    fakes.credit["U1"] = (0, 100)

    async def wallet(user):
        # Match the verified legacy snapshot + confirmed transfer sources, minus all charges.
        from spotbot.opennext_ledger import amount
        charges = await service.ctx.legacy_ledger.charges(user)
        return guard(service.db, user), 10000 + await service.ops.credits(user) - sum(amount(c) for c in charges)

    monkeypatch.setattr(service, "wallet", wallet)
    return client, fakes, service, app.state.funding_worker


def headers(user="buyer"):
    return {"cookie": "session=" + user, "origin": "https://" + HOST,
            "x-csrf-token": "csrf-1" if user == "buyer" else "csrf-2"}


async def purchase(env, method="Credit", key="purchase"):
    client, _, service, _ = env
    offer = next(o for o in (await service.market.offers()).values()
                 if o.region == "us-west-2" and o.sku == "g6.xlarge")
    response = await client.post("/api/billing/spot-quotes", headers=headers(), json=dict(
        offerId=offer.id, durationHours=2, paymentMethod=method,
        maxHourlyCents=100, maxTotalCents=2000))
    assert response.status_code == 200, response.text
    quote = response.json()
    response = await client.post("/api/billing/spot-purchases", headers=headers(), json=dict(
        pricingVersion="spot-hourly-v1", quoteId=quote["quoteId"], idempotencyKey=key,
        consent=True, storageRetentionAcknowledged=True))
    assert response.status_code == 200, response.text
    return response.json(), quote


async def test_credit_purchase_consent_owner_isolation_and_legacy_billing(floating):
    client, _, service, worker = floating
    result, quote = await purchase(floating)
    order_id = result["order"]["orderId"]
    assert quote["storageReserveCents"] == 350
    assert quote["initialPaymentCents"] == quote["computeFundingCents"] + 350
    assert quote["serviceFeeCents"] == 0
    other = await client.get(f"/api/billing/spot-orders/{order_id}/funding", headers=headers("other"))
    assert other.status_code == 404
    await worker.tick()
    row = service.ledger.order("U1", order_id)
    assert row["rental_id"]
    assert row["native_rfq"]["funding"]["max_total_cents"] == 2000
    assert row["native_rfq"]["service_seconds"] is None
    # The historical reconciliation routine must not mark a floating order prepaid or refund it.
    await service.ctx.legacy_ledger.reconcile("U1", [])
    assert service.ledger.order("U1", order_id)["funded_cents"] == quote["computeFundingCents"]
    detail = await client.get(f"/api/instances/{row['rental_id']}/funding", headers=headers())
    assert detail.status_code == 200 and detail.json()["order"]["orderId"] == order_id
    other = await client.get(f"/api/instances/{row['rental_id']}/funding", headers=headers("other"))
    assert other.status_code == 404


async def test_quote_uses_the_real_catalog_adapter_and_keeps_existing_reads_when_disabled(floating, monkeypatch):
    client, _, service, _ = floating
    monkeypatch.setattr(service.market, "offers", SpotMarket.offers.__get__(service.market))
    result, quote = await purchase(floating)
    assert quote["hourlyCents"] > 0
    monkeypatch.setattr(service, "capabilities", AsyncMock(return_value=dict(enabled=False, pricingVersion="spot-hourly-v1")))
    capability = (await client.get("/api/billing/spot-funding/capabilities", headers=headers())).json()
    assert capability["enabled"] is False and capability["readEnabled"] is True
    replay = await client.post("/api/billing/spot-purchases", headers=headers(), json=dict(
        pricingVersion="spot-hourly-v1", quoteId=quote["quoteId"], idempotencyKey="purchase",
        consent=True, storageRetentionAcknowledged=True))
    assert replay.status_code == 200 and replay.json()["order"]["orderId"] == result["order"]["orderId"]


async def test_enabled_floating_policy_cannot_be_bypassed_through_legacy_checkout(floating):
    client, fakes, service, _ = floating
    credit = await client.post("/api/marketplace/spot-purchases", headers=headers(), json=body())
    assert credit.status_code == 409 and credit.json()["code"] == "FLOATING_CONSENT_REQUIRED"
    direct = await client.post("/api/billing/bank-transfer-intents", headers=headers(), json=dict(
        purpose="order", currency="USD", amountCents=39, offerId="spotbot-us-west-2-g6.xlarge",
        durationHours=1, idempotencyKey="legacy-consent-check-1"))
    assert direct.status_code == 409 and direct.json()["code"] == "FLOATING_CONSENT_REQUIRED"
    assert not fakes.created and not service.db.list("opennext_charge")


async def test_direct_pay_requires_review_and_confirm_is_atomic_idempotent(floating):
    client, fakes, service, worker = floating
    result, quote = await purchase(floating, "Direct Pay")
    order_id, transfer_id = result["order"]["orderId"], result["transfer"]["id"]
    await worker.tick()
    assert not fakes.created
    transfer = await service.ops.get_transfer(transfer_id)
    body = dict(accountId="U1", expectedRevision=transfer["revision"], decision="Confirm",
                fundsVerified=True, idempotencyKey="confirm", caseId=transfer_id)
    receipt = await service.ops.paid_purchases.complete(transfer_id, body, "operator")
    assert receipt["ledgerPosted"] and receipt["provisioningQueued"]
    from spotbot.opennext_ops import review_record

    review = review_record(await service.ops.get_transfer(transfer_id))
    assert review["fundingPolicy"] == "spot-hourly-v1" and review["fundingOrderId"] == order_id
    assert receipt["fundingResolution"] == dict(policy="spot-hourly-v1", fundingOrderId=order_id,
                                              orderId=review["orderId"], outcome="funded")
    assert await service.ops.decide_payment(transfer_id, body, "operator") == receipt
    assert await service.ops.credits("U1") == 0
    row = service.ledger.order("U1", order_id)
    assert row["funded_cents"] == quote["computeFundingCents"]
    assert len(service.db.list("spot_funding_receipt")) == 1
    await worker.tick()
    assert len(fakes.created) == 1
    assert service.ledger.order("U1", order_id)["rental_id"]


async def test_failure_reason_and_late_confirmed_money_goes_to_credit_once(floating):
    _, _, service, _ = floating
    result, _ = await purchase(floating, "Direct Pay")
    transfer_id = result["transfer"]["id"]
    body = dict(accountId="U1", expectedRevision=1, decision="Fail", reason="Bank reference mismatch",
                idempotencyKey="fail", caseId=transfer_id)
    await service.ops.decide_payment(transfer_id, body, "operator")
    row = await service.ops.get_transfer(transfer_id)
    assert row["status"] == "Failed" and "Bank reference mismatch" in row["emails"][0]["text"]
    assert not service.db.list("spot_funding_receipt")
    result, quote = await purchase(floating, "Direct Pay", "late")
    order = service.ledger.order("U1", result["order"]["orderId"])
    service.ledger.finish(order, guard(service.db, "U1"), utcnow().isoformat())
    transfer_id = result["transfer"]["id"]
    body.update(decision="Confirm", fundsVerified=True, reason="", idempotencyKey="late-confirm", caseId=transfer_id)
    receipt = await service.ops.decide_payment(transfer_id, body, "operator")
    assert receipt["creditAmountCents"] == quote["initialPaymentCents"]
    await service.ops.decide_payment(transfer_id, body, "operator")
    assert await service.ops.credits("U1") == quote["initialPaymentCents"]


async def test_expired_bank_reference_cannot_restart_an_order(floating):
    _, fakes, service, worker = floating
    result, quote = await purchase(floating, "Direct Pay")
    transfer_id = result["transfer"]["id"]
    transfer = await service.ops.get_transfer(transfer_id)
    transfer["expires_at"] = (utcnow() - timedelta(seconds=1)).isoformat()
    await service.ops._save(transfer)
    body = dict(accountId="U1", expectedRevision=1, decision="Confirm", fundsVerified=True,
                idempotencyKey="confirm-expired", caseId=transfer_id)
    receipt = await service.ops.decide_payment(transfer_id, body, "operator")
    assert receipt["creditAmountCents"] == quote["initialPaymentCents"]
    await worker.tick()
    assert not fakes.created
    assert await service.ops.credits("U1") == quote["initialPaymentCents"]


async def test_effective_rates_pause_and_restore_without_new_payment_path(floating, monkeypatch):
    _, fakes, service, worker = floating
    result, _ = await purchase(floating)
    order_id = result["order"]["orderId"]
    await worker.tick()
    order = service.ledger.order("U1", order_id)
    row = next(r for r in fakes.rentals if r["id"] == order["rental_id"])
    start = utcnow() - timedelta(hours=1)
    row.update(state="ACTIVE", funding_revision=0, generation=1,
               service_intervals=[dict(start=start.isoformat(), end=(start+timedelta(minutes=30)).isoformat())])
    original = service.market.bot
    commands = []

    async def bot(method, path, **kwargs):
        if path.endswith("price-evidence"):
            return httpx.Response(200, request=httpx.Request(method, "https://bot.test"+path), json=dict(
                rental=row, observed_at=utcnow().isoformat(), prices=[dict(
                    source_hourly="0.80", effective_at=start.isoformat(),
                    valid_until=utcnow().isoformat(), generation=1)],
                retention_verified=row["state"] == "PAUSED_FOR_FUNDS",
                retention_until=row.get("funding_retention_until"), storage_cleaned=False))
        if path.endswith("execution-grant"):
            command = kwargs["json"]
            commands.append(command)
            if command["action"] == "pause":
                row.update(state="PAUSED_FOR_FUNDS", funding_paused_at=utcnow().isoformat(),
                           funding_retention_until=(utcnow()+timedelta(days=7)).isoformat())
            else:
                row["state"] = "ACTIVE"
            row["funding_revision"] += 1
            return httpx.Response(200, request=httpx.Request(method, "https://bot.test"+path), json=row)
        return await original(method, path, **kwargs)

    monkeypatch.setattr(service.market, "bot", bot)
    # Do not allow this order to claim extra account Credit until the customer tops up.
    real_wallet = service.wallet
    monkeypatch.setattr(service, "wallet", AsyncMock(return_value=(guard(service.db, "U1"), 0)))
    await worker.step(order)
    assert commands[-1]["action"] == "pause"
    order = service.ledger.order("U1", order_id)
    assert order["compute_cents"] == 40
    await worker.step(order)
    assert service.ledger.order("U1", order_id)["retention"] == "confirmed"
    monkeypatch.setattr(service, "wallet", real_wallet)
    order = service.ledger.order("U1", order_id)
    await worker.step(order)
    assert commands[-1]["action"] == "resume"
    assert service.ledger.order("U1", order_id)["purchased_seconds"] == 7200


@pytest.mark.parametrize("method", ["Credit", "Direct Pay"])
async def test_model_storage_and_preparation_consent_reach_both_funding_paths(floating, method):
    from spotbot.inference import InferenceSpec, priced

    client, fakes, service, worker = floating
    spec = InferenceSpec(preset_id="deepseek-r1-distill-7b", revision="a" * 40,
                         image="vllm/vllm-openai@sha256:" + "b" * 64, tensor_parallel=1,
                         disk_gib=100, preparation_seconds=1800)

    async def prepare(offer, preset):
        assert preset == spec.preset_id
        return priced(offer, spec, service.market.storage_rate,
                      initial_images={"us-west-2": "ami-1234567890abcdef0"})

    service.market.prepare_offer = prepare
    quote = (await client.post("/api/billing/spot-quotes", headers=headers(), json=dict(
        offerId="spotbot-us-west-2-g6.xlarge", durationHours=2, paymentMethod=method,
        maxHourlyCents=100, maxTotalCents=5000, inferencePresetId=spec.preset_id))).json()
    assert quote["protectedGiB"] == 200 and quote["storageReserveCents"] == 700
    acceptance = dict(pricingVersion="spot-hourly-v1", quoteId=quote["quoteId"], idempotencyKey="model",
                      consent=True, storageRetentionAcknowledged=True)
    refused = await client.post("/api/billing/spot-purchases", headers=headers(), json=acceptance)
    assert refused.status_code == 400 and not service.ledger.orders("U1")
    acceptance["inferenceBillingAcknowledged"] = True
    result = (await client.post("/api/billing/spot-purchases", headers=headers(), json=acceptance)).json()
    if method == "Direct Pay":
        transfer_id = result["transfer"]["id"]
        await service.ops.decide_payment(transfer_id, dict(accountId="U1", expectedRevision=1,
            decision="Confirm", fundsVerified=True, idempotencyKey="model-confirm"), "operator")
    await worker.tick()
    assert fakes.created[0]["inference"] == spec.model_dump()
    assert fakes.created[0]["data_disks"] == [dict(device="/dev/sdf", size_gib=100)]
    assert fakes.created[0]["initial_image_ids"] == {"us-west-2": "ami-1234567890abcdef0"}


async def test_console_aggregates_direct_pay_funding_without_calling_a_hold_settled(floating):
    from spotbot.opennext_console_data import order_rows, settled_cents

    _, _, service, _ = floating
    result, quote = await purchase(floating, "Direct Pay")
    transfer_id, order_id = result["transfer"]["id"], result["order"]["orderId"]
    await service.ops.decide_payment(transfer_id, dict(accountId="U1", expectedRevision=1,
        decision="Confirm", fundsVerified=True, idempotencyKey="first"), "operator")
    order = service.ledger.order("U1", order_id)
    transfer = await service.transfer(order, 100, "replenish")
    await service.ops.decide_payment(transfer["id"], dict(accountId="U1", expectedRevision=1,
        decision="Confirm", fundsVerified=True, idempotencyKey="second"), "operator")
    rows = order_rows([], [], [], [], await service.ops.transfers(), service.ledger.orders("U1"))
    assert len(rows) == 1 and rows[0]["total"] == (quote["initialPaymentCents"] + 100) / 100
    assert rows[0]["model"] == "L4" and rows[0]["settledTotal"] is None
    assert settled_cents(dict(pricing_version="spot-hourly-v1", state="charged",
                              hourly_cents=None, cents=999)) is None
