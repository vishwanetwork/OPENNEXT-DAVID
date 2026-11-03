"""Customer authorization and verified wallet access for floating Spot purchases."""

import asyncio
from datetime import timedelta
from decimal import ROUND_FLOOR, Decimal
from types import SimpleNamespace
from uuid import uuid4

from spotbot.funding_ledger import FundingLedger, doc, guard
from spotbot.funding_math import ceil_cents, envelope, order_view
from spotbot.funding_models import RETENTION_SECONDS, VERSION, storage_reserve
from spotbot.funding_store import atomic
from spotbot.models import utcnow
from spotbot.opennext_accounts import cents
from spotbot.opennext_ledger import account_id
from spotbot.opennext_market import ROOT_GIB, Offer, rfq_for
from spotbot.opennext_ops import OperationError
from spotbot.rentals import at, identity
from spotbot.storage.workflows import ConflictError


class FundingService:
    def __init__(self, ctx):
        self.ctx = ctx
        self.db, self.market, self.ops = ctx.db, ctx.market, ctx.ops
        self.ledger = FundingLedger(self.db)
        self.ops.funding_service = self

    async def call(self, method, *args, **kwargs):
        return await asyncio.to_thread(method, *args, **kwargs)

    async def checkpoint(self, user_id):
        return await self.call(guard, self.db, user_id)

    async def save(self, order, *extra):
        return await self.call(self.ledger.save, order, await self.checkpoint(order["account"]), *extra)

    async def capabilities(self):
        if not self.ctx.settings or not self.ctx.settings.spotbot_floating_enabled or not self.market:
            return dict(pricingVersion=VERSION, enabled=False)
        response = await self.market.bot("GET", "/v1/rentals/funding-capabilities")
        if response.status_code != 200:
            return dict(pricingVersion=VERSION, enabled=False)
        body = response.json()
        return dict(pricingVersion=VERSION,
                    enabled=body.get("enabled") is True and body.get("pricingVersion") == VERSION)

    async def require_enabled(self):
        if not (await self.capabilities())["enabled"]:
            raise OperationError(503, "Floating Spot purchases are not enabled.")

    async def quote(self, user, request):
        await self.require_enabled()
        offers = await self.market.offers()
        offer = next((o for o in offers if o.id == request.offerId), None)
        if not offer:
            raise OperationError(409, "This offer is no longer available. Refresh the market.")
        if request.inferencePresetId:
            offer = await self.market.prepare_offer(offer, request.inferencePresetId)
        model = offer.pricing.get("inference")
        storage = storage_reserve(ROOT_GIB + (model["disk_gib"] if model else 0),
                                  self.market.storage_rate)
        compute = ceil_cents(offer.cents * request.durationHours)
        if request.maxHourlyCents < offer.cents or request.maxTotalCents < compute + storage:
            raise OperationError(400, "Your limits must cover the initial price and storage reserve.")
        quote = doc(
            "spot_quote", user["id"], str(uuid4()), offer_id=offer.id, model=offer.gpu_model,
            offer=offer.raw, pricing=offer.pricing, payment_method=request.paymentMethod,
            purchased_seconds=int(request.durationHours * 3600), hourly_cents=offer.cents,
            compute_funding_cents=compute, storage_reserve_cents=storage,
            initial_payment_cents=compute + storage, max_hourly_cents=request.maxHourlyCents,
            max_total_cents=request.maxTotalCents, protected_gib=ROOT_GIB + (model["disk_gib"] if model else 0),
            storage_monthly_usd=str(self.market.storage_rate),
            expires_at=(utcnow() + timedelta(minutes=10)).isoformat(),
        )
        await self.call(atomic, self.db, [await self.checkpoint(user["id"]), quote])
        return self.quote_view(quote)

    @staticmethod
    def quote_view(quote):
        return dict(
            **envelope(quote["account"]), quoteId=quote["id"], offerId=quote["offer_id"],
            expiresAt=quote["expires_at"], hourlyCents=quote["hourly_cents"],
            purchasedSeconds=quote["purchased_seconds"], paymentMethod=quote["payment_method"],
            computeFundingCents=quote["compute_funding_cents"],
            storageReserveCents=quote["storage_reserve_cents"],
            initialPaymentCents=quote["initial_payment_cents"],
            maxHourlyCents=quote["max_hourly_cents"], maxTotalCents=quote["max_total_cents"],
            storageRetentionSeconds=RETENTION_SECONDS, protectedGiB=quote["protected_gib"],
            storageMonthlyUsd=quote["storage_monthly_usd"], serviceFeeCents=0,
            inferencePresetId=(quote["pricing"].get("inference") or {}).get("preset_id"),
        )

    async def wallet(self, user_id):
        """No browser session is needed; verified private account snapshots are mandatory."""
        checkpoint = await self.checkpoint(user_id)
        source = await self.ctx.accounts.source()
        summary = await self.ctx.accounts.summary(user_id, source)
        return checkpoint, summary["currentCreditCents"]

    async def accept(self, user, request, browser_request):
        await self.require_enabled()
        quote = await self.call(self.db.get, "spot_quote", request.quoteId)
        if not quote or quote["tenant_id"] != account_id(user["id"]):
            raise OperationError(404, "Quote not found.")
        prior_id = identity("spot_order", user["id"], request.idempotencyKey)
        prior = await self.call(self.db.get, "spot_order", prior_id)
        if prior:
            if prior["quote_id"] != quote["id"]:
                raise OperationError(409, "This purchase reference was already used.")
            return await self.purchase_view(prior)
        if at(quote["expires_at"]) <= utcnow():
            raise OperationError(409, "Your quote expired. Review a new quote.")
        if quote["pricing"].get("inference") and not request.inferenceBillingAcknowledged:
            raise OperationError(400, "Acknowledge billing during model preparation.")
        async with self.ctx.legacy_ledger.lock(user["id"]):
            checkpoint = await self.checkpoint(user["id"])
            available = 0
            if quote["payment_method"] == "Credit":
                account = await self.ctx.credit(browser_request, user["id"])
                if not account or account.get("confirmed") is not True:
                    raise OperationError(503, "Your Credit could not be verified.")
                if account["_creditGuardVersion"] != checkpoint.get("version", 0):
                    raise ConflictError("wallet_changed")
                available = cents(account["availableCredit"])
            row = await self.call(self.ledger.create, quote, request, user, checkpoint, available)
        return await self.purchase_view(row)

    async def purchase_view(self, order):
        result = dict(**envelope(order["account"]), order=order_view(order))
        if order["awaiting_payment"]:
            result["transfer"] = await self.transfer(order, order["initial_payment_cents"], "initial")
        return result

    async def transfer(self, order, amount, key):
        from spotbot.funding_payments import create_transfer

        return await create_transfer(self, order, amount, key)

    async def decide_payment(self, transfer_id, body, operator):
        from spotbot.funding_payments import decide

        return await decide(self, transfer_id, body, operator)

    async def replenish(self, user, order_id, request):
        row = await self.call(self.ledger.order, user["id"], order_id)
        if row["runtime_state"] == "ended":
            raise OperationError(409, "This order has ended.")
        if row["payment_method"] == "Direct Pay":
            return dict(**envelope(user["id"]), transfer=await self.transfer(
                row, request.amountCents, request.idempotencyKey))
        checkpoint, available = await self.wallet(user["id"])
        row = await self.call(self.ledger.replenish, row, checkpoint, request.idempotencyKey,
                              request.amountCents, available_cents=available)
        return dict(**envelope(user["id"]), order=order_view(row))

    def rfq(self, order):
        quote = order["agreement"]
        offer = Offer(quote["offer"], frozen=quote["pricing"])
        purchase = SimpleNamespace(durationHours=quote["purchased_seconds"] / 3600,
                                   idempotencyKey=order["id"], sshPublicKey=order["ssh_public_key"])
        now = utcnow()
        rfq = rfq_for(offer, purchase, order["account"], now, self.market.storage_rate)
        storage_hourly = quote["pricing"].get("modelStorageHourlyCents", 0)
        markup = quote["pricing"]["markupBps"]
        source_cap = (Decimal(quote["max_hourly_cents"] - storage_hourly) * 100
                      / (10000 + markup)).quantize(Decimal("0.000001"), rounding=ROUND_FLOOR)
        rfq.update(
            rfq_id="opennext-" + order["id"], upstream_order_id="opennext-" + order["id"],
            service_seconds=None, max_price_hourly=str(source_cap),
            retail_hourly_cents=quote["hourly_cents"],
            expires_at=(now + timedelta(seconds=quote["purchased_seconds"] + RETENTION_SECONDS)).isoformat(),
            # Provider cost ceiling is independent of the customer's retail ledger.
            budget_usd=str(Decimal(quote["max_total_cents"]) / 100 + 10),
            funding=dict(pricing_version=VERSION, purchased_seconds=quote["purchased_seconds"],
                         retention_seconds=RETENTION_SECONDS,
                         max_retail_hourly_cents=quote["max_hourly_cents"],
                         max_total_cents=quote["max_total_cents"],
                         storage_reserve_cents=quote["storage_reserve_cents"],
                         grant_expires_at=(now + timedelta(seconds=self.ctx.settings.spotbot_floating_grant_seconds)).isoformat()),
        )
        return rfq
