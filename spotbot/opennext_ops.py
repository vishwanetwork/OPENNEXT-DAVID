"""OpenNEXT account operations: Buyer KYB, bank transfers, Credit receipts and owner notices.

These back the Terminal's and the operations Console's service ports (OPENNEXT-DAVID
`docs/BUYER_KYB_HANDOFF.md` and `docs/PAYMENT_OPERATIONS_HANDOFF.md`):

- Buyer KYB: private document uploads, a submission per revision, and an operator decision.
- Bank transfers: a top-up or Direct Pay intent with an immutable amount, reference and expiry,
  the customer's "sent" report, and the operator's Confirm (Add Credit for top-ups) or Fail.
- Credit: a confirmed top-up adds its full amount (no top-up fee). A confirmed Direct Pay
  queues provisioning; the payment becomes Credit that is held for the order at once, so
  usage billing returns any unused part to Credit.

Every decision is one compare-and-swap write of the case or transfer document that also
appends its owner notice and email to the same document, so the decision, the notification
and the email outbox commit together. The notifier delivers the emails.
"""

import asyncio
import base64
import hashlib
import secrets
from datetime import timedelta
from uuid import NAMESPACE_URL, uuid5

from cryptography.exceptions import InvalidTag

from spotbot.models import timestamp, utcnow
from spotbot.opennext_files import Infected, StorageUnavailable
from spotbot.opennext_ledger import account_id
from spotbot.opennext_market import order_reference
from spotbot.rentals import at
from spotbot.storage.common import dump
from spotbot.storage.workflows import ConflictError

KYB = "opennext_kyb_case"
DOCUMENT = "opennext_kyb_document"
TRANSFER = "opennext_transfer"

# Company registration countries reviewed in Auto mode; every other country is Full.
AUTO_COUNTRIES = {
    "CN",
    "IN",
    "JP",
    "NZ",
    "SG",
    "TW",
    "TH",
    "VN",
    "HK",
    "ID",
    "MY",
    "PH",
    "KR",
    "AU",
}
DOCUMENT_KINDS = (
    "legal-presence",
    "ownership-structure",
    "proof-of-address",
    "company-details",
    "representative-authorization",
)
SIGNATURES = {
    "application/pdf": (b"%PDF-",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/jpeg": (b"\xff\xd8\xff",),
}
MAX_FILE = 10 * 1024 * 1024
MAX_TOTAL = 50 * 1024 * 1024
MAX_FILES = 20
COMPANY_FIELDS = (
    "country",
    "companyName",
    "registrationNumber",
    "email",
    "website",
    "taxId",
    "monthlyVolumeUsd",
    "monthlyTransactions",
    "businessDescription",
    "incorporationDate",
    "legalForm",
    "legalAddress",
    "phone",
)
BOTH_REQUIRED = (
    "companyName",
    "registrationNumber",
    "email",
    "taxId",
    "monthlyVolumeUsd",
    "monthlyTransactions",
    "businessDescription",
)
FULL_REQUIRED = ("incorporationDate", "legalForm", "legalAddress", "phone")
TRANSFER_DAYS = 7
UNSUBMITTED_RETENTION = timedelta(days=1)
PENDING = {"Awaiting transfer", "Awaiting payment confirmation"}
# A held Direct Pay order makes its payment count as Credit (the hold offsets it).
CREDITED = {"held", "submitted", "failed"}


class OperationError(Exception):
    """A refusal with an HTTP status and a customer-safe message."""

    def __init__(self, status, message, code=None):
        super().__init__(message)
        self.status, self.message, self.code = status, message, code


def identity(*parts):
    return str(uuid5(NAMESPACE_URL, dump(["opennext-ops", *parts])))


def direct_pay_key(idempotency_key):
    return "direct-pay:" + idempotency_key


def mode_for(country):
    return "Auto" if country in AUTO_COUNTRIES else "Full"


def money(cents):
    return f"${cents / 100:,.2f}"


def notice(subject, message, **extra):
    return dict(
        id="NTF-" + secrets.token_hex(10),
        subject=subject,
        message=message,
        created_at=timestamp(),
        **extra,
    )


def email(to, subject, text):
    return dict(
        id="EML-" + secrets.token_hex(10),
        to=to,
        subject=subject,
        text=text,
        state="pending",
        attempts=0,
        created_at=timestamp(),
    )


def footer(public_url):
    return f"\n\nOpen the Terminal: {public_url}/terminal" if public_url else ""


def document_view(doc):
    return dict(
        id=doc["id"],
        kind=doc["document_kind"],
        fileName=doc["file_name"],
        contentType=doc["content_type"],
        sizeBytes=doc["size_bytes"],
    )


def case_view(case):
    view = dict(
        id=case["id"],
        accountId=case["account"],
        email=case["email"],
        mode=case["mode"],
        status=case["status"],
        revision=case["revision"],
        company=case["company"],
        documents=[document_view(d) for d in case["documents"]],
        submittedAt=case["submitted_at"],
    )
    if case.get("reviewed_at"):
        view["reviewedAt"] = case["reviewed_at"]
    return view


def review_status(transfer):
    return "Pending" if transfer["status"] in PENDING else transfer["status"]


def review_record(transfer):
    record = dict(
        id=transfer["id"],
        accountId=transfer["account"],
        email=transfer["email"],
        revision=transfer["revision"],
        kind="topup" if transfer["purpose"] == "topup" else "direct_pay",
        status=review_status(transfer),
        currency="USD",
        amountCents=transfer["amount_cents"],
        reference=transfer["reference"],
        submittedAt=transfer.get("reported_at") or transfer["created_at"],
    )
    if transfer["purpose"] == "topup":
        record.update(
            pricingVersion="credit-face-value-v1",
            creditAmountCents=transfer["amount_cents"],
            feeAmountCents=0,
        )
    else:
        record.update(pricingVersion="order-total-v1", orderId=transfer["order_reference"])
    return record


def intent_view(transfer):
    """The intent exactly as created, echoing the request so the browser can match it."""
    view = dict(
        confirmed=True,
        accountId=transfer["account"],
        demo=False,
        id=transfer["id"],
        purpose=transfer["purpose"],
        currency="USD",
        amountCents=transfer["amount_cents"],
        idempotencyKey=transfer["idempotency_key"],
        reference=transfer["reference"],
        expiresAt=transfer["expires_at"],
        status=transfer["status"],
    )
    for name, key in (
        ("orderId", "order_id"),
        ("offerId", "offer_id"),
        ("durationHours", "duration_hours"),
        ("purchaseReference", "purchase_reference"),
    ):
        if transfer.get(key) is not None:
            view[name] = transfer[key]
    if transfer["purpose"] == "topup":
        view.update(
            pricingVersion="credit-face-value-v1",
            creditAmountCents=transfer["amount_cents"],
            feeAmountCents=0,
        )
    return view


class Operations:
    def __init__(self, db, vault, public_url="", retention_days=365):
        self.db = db
        self.vault = vault
        self.public_url = public_url.rstrip("/")
        self.retention = timedelta(days=retention_days)
        self.locks = {}

    def lock(self, key):
        return self.locks.setdefault(key, asyncio.Lock())

    async def _get(self, kind, doc_id):
        return await asyncio.to_thread(self.db.get, kind, doc_id)

    async def _list(self, kind, tenant=None):
        return await asyncio.to_thread(self.db.list, kind, tenant)

    async def _save(self, doc):
        """Compare-and-swap at the document's current version; returns the saved copy."""
        saved = dict(doc)
        await asyncio.to_thread(self.db.save, saved, doc["version"])
        return saved  # The store updated its version and timestamps in place.

    # ---------- Buyer KYB ----------

    def case_id(self, user_id):
        return "KYB-" + identity("kyb", user_id)

    async def kyb_case(self, user_id):
        return await self._get(KYB, self.case_id(user_id))

    async def kyb_approved(self, user_id):
        case = await self.kyb_case(user_id)
        return bool(case and case["status"] == "Approved")

    def snapshot(self, user_id, case):
        return dict(
            confirmed=True,
            accountId=user_id,
            demo=False,
            verification=case_view(case) if case else None,
        )

    async def upload(self, user_id, kind, file_name, content_type, data_base64):
        if kind not in DOCUMENT_KINDS:
            raise OperationError(400, "Choose a supporting document category.")
        if content_type not in SIGNATURES:
            raise OperationError(400, "Upload a PDF, PNG or JPEG file.")
        name = str(file_name or "").replace("\\", "/").split("/")[-1].strip()[:200]
        if not name:
            raise OperationError(400, "The file needs a name.")
        try:
            data = base64.b64decode(data_base64, validate=True)
        except (ValueError, TypeError) as exc:
            raise OperationError(400, "The file could not be read.") from exc
        if not data or len(data) > MAX_FILE:
            raise OperationError(400, "Each file must be at most 10 MB.")
        # Browser MIME types are not a boundary: the content must match the declared type.
        if not data.startswith(SIGNATURES[content_type]):
            raise OperationError(400, "The file content does not match its type.")
        try:
            scan = await asyncio.to_thread(self.vault.check, data)
        except Infected as exc:
            raise OperationError(400, "The file failed the malware scan.") from exc
        except StorageUnavailable as exc:
            raise OperationError(
                503, "Document uploads are temporarily unavailable. Please try again later."
            ) from exc
        doc_id = "DOC-" + secrets.token_hex(12)
        relative = f"{hashlib.sha256(user_id.encode()).hexdigest()[:24]}/{doc_id}"
        await asyncio.to_thread(self.vault.write, relative, doc_id, data)
        doc = dict(
            id=doc_id,
            kind=DOCUMENT,
            tenant_id=account_id(user_id),
            account=user_id,
            document_kind=kind,
            file_name=name,
            content_type=content_type,
            size_bytes=len(data),
            sha256=hashlib.sha256(data).hexdigest(),
            path=relative,
            scan=scan,
            created_at=timestamp(),
            version=0,
        )
        await self._save(doc)
        return doc

    async def submit(self, user, company, mode, document_ids, idempotency_key):
        user_id = user["id"]
        company = {k: str(company.get(k) or "").strip() for k in COMPANY_FIELDS}
        country = company["country"].upper()
        company["country"] = country
        if len(country) != 2 or not country.isalpha():
            raise OperationError(400, "Choose the company registration country.")
        if mode != mode_for(country):
            raise OperationError(400, "The verification mode does not match the country.")
        required = BOTH_REQUIRED + (FULL_REQUIRED if mode == "Full" else ())
        if any(not company[k] for k in required):
            raise OperationError(400, "Complete every required company field.")
        if "@" not in company["email"]:
            raise OperationError(400, "Enter a valid company contact email.")
        ids = list(dict.fromkeys(document_ids))
        if not ids or len(ids) > MAX_FILES:
            raise OperationError(400, "Upload between one and 20 files.")
        docs = [await self._get(DOCUMENT, i) for i in ids]
        if any(not d or d["account"] != user_id or d.get("case_revision") for d in docs):
            raise OperationError(400, "A document is missing or was already submitted.")
        if {d["document_kind"] for d in docs} != set(DOCUMENT_KINDS):
            raise OperationError(400, "Upload every required supporting document category.")
        if sum(d["size_bytes"] for d in docs) > MAX_TOTAL:
            raise OperationError(400, "The files must total at most 50 MB.")
        account_email = user.get("email") if isinstance(user.get("email"), str) else ""
        async with self.lock("kyb:" + user_id):
            case = await self.kyb_case(user_id)
            if case and idempotency_key in case.get("submission_keys", {}):
                return case  # A retried submission returns the original case.
            if case and case["status"] != "Rejected":
                raise OperationError(409, "Business verification was already submitted.")
            revision = (case["revision"] if case else 0) + 1
            updated = dict(
                case
                or dict(
                    id=self.case_id(user_id),
                    kind=KYB,
                    tenant_id=account_id(user_id),
                    account=user_id,
                    version=0,
                    submission_keys={},
                    decisions=[],
                    notices=[],
                    emails=[],
                ),
                email=account_email or company["email"],
                mode=mode,
                status="Reviewing",
                revision=revision,
                company=company,
                documents=[
                    {
                        k: d[k]
                        for k in (
                            "id",
                            "document_kind",
                            "file_name",
                            "content_type",
                            "size_bytes",
                            "sha256",
                            "path",
                        )
                    }
                    for d in docs
                ],
                submitted_at=timestamp(),
                reviewed_at=None,
            )
            updated["submission_keys"] = {**updated["submission_keys"], idempotency_key: revision}
            saved = await self._save(updated)
            for d in docs:
                await self._save(dict(d, case_revision=revision))
            return saved

    async def db_get_document(self, document_id):
        return await self._get(DOCUMENT, document_id)

    async def kyb_cases(self):
        cases = await self._list(KYB)
        return sorted(cases, key=lambda c: c["submitted_at"], reverse=True)

    async def kyb_document(self, case_id, document_id, expected_revision):
        case = await self._get(KYB, case_id)
        if not case or case["revision"] != expected_revision:
            raise OperationError(409, "This case changed. Refresh before downloading.")
        doc = next((d for d in case["documents"] if d["id"] == document_id), None)
        if not doc:
            raise OperationError(404, "Document not found.")
        stored = await self._get(DOCUMENT, document_id)
        if not stored or stored.get("deleted_at"):
            raise OperationError(410, "This document was deleted under the retention policy.")
        try:
            data = await asyncio.to_thread(self.vault.read, doc["path"], document_id)
        except (StorageUnavailable, InvalidTag, OSError) as exc:
            raise OperationError(500, "The stored document could not be read.") from exc
        if hashlib.sha256(data).hexdigest() != doc["sha256"]:
            raise OperationError(500, "The stored document failed its integrity check.")
        return doc, data

    async def purge(self, now=None):
        """Delete documents past retention: unsubmitted after a day, decided cases after
        `retention` from the decision. Metadata stays, marked deleted, for the audit trail."""
        now = now or utcnow()
        removed = 0
        for doc in await self._list(DOCUMENT):
            if doc.get("deleted_at"):
                continue
            if not doc.get("case_revision"):
                due = at(doc["created_at"]) + UNSUBMITTED_RETENTION <= now
            else:
                case = await self.kyb_case(doc["account"])
                due = bool(
                    case
                    and case["status"] != "Reviewing"
                    and case.get("reviewed_at")
                    and at(case["reviewed_at"]) + self.retention <= now
                )
            if due:
                await asyncio.to_thread(self.vault.delete, doc["path"])
                try:
                    await self._save(dict(doc, deleted_at=timestamp()))
                except ConflictError:
                    continue
                removed += 1
        return removed

    async def kyb_decide(
        self, case_id, expected_revision, decision, reason, allscale, idempotency_key, operator
    ):
        reason = str(reason or "").strip()
        if decision not in {"Approved", "Rejected"}:
            raise OperationError(400, "Choose Approve or Reject.")
        if decision == "Approved" and allscale is not True:
            raise OperationError(400, "Confirm the external review approved this application.")
        if decision == "Rejected" and not reason:
            raise OperationError(400, "Enter a rejection reason.")
        async with self.lock("kyb-case:" + case_id):
            case = await self._get(KYB, case_id)
            if not case:
                raise OperationError(404, "Case not found.")
            done = next(
                (d for d in case["decisions"] if d["idempotency_key"] == idempotency_key), None
            )
            if done:
                return done["receipt"]
            if case["revision"] != expected_revision or case["status"] != "Reviewing":
                raise OperationError(409, "This case changed. Refresh before deciding.")
            revision = case["revision"] + 1
            if decision == "Approved":
                subject = "Business verification complete"
                message = (
                    "Your business verification is complete. You can now add Credit and "
                    "purchase capacity, including by bank transfer."
                )
            else:
                subject = "Business verification not approved"
                message = f"Your KYB was not approved. Reason: {reason.rstrip('.')}. Please review and resubmit."
            receipt = dict(
                confirmed=True,
                caseId=case_id,
                accountId=case["account"],
                idempotencyKey=idempotency_key,
                status=decision,
                revision=revision,
                notificationQueued=True,
                emailQueued=True,
            )
            updated = dict(
                case,
                status=decision,
                revision=revision,
                reviewed_at=timestamp(),
                decisions=[
                    *case["decisions"],
                    dict(
                        idempotency_key=idempotency_key,
                        decision=decision,
                        reason=reason,
                        external_review_confirmed=allscale is True,
                        operator=operator,
                        at=timestamp(),
                        receipt=receipt,
                    ),
                ],
                notices=[
                    *case["notices"],
                    notice(subject, message, kind="buyer_kyb", kyb_status=decision),
                ],
                emails=[
                    *case["emails"],
                    email(case["email"], subject, message + footer(self.public_url)),
                ],
            )
            try:
                await self._save(updated)
            except ConflictError as exc:
                raise OperationError(409, "This case changed. Refresh before deciding.") from exc
            return receipt

    # ---------- Bank transfers ----------

    async def find_transfer(self, user_id, key):
        identity = (
            "BT-"
            + hashlib.sha256(dump(["transfer", user_id, key]).encode()).hexdigest()[:20].upper()
        )
        doc = await self._get(TRANSFER, identity)
        return doc if doc and doc["account"] == user_id else None

    async def create_transfer(self, user, request, offer=None):
        """Issue (or return) the intent for this request; `offer` is the priced Spot offer."""
        user_id = user["id"]
        key = dump(["transfer", user_id, request["idempotencyKey"]]).encode()
        transfer_id = "BT-" + hashlib.sha256(key).hexdigest()[:20].upper()
        fields = dict(
            purpose=request["purpose"],
            amount_cents=request["amountCents"],
            idempotency_key=request["idempotencyKey"],
            order_id=request.get("orderId"),
            offer_id=request.get("offerId"),
            duration_hours=request.get("durationHours"),
            purchase_reference=request.get("purchaseReference"),
        )
        async with self.lock("transfer:" + transfer_id):
            existing = await self._get(TRANSFER, transfer_id)
            if existing:
                if any(existing.get(k) != v for k, v in fields.items()):
                    raise OperationError(
                        409, "This payment reference was already used.", "IDEMPOTENCY_CONFLICT"
                    )
                return existing
            email_address = user.get("email") if isinstance(user.get("email"), str) else ""
            doc = dict(
                id=transfer_id,
                kind=TRANSFER,
                tenant_id=account_id(user_id),
                account=user_id,
                email=email_address,
                currency="USD",
                reference="ONX-" + secrets.token_hex(4).upper(),
                ssh_public_key=request.get("sshPublicKey") or None,
                offer=offer.raw if offer else None,
                pricing_snapshot=dict(offer.pricing, durationHours=request["durationHours"])
                if offer
                else None,
                hourly_cents=offer.cents if offer else None,
                # The order's RFQ reference: the same derivation as a Credit purchase, with a
                # Direct Pay key, so provisioning retries can never create a second rental.
                order_reference=(
                    order_reference(user_id, direct_pay_key(request["idempotencyKey"]))
                    if request["purpose"] == "order"
                    else None
                ),
                status="Awaiting transfer",
                revision=1,
                created_at=timestamp(),
                expires_at=(utcnow() + timedelta(days=TRANSFER_DAYS)).isoformat(),
                reported_at=None,
                decision=None,
                provisioning=None,
                notices=[],
                emails=[],
                version=0,
                **fields,
            )
            return await self._save(doc)

    async def get_transfer(self, transfer_id):
        return await self._get(TRANSFER, transfer_id)

    async def transfer(self, user_id, transfer_id):
        doc = await self._get(TRANSFER, transfer_id)
        if not doc or doc["account"] != user_id:
            raise OperationError(404, "This payment was not found.")
        return doc

    async def report_sent(self, user_id, transfer_id):
        async with self.lock("transfer:" + transfer_id):
            doc = await self.transfer(user_id, transfer_id)
            if doc["status"] == "Awaiting transfer":
                if at(doc["expires_at"]) <= utcnow():
                    raise OperationError(409, "These payment instructions have expired.")
                doc = await self._save(
                    dict(doc, status="Awaiting payment confirmation", reported_at=timestamp())
                )
            elif doc["status"] != "Awaiting payment confirmation":
                raise OperationError(409, "This payment was already reviewed.")
            return dict(
                confirmed=True, intentId=transfer_id, status="Awaiting payment confirmation"
            )

    async def transfers(self, purpose=None, user_id=None):
        rows = await self._list(TRANSFER, account_id(user_id) if user_id else None)
        rows = [r for r in rows if purpose is None or r["purpose"] == purpose]
        return sorted(rows, key=lambda r: r["created_at"], reverse=True)

    async def decide_payment(self, transfer_id, body, operator):
        decision = body.get("decision")
        reason = str(body.get("reason") or "").strip()
        if decision not in {"Confirm", "Fail"}:
            raise OperationError(400, "Choose Confirm or Fail.")
        if decision == "Confirm" and body.get("fundsVerified") is not True:
            raise OperationError(400, "Confirm that the funds were received.")
        if decision == "Fail" and not reason:
            raise OperationError(400, "Enter a reason before sending the failure notification.")
        key = str(body.get("idempotencyKey") or "")
        if not key:
            raise OperationError(400, "A decision key is required.")
        async with self.lock("transfer:" + transfer_id):
            doc = await self._get(TRANSFER, transfer_id)
            if not doc or doc["account"] != body.get("accountId"):
                raise OperationError(404, "Payment request not found.")
            if doc.get("decision"):
                if doc["decision"]["idempotency_key"] == key:
                    return doc["decision"]["receipt"]
                raise OperationError(409, "This payment was already reviewed.")
            if doc["revision"] != body.get("expectedRevision") or doc["status"] not in PENDING:
                raise OperationError(409, "This payment changed. Refresh before reviewing.")
            topup = doc["purpose"] == "topup"
            confirmed = decision == "Confirm"
            amount = money(doc["amount_cents"])
            if not confirmed:
                subject = "Payment could not be confirmed"
                message = (
                    f"Your payment could not be confirmed. Reason: {reason.rstrip('.')}. "
                    "Please check the details and try again."
                )
            elif topup:
                subject = "Credit top-up complete"
                message = f"Your {amount} Credit top-up is complete. You can now purchase capacity."
            else:
                subject = "Payment complete"
                message = (
                    "Your payment is complete. Our Agent is finding your instance; you do not "
                    "need to keep this page open, and we will email you when it is ready. If "
                    "you did not add an SSH public key at purchase, add one in Instances."
                )
            receipt = dict(
                confirmed=True,
                currency="USD",
                pricingVersion="credit-face-value-v1" if topup else "order-total-v1",
                caseId=transfer_id,
                accountId=doc["account"],
                revision=doc["revision"] + 1,
                idempotencyKey=key,
                status="Confirmed" if confirmed else "Failed",
                notificationQueued=True,
                emailQueued=True,
                amountCents=doc["amount_cents"],
                creditAmountCents=doc["amount_cents"] if confirmed and topup else 0,
                feeAmountCents=0,
                ledgerPosted=confirmed and topup,
                provisioningQueued=confirmed and not topup,
            )
            updated = dict(
                doc,
                status=receipt["status"],
                revision=receipt["revision"],
                decision=dict(
                    idempotency_key=key,
                    decision=decision,
                    reason=reason,
                    operator=operator,
                    at=timestamp(),
                    receipt=receipt,
                ),
                credited_cents=doc["amount_cents"] if confirmed and topup else 0,
                provisioning=dict(state="queued", attempts=0) if confirmed and not topup else None,
                notices=[*doc["notices"], notice(subject, message, kind="payment")],
                emails=[
                    *doc["emails"],
                    *(
                        [email(doc["email"], subject, message + footer(self.public_url))]
                        if doc["email"]
                        else []
                    ),
                ],
            )
            try:
                await self._save(updated)
            except ConflictError as exc:
                raise OperationError(
                    409, "This payment changed. Refresh before reviewing."
                ) from exc
            return receipt

    async def set_provisioning(self, doc, **changes):
        updated = dict(doc, provisioning={**doc["provisioning"], **changes})
        return await self._save(updated)

    async def add_notice(self, doc, subject, message, kind="payment"):
        updated = dict(
            doc,
            notices=[*doc["notices"], notice(subject, message, kind=kind)],
            emails=[
                *doc["emails"],
                *(
                    [email(doc["email"], subject, message + footer(self.public_url))]
                    if doc.get("email")
                    else []
                ),
            ],
        )
        return await self._save(updated)

    # ---------- Credit, notifications and the email outbox ----------

    async def credits(self, user_id):
        """Cents added to the account: confirmed top-ups and held Direct Pay payments."""
        return sum(
            [await self.credits_for_transfer(d) for d in await self.transfers(user_id=user_id)]
        )

    async def credits_for_transfer(self, doc):
        if doc["status"] != "Confirmed":
            return 0
        if doc["purpose"] == "topup":
            return doc.get("credited_cents") or 0
        return (
            doc["amount_cents"] if (doc.get("provisioning") or {}).get("state") in CREDITED else 0
        )

    async def notifications(self, user_id):
        docs = [*await self.transfers(user_id=user_id)]
        case = await self.kyb_case(user_id)
        if case:
            docs.append(case)
        rows = []
        for doc in docs:
            for n in doc.get("notices") or []:
                row = dict(
                    id=n["id"],
                    ownerId=user_id,
                    subject=n["subject"],
                    message=n["message"],
                    created=n["created_at"],
                    createdAt=n["created_at"],
                    read=False,
                    kind=n.get("kind"),
                )
                if n.get("kyb_status"):
                    row["kybStatus"] = n["kyb_status"]
                rows.append(row)
        return rows

    async def outbox(self):
        """`(kind, doc)` for every case or transfer with an email still to send."""
        result = []
        for kind in (KYB, TRANSFER):
            for doc in await self._list(kind):
                if any(e["state"] == "pending" for e in doc.get("emails") or []):
                    result.append((kind, doc))
        return result

    async def email_result(self, kind, doc_id, email_id, sent):
        doc = await self._get(kind, doc_id)
        emails = []
        for e in doc["emails"]:
            if e["id"] == email_id:
                attempts = e["attempts"] + 1
                state = "sent" if sent else ("failed" if attempts >= 5 else "pending")
                e = dict(e, attempts=attempts, state=state, updated_at=timestamp())
            emails.append(e)
        try:
            await self._save(dict(doc, emails=emails))
        except ConflictError:
            pass  # Retried on the next pass; a duplicate send is preferable to a lost one.
