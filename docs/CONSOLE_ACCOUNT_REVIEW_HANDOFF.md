# Console accounts and review completion

Implementation update: the optional ports described below are now connected through
capability-gated Python adapters. Account summaries/history, KYB ZIP exports and Direct Pay
completion/Terminal redemption have live endpoint contracts in API_CONTRACT.md. The original
handoff below records the frontend boundary at PR #15. Customer bank enrollment remains
unavailable; records display null rather than substituting the platform receiving bank.
AWS completion uses provider quota/price preflight, not a guaranteed stock reservation;
actual allocation failure returns the full receipt to Credit.

Updated 2026-11-01. Frontend implementation and backend handoff. No backend, wire schema,
deployment or local Demo walkthrough is changed by this work.

## Delivery boundary

| Area             | Connected now                                                           | Pending backend capability                                                                              |
| ---------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Payment Requests | Existing private queue and Failed decision with reason                  | Display Account #; original offer binding; replacement Direct Pay completion policy and paid redemption |
| Top-up Requests  | Existing queue, Completed/Failed, verified 1:1 receipt                  | Display Account # and authoritative current customer Credit                                             |
| Buyer KYB        | Existing queue, Completed/Failed and individual original-file downloads | One private ZIP containing submitted form PDF and original files                                        |
| User → Account   | Existing authenticated, paginated user directory                        | Verified account numbers, customer bank details, KYB, current Credit and histories                      |

Payment columns: Order / Payment Amount / Account # / Email / Action.
Top-up columns: Account # / Top-up Amount / Current Credit / Action.
Buyer KYB columns: Email / Company / Country / Download / Action.
The first identifying cell opens the existing details dialog. Failed requires a reason and Submit.
Reasons remain private to the decision and affected user's notification/email, not public tables.

Completed is a UI label. Existing payment decisions remain Confirm/Fail and statuses
Confirmed/Failed; KYB decisions remain Approved/Rejected. Both messaging outboxes must be
acknowledged before showing success. Queued is not delivered; workers need retries and diagnostics.
After completion, refetch authoritative records. Never calculate a user's new balance in React.

## Account enrichment

Route: Console-relative `/users/accounts`, nested under User. Frontend port:
`apps/web/src/lib/console-account.ts`; no new endpoint is called until contracts are agreed.
Use an immutable user identifier for ownership and a backend-assigned stable Account # for display.
Do not derive account numbers from user IDs/email or substitute the platform's receiving bank.

- `summaries({ userIds, signal })` returns confirmed live summaries plus operator session scope
  and as-of time. Each has userId, nullable accountNumber, KYB status, integer-cent current Credit
  and bank account count. Null means unavailable, not zero or unverified.
- `details({ userId, creditCursor, purchaseCursor, signal })` returns the same bound account,
  masked customer bank account information and two independent cursor-paginated histories.
- Credit History contains signed integer-cent top-ups, purchases, refunds and adjustments,
  authoritative balance-after where available, reference, description and timestamp.
- Purchase History contains owned Instance/RFQ orders, model, quantity, total, status and time.

Server enforces operator RBAC, owner binding, private no-store responses, pagination bounds and
audit. Rotate sessionScope on authentication or permission changes. Never return full bank
secrets when masked fields suffice. On denial, discard private cached data; do not show stale
records from the previous operator. A frontend prop is not an authorization boundary.

## KYB package export

Optional port: `BuyerKybAdminService.downloadBundle({ caseId, accountId, expectedRevision })`.
Return a confirmed `BuyerKybBundle` containing matching case/account/revision, safe ZIP filename,
ZIP Blob, submitted form PDF metadata and the complete original-document manifest.
The PDF must reproduce the submitted company fields, country/mode, consent and revision;
it must not incorporate later edits. Include every uploaded original from that revision.

The frontend checks matching metadata, ZIP type/size (maximum 100 MiB), PDF metadata (maximum
20 MiB), and exact original-file manifest. Metadata cannot prove archive contents: the backend
must generate, validate, scan and audit the actual archive. Files stay private with no public
URLs. Check operator access and revision at download time, send no-store/attachment headers,
and expire any private download token. Browser object URLs are temporary and revoked.
Without the capability, Download is disabled with an explanation; company details still provide
the existing form view and individual private-file downloads. No empty/example PDF is generated.

## Direct Pay replacement policy

The existing Confirm adapter queues provisioning automatically. Do not connect it to the new
Completed button. `PaymentReviewService.completeDirectPay` is a separate optional capability,
currently absent in route composition. The button is disabled until that capability and a
server-confirmed original `offerId` are present. Failed remains available via the existing API.

Backend transaction/outbox requirements:

1. Authenticate the operator; lock the pending receipt, owner and order. Validate expected
   revision, idempotency key, bank amount/currency/reference and immutable priced order.
2. Recheck the exact original offer with its provider at completion time. A stale catalog row
   is not proof of stock. Record the authoritative availability check timestamp.
3. If unavailable, atomically add the **entire verified payment** to Credit once. For example,
   a $105 Direct Pay receipt becomes $105 Credit, including its original purchase fee. No new
   conversion/top-up fee. Close the payment and cancel any claim to that paid purchase.
4. If available, issue an owner-bound single-use paid purchase intent and notify the user to
   continue the original purchase. Do not allocate yet, post Credit, or debit Credit again.
5. Atomically persist the decision, audit and notification/email outbox entries. Retries must
   return the original receipt. Never both credit and redeem the same payment.

New receipt extension (`directPayResolution` in the frontend port):

- `policy: 'recheck-before-purchase-v1'`, matching orderId and offerId, checked-at timestamp.
- `outcome: 'credited'`: exact full creditAmountCents, ledgerPosted true, no purchaseIntentId.
- `outcome: 'awaiting_customer_order'`: nonempty purchaseIntentId, zero credit, ledgerPosted false.
- Both: zero additional fee, provisioningQueued false, next revision, matching request key,
  notificationQueued true and emailQueued true.

Paid redemption needs a **new agreed backend operation and Terminal resume adapter**. The
current `/api/marketplace/spot-purchases` endpoint charges Credit and must not be reused as-is.
Redemption must check owner, KYB, intent consumption, offer identity/availability and unchanged
terms again, then enqueue one durable order without another charge. Resolve stock loss between
notification and redemption with the same full-credit policy. Handle concurrent Credit checkout,
late receipts, duplicate bank transfers, short/overpayment, expiry and refund reconciliation.
Never allow both a refund/credit and an instance for the same receipt.

Notification/email content (server-generated safe owner-checked destinations):

- Available: “Your payment is complete. Continue your original purchase without paying again.”
- Unavailable: “The selected capacity is no longer available. Your full payment of {amount}
  has been added to your Credit. Please select another instance.”
- Top-up completed: “Your {amount} Credit top-up is complete. You can now purchase capacity.”
- Failed: “Your payment could not be confirmed. Reason: {reason}. Please check the details
  and try again.” Use top-up-specific wording for a top-up failure.
- KYB: OpenNEXT-branded approved/rejected messages with private reason and safe next step.

## Required backend acceptance tests

Test owner/RBAC/session revocation; stale revisions; duplicate/uncertain decisions; full receipt
conversion; competing purchases; lost stock at redemption; no double debit/refund/provisioning;
1:1 top-ups; real balance refetch; PDF/original manifest equality; private download audit; and both
messaging outboxes including delivery failure/retry. Frontend fixture tests do not prove backend
reconciliation, bank receipt, archive contents or email delivery.

## Changed files

Validation: 477 frontend tests verified across the full sandbox run and a separate authorized
rerun of the five localhost API-proxy tests; 10 contract tests and 668 unchanged legacy tests
passed. The initial sandbox run could not reach its local proxy test server. TypeScript,
production build and changed-file formatting passed; full lint has zero errors and three
pre-existing file-length warnings. Four production-built Console pages were checked in a
browser with intercepted test responses, including two simulated review submissions and no
real writes. This does not verify real bank reconciliation, bundle export or email delivery.

Paths below are relative to the repository root. No changes to `legacy/`, API wire schemas,
deployment, host routing or the separate local Demo checkout are included.

| Directory                                   | Files                                                                                                                                                                             |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/app/admin/users/accounts/`    | `page.tsx`                                                                                                                                                                        |
| `apps/web/src/features/console-accounts/`   | `account-details.tsx`, `account-table.tsx`, `accounts.css`, `accounts.test.tsx`, `hooks.ts`, `index.ts`, `page.tsx`, `session.test.tsx`, `validation.ts`                          |
| `apps/web/src/features/console-buyer-kyb/`  | `bundle-download.tsx`, `bundle-download.test.tsx`, `buyer-kyb.css`, `decision.tsx`, `details.tsx`, `page.tsx`, `review.test.tsx`, `session.test.tsx`                              |
| `apps/web/src/features/console-operations/` | `routes.tsx`, `session-gates.test.tsx`                                                                                                                                            |
| `apps/web/src/features/console-payments/`   | `access.test.tsx`, `completion.test.tsx`, `decision-dialog.tsx`, `page.tsx`, `payment-review.css`, `request-details.tsx`, `request-table.tsx`, `review.test.tsx`, `validation.ts` |
| `apps/web/src/features/console-topups/`     | `topups.test.tsx`                                                                                                                                                                 |
| `apps/web/src/features/console/`            | `components/sidebar.tsx`, `console.test.tsx`, `index.ts`, `live-hooks.ts`, `pages.ts`                                                                                             |
| `apps/web/src/lib/`                         | `buyer-kyb.ts`, `console-account.ts`, `payment-review.ts`                                                                                                                         |
| `apps/web/src/test/`                        | `console-account-fixture.ts`, `payment-review-fixture.ts`                                                                                                                         |
| `docs/`                                     | `API_CONTRACT.md`, `ARCHITECTURE.md`, `BUYER_KYB_HANDOFF.md`, `PAYMENT_OPERATIONS_HANDOFF.md`, `CONSOLE_ACCOUNT_REVIEW_HANDOFF.md`                                                |
