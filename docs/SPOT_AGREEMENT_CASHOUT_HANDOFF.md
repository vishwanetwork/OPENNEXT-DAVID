# Spot agreements and Credit Cashout

Status: frontend and typed capability ports only. No new backend endpoint, ledger,
signature, email delivery or bank payout is implemented here. Legacy, host routing,
the API proxy, wire contracts and deployment configuration are unchanged.

The reviewed [English Word template](legal/spot-rental-agreement-en.docx) and
[autofill mapping](legal/spot-rental-agreement-fields.md) are included with this handoff.

## Checkout and agreement

The flow is: review Spot offer/hours, choose Credit or Direct Pay, review and sign
the agreement, then authorize payment or obtain bank transfer instructions.
Insufficient Credit still leads to Top-up before the purchase can proceed.

`features/agreements` renders eight versioned clauses and commercial terms, with
the order and approved Buyer KYB information. Only signatory name/title and explicit
consents need manual entry. A confirmed server document is required to sign; local
checkboxes never create an executed agreement.

`lib/spot-agreement.ts` defines optional `SpotAgreementService` ports:

| Port                 | Backend responsibility                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prepare`            | Authenticate Buyer; resolve approved KYB, account number and current offer; calculate/freeze retail pricing; return immutable version/hash, legal parties, commercial policies and expiry. |
| `sign`               | Verify signatory authority and express consent; record both parties' execution; return exact document/order/KYB-bound execution receipt. Retry one key with identical payload.             |
| `download`           | Authorize download of the complete document matching ID/hash. No permanent public document URLs.                                                                                           |
| `purchaseByCredit`   | Atomically validate execution, owner, offer, price, duration, KYB revision, expiry and funds; reserve Credit and create one order.                                                         |
| `createBankTransfer` | Apply the same checks and create an agreement-linked payment intent, echoing its agreement ID.                                                                                             |

These are ports, not URLs. Agree backend wire schemas/endpoints, add them to
`packages/contracts`, and implement feature `api.ts` adapters through `useApi()`
before assigning `TerminalServices.spotAgreement` in the composition root.
There is no fallback to an unsigned legacy purchase endpoint. **Do not deploy this
frontend as a working payment flow before that capability and legal/policy approval.**

The signing service must render the same canonical clause version and frozen
commercial fields shown in the UI in the downloadable/executed PDF. The DOCX is an
editable source template, not signature evidence. Store express consent records,
signatory identity/authority evidence, immutable bytes/hash, order/account/KYB
revision, both execution timestamps and signature-provider evidence. Authorize all
downloads; protect personal information; apply approved retention. Reject forged
client receipts even if their shape is valid. Hashes/checkboxes alone are not proof
of completed bilateral execution.

Changed price, duration, configuration, payment method or identity needs a matching
agreement again. Receipts stay in memory, not browser storage. Uncertain payment
retains its key. After reload without a receipt, another payment/signature is
blocked: check order status instead. Add an owner-bound reconciliation read in the
backend; never sign again and accidentally pay twice.

## Activation prerequisites

- Business-owner-supplied metadata: legal entity Bitfintech Group Limited, OpenNEXT
  brand, BVI company number 2180739, Mrs. Shuxian Deng, and the supplied BVI address.
  Prepared documents must match this exact legal entity and registration number.
  Confirm signatory authority and notice email before activation. The supplied name
  is not an independent registry or authorization check. BVI registration does not
  itself select governing law.
- Confirmed duration policy: purchased hours are **cumulative available runtime**.
  Timing starts automatically as soon as a matching instance is provisioned and ready
  for use. Do not wait for SSH setup, a user connection, a workload or GPU utilization.
  Idle but available instances count. Listing discovery alone is not provisioning.
  Payment/signing/initial provisioning do not count; interruptions pause both the
  runtime clock and compute billing. Replacements consume only the remaining hours.
  Completion occurs at the purchased cumulative runtime or earlier user termination,
  not at a fixed calendar deadline after the first ready instance.
- The agent seeks equivalent resources in the agreed country while purchased runtime
  remains and the order has not ended; material changes require consent. Durable matching/provisioning is a
  backend task, not implemented by this UI.
- Data preservation needs managed storage/checkpoints and tested recovery. Disclose
  paths/volumes, checkpoint intervals, recovery limits and post-service retention.
  Do not enable signing on ephemeral disks while promising persistence. Unwritten
  in-memory state is not preserved automatically by a disk snapshot.
- Keep current main retail-markup pricing: whole-instance hourly rate times hours,
  no second GPU-count multiplication and no extra fixed 5% fee. Top-up remains
  1 USD to 1 Credit; preserve historical orders' frozen prices.
- Main currently exposes per-minute usage with a one-hour minimum. Approve how
  minimum/rounding applies to platform-caused interruptions, early release and
  never-ready orders; never silently add another minimum on each replacement.
  Disclose tax treatment and any separately authorized non-compute charges.
- Settle unused paid funds to Credit. Never-fulfilled orders return unconsumed
  payment. Preserve existing paid-purchase continuation and original price; do not
  charge again on redemption or retroactively change existing orders' terms.
- Bank instructions currently name Stable X Limited, not the supplied OpenNEXT
  identity. Confirm and disclose payment collection authority before signing.
- Configure governing law/forum, notice addresses, settlement timing, preservation
  terms and Cashout timing/costs. Obtain legal review of the final version.

Prepared documents require `policies.approved`, `dataPreservationVerified` and
`cashoutEnabled`; unresolved template fields are rejected. These are backend
attestations, not substitutes for the underlying operational and legal checks.

### Cumulative runtime accounting

The agreement version is `opennext-spot-runtime-v2`, with
`policies.serviceWindow: 'cumulative-running-time'`. The property is an internal
capability-port field, not a new HTTP wire format. Prepared or signed v1 agreements
cannot authorize a new v2 purchase. Already-paid historical orders and their signed
documents retain their original policies; never rewrite executed agreements.

Backend lifecycle events must authoritatively open and close available intervals.
Accumulate their non-overlapping duration across replacements, capped at
`durationHours * 3600`; interruption/waiting intervals contribute zero. Duplicate,
late and replayed provider events must not double count. A replacement does not reset
consumed runtime or introduce another minimum charge. Browser timers and GPU
utilization samples are not the source of truth for duration or billing.

For example, a 72-hour order that runs for 20 hours, waits 5 hours for a replacement,
and then runs for 52 hours completes after 77 calendar hours but consumes 72 purchased
hours. Available idle time is included in those 72 hours. Do not use
`firstReadyAt + durationHours` as a hard expiry; any predicted completion time is an
estimate that moves with interruptions. Agreement-signing/offer expiry remains a
separate pre-payment safeguard, not the runtime deadline.

At completion or early termination, close the running interval and settle the ledger
once. Unused paid funds return to Credit under the agreed settlement policy. No
client-side clock, automatic calendar cutoff or backend metering change is introduced
by this frontend handoff. Confirm the backend implementation before activating v2.

## Buyer Cashout

Buyer Billing includes Cashout and masked history. Approved KYB is required. The
form collects amount, locked KYB beneficiary name/address, bank name/country/address,
account number or IBAN, SWIFT/BIC, routing code and optional intermediary details.
Beneficiary must be the same verified business; matching text alone does not prove
bank account ownership.

`lib/cashout.ts` defines `CashoutService.load` and `submit`. Server supplies
`withdrawableCents`, balance/KYB revisions and a durable submission key. Do not derive
withdrawable money from `availableCredit`: exclude promotional, unsettled,
order-held and already Cashout-reserved amounts. Freeze the approved KYB/bank snapshot.

On submit, lock the ledger, authenticate owner, recheck eligible funds/revisions and
reserve atomically. Concurrent purchase/Cashout cannot spend the same money. A
timeout retry, including a dialog/browser restart, must reuse the same key/payload
and return the original result. Encrypt bank details; restrict access; omit them
from logs, analytics, browser storage and ordinary list projections.

Only a confirmed pending request with a verified reservation/advanced revision
shows 'Cashout request submitted', not 'paid'. Backend must validate country-specific
routing, sanctions/AML controls and bank ownership, and disclose transfer costs.
Current UI does not calculate a Cashout fee: it authorizes no additional deduction.

## Console Cashout Requests

`/admin/cashouts` is under Requests. `CashoutAdminService` is intentionally absent
until implemented; production displays Awaiting backend, not fake rows. Private
queries bind to administrator session; full bank details require a separate
authorized read, matching request/account/revision/KYB.

Operations performs the payout externally, checks its bank transfer reference, then
clicks Completed. This button does not send money. Server rechecks pending request,
frozen beneficiary and amount, records reference/operator/time, settles the existing
reservation once, completes the case, and queues Terminal notification and email
in a durable transactional outbox. A retry cannot debit or send another payout.

`complete` echoes exact request/account/amount/currency/reference/key, advanced
revision, `reservationSettled`, `notificationQueued` and `emailQueued`. Queued is
not delivered: retry outbox failures and surface delivery status. UI does not claim
arrival at the recipient bank. Suggested backend copy:

> Your Cashout of USD {amount} has been completed. Transfer reference: {reference}.
> Your receiving bank may take additional time to credit the funds. View Billing
> for your Cashout history.

A future rejection/cancellation workflow must release the hold once and notify
with a reason; do not leave failed funds reserved. That action is not introduced here.

## Integration acceptance tests

1. Unapproved KYB, wrong owner, modified hash/version, expired agreement and
   mismatched price/hours/method cannot sign or pay.
2. Signing/payment timeout retries create one execution and one hold/order,
   including reload and concurrent tabs.
3. First-ready automatically starts cumulative runtime, including idle time without
   SSH or a workload. Interruptions pause runtime and billing; replacement consumes
   remaining hours without another minimum. A 20-hour run, 5-hour outage and 52-hour
   run completes a 72-hour order after 77 calendar hours, not after 72. Replayed and
   overlapping provider events cannot double count. End/no-match settles correctly.
4. Recovery restores disclosed data through repeated failures and runtime completion,
   independently of an open browser.
5. Concurrent purchase/Cashout cannot overspend. Tampered beneficiary/amount/KYB and
   stale revisions fail. Replay is idempotent.
6. Completed requires audited external transfer reference, settles one reservation
   and queues one notification/email. Other users cannot read financial records.
7. Pre-agreement orders, refunds, Top-ups, transfer reporting and paid continuation
   preserve their original commercial terms.
