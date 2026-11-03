"""Dedicated Direct Pay pots, reviewed through the existing Console payment queue."""

import hashlib
import secrets
from datetime import timedelta

from spotbot.funding_ledger import doc
from spotbot.funding_store import atomic
from spotbot.models import timestamp, utcnow
from spotbot.opennext_ops import PENDING, OperationError, email, footer, intent_view, notice
from spotbot.rentals import at


async def create_transfer(service, order, amount, key):
    digest = hashlib.sha256(f"spot-funding:{order['id']}:{key}".encode()).hexdigest()
    transfer_id = "BT-" + digest[:20].upper()
    existing = await service.ops.get_transfer(transfer_id)
    if existing:
        if existing["amount_cents"] != amount:
            raise OperationError(409, "This payment reference was already used.")
        return intent_view(existing)
    if amount <= 0 or order["runtime_state"] == "ended":
        raise OperationError(409, "This order cannot accept funding.")
    if order["funded_cents"] + order["storage_funded_cents"] + amount > order["agreement"]["max_total_cents"]:
        raise OperationError(409, "This payment would exceed your authorized total budget.")
    row = dict(
        id=transfer_id, kind="opennext_transfer", tenant_id=order["tenant_id"],
        account=order["account"], email=order.get("email") or "", currency="USD",
        purpose="order", amount_cents=amount, idempotency_key=key,
        order_id=order["id"], funding_order_id=order["id"],
        order_reference="opennext-" + order["id"], offer_id=order["agreement"]["offer_id"],
        duration_hours=order["purchased_seconds"] / 3600, purchase_reference=key,
        reference="ONX-" + secrets.token_hex(4).upper(),
        status="Awaiting transfer", revision=1, created_at=timestamp(),
        expires_at=(utcnow() + timedelta(days=7)).isoformat(),
        reported_at=None, decision=None, provisioning=None, notices=[], emails=[], version=0,
    )
    await service.call(atomic, service.db, [await service.checkpoint(order["account"]), row])
    return intent_view(row)


async def decide(service, transfer_id, body, operator):
    async with service.ops.lock("transfer:" + transfer_id):
        row = await service.ops.get_transfer(transfer_id)
        if not row or row["account"] != body.get("accountId"):
            raise OperationError(404, "Payment request not found.")
        prior = row.get("decision")
        key, decision = body.get("idempotencyKey"), body.get("decision")
        if prior:
            if prior["idempotency_key"] == key and prior["decision"] == decision:
                return prior["receipt"]
            raise OperationError(409, "This payment was already reviewed.")
        if not key or row["revision"] != body.get("expectedRevision") or row["status"] not in PENDING:
            raise OperationError(409, "This payment changed. Refresh before reviewing.")
        reason = str(body.get("reason") or "").strip()
        if (decision not in {"Confirm", "Fail"}
                or decision == "Confirm" and body.get("fundsVerified") is not True
                or decision == "Fail" and not reason):
            raise OperationError(400, "Verify received funds, or enter a failure reason.")
        order = await service.call(service.ledger.order, row["account"], row["funding_order_id"])
        confirmed = decision == "Confirm"
        over_limit = (order["funded_cents"] + order["storage_funded_cents"] + row["amount_cents"]
                      > order["agreement"]["max_total_cents"])
        credit_back = confirmed and (order["runtime_state"] == "ended" or over_limit
                                     or at(row["expires_at"]) <= utcnow())
        receipt = dict(
            confirmed=True, currency="USD", pricingVersion="order-total-v1", caseId=transfer_id,
            accountId=row["account"], revision=row["revision"] + 1, idempotencyKey=key,
            status="Confirmed" if confirmed else "Failed", notificationQueued=True,
            emailQueued=bool(row["email"]), amountCents=row["amount_cents"], feeAmountCents=0,
            creditAmountCents=row["amount_cents"] if credit_back else 0,
            ledgerPosted=confirmed, provisioningQueued=confirmed and not credit_back,
        )
        subject = "Spot funding confirmed" if confirmed else "Payment could not be confirmed"
        message = (
            "Your confirmed payment was added to Credit because the order ended, its payment "
            "reference expired, or its budget limit was reached."
            if credit_back else "Your Spot funding is confirmed. The Agent will acquire or restore your "
            "instance automatically. Watch Instances for readiness and add your SSH public key there."
            if confirmed else f"Your payment could not be confirmed. Reason: {reason}. Please check and retry."
        )
        row.update(
            status=receipt["status"], revision=receipt["revision"],
            decision=dict(idempotency_key=key, decision=decision, reason=reason, operator=operator,
                          at=timestamp(), receipt=receipt), provisioning=None, credited_cents=0,
            notices=[*row["notices"], notice(subject, message, kind="payment")],
            emails=[*row["emails"], *([email(row["email"], subject, message + footer(service.ops.public_url))]
                                     if row["email"] else [])],
        )
        checkpoint = await service.checkpoint(row["account"])
        if confirmed and not credit_back:
            await service.call(service.ledger.replenish, order, checkpoint, row["id"],
                               row["amount_cents"], payment_record=row)
        else:
            extra = [doc("spot_wallet_credit", row["account"], row["id"],
                         cents=row["amount_cents"], order_id=order["id"],
                         reason="Unusable confirmed Direct Pay funding")] if credit_back else []
            await service.call(atomic, service.db, [checkpoint, row, *extra])
        return receipt
