"""Direct Pay completion and one-time customer redemption, without a second payment."""

import secrets
from datetime import timedelta

import httpx
from fastapi import Request

from spotbot.models import timestamp, utcnow
from spotbot.opennext_ops import PENDING, OperationError, email, footer, money, notice
from spotbot.rentals import at
from spotbot.storage.workflows import ConflictError

POLICY = "recheck-before-purchase-v1"


class PaidPurchases:
    def __init__(self, ops, market):
        self.ops, self.market = ops, market

    async def check(self, doc):
        if self.market is None:
            raise OperationError(
                503, "Capacity checks are temporarily unavailable. Nothing was changed."
            )
        try:
            result = await self.market.preflight(doc)
            return result["eligible"]
        except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError) as exc:
            raise OperationError(
                503, "The provider preflight could not be confirmed. Nothing was changed."
            ) from exc

    def notify(self, doc, subject, message):
        if not doc.get("email"):
            raise OperationError(
                409, "A verified customer email is required before completing this payment."
            )
        return dict(
            doc,
            notices=[*doc.get("notices", []), notice(subject, message, kind="payment")],
            emails=[
                *doc.get("emails", []),
                email(doc["email"], subject, message + footer(self.ops.public_url)),
            ],
        )

    async def save(self, doc):
        try:
            return await self.ops._save(doc)
        except ConflictError as exc:
            raise OperationError(409, "This payment changed. Refresh before continuing.") from exc

    async def complete(self, transfer_id, body, operator):
        if body.get("decision") != "Confirm" or body.get("fundsVerified") is not True:
            raise OperationError(400, "Verify receipt of the full payment before completing it.")
        async with self.ops.lock("transfer:" + transfer_id):
            doc = await self.ops.get_transfer(transfer_id)
            if not doc or doc["account"] != body["accountId"] or doc["purpose"] != "order":
                raise OperationError(404, "Direct Pay request not found.")
            prior = doc.get("decision")
            if prior:
                if (
                    prior.get("idempotency_key") == body["idempotencyKey"]
                    and prior.get("policy") == POLICY
                ):
                    return prior["receipt"]
                raise OperationError(409, "This payment was already reviewed.")
            if doc["revision"] != body["expectedRevision"] or doc["status"] not in PENDING:
                raise OperationError(409, "This payment changed. Refresh before completing it.")
            if not doc.get("offer_id") or not doc.get("offer") or not doc.get("pricing_snapshot"):
                raise OperationError(
                    409,
                    "The original priced offer is missing. Reconcile this legacy payment before continuing.",
                )
            eligible = await self.check(doc) if at(doc["expires_at"]) > utcnow() else False
            checked_at = timestamp()
            intent_id = "PI-" + secrets.token_hex(12) if eligible else None
            resolution = dict(
                policy=POLICY,
                orderId=doc["order_reference"],
                offerId=doc["offer_id"],
                availabilityCheckedAt=checked_at,
                outcome="awaiting_customer_order" if eligible else "credited",
            )
            if intent_id:
                resolution["purchaseIntentId"] = intent_id
            receipt = dict(
                confirmed=True,
                currency="USD",
                pricingVersion="order-total-v1",
                caseId=doc["id"],
                accountId=doc["account"],
                revision=doc["revision"] + 1,
                idempotencyKey=body["idempotencyKey"],
                status="Confirmed",
                notificationQueued=True,
                emailQueued=True,
                amountCents=doc["amount_cents"],
                creditAmountCents=0 if eligible else doc["amount_cents"],
                feeAmountCents=0,
                ledgerPosted=not eligible,
                provisioningQueued=False,
                directPayResolution=resolution,
            )
            updated = dict(
                doc,
                status="Confirmed",
                revision=receipt["revision"],
                credited_cents=0 if eligible else doc["amount_cents"],
                provisioning=None,
                decision=dict(
                    idempotency_key=body["idempotencyKey"],
                    decision="Confirm",
                    policy=POLICY,
                    reason="",
                    operator=operator,
                    at=checked_at,
                    receipt=receipt,
                ),
                paid_purchase=dict(
                    id=intent_id,
                    state="awaiting_customer_order" if eligible else "credited",
                    expires_at=(utcnow() + timedelta(days=7)).isoformat(),
                    checked_at=checked_at,
                    check_kind="provider_preflight",
                    capacity_guaranteed=False,
                ),
            )
            if eligible:
                message = (
                    "Your payment is complete. Continue your original purchase without paying again "
                    "in Instances. The provider preflight passed; Spot capacity is confirmed only "
                    "when the instance starts. Add your SSH key in Instances before connecting."
                )
            else:
                message = (
                    f"The selected capacity is no longer eligible or the payment instructions expired. "
                    f"Your full payment of {money(doc['amount_cents'])} has been added to your Credit. "
                    "Please select another instance."
                )
            await self.save(self.notify(updated, "Payment complete", message))
            return receipt

    async def owned(self, user_id, intent_id):
        for doc in await self.ops.transfers("order", user_id):
            if (doc.get("paid_purchase") or {}).get("id") == intent_id:
                return doc
        raise OperationError(404, "Paid purchase not found.")

    async def credit(self, doc, reason):
        paid = dict(doc["paid_purchase"], state="credited", reason=reason)
        updated = dict(doc, paid_purchase=paid, credited_cents=doc["amount_cents"])
        return await self.save(
            self.notify(
                updated,
                "Payment added to Credit",
                f"Your original purchase could not continue. Your full payment of {money(doc['amount_cents'])} "
                "has been added to Credit, with no additional fee. Please select another instance.",
            )
        )

    async def redeem(self, user_id, intent_id, key):
        original = await self.owned(user_id, intent_id)
        async with self.ops.lock("transfer:" + original["id"]):
            doc = await self.ops.transfer(user_id, original["id"])
            paid = doc["paid_purchase"]
            if paid["state"] != "awaiting_customer_order":
                # The intent itself is single-use; a retry may use a new HTTP request key.
                return doc
            if at(paid["expires_at"]) <= utcnow():
                return await self.credit(doc, "paid_intent_expired")
            if not await self.check(doc):
                return await self.credit(doc, "provider_preflight_failed")
            updated = dict(
                doc,
                paid_purchase=dict(
                    paid, state="redeeming", request_key=key, redeemed_at=timestamp()
                ),
                provisioning=dict(state="redeeming", attempts=0),
            )
            return await self.save(updated)

    async def expire(self):
        for doc in await self.ops.transfers("order"):
            paid = doc.get("paid_purchase") or {}
            if (
                paid.get("state") == "awaiting_customer_order"
                and at(paid["expires_at"]) <= utcnow()
            ):
                try:
                    await self.credit(doc, "paid_intent_expired")
                except OperationError:
                    pass  # A redemption or message delivery changed the version; retry next tick.

    def view(self, doc):
        paid, offer = doc["paid_purchase"], doc.get("offer") or {}
        provisioning = doc.get("provisioning") or {}
        state = paid["state"]
        if provisioning.get("state") == "submitted":
            state = "submitted"
        elif provisioning.get("state") == "failed":
            state = "credited"
        return dict(
            id=paid["id"],
            accountId=doc["account"],
            transferId=doc["id"],
            offerId=doc["offer_id"],
            orderId=doc["order_reference"],
            model=offer.get("gpu_model", ""),
            gpuCount=offer.get("gpu_count", 0),
            region=offer.get("region", ""),
            durationHours=doc["duration_hours"],
            amountCents=doc["amount_cents"],
            currency="USD",
            state=state,
            expiresAt=paid["expires_at"],
            rentalId=provisioning.get("rental_id"),
            capacityGuaranteed=False,
        )


def install(app, ctx, operator, parse, decision_model, redeem_model):
    paid = PaidPurchases(ctx.ops, ctx.market)
    ctx.ops.paid_purchases = paid

    @app.post("/api/admin/payment-requests/{transfer_id}/complete")
    async def complete(request: Request, transfer_id: str):
        actor, failed = await operator(request, write=True)
        if failed:
            return failed
        body, failed = await parse(request, decision_model)
        if failed:
            return failed
        if body.caseId != transfer_id:
            return ctx.error(400, "The payment identifier does not match.")
        try:
            return ctx.no_store(await paid.complete(transfer_id, body.model_dump(), actor))
        except OperationError as exc:
            return ctx.error(exc.status, exc.message)

    async def customer(request, write=False):
        user, failed = await ctx.customer(request, write=write)
        if failed:
            return None, failed
        if user.get("role") != "buyer":
            return None, ctx.error(403, "A Buyer account is required.")
        return user, None

    @app.get("/api/billing/paid-purchases")
    async def listing(request: Request):
        user, failed = await customer(request)
        if failed:
            return failed
        return ctx.no_store(
            dict(
                confirmed=True,
                demo=False,
                accountId=user["id"],
                purchases=[
                    paid.view(d)
                    for d in await ctx.ops.transfers("order", user["id"])
                    if (d.get("paid_purchase") or {}).get("id")
                ],
            )
        )

    @app.post("/api/billing/paid-purchases/{intent_id}/redeem")
    async def redeem(request: Request, intent_id: str):
        user, failed = await customer(request, True)
        if failed:
            return failed
        if not await ctx.ops.kyb_approved(user["id"]):
            return ctx.error(
                403, "Complete business verification before continuing.", code="KYB_REQUIRED"
            )
        body, failed = await parse(request, redeem_model)
        if failed:
            return failed
        try:
            doc = await paid.redeem(user["id"], intent_id, body.idempotencyKey)
            if (doc.get("provisioning") or {}).get("state") in {"redeeming", "queued", "held"}:
                await ctx.provision_now(doc["id"])
            return ctx.no_store(
                dict(confirmed=True, demo=False, accountId=user["id"], purchase=paid.view(doc))
            )
        except OperationError as exc:
            return ctx.error(exc.status, exc.message)
