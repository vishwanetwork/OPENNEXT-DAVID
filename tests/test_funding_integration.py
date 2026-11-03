"""Real API and durable worker acceptance with a simulated cloud; no paid resources."""

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from spotbot.funding_ledger import guard
from spotbot.models import utcnow
from spotbot.opennext_market import Offer
from tests.test_opennext_market import CATALOG, HOST
from tests.test_opennext_market import env as env  # noqa: F401


@pytest.fixture
async def floating(env, monkeypatch):
    client, fakes, calls = env
    app = client._transport.app
    service = app.state.funding
    service.ctx.settings = SimpleNamespace(spotbot_floating_enabled=True,
                                           spotbot_floating_grant_seconds=120)
    monkeypatch.setattr(service, "capabilities", AsyncMock(return_value=dict(enabled=True, pricingVersion="spot-hourly-v1")))
    monkeypatch.setattr(service.market, "offers", AsyncMock(return_value=[Offer(CATALOG[0])]))
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
    offer = (await service.market.offers())[0]
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
