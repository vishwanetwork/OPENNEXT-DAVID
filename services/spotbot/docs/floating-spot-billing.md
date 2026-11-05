# Floating Spot billing (`spot-hourly-v1`)

Status: implemented behind a disabled-by-default rollout flag. Legacy `duration-v1` orders are immutable.
Frontend integration extends OPENNEXT-DAVID PR #22, merged into main.

## Implemented adapter and execution boundaries

The adapter exposes authenticated `/api/billing/spot-quotes`, `/spot-purchases`,
`/spot-funding`, `/spot-orders/{id}/funding`, and
`/spot-orders/{id}/replenishments` under `/api/billing`. Writes require the
existing buyer session, same-origin CSRF check and approved KYB. Quotes expire
after ten minutes. Acceptance requires explicit variable-price and seven-day
storage consent, plus paid model-preparation consent when applicable.

`SPOTBOT_FLOATING_ENABLED=false` remains the default on both native Bot and
OpenNEXT adapter. New purchases require matching native protocol capabilities.
The settlement worker must continue running for existing agreements even when
new purchases are disabled. Do not migrate historical orders to this version.

Direct Pay requests appear in the existing Console payment queue. Confirming a
linked request atomically posts its dedicated funding receipt and payment
decision. It cannot provision through the historical fixed-price redemption
path. Failed requests require a reason and queue the existing notification and
email. Funds received after order closure or beyond its accepted budget become
Credit once; unused compute funding also becomes Credit on closure. Unused
storage reserve is released only after native cleanup is confirmed.

Background Credit allocation requires the adapter's read-only shared legacy
data directory (`SPOTBOT_OPENNEXT_LEGACY_DATA_DIR`). Its account directory and
approved top-up ledger are verified before allocating additional wallet funds.
Missing or inconsistent snapshots do not authorize further debits. SQLite,
MySQL and DynamoDB use the same account-level compare-and-swap guard across
historical and floating charges.

Settlement uses AWS price history for the actual account, instance type and
availability zone. Provider interruption periods are excluded. Price gaps
prevent execution-grant renewal. Execution grants expire within five minutes;
the native lifecycle and guest deadline watcher independently stop continued
execution. The guest watcher is defense in depth: customers with root access
can modify their guest, so native Bot availability remains an operational
requirement. This implementation does not install an independent cloud-level
watchdog against simultaneous control-plane failure and guest tampering.

Native retention evidence includes verified backup availability and physical
cleanup completion. A paused order never promises a verified backup until the
snapshot workflow confirms it. Seven-day storage charging uses the disclosed
protected-storage tariff and never exceeds its reserved funding; delayed
cleanup costs beyond that reserve are absorbed by the platform.

Email delivery uses the existing SMTP outbox conventions and retries. Financial
transactions are idempotent; SMTP delivery is at least once across process
failure, so duplicate transport delivery is possible.

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

## Rollout and acceptance

Deploy the reviewed frontend and adapter/native Bot versions together. Build a
new pinned image containing these changes; older image pins do not provide this
protocol. Keep `SPOTBOT_FLOATING_ENABLED=false` until all services are updated,
the shared read-only legacy account snapshots are mounted, and native price
evidence and bounded execution grants are verified. Then set the flag on both
the adapter and native Bot. The capability response distinguishes required
floating checkout, new-purchase readiness, and existing funding read support.
New legacy purchases are refused after activation; existing fixed orders and
issued fixed-price bank references retain their original agreements.

For rollback, disable new floating purchases while leaving the funding worker
and native rental worker running. Existing floating orders still require
settlement, grants, payment review, retention cleanup and customer access.
The frontend keeps their funding views and retry confirmations available.
Never roll the native Bot back to a version without funding pause/grant support
while a floating agreement is open.

Automated acceptance uses isolated accounts, test stores and simulated cloud
providers. It covers Credit and Direct Pay model-preinstallation handoff, native
pause/snapshot/restore, account isolation, retries, price changes, budget limits,
bank confirmation, refunds, Console projections and seven-day cleanup. Browser
acceptance uses a local simulated backend; it does not allocate paid GPU
resources. Live financial activation and a paid GPU acceptance require explicit
deployment authorization and a separate test budget.

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
