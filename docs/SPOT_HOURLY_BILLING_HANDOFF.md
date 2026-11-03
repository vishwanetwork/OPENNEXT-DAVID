# Floating Spot settlement and funding alerts

Status: frontend views and proposed read-only ports; **not an activated billing contract**.
Product clarification: 2026-11-03. Backend owner: SpotOrderBot.

## Confirmed product rules

1. The first payment uses the accepted purchase-time retail rate and requested runtime.
   It funds the order; it does not guarantee a fixed rate for its entire runtime.
2. Subsequent billable usage settles at the effective Spot retail rate for that period.
   Preserve every effective rate and charge in the instance ledger and expose the same
   ledger in Billing. Never apply today's catalog rate retrospectively.
3. Notify when remaining order funding reaches **20%**, not 80%. Direct Pay uses the
   order's dedicated funded balance. Credit orders require both an order funding view
   and an aggregate account warning covering concurrent Credit-funded orders.
4. Crossing 20% is a warning, not a pause. Continue while funding is sufficient.
   If the next billable hour cannot be funded, pause the affected allocation, preserve
   data, and resume the remaining cumulative runtime after confirmed funding and safe
   backend recovery. Do not mark a funding pause as provider reconnection or completion.
5. Runtime starts when the delivered instance is ready, even if the user has not connected.
   Available but idle runtime counts. Provider interruptions and funding pauses do not
   consume cumulative purchased runtime or incur compute charges.
6. Top-up remains face value: a verified USD 100 payment adds USD 100 Credit. No top-up
   percentage or second purchase fee is introduced by this change.

## Activation and existing orders

Current `duration-v1` purchases and paid Direct Pay intents have immutable price snapshots.
The existing API does not authorize runtime repricing or extra debits. **Do not reinterpret
these historical orders.** Any migration requires an explicit replacement agreement and
recorded customer consent, not a silent frontend label change.

Proposed `spot-hourly-v1` must be implemented and negotiated with the backend before wiring
the optional `TerminalServices.spotFunding` read adapter. Production currently leaves it
undefined. New UI reads are unavailable until then. No guessed API URLs or modified live
purchase payloads are included in this frontend change.

The new purchase handshake must return and bind an immutable authorization including the
initial rate/payment, currency, whole-instance rate basis, requested cumulative runtime,
retail markup policy, funding source, variable-price disclosure, customer-approved price or
spend guardrails, policy version, consent timestamp and idempotency key. Backend and product
must agree these guardrails before enabling automatic higher-price procurement. A pricing
notice alone is not consent and does not authorize uncapped additional payment.

The current Console markup policy changes NEW quotes, not accepted purchases. For the new
floating version, preserve the accepted markup policy while applying effective provider cost
changes. Do not silently change the customer's markup as well. No additional fixed fee is
added. Model inference/storage components must retain their own accepted units and effective
price records; do not substitute GPU market history for an inference/storage bill.

## Funding model and 20% denominator

The browser displays server-issued amounts and warnings. It does not allocate shared Credit,
decide which instance receives money, debit balances or emit notifications.

- **Direct Pay order:** maintain a dedicated pot funded by confirmed bank receipts assigned
  to that order. Remaining funds equal credited receipts minus settled charges and committed
  charges not yet posted. Do not count pending or user-reported transfers.
- **Credit order:** keep an auditable earmarked funding allocation and an atomically assigned
  share of usable Credit. Its projected coverage must not assume the same free dollars are
  simultaneously available to every running order. An existing prepaid hold is not a second
  debit when hourly settlement starts.
- **Credit account:** aggregate every active Credit-funded order, including records outside
  the displayed page. Count unspent earmarked funds and usable unallocated Credit once only;
  exclude dedicated Direct Pay pots, pending receipts, cashout holds and ineligible funds.
  Do not use the raw available-wallet number if it already excludes refundable usage holds.
- **Funding cycle baseline:** use the confirmed funding available at cycle start. A verified
  replenishment creates a new server-owned cycle whose baseline is remaining confirmed funds
  plus the new funds. This makes the 20% denominator explicit and prevents a rate change or
  page refresh from silently resetting it. The adapter must document this normalization in
  its final contract and return `cycleId`, `baselineCents`, `remainingCents`, `remainingPercent`.
- Warn at or below 20%, once per account/order funding cycle. Check again after every
  settlement, price update, reservation change and confirmed replenishment. A projected
  shortfall can be warned earlier even while more than 20% of the cycle remains.
- An account-wide alert and an order alert are different scopes. Deduplicate repeated
  events, combine affected orders where practical, and do not show an old low-funds alert as
  a new event on every hourly poll. Clear/rearm only after confirmed funding recovery.

Examples: a Direct Pay pot funded with USD 100 warns at USD 20 and continues while the next
hour fits. Two Credit orders must share one account pool, not each claim its whole balance.
If that pool has USD 10 and their next hours require USD 8 and USD 7, the backend cannot admit
both. A deterministic documented scheduling policy must admit/pause orders atomically; the
frontend must not choose winners. A USD 15 top-up is not usable until payment is confirmed.

## Settlement and pause/resume worker

1. Persist confirmed payment/funding, purchase policy and requested runtime durably. Separate
   funded/held money from earned/settled revenue and preserve promotional/non-withdrawable
   provenance. Bank confirmation, existing paid-redemption checks and KYB remain mandatory.
2. Before admitting the next usage period, obtain a trustworthy allocation-specific price
   with an effective timestamp. A public catalog observation is not proof of the actual
   running allocation's price. Unknown/stale prices must not produce fabricated charges.
3. Compute the next period funding requirement server-side, considering remaining runtime,
   the confirmed rate, authorized price limits and every concurrent reservation. Reserve
   atomically before admission. If funding is insufficient, pause before uncovered compute
   accrues; do not wait for the customer's browser to poll or balance to become negative.
4. When a provider rate changes within a clock hour, retain its effective subintervals.
   Display those subintervals under their hour; never bill an entire hour at a later price.
   Use UTC, exact decimal arithmetic/integer minor units and a documented rounding policy.
   Preserve posted entries; corrections are auditable adjustment entries, not overwritten rates.
5. The existing service has a one-hour minimum per order and minute settlement thereafter.
   Explicitly agree the new version's minimum before activation. Never introduce another
   minimum on each reconnect or top-up. Include any minimum/rounding adjustment with its
   explanation, separate from the actual hourly rate. The UI cannot infer a rate by dividing
   charge by running seconds because minimum adjustments make that quotient misleading.
6. Pause compute and cumulative runtime on both provider interruption and insufficient funds.
   Record separate reasons. Preserve storage before releasing the compute allocation. Storage
   retention, its duration/cost, encryption, quota and recovery failure handling must be agreed
   and funded independently before promising indefinite retention. Expose `retention=confirmed`
   only after durable storage is verified; pending/unavailable must remain honest in the UI.
7. Confirmed replenishment triggers a durable resume evaluation, not instant browser-led
   provisioning. Revalidate owner, KYB, funds, current authorized price, equivalent specs,
   retained data and remaining cumulative seconds. Resume once; do not reset the duration.
   Preserve the pause state while restoration/provisioning is still pending.
8. Closing tabs, logging out, worker restart or duplicate webhooks must not skip billing,
   cancel an order, double debit, reset runtime, repeat a payment or issue duplicate notifications.

Do not show a projected wall-clock end as authoritative completion for cumulative-runtime
orders. The new instance UI uses the validated runtime state and remaining seconds from the
funding snapshot. Existing fixed-version lifecycle behavior is retained when that snapshot
is absent. Floating-order resale remains disabled until a compatible backend policy exists.

## Frontend port and read views

`apps/web/src/lib/spot-funding.ts` is a **frontend view-model proposal**, not a new contract in
`packages/contracts`. The future adapter must use `useApi()` and approved contract schemas;
it belongs in the Terminal composition root, not in a Next.js business API handler.

`SpotFundingService` has an opaque, non-secret authorization `scope` and:

- `loadAccount({signal})`: confirmed owner/environment/version/UTC `observedAt`, USD currency,
  complete account funding aggregate, count of all active Credit orders, order summaries and
  explicit `ordersComplete`. Partial summary rows never define the account totals.
- `loadOrder({orderId | instanceId, cursor?, signal})`: matching owner/order/instance/environment,
  immutable initial payment and rate, current confirmed rate (nullable), purchased/remaining
  cumulative seconds, authoritative runtime state and retention confirmation. Ledger pages
  contain a global posted total, entries, opaque next cursor and explicit completeness.

Each funding position contains its cycle/baseline/remaining amount, server-issued percentage,
next-hour required amount, estimated cost to finish remaining runtime, status and explicit
warning reasons (`remaining_20_percent`, `projected_shortfall`, `next_hour_unfunded`).
Estimated completion cost is not a fixed final bill. Null is unavailable, never zero/free.

Hourly entries carry stable settlement IDs, UTC effective start/end, billable seconds,
whole-instance retail cents/hour, compute cents, signed adjustment cents, total cents and an
adjustment explanation. The same IDs and amounts must feed both Instances and Billing.
The frontend rejects wrong owners/environments, duplicate/overlapping periods, unsafe amounts,
inconsistent totals and runtime exceeding the purchased allowance. It never reconstructs
prices from utilization bars or current market listings.

The proposed hourly view permits signed adjustments within a nonnegative usage charge, not
standalone negative refunds or overlapping correction periods. Such transactions must remain
in the account Credit ledger with references to the original settlement, or receive an agreed
versioned correction representation before activation. Never fabricate usage to fit a refund.

New presentation is in `features/spot-funding`, used by Billing and Instances. Query keys
include account identity, authorization scope, lookup and cursor; reads are abortable and
foreground-polled. No record goes into localStorage. Demo cannot call this live port; its
test fixtures never ship as fake account balances. Missing adapter means unavailable.
Instance status reads use individual instance lookups, not the potentially partial account
order list. The backend integration must also provide explicit pricing-version routing for
legacy versus floating orders, and an unavailable state during failed floating reads; absence
from a paginated list or a failed read must never be treated as proof that an order has ended.

The Add credit action reuses the existing KYB-gated top-up flow. The current bank-intent API
does not implement replenishment of an existing Direct Pay order. Agree a dedicated linked
top-up/payment operation with owner/order/purpose and idempotency before enabling that route.
An ordinary wallet top-up must not silently fund a different order or debit Credit twice.

`SpotPricingNotice` is prepared for the future versioned checkout. It is intentionally not
inserted into the current fixed-price payment flow. Enabling it requires the new server purchase
handshake and an explicit persisted customer acknowledgment, not just the read capability.

## Notifications and email

Settlement, funding-state changes and outbox events must share a durable consistency boundary.
Use stable dedupe keys incorporating owner, scope, order (if any), funding cycle and event type.
Notification/email failures retry delivery, not the money operation. An outbox acknowledgment
is not delivery confirmation. Redact bank, KYB, SSH and supplier secrets from message payloads.

Suggested English messages:

| Event                        | Copy                                                                                                                             | Safe destination                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Order 20% remaining          | Only {percent}% ({amount}) of your order funding remains. Spot prices can change. Add funds to avoid an interruption.            | Owned order funding details        |
| Credit account 20% remaining | Your shared Credit funding is down to {percent}% ({amount}) across {count} active orders. Top up to keep your instances running. | Billing                            |
| Projected shortfall          | At the current rate, available funds may not cover your remaining running hours. Review your funding and top up.                 | Owned order / Billing              |
| Paused for funds             | Your instance has been paused because the next hour could not be funded. Your remaining runtime is preserved.                    | Owned instance and funding details |
| Resume complete              | Your funding is confirmed and your instance has resumed. Your remaining running hours will continue from where they stopped.     | Owned instance                     |

Include a data-retention sentence only when the backend confirms retention. Never promise
resumption before allocation/data restoration succeeds. These messages must be generated by
the backend even when the user has no page open; frontend polling is not an alert scheduler.

## Activation test matrix

- Fixed-version orders/retries/paid redemptions remain immutable; no unconsented repricing.
- First payment is funded once; settlement does not debit the same held amount again.
- Rising/falling/intra-hour rates, source outages, delayed pricing and stale quotes.
- Boundary percentages 20.01%, 20%, 19.99%; warn once, no pause solely for crossing 20%.
- Exact next-hour coverage continues; one cent short pauses; final fractional-hour policy.
- Direct Pay dedicated balance, linked replenishment and ordinary Credit top-up separation.
- Two or more simultaneous Credit orders cannot spend the same dollar or hide account alerts.
- Confirmed top-ups reset the funding cycle; pending/rejected/duplicate receipts do not.
- Partial pages, complete aggregate totals, idempotent settlement IDs and consistent cross-view ledgers.
- Rate caps/consent limits, minimum charges, rounding, no second top-up/purchase fee.
- Provider interruption vs funding pause, expired old wall-clock estimate, cumulative resume.
- Durable retention and restoration failures, no false data-retention claim.
- Closed browser, process restart, overlapping workers, double webhook and outbox retry.
- Ownership/role/demo/CSRF isolation, permission revocation, stale responses and cache clearing.
