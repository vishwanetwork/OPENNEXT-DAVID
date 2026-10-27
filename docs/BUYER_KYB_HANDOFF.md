# Buyer KYB and bank transfer — backend handoff

Updated 2026-10-28. **Frontend-only implementation; no live adapters or new wire contracts.**
The product owner approved frontend + interface handoff, not changes to `legacy/`.

## Implemented frontend

- Buyer Profile KYB entry; country-led Auto / Full form with five document categories.
- KYB gates for top-up, Spot Credit / Direct Pay and quote acceptance; fresh approval checks
  before mutations. Supplier approval never substitutes for Buyer KYB.
- Bank transfer is the only newly offered payment method; old provider checkout is disabled.
- Shared bank instructions, amount/reference/expiry, and “I have made the transfer” flow.
- Console `/admin/kyb` Buyer queue; `?tab=supplier` retains the supplier queue and deep links.
- Private file download; Approve requires ALLScale confirmation; Reject requires a private reason.
- Allowlisted approval/rejection notification shortcuts; reopening always rechecks KYB.
- Public-facing forms, review states and notification templates must use OpenNEXT branding;
  ALLScale is an internal operations/review integration detail, not a customer-facing label.
  Consent covers OpenNEXT and authorized verification partners. The Demo exploration warning
  is omitted from the KYB UI; Demo isolation and disabled uploads/submission remain unchanged.

Composition supplies no `buyerKyb` / `bankTransfer` service, and the Console route supplies no
Buyer review service. Upload, submission, review and payment therefore fail closed. No fake
requests, approvals, notifications, balances or payment confirmations are generated. Demo accepts
no genuine files and shows no actionable banking instructions. Inputs/files remain in memory only.

## Source requirements

Inputs: supplied `allscale-kyb-guide-auto.pdf`, `allscale-kyb-guide-full.pdf`, country screenshot
and bank screenshot. These are product requirements, not an independent legal eligibility check.
Confirm current requirements and mapping with ALLScale before launch.

Auto codes: **CN IN JP NZ SG TW TH VN HK ID MY PH KR AU** (all three screenshot tiers).
Other valid ISO countries/territories use Full. Selection is company registration country,
not IP location or personal residence.

Both: company name, registration number, CEO/contact email, optional website, tax ID, monthly
USD volume, monthly transaction count, business description. Full adds incorporation date,
legal form, registered/operating address and phone. Hong Kong registration/tax-ID examples are
help text, not global validation rules.

Five required categories:

1. Legal presence: incorporation certificate; Full accepts applicable Trust/Foundation documents.
2. Ownership: Hong Kong Auto NNC1; otherwise signed and dated ownership chart, shareholder names
   and percentages, director/UBO signature.
3. Address: evidence within three months in the company name (bank statement, lease, utility,
   internet/property bill). Fully remote businesses may use director/UBO residential proof.
   Bank balances may be redacted as described by the guides.
4. Company details: articles/memorandum/bylaws as applicable.
5. Representative authorization: official ALLScale Letter of Authorization, obtained from
   ALLScale/business development. No authorization template has been invented.

UI limits are product defaults, not ALLScale-provided limits: PDF/PNG/JPEG, 10 MiB/file,
50 MiB combined. Backend must agree/publish limits, validate content signatures and malware-scan;
browser MIME checks are not a security boundary.

## Proposed interfaces — not currently deployed endpoints

Frontend types: `apps/web/src/lib/buyer-kyb.ts`. Agree schemas with the backend team before
implementing adapters using the shared API client and versioned contracts.

| Proposed endpoint                                         | Responsibility                                                                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/buyer-kyb/me`                                   | Confirmed owner-bound status and company/document metadata.                                                                |
| `POST /api/buyer-kyb/documents`                           | Private authenticated upload, category/limits, quarantine and malware scan.                                                |
| `POST /api/buyer-kyb/submissions`                         | Idempotently bind company, mode, consent and scanned document IDs; return Reviewing case/revision.                         |
| `GET /api/admin/buyer-kyb`                                | Authenticated queue, filtering/pagination; no public URLs or rejection reason.                                             |
| `GET /api/admin/buyer-kyb/:caseId/documents/:documentId`  | Authorized and audited download, revision check, attachment disposition, no-store.                                         |
| `POST /api/admin/buyer-kyb/:caseId/decision`              | Expected revision/idempotency, ALLScale-confirmed approval or reason-required rejection, atomic owner notification outbox. |
| `POST /api/billing/bank-transfer-intents`                 | Recheck KYB/ownership/pricing; issue immutable amount/reference/expiry and approved bank-instruction version.              |
| `POST /api/billing/bank-transfer-intents/:id/report-sent` | Record user report; return Awaiting payment confirmation, never paid.                                                      |
| `GET /api/admin/payment-requests`                         | Incoming transfer review, linked top-up/order and audit metadata.                                                          |
| `POST /api/admin/payment-requests/:id/decision`           | Verify actual receipt, currency/amount/reference; atomic idempotent accounting and notification.                           |

The current API client is JSON-only; secure FormData/binary transport needs coordinated work.
Do not bypass it with raw fetch, change CSRF/host forwarding, call seller KYB for buyers, or label
bank transfers as `credit_card` to fit existing contracts. Demo must never reach these live APIs.

## Privacy and state rules

- `BuyerKybService`: load/submit. Only confirmed matching account/scope responses unlock gates.
- `BuyerKybAdminService`: list/download/decide and required non-secret `sessionScope` unique to
  the authenticated operator session. Change scope on logout/login/permissions/identity changes.
  Scope or service replacement remounts private UI, cancels requests and purges old cache.
- `BankTransferService`: create/reportSent. Integer USD cents; hours allow 0.01-hour precision.
  Owner, purpose, amount, reference and expiry are checked; no optimistic balance mutations.
- Server must enforce authorization independently. Files must be private, encrypted, scanned,
  auditable and subject to agreed retention/deletion rules. No PII/files/approval/credit in browser
  persistent storage, logs, analytics or URL query strings.
- Operations manually downloads and delivers files to ALLScale via an approved channel. No
  automatic email or external file sharing is implemented.
- Rejection reason appears only in the private rejection dialog and recipient notification,
  not the queue, details page or error diagnostics.

KYB flow: not submitted → Reviewing → Approved / Rejected; resubmit creates a revision. Reject
stale concurrent decisions. UI review success requires correct case ID, next revision, decision
and `notificationQueued: true`. Store the operator, ALLScale evidence and time in the audit trail.

Notification proposal on the existing owner-scoped feed: `kind: "buyer_kyb"`,
`kybStatus: "Approved" | "Rejected"`, subject/message/time/ownerId. UI ignores arbitrary URLs.
Approval: “Your KYB has been approved. You can now continue with a bank transfer.”
Rejection: “Your KYB was not approved. Reason: {review reason}. Please review and resubmit.”
Customer-facing notification text and operator-entered reasons must use OpenNEXT branding;
keep external reviewer identifiers in the internal audit record, not the recipient message.
Agree wire schema additions with backend; these fields are not an active notification integration.
Clicking a notice is navigation, not proof of approval.

Bank top-up records must preserve the existing owner-scoped billing request and purchase reference
so an approved receipt can restore the pending purchase. New intents must be resumable from the
server after reload. “Transfer reported”, “KYB approved” and “funds received” are distinct states.

## Bank instructions / money handling

The UI reproduces the user-supplied beneficiary: Stable X Limited; SINGAPORE GULF BANK B.S.C.
CLOSED; Bahrain; USD; account `79211900001010`; SWIFT `SGBDBHB2XXX`; IBAN
`BH10SGBD79211900001010`; UNIT 2901, BUILDING 1B, ISA AL-KABEER AVENUE 365, BLOCK 316, MANAMA,
BAHRAIN. Optional correspondent JPMORGAN CHASE BANK N.A. / `CHASUS33XXX`, only if requested by
the remitting bank. **These display values are not independently verified.** Before live activation,
operations must verify beneficiary authorization and move/version authoritative instructions in
backend configuration. Never trust browser beneficiary details or user-reported receipt as payment.

Enforce approved Buyer KYB server-side on every top-up, Credit purchase, quote acceptance and
bank payment endpoint. UI gates alone cannot provide enforcement against direct API calls.
Order subtotal = node hourly rate × hours; aggregate fee = 5% of subtotal rounded to cents;
total = subtotal + fee. Recompute prices/inventory server-side; changes require renewed consent.

Bank transfers are asynchronous. Agree Spot inventory hold/expiry, late/short/overpayment,
duplicates, refunds and reconciliation before enabling live orders. Cross-method idempotency must
prevent Credit plus a late bank arrival from paying/provisioning the same purchase twice.
Only verified receipt may post the ledger, solve the case and enqueue notification atomically.
Automated bank reconciliation is deferred; a user's transfer report cannot authorize a top-up.

## Backend activation checklist

- Approved schemas/transport; contract, RBAC, CSRF and Demo-isolation tests.
- Private document ownership, scanning, retention, export audit and download tests.
- Auto/Full mapping, concurrent review, rejection/resubmit, outbox delivery tested.
- Fresh KYB enforced server-side, including revoked approval and expired sessions.
- Bank instructions verified/versioned; exact cents, reference, expiry and cross-method idempotency.
- Account/operator switching and uncertain responses never expose another user's data or create credit.
- Overview includes authoritative Buyer KYB pending count and review audit events. Until connected,
  the count remains unavailable, rather than displaying the unrelated supplier-review total.
