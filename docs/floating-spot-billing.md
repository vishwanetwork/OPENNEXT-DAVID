# Floating Spot billing (`spot-hourly-v1`)

Status: implementation in progress. Legacy `duration-v1` orders are immutable.
Frontend integration target: OPENNEXT-DAVID PR #22, merged into main.

## Accepted product policy

- Warn when confirmed funding reaches 20% remaining, once per funding cycle.
- Require explicit acceptance of a maximum whole-instance hourly price and total
  spend. A quote or notification never authorizes unbounded additional debits.
- Reserve seven days of protected-storage charges before accepting an order.
  Funding pauses release GPU compute, preserve verified data for seven days, then
  clean it up. Display the reserve and expiry before the customer accepts.
- The accepted markup policy is frozen; supplier cost may change. New purchases
  have no fixed service fee. Verified USD 100 top-ups add USD 100 Credit.
- Preserve the existing one-hour minimum per order and subsequent started-minute
  billing. Never repeat the minimum on recovery, top-up or funding resume.
- Count delivered running time, including idle time and model preparation. Pause
  the purchased cumulative runtime during supplier interruption and funding pause.
- Credit shares one wallet with atomic reservations. Direct Pay uses a dedicated
  order balance and confirmed, order-linked replenishments.

## Records and consistency

Use versioned workflow records for purchase quotes, accepted agreements, funding
positions, effective-rate settlements, payment receipts and notification outboxes.
Money uses integer USD cents; intermediate rate/time arithmetic uses Decimal.
Keep supplier account, Region, AZ, SKU, product and effective timestamps private.
Use the actual allocation's price history, never a marketplace minimum or chart.

Every finance mutation is a compare-and-swap transaction including an account
guard, affected charge/order records, immutable settlement/receipt records and
outbox messages. SQLite, MySQL and DynamoDB must have identical rollback and
idempotency semantics. Financial network side effects run after committed state.
Uncertain creation results are reconciled before retrying an allocation.

Confirmed funding minus settled costs is remaining funding. An existing order's
own reservation is not subtracted twice. Account summaries include earmarked funds
and free usable Credit once, excluding dedicated Direct Pay funds. A replenishment
starts a new cycle with baseline = prior remaining funds + newly confirmed funds.
Pending or reported transfers cannot replenish a balance.

Post immutable price subintervals, with stable IDs shared by Instances and Billing.
Round cumulative compute once to cents, retaining exact intermediate amounts.
Apply any final partial-minute/minimum adjustment explicitly; do not overwrite a
posted rate or invent runtime to represent an adjustment. API contracts distinguish
zero-runtime, explained adjustment records from actual usage records.

## Execution and recovery

New rentals carry a cumulative-runtime policy and bounded renewable execution
authorization. Every acquisition/recovery checks the durable authorization and
accepted limits. The guest also enforces its current deadline independently of
the scheduler. Supplier/application costs incurred during shutdown are covered by
the execution reserve; an unavailable billing worker cannot leave unbounded GPU
compute running.

Funding pause is nonterminal: revoke access, bounded guest flush, retain the owned
EBS inventory, terminate compute, then capture/verify a restorable disk set. Report
retention as pending until durable storage is confirmed. Never reuse permanent END
as pause. Protect paused recovery data until its funded retention deadline.

Confirmed replenishment schedules one idempotent resume evaluation. Revalidate
ownership, KYB, funds, equivalent hardware, current price, backup and remaining
runtime. Only verified restore plus gateway acknowledgement resumes the clock.
Explicit END remains available while paused. Expired retention closes the order
and cleans its resources. Model/task recovery keeps its accepted restart policy.

## HTTP and frontend integration

- Add a versioned quote/accept handshake with owner, scope, consent, quote expiry,
  immutable funding source, limits, runtime and storage reserve.
- Add owner-scoped account and order funding reads, paginated immutable settlements
  and instance lookup. Expose only server-authoritative balances and statuses.
- Reuse the existing Console bank review for initial Direct Pay and linked funding
  receipts. Confirm/Fail outcomes retain notification/email delivery and reasons.
- Wire `TerminalServices.spotFunding` with `useApi()` and shared contract schemas.
- Add explicit pricing-version identity; a failed floating read must not fall back
  to an expired fixed-order end date. Direct Pay pause actions open linked order
  replenishment, rather than an unrelated wallet top-up.
- A low-funds warning is not a pause. Missing/stale prices are unavailable, not free.

## Implementation checkpoints

1. Commit policy/contracts and atomic finance storage with rollback tests.
2. Commit funding/settlement/receipt engine with restart and concurrency tests.
3. Commit native bounded pause/restore and cumulative-runtime lifecycle tests.
4. Commit authenticated API, background worker and payment/outbox integration.
5. Commit frontend adapter, checkout disclosure, replenishment and unavailable UX.
6. Review and run backend/database, contract, web and mocked end-to-end acceptance;
   push focused PRs. Paid cloud acceptance requires a separate explicit budget.

Feature activation is versioned and gated. No historical customer migration,
production financial switch or additional paid GPU test is implicit in development.
