"""Paid continuation cannot credit, debit or provision the same receipt twice."""
# ruff: noqa: F811

import asyncio
from datetime import timedelta
from unittest.mock import AsyncMock

import httpx

from spotbot.models import utcnow
from tests.test_opennext_market import Outbox, balance, body, buy, env  # noqa: F401
from tests.test_opennext_ops import ADMIN, headers, transfer


async def pending(client):
    purchase = body()
    result = await transfer(
        client,
        dict(
            purpose="order",
            amountCents=purchase["expectedPricing"]["totalCents"],
            currency="USD",
            orderId="checkout-1",
            offerId=purchase["offerId"],
            durationHours=1.5,
            idempotencyKey="paid-1",
        ),
    )
    assert result.status_code == 200, result.text
    rows = (await client.get("/api/admin/payment-requests?kind=direct_pay", headers=ADMIN)).json()[
        "records"
    ]
    row = next(r for r in rows if r["id"] == result.json()["id"])
    return row, dict(
        caseId=row["id"],
        accountId="U1",
        expectedRevision=row["revision"],
        idempotencyKey="complete-1",
        decision="Confirm",
        fundsVerified=True,
        reason="",
    )


async def complete(client, row, request):
    return await client.post(
        f"/api/admin/payment-requests/{row['id']}/complete", json=request, headers=ADMIN
    )


async def redeem(client, intent_id, **kwargs):
    kwargs = {"cookie": "session=buyer", "csrf": "csrf-1", **kwargs}
    return await client.post(
        f"/api/billing/paid-purchases/{intent_id}/redeem",
        json=dict(idempotencyKey="redeem-1"),
        headers=headers(**kwargs),
    )


async def wait_background(app):
    for _ in range(30):
        await asyncio.sleep(0.01)
        doc = (await app.state.ops.transfers("order"))[0]
        if (doc.get("provisioning") or {}).get("state") in {"submitted", "failed"}:
            return doc
    raise AssertionError("Provisioning did not complete")


async def test_complete_then_redeem_once_at_original_price_without_second_debit(env):
    client, fakes, _ = env
    app = client._transport.app
    paid = app.state.ops.paid_purchases
    paid.market.preflight = AsyncMock(return_value=dict(eligible=True))
    row, request = await pending(client)
    before = (await balance(client)).json()["availableCredit"]
    response = await complete(client, row, request)
    assert response.status_code == 200, response.text
    receipt = response.json()
    resolution = receipt["directPayResolution"]
    intent_id = resolution["purchaseIntentId"]
    assert resolution["outcome"] == "awaiting_customer_order"
    assert receipt["provisioningQueued"] is False and receipt["creditAmountCents"] == 0
    assert len(fakes.rentals) == 0
    assert (await balance(client)).json()["availableCredit"] == before
    assert (await complete(client, row, request)).json() == receipt
    assert (
        await complete(client, row, dict(request, idempotencyKey="different"))
    ).status_code == 409
    assert (
        await redeem(client, intent_id, cookie="session=other", csrf="csrf-2")
    ).status_code == 404
    [owned] = (
        await client.get("/api/billing/paid-purchases", headers={"Cookie": "session=buyer"})
    ).json()["purchases"]
    assert owned["id"] == intent_id and owned["amountCents"] == row["amountCents"]
    other = (
        await client.get("/api/billing/paid-purchases", headers={"Cookie": "session=other"})
    ).json()
    assert other["purchases"] == []
    # Redemptions race with retries, but the first durable transition consumes the paid intent.
    results = await asyncio.gather(redeem(client, intent_id), redeem(client, intent_id))
    assert all(r.status_code == 200 for r in results)
    doc = await wait_background(app)
    assert doc["provisioning"]["state"] == "submitted" and len(fakes.rentals) == 1
    assert (await balance(client)).json()["availableCredit"] == before
    assert len(await app.state.notifier.ledger.charges("U1")) == 1
    assert len(doc["notices"]) == 1 and len(doc["emails"]) == 1
    assert (await redeem(client, intent_id)).status_code == 200 and len(fakes.rentals) == 1


async def test_unavailable_preflight_credits_entire_receipt_once(env):
    client, fakes, _ = env
    ops = client._transport.app.state.ops
    ops.paid_purchases.market.preflight = AsyncMock(return_value=dict(eligible=False))
    row, request = await pending(client)
    before = (await balance(client)).json()["availableCredit"]
    response = await complete(client, row, request)
    assert response.status_code == 200, response.text
    receipt = response.json()
    assert receipt["directPayResolution"]["outcome"] == "credited"
    assert "purchaseIntentId" not in receipt["directPayResolution"]
    assert receipt["creditAmountCents"] == row["amountCents"] and receipt["feeAmountCents"] == 0
    assert (await complete(client, row, request)).json() == receipt
    assert (await balance(client)).json()["availableCredit"] == before + row["amountCents"] / 100
    assert fakes.rentals == []


async def test_stock_loss_or_expiry_before_redemption_converts_full_amount(env):
    client, fakes, _ = env
    ops = client._transport.app.state.ops
    check = ops.paid_purchases.market.preflight = AsyncMock(return_value=dict(eligible=True))
    row, request = await pending(client)
    receipt = (await complete(client, row, request)).json()
    intent_id = receipt["directPayResolution"]["purchaseIntentId"]
    check.return_value = dict(eligible=False)
    result = await redeem(client, intent_id)
    assert result.json()["purchase"]["state"] == "credited"
    assert (await redeem(client, intent_id)).json()["purchase"]["state"] == "credited"
    assert await ops.credits("U1") == row["amountCents"] and not fakes.rentals


async def test_provider_errors_do_not_convert_money_and_expiry_is_recoverable(env):
    client, fakes, _ = env
    ops = client._transport.app.state.ops
    check = ops.paid_purchases.market.preflight = AsyncMock(
        side_effect=httpx.ConnectError("offline")
    )
    row, request = await pending(client)
    assert (await complete(client, row, request)).status_code == 503
    assert (await ops.get_transfer(row["id"]))["decision"] is None
    check.side_effect = None
    check.return_value = dict(eligible=True)
    assert (await complete(client, row, request)).status_code == 200
    doc = await ops.get_transfer(row["id"])
    await ops._save(
        dict(
            doc,
            paid_purchase=dict(
                doc["paid_purchase"], expires_at=(utcnow() - timedelta(seconds=1)).isoformat()
            ),
        )
    )
    await ops.paid_purchases.expire()
    await ops.paid_purchases.expire()
    assert await ops.credits("U1") == row["amountCents"] and not fakes.rentals


async def test_actual_bot_rejection_after_preflight_returns_full_payment(env):
    client, fakes, _ = env
    app = client._transport.app
    app.state.ops.paid_purchases.market.preflight = AsyncMock(return_value=dict(eligible=True))
    row, request = await pending(client)
    receipt = (await complete(client, row, request)).json()
    fakes.create = "reject"
    before = (await balance(client)).json()["availableCredit"]
    assert (
        await redeem(client, receipt["directPayResolution"]["purchaseIntentId"])
    ).status_code == 200
    doc = await wait_background(app)
    assert doc["provisioning"]["state"] == "failed" and not fakes.rentals
    assert (await balance(client)).json()["availableCredit"] == before + row["amountCents"] / 100
    assert len(doc["emails"]) == 2


async def test_redeeming_recovers_after_restart_and_retries_email_without_recrediting(env):
    client, fakes, _ = env
    app = client._transport.app
    ops = app.state.ops
    ops.paid_purchases.market.preflight = AsyncMock(return_value=dict(eligible=True))
    row, request = await pending(client)
    receipt = (await complete(client, row, request)).json()
    # Crash after the durable claim but before the HTTP handler queues background work.
    doc = await ops.paid_purchases.redeem(
        "U1", receipt["directPayResolution"]["purchaseIntentId"], "crash"
    )
    assert doc["provisioning"]["state"] == "redeeming" and await ops.credits("U1") == 0
    await app.state.notifier.provision_paid()
    assert len(fakes.rentals) == 1
    failed_mailer = Outbox()

    def offline(*args):
        raise OSError("SMTP unavailable")

    failed_mailer.send = offline
    app.state.notifier.mailer = failed_mailer
    await app.state.notifier.deliver_outbox()
    doc = await ops.get_transfer(row["id"])
    assert doc["emails"][0]["state"] == "pending" and doc["emails"][0]["attempts"] == 1
    app.state.notifier.mailer = Outbox()
    await app.state.notifier.deliver_outbox()
    await app.state.notifier.deliver_outbox()
    assert len(app.state.notifier.mailer.messages) == 1
    assert len(fakes.rentals) == 1 and await ops.credits("U1") == row["amountCents"]
    # A customer Credit request cannot hijack the separate Direct Pay order namespace.
    assert (await buy(client, body(idempotencyKey="direct-pay:paid-1"))).status_code == 400
