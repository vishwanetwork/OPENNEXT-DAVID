"""HTTP routes for Buyer KYB, bank transfers, payment review and instance usage.

Customer routes need a verified Buyer session (and the CSRF token for writes); operator routes
need the existing administrator session and a same-origin request. Payloads follow the
OPENNEXT-DAVID service ports; files travel as base64 because the web API client is JSON-only.
"""

import base64
import hashlib
from typing import Literal

import httpx
from fastapi import Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from spotbot.opennext_market import MAX_HOURS, MIN_HOURS, checkout_totals
from spotbot.opennext_ops import OperationError, case_view, intent_view, review_record
from spotbot.opennext_usage import usage_snapshot
from spotbot.rental_models import valid_public_key

IDENTIFIER = r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"


class Strict(BaseModel):
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)


class DocumentUpload(Strict):
    kind: str
    fileName: str = Field(min_length=1, max_length=255)
    contentType: str
    dataBase64: str = Field(min_length=4, max_length=15_000_000)


class Submission(Strict):
    company: dict[str, str]
    mode: Literal["Auto", "Full"]
    consent: Literal[True]
    idempotencyKey: str = Field(pattern=IDENTIFIER)
    documentIds: list[str] = Field(min_length=1, max_length=20)


class TransferRequest(Strict):
    purpose: Literal["topup", "order"]
    amountCents: int = Field(gt=0, le=10_000_000)
    currency: Literal["USD"]
    pricingVersion: Literal["credit-face-value-v1"] | None = None
    creditAmountCents: int | None = None
    feeAmountCents: int | None = None
    purchaseReference: str | None = Field(None, max_length=160)
    orderId: str | None = Field(None, pattern=IDENTIFIER)
    offerId: str | None = Field(None, pattern=IDENTIFIER)
    durationHours: float | None = Field(None, ge=MIN_HOURS, le=MAX_HOURS)
    sshPublicKey: str | None = Field(None, max_length=16384)
    idempotencyKey: str = Field(pattern=IDENTIFIER)

    @field_validator("sshPublicKey")
    @classmethod
    def public_key(cls, value):
        if value is None or not value.strip():
            return None
        if not valid_public_key(value):
            raise ValueError("invalid_ssh_public_key")
        return value.strip()


class Report(Strict):
    idempotencyKey: str = Field(pattern=IDENTIFIER)


class PaymentDecision(Strict):
    caseId: str
    accountId: str
    expectedRevision: int
    idempotencyKey: str = Field(pattern=IDENTIFIER)
    decision: Literal["Confirm", "Fail"]
    fundsVerified: bool = False
    reason: str = Field("", max_length=2000)


class KybDecision(Strict):
    expectedRevision: int
    decision: Literal["Approved", "Rejected"]
    reason: str = Field("", max_length=2000)
    allscaleApproved: bool = False
    idempotencyKey: str = Field(pattern=IDENTIFIER)


def install(app, ctx):
    """Register the routes; `ctx` carries the adapter's shared helpers (see opennext.py)."""
    ops, error, no_store = ctx.ops, ctx.error, ctx.no_store

    def refused(exc):
        extra = {"code": exc.code} if exc.code else {}
        return error(exc.status, exc.message, **extra)

    async def parse(request, model):
        try:
            return model.model_validate_json(await request.body()), None
        except ValidationError as exc:
            if any(e["msg"].endswith("invalid_ssh_public_key") for e in exc.errors()):
                return None, error(400, "Enter a valid OpenSSH public key.")
            return None, error(400, "The request is invalid.", code="INVALID_REQUEST")

    async def buyer(request, *, write):
        user, failed = await ctx.customer(request, write=write)
        if failed:
            return None, failed
        if user.get("role") != "buyer":
            return None, error(403, "A Buyer account is required.")
        return user, None

    # ---------- Buyer KYB ----------

    @app.get("/api/buyer-kyb/me")
    async def kyb_me(request: Request):
        user, failed = await buyer(request, write=False)
        if failed:
            return failed
        return no_store(ops.snapshot(user["id"], await ops.kyb_case(user["id"])))

    @app.post("/api/buyer-kyb/documents")
    async def kyb_upload(request: Request):
        user, failed = await buyer(request, write=True)
        if failed:
            return failed
        body, failed = await parse(request, DocumentUpload)
        if failed:
            return failed
        try:
            doc = await ops.upload(
                user["id"], body.kind, body.fileName, body.contentType, body.dataBase64
            )
        except OperationError as exc:
            return refused(exc)
        return no_store(
            {
                "confirmed": True,
                "document": {
                    "id": doc["id"],
                    "kind": doc["document_kind"],
                    "fileName": doc["file_name"],
                    "contentType": doc["content_type"],
                    "sizeBytes": doc["size_bytes"],
                },
            }
        )

    @app.post("/api/buyer-kyb/submissions")
    async def kyb_submit(request: Request):
        user, failed = await buyer(request, write=True)
        if failed:
            return failed
        body, failed = await parse(request, Submission)
        if failed:
            return failed
        try:
            case = await ops.submit(
                user, body.company, body.mode, body.documentIds, body.idempotencyKey
            )
        except OperationError as exc:
            return refused(exc)
        return no_store(ops.snapshot(user["id"], case))

    # ---------- Bank transfers ----------

    @app.post("/api/billing/bank-transfer-intents")
    async def create_intent(request: Request):
        user, failed = await buyer(request, write=True)
        if failed:
            return failed
        body, failed = await parse(request, TransferRequest)
        if failed:
            return failed
        if not await ops.kyb_approved(user["id"]):
            return error(
                403,
                "Complete business verification before paying by bank transfer.",
                code="KYB_REQUIRED",
            )
        offer = None
        if body.purpose == "topup":
            if (
                body.pricingVersion != "credit-face-value-v1"
                or body.creditAmountCents != body.amountCents
                or body.feeAmountCents != 0
                or body.amountCents < 100
            ):
                return error(400, "Top-ups add their full amount as Credit, from $1.")
        else:
            if body.pricingVersion or body.creditAmountCents or body.feeAmountCents:
                return error(400, "The request is invalid.", code="INVALID_REQUEST")
            if not (body.offerId and body.durationHours):
                return error(400, "Choose a Spot offer and a duration.")
            previous = await ops.find_transfer(user["id"], body.idempotencyKey)
            if previous:
                try:
                    # A previously issued intent keeps its agreed quote through later policy changes.
                    return no_store(intent_view(await ops.create_transfer(user, body.model_dump())))
                except OperationError as exc:
                    return refused(exc)
            try:
                offer = (await ctx.market.offers()).get(body.offerId)
            except (httpx.HTTPError, ValueError, KeyError, TypeError):
                return error(503, "Spot offers are temporarily unavailable. Nothing was created.")
            if offer is None:
                return error(
                    409, "This Spot offer is no longer available.", code="OFFER_UNAVAILABLE"
                )
            totals = checkout_totals(offer.instance_hourly, body.durationHours)
            if totals["totalCents"] != body.amountCents:
                return error(
                    409,
                    "The offer price changed. Review the current price before paying.",
                    code="PRICE_CHANGED",
                )
        try:
            doc = await ops.create_transfer(user, body.model_dump(), offer)
        except OperationError as exc:
            return refused(exc)
        return no_store(intent_view(doc))

    @app.get("/api/billing/bank-transfer-intents/{intent_id}")
    async def get_intent(request: Request, intent_id: str):
        user, failed = await buyer(request, write=False)
        if failed:
            return failed
        try:
            return no_store(intent_view(await ops.transfer(user["id"], intent_id)))
        except OperationError as exc:
            return refused(exc)

    @app.post("/api/billing/bank-transfer-intents/{intent_id}/report-sent")
    async def report_sent(request: Request, intent_id: str):
        user, failed = await buyer(request, write=True)
        if failed:
            return failed
        _, failed = await parse(request, Report)
        if failed:
            return failed
        try:
            return no_store(await ops.report_sent(user["id"], intent_id))
        except OperationError as exc:
            return refused(exc)

    # ---------- Instance usage ----------

    @app.get("/api/marketplace/instances/{rental_id}/usage")
    async def instance_usage(request: Request, rental_id: str):
        user, rental, failed = await ctx.own_rental(request, rental_id, write=False)
        if failed:
            return failed
        # This is a single-instance read. Only reconcile the verified rental; a partial
        # inventory must never refund other held orders as though they did not exist.
        async with ctx.ledger.lock(user["id"]):
            await ctx.ledger.reconcile(user["id"], [rental], complete=False)
            charges = await ctx.ledger.charges(user["id"])
        charge = next((c for c in charges if c.get("rental_id") == rental["id"]), None)
        return no_store(usage_snapshot(user["id"], rental, charge))

    # ---------- Operator review ----------

    async def operator(request, *, write):
        scope, failed = await ctx.admin_session(request)
        if failed:
            return None, failed
        if write and not ctx.same_origin(request):
            return None, error(403, "Origin not allowed")
        return scope, None

    @app.get("/api/admin/operations/session")
    async def operations_session(request: Request):
        scope, failed = await operator(request, write=False)
        if failed:
            return failed
        return no_store({"confirmed": True, "sessionScope": scope})

    @app.get("/api/admin/payment-requests")
    async def payment_requests(request: Request, kind: str = "topup"):
        scope, failed = await operator(request, write=False)
        if failed:
            return failed
        if kind not in {"topup", "direct_pay"}:
            return error(400, "Unknown payment kind.")
        rows = await ops.transfers("topup" if kind == "topup" else "order")
        return no_store(
            {"confirmed": True, "sessionScope": scope, "records": [review_record(r) for r in rows]}
        )

    @app.post("/api/admin/payment-requests/{transfer_id}/decision")
    async def payment_decision(request: Request, transfer_id: str):
        scope, failed = await operator(request, write=True)
        if failed:
            return failed
        body, failed = await parse(request, PaymentDecision)
        if failed:
            return failed
        if body.caseId != transfer_id:
            return error(400, "The request is invalid.", code="INVALID_REQUEST")
        try:
            receipt = await ops.decide_payment(transfer_id, body.model_dump(), scope)
        except OperationError as exc:
            return refused(exc)
        if receipt["provisioningQueued"]:
            await ctx.provision_now(transfer_id)
        return no_store(receipt)

    @app.get("/api/admin/buyer-kyb")
    async def kyb_queue(request: Request):
        scope, failed = await operator(request, write=False)
        if failed:
            return failed
        cases = [case_view(c) for c in await ops.kyb_cases()]
        return no_store({"confirmed": True, "sessionScope": scope, "cases": cases})

    @app.get("/api/admin/buyer-kyb/{case_id}/documents/{document_id}")
    async def kyb_document(request: Request, case_id: str, document_id: str, revision: int = 0):
        scope, failed = await operator(request, write=False)
        if failed:
            return failed
        try:
            doc, data = await ops.kyb_document(case_id, document_id, revision)
        except OperationError as exc:
            return refused(exc)
        ctx.audit("kyb_document_download", case=case_id, document=document_id, operator=scope)
        return no_store(
            {
                "confirmed": True,
                "caseId": case_id,
                "documentId": document_id,
                "fileName": doc["file_name"],
                "contentType": doc["content_type"],
                "sha256": hashlib.sha256(data).hexdigest(),
                "dataBase64": base64.b64encode(data).decode(),
            }
        )

    @app.post("/api/admin/buyer-kyb/{case_id}/decision")
    async def kyb_decision(request: Request, case_id: str):
        scope, failed = await operator(request, write=True)
        if failed:
            return failed
        body, failed = await parse(request, KybDecision)
        if failed:
            return failed
        try:
            receipt = await ops.kyb_decide(
                case_id,
                body.expectedRevision,
                body.decision,
                body.reason,
                body.allscaleApproved,
                body.idempotencyKey,
                scope,
            )
        except OperationError as exc:
            return refused(exc)
        return no_store(receipt)
