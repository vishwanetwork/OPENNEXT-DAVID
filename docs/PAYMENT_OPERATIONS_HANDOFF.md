# Payment operations and instance usage

Updated 2026-11-01. Existing review adapters plus proposed backend extensions.
`legacy/` and existing wire schemas are unchanged. No live mail sender, bank reconciliation,
Credit ledger writer, or provisioning worker has been added to the frontend.

## Product rules

The latest product clarification supersedes the earlier $105 transfer / $100 Credit example:

- Top-up is 1:1. $100 transferred means $100 Credit. Do not add or deduct a top-up fee.
- Purchase subtotal is the hourly offer price multiplied by the selected duration. Apply the
  tentative 5% purchase fee once to that subtotal, rounded to integer cents.
- A Credit purchase debits that full purchase total. Insufficient Credit returns to Add credit.
- Direct Pay transfers that full purchase total. Confirmation must recheck the original offer:
  if unavailable, credit the entire received amount; otherwise invite the customer to complete
  that already-paid purchase. Confirmation alone must not provision or charge Credit again.
- The final commercial fee rate and whether it is itemized or included in displayed prices
  are not finalized. Current UI continues to itemize 5%; do not introduce a hidden uplift.
- Changing fee policy requires a new pricing version and renewed customer consent. Never
  reinterpret historical amount-only records as fee-inclusive totals.

`src/lib/topup-pricing.ts` describes the `credit-face-value-v1` basis:
`amountCents === creditAmountCents`, `feeAmountCents === 0`, currency USD.
Bank transfer creation requests and responses must preserve and validate that basis.
Each receipt also echoes its creation idempotency key and the linked order or priced offer/duration.
Equal prices alone do not prove that a transfer belongs to the selected purchase.
The browser does not calculate Credit from a user-reported gross payment or post a ledger entry.

## Buyer KYB

The one-time welcome prompt is set only after a confirmed first Buyer onboarding response.
Skip for now allows browsing, not checkout. Profile, Buy Now and Add credit retain KYB entry points.
All five Supporting documents categories must pass client validation before consent is enabled.
Removing, replacing or invalidating documents clears consent; switching country resets documents.
Backend validation must independently verify document ownership, scanning, consent and eligibility.

The help link opens the existing Contact Us dialog. A successful submission is only Reviewing:
"Your KYB has been submitted. Your submission is pending team review. We will notify you when
the review is complete." Approval is a separate operations decision.

KYB review must atomically append the decision and notification/email outbox records. The frontend
accepts only the matching account, case, next revision and idempotency key with both outbox flags.
`emailQueued` means queued, not delivered. Retries of uncertain responses must return the original
decision receipt, not apply the decision again. Mail delivery failures need retry/dead-letter handling.

## Operations payment queue

Frontend port: `src/lib/payment-review.ts`, consumed by `features/console-payments`.
`features/console-operations/routes.tsx` supplies the existing review adapter after a confirmed
operator session. Both queues fail closed if that service is unavailable; they do not fall back
to the legacy top-up approval endpoint. Top-up completion and both failure decisions retain the
existing decision API and require owner/revision/idempotency and both messaging acknowledgments.
Direct Pay completion is separately gated by the optional `completeDirectPay` capability, which
is deliberately not connected to the old auto-provisioning endpoint. Its replacement policy and
the additional account fields are specified in [the current handoff](CONSOLE_ACCOUNT_REVIEW_HANDOFF.md).

Existing adapter operations; new Direct Pay completion semantics require backend agreement:

| Operation                                                | Required semantics                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/admin/payment-requests?kind=topup\|direct_pay` | Authenticated operator-scoped records with owner, email, purpose, amount, pricing version, reference, submission timestamp, status and revision. |
| `POST /api/admin/payment-requests/:id/decision`          | Owner/case/expected revision/idempotency key, Confirm or Fail, receipt-verification evidence and private failure reason.                         |
| `GET /api/billing/bank-transfer-intents/:id`             | Owner-bound resumable state after reload, including linked purchase and authoritative payment status.                                            |

The service has an opaque non-secret `sessionScope` rotated on operator login, logout or permission
change. Replacing scope/service remounts private views, cancels reads and removes old scoped cache.
Backend RBAC is mandatory; a React prop is not authorization.

For a top-up, the positive action is Completed. Operations must confirm the actual received amount,
currency and payment reference. Confirm performs one atomic transaction:

1. Lock the pending case and validate revision, bank evidence and pricing basis.
2. Credit the full receipt amount once; mark the case Confirmed/solved.
3. Create notification and email outbox entries for that owner, with the Credit amount.
4. Return a receipt matching the owner, case, next revision, idempotency key, currency, pricing version and exact cents,
   `ledgerPosted: true`, `notificationQueued: true`, `emailQueued: true`.

For Direct Pay, the positive action is Completed. Use the same locking/receipt verification,
then atomically record either full payment-to-Credit conversion or a single-use paid purchase
intent after an authoritative offer recheck. Both outcomes require `provisioningQueued: false`.
Only the customer's subsequent owner-checked redemption can start provisioning; that redemption
must recheck availability again and must not use the ordinary Credit-debit purchase endpoint.

Failed opens a required-reason dialog. Submit commits Failed plus the reason and both owner outboxes.
Do not add Credit or enqueue provisioning. Keep the reason out of public queues and browser logs;
send it to the affected user in the private notification and email. Do not silently retry a failed
payment as a new transfer; ask the customer to verify the reason and start an intentional retry.

## Durable provisioning and messaging

After the customer completes a paid purchase, the Agent runs on the backend, independent of browser lifetime. Refreshing, closing a tab,
signing out, or switching accounts must not cancel a paid provisioning job.

- Persist the paid order, exact model/capacity/region/specification, purchased duration and
  authorized maximum cost before searching. Store only the approved public SSH key.
- Do not silently buy a more expensive or mismatched instance. Define price-expiry, hold,
  unavailable-capacity, timeout, refund and cancellation policies before launch.
- On allocation, bind the provider instance to the order/owner, register lifecycle events and
  add it to the existing owned Instances feed. Queue instance-ready notification and email once.
- On provider interruption, stop metered billing at the authoritative interruption time,
  move to Reconnecting and search for the agreed equivalent specification.
- Reconnection resumes usage and billing from the authoritative reconnect time. Do not bill
  disconnected intervals. Never infer these times from a browser refresh or utilization of 0%.
- Storage persistence is a backend/provider guarantee. Set `retainedDataConfirmed` only after
  confirming that the workload's files/storage will survive replacement; never promise this
  solely because the GPU model matches. Define failure/recovery handling when retention fails.

Suggested owner-only notification/email copy (safe in-app routes, no arbitrary external URLs):

| Event                | Message                                                                                                                                    | Destination                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| KYB approved         | Your business verification is complete. You can now continue with a bank transfer.                                                         | KYB status / retained payment flow |
| Top-up confirmed     | Your {amount} Credit top-up is complete. You can now purchase capacity.                                                                    | Billing / retained purchase        |
| Payment confirmed    | Your payment is complete. The selected capacity is still available. Continue your original purchase without paying again.                  | Owner-bound paid purchase          |
| Capacity unavailable | The selected capacity is no longer available. Your full payment of {amount} has been added to your Credit. Please select another instance. | GPU Market / Billing               |
| Instance ready       | Your instance has been purchased successfully and is ready to use.                                                                         | Owned instance                     |
| Payment failed       | Your payment could not be confirmed. Reason: {operator reason}. Please check the details and try again.                                    | Payment history                    |

Do not put private KYB files, bank evidence or credentials in email. Require server-generated,
owner-checked destinations. Track sent/delivered/failed states separately from queue acceptance.

## Instance timeline and billing

Frontend port: `src/lib/instance-usage.ts` via `TerminalServices.instanceUsage`.
The existing adapter calls `GET /api/marketplace/instances/:id/usage`, with authenticated owner
checks. This Console change does not alter that adapter or its backend behavior.

The read snapshot contains matching account/instance/environment, explicit purchased hours,
observed/window timestamps, connected/interrupted intervals, utilization values (nullable),
lifecycle events, retention confirmation and an optional authoritative hourly billing ledger.
All timestamps include timezone. Missing telemetry is unavailable, not zero usage; disconnected
time must remain visually distinct from connected 0% GPU utilization.

Billing entries provide start/end, billable seconds and integer compute/fee/total cents. The UI
displays those values; it never multiplies chart bars or the current market rate into a charge.
Backend must define partial-hour rounding, allocation start/end, prepaid-vs-metered reconciliation,
fee allocation, maximum purchased duration and unused-credit/refund rules before activation.
Ensure one purchase fee is not accidentally charged again in hourly ledger entries.

History lists non-user interruption and reconnection events as additional explanation. Instances
group into Running / Reconnecting / End; unknown states remain explicitly unclassified.
Durations come from confirmed purchase data, not inferred from current expiry. Cloud zone codes
are normalized to countries; unknown countries are not presented as known locations.

## Release scope and validation

New local KYB, bank-transfer and instance-usage demonstration walkthroughs are excluded from this
production release. The existing public Demo baseline remains unchanged. Synthetic usage records
are test-only fixtures and are never imported by runtime components. Missing live ports continue
to show unavailable states; simulated approval cannot unlock live KYB or payment gates.

Activation tests must cover authorization, revocation, stale revision, replayed/uncertain decisions,
duplicate transfers, incorrect amounts/currency, mismatched owner, session changes during requests,
outbox failures, closed-browser provisioning, interruption billing gaps, storage retention and
exact-cent purchase reconciliation. UI tests do not replace these backend integration checks.
