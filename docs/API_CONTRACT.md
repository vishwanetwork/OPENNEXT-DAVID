# API contract (what the front-end expects from the backend)

Source of truth for shapes: `packages/contracts/src/**` (zod). This document lists every
endpoint the web application calls, with the auth model and envelopes the legacy Node server
implements today. The Python backend must keep paths, methods, status codes and envelopes
identical so the front-end is unaffected by the switch (`API_ORIGIN`).

## Cross-cutting rules

- All endpoints live under `/api/`. The browser calls its own host; the Next route handler
  `apps/web/src/app/api/[...path]/route.ts` passes the request through unchanged (`Host`, `Origin`,
  cookies, CSRF header, body). `X-Forwarded-*` headers reach the backend only when the front-end
  runs with `OPENNEXT_TRUST_PROXY=1` (behind the TLS reverse proxy); the backend must trust them
  only in that deployment.
- JSON everywhere. Errors are `{ "error": "<human message>", "code"?: "<MACHINE_CODE>" }` with a
  meaningful status (400, 401, 403, 404, 405, 409, 413, 415, 429, 502, 503). Unknown failures → 503.
- **Customer session**: HttpOnly cookie issued by the auth endpoints. Every write (non-GET) must
  carry `X-CSRF-Token` equal to `user.csrfToken` from `GET /api/auth/session`, and must be
  same-origin (`Origin`/`Referer` check). Writes without it → 403.
- **Administrator session**: separate from customer sessions (`/api/admin/pricing/session`).
  Direct localhost access counts as authorized; remote access needs the admin token exchanged
  for a short-lived HttpOnly cookie over HTTPS. Admin endpoints are 404 on the terminal host and
  on the public site host; only served on the admin host.
- **Host scoping**: `/api/homepage/*` and `/api/demo/showcase` only on the site/terminal hosts;
  `/api/marketplace/reference-catalog` never on the admin host; `/api/demo/*` never on the admin
  host.
- **Demo sandbox** (`/api/demo/...`): separate cookie, separate store, auto-expiring workspaces.
  The front-end rewrites `/api/(auth|marketplace|billing|contact)/…` to `/api/demo/…` in demo mode.
- `Cache-Control: no-store` on every response.

## Auth — `/api/auth` (contracts: `auth`)

| Method | Path                                        | Auth         | Request                       | Response                                                                             |
| ------ | ------------------------------------------- | ------------ | ----------------------------- | ------------------------------------------------------------------------------------ |
| GET    | `/api/auth/config`                          | none         |                               | `{ providers: { google, github }, email: bool, otherMethods: false }`                |
| GET    | `/api/auth/session`                         | cookie       |                               | `{ user: SessionUser \| null }`                                                      |
| GET    | `/api/auth/oauth/{google\|github}/start`    | none         |                               | 302 to provider (503 if not configured)                                              |
| GET    | `/api/auth/oauth/{google\|github}/callback` | none         |                               | 302 to the terminal after issuing the session                                        |
| POST   | `/api/auth/email/request`                   | same-origin  | `{ email }`                   | `{ challengeId, expiresIn, message }` (rate-limited, 503 if email not configured)    |
| POST   | `/api/auth/email/verify`                    | flow cookie  | `{ challengeId, code }`       | `{ user }` (401 expired/invalid, 429 too many)                                       |
| POST   | `/api/auth/logout`                          | session+CSRF | `{}`                          | `{ user: null }`                                                                     |
| POST   | `/api/auth/onboarding`                      | session+CSRF | `{ role: "buyer"\|"seller" }` | `{ user }` with `onboardingCompleted: true` and the one-time $100 promotional credit |
| POST   | `/api/auth/role`                            | session+CSRF | `{ role }`                    | `{ user }` (409 if onboarding incomplete)                                            |

`SessionUser`: `id, email, name, role, onboardingCompleted, promotionalCredit,
promotionalCreditGranted, promotionalCreditWithdrawable:false, welcomeCreditGrantedAt, csrfToken`.

## Public pricing — `/api/pricing` (read-only, GET only → 405 otherwise)

| Path                            | Query                                                                                    | Response                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `/api/pricing/prices`           | `limit`, `provider`, `gpuModel`, `region`, `term`, `gpuCount`…                           | `{ records: PriceRecord[], meta: { status, fetchedAt, message } }`                                |
| `/api/pricing/history`          | `provider=aws, gpuModel, region\|all, term, period, gpuCount, gpuMemoryGb?, formFactor?` | `{ series: [{ recordId, region, points: [{ date, value }] }], meta }`                             |
| `/api/pricing/history-catalog`  |                                                                                          | `{ regions: [{ code, name, city }], … }`                                                          |
| `/api/pricing/ticker`           | `period=1W`                                                                              | `{ records: [{ gpuModel, country, term, perGpuHourly, vcpu, gpuMemoryGb, historical, points }] }` |
| `/api/pricing/regional-history` | `metric=min\|avg\|max, term, period, gpuCount, gpuMemoryGb`                              | regional statistics series                                                                        |
| `/api/pricing/capacity-history` | filters + `period`                                                                       | Spot / On-demand / Reserved lines for one offering                                                |
| `/api/pricing/imported-history` | filters + `period`                                                                       | imported Spot dataset                                                                             |
| `/api/pricing/status`           |                                                                                          | `{ providers: [{ id, name, status, recordCount, lastRunAt }], historyProvider: "aws" }`           |

History periods: `1D 3D 1W 1M 3M` free; longer → `403 { code: "HISTORY_ACCESS_REQUIRED" }`.
`PriceRecord`: `recordId, provider, underlyingProvider?, gpuModel, gpuMemoryGb, formFactor,
region, term (Spot|On-demand|Reserved), gpuCount, perGpuHourly, instanceHourly, instanceType,
availability, observedAt, effectiveAt, sourceUrl, priceKind, stale, currency, operatingSystem, tenancy`.

## Market feeds (public, GET)

| Path                                     | Response                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `/api/market`                            | normalized public catalog (legacy `market-feed`)                           |
| `/api/news`                              | `{ items: [...], fetchedAt, stale }` hourly GPU news                       |
| `/api/homepage/rfqs`                     | `{ rfqs: CuratedRfq[] }` (site/terminal hosts only)                        |
| `/api/demo/showcase`                     | `{ supplies, rfqs, … }` isolated showcase for the homepage                 |
| `/api/marketplace/reference-catalog`     | `{ scope: "reference-only", supplies, rfqs, recent }`                      |
| `/api/marketplace/public`                | approved public market records                                             |
| `/api/marketplace/settlements?period=3D` | `{ rows }` recent settled history (`1D 3D 1W 1M 3M 6M 1Y ALL`, or `days=`) |

## Marketplace (verified customer; writes need CSRF) — contracts: `marketplace`

| Method | Path                                                         | Request                          | Response                                                     |
| ------ | ------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------ |
| GET    | `/api/marketplace/me`                                        |                                  | owned RFQs, supplies, review (KYB), orders, notifications, … |
| GET    | `/api/marketplace/matches?model=&region=`                    |                                  | best matches for the current filters                         |
| GET    | `/api/marketplace/instances`                                 |                                  | `{ instances }`                                              |
| POST   | `/api/marketplace/kyb`                                       | KYB form                         | `201 { review }`                                             |
| POST   | `/api/marketplace/rfqs`                                      | RFQ form + `clientSubmissionId?` | `201 { rfq }` (409 on conflicting retry)                     |
| PATCH  | `/api/marketplace/rfqs/:id`                                  | edited fields                    | `200 { rfq }` (revision++)                                   |
| POST   | `/api/marketplace/rfqs/:id/quotes`                           | quote                            | `201 { quote }`                                              |
| POST   | `/api/marketplace/rfqs/:id/quotes/:quoteId/{accept\|reject}` |                                  | order / decision                                             |
| POST   | `/api/marketplace/supplies`                                  | supply form                      | `201 { supply }`                                             |
| POST   | `/api/marketplace/supplies/:id/agent`                        |                                  | installation status                                          |
| POST   | `/api/marketplace/instances/:id/resell`                      |                                  | `201 { supply }`                                             |
| POST   | `/api/marketplace/quote-interest`                            | `{ supplyId }`                   | interest receipt                                             |
| POST   | `/api/marketplace/spot-purchases`                            | see below                        | `{ confirmed, orderId, totalCents, … }`                      |

`POST /api/marketplace/spot-purchases` (`billing` contracts
`SpotPurchaseRequest` / `SpotPurchaseResponse`) is Spot "Buy Now" from the Terminal Spot market, served by SpotOrderBot.
The Terminal calls it only after Buyer KYB is approved (see the Buyer KYB notes below; until
that backend is connected, checkout stops before this call).
The body is `{ pricingVersion: "duration-v1", offerId, durationHours, expectedPricing,
sshPublicKey, idempotencyKey }`, where `expectedPricing` is the checkout's `checkoutTotals` result.
The server verifies a signed-in, non-demo Buyer session, CSRF and same origin, recomputes the
totals from the current offer (409 `PRICE_CHANGED`; 409 `OFFER_UNAVAILABLE` when the offer left
the market; 409 `INSUFFICIENT_CREDIT`), charges the total to the account's Credit and starts
acquiring a Spot server. `sshPublicKey` is optional (400 only for an invalid key); keys can be
set on the instance later. A retry with the same `idempotencyKey` returns the same `orderId`
and charges once; reusing it for another offer or duration is 409 `IDEMPOTENCY_CONFLICT`. Any
4xx means no order was created and nothing was charged, so the checkout returns to review; other
failures leave the purchase pending for a retry. The order then appears in
`GET /api/marketplace/me` `instances` with `id` equal to `orderId`, `status` `pending` → `active`
(or `recovering`, `ended`), `rate` per GPU-hour, `serviceEnd`, and gateway SSH details
(`sshHost`, `sshPort`, `sshUser`) once running.

**Credit.** With SpotOrderBot in front, `GET /api/billing/account` returns the account's Credit
less its open Spot charges (promotional Credit first) and lists them in `spotCharges`
(`orderId`, `totalCents`, `state`, `createdAt`). A charge is refunded in full when the order was
refused, never created, or ended before the server was handed over. Ending a delivered instance
early is not refunded; the duration is prepaid.

**Spot instance actions** (SpotOrderBot; 404 for instances it does not manage):

| Method | Path                                      | Request                   | Response                                                 |
| ------ | ----------------------------------------- | ------------------------- | -------------------------------------------------------- |
| GET    | `/api/marketplace/instances/:id/ssh-keys` |                           | `InstanceSshKeysResponse` `{ keys, version, installed }` |
| POST   | `/api/marketplace/instances/:id/ssh-keys` | `{ keys: [publicKey] }`   | the new set; replaces all keys (max 20)                  |
| POST   | `/api/marketplace/instances/:id/end`      | `{ confirmation: "END" }` | `{ confirmed: true, instance }`                          |
| GET    | `/api/account/ssh-keys`                   |                           | `{ keys }` (account key library, max 50)                 |
| POST   | `/api/account/ssh-keys`                   | `{ label, publicKey }`    | `{ confirmed: true, key }`                               |
| DELETE | `/api/account/ssh-keys/:id`               |                           | `{ confirmed: true, id }`                                |

The server installs an instance's key set for `ubuntu` within about 15 seconds through its
guest agent (also on replacement servers); `installed` turns true once the running server has
the current set. Saved account keys are not installed anywhere until added to an instance.

Record semantics (receipts, revisions, idempotency, fees 5 % each side, review states) are
specified in `legacy/docs/TERMINAL_CONSOLE_SYNC.md` and `legacy/README.md` ("Order fees").

## Billing (verified + onboarded customer) — contracts: `billing`

| Method | Path                      | Request                                                                                   | Response                                                                                                         |
| ------ | ------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/billing/account`    |                                                                                           | balances, ledger, payouts, top-up requests                                                                       |
| POST   | `/api/billing/topups`     | manual top-up request                                                                     | `201 { request }`                                                                                                |
| GET    | `/api/billing/topups/:id` |                                                                                           | `{ request }`                                                                                                    |
| POST   | `/api/billing/checkout`   | `{ amount (1–100000, cents precision), method: "credit_card"\|"paypal", idempotencyKey }` | `{ checkoutUrl }`; `503 { code: "PAYMENTS_NOT_CONFIGURED" }` until a provider is connected; 502 provider failure |

## Contact

| Method | Path           | Auth                                            | Request      | Response    |
| ------ | -------------- | ----------------------------------------------- | ------------ | ----------- |
| POST   | `/api/contact` | same-origin, rate-limited (429 + `Retry-After`) | contact form | `201 { … }` |

## Demo sandbox — `/api/demo`

`GET /config`, `GET /auth/config`, `POST /start { role }` → `{ user, demo: true, expiresAt }`,
`GET /auth/session`, `POST /auth/logout`, `POST /auth/{role|onboarding}`, `GET /showcase`,
`/billing/account`, `/billing/topups…`, and `/marketplace/*` mirrors of the customer routes.
Admin, internal, agent, resell, connect and ssh actions are always 403 in demo.

## Operations Console (administrator session; admin host only) — contracts: `admin`

| Method | Path                                          | Request                                    | Response                                                |
| ------ | --------------------------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| GET    | `/api/admin/pricing/session`                  |                                            | `{ access: { mutable, local, reason } }`                |
| POST   | `/api/admin/pricing/session`                  | `{ token }` over HTTPS                     | sets the admin cookie                                   |
| GET    | `/api/admin/pricing/providers`                |                                            | provider registrations with status, runs, capabilities  |
| GET    | `/api/admin/pricing/runs?provider=`           |                                            | `{ runs }`                                              |
| GET    | `/api/admin/pricing/runs/:id`                 |                                            | run with log                                            |
| POST   | `/api/admin/pricing/providers/:id/run`        |                                            | `202` run started                                       |
| POST   | `/api/admin/pricing/providers/:id/test`       |                                            | test result                                             |
| POST   | `/api/admin/pricing/providers/:id/credential` | `{ credential }` (HTTPS or localhost)      | `{ ok, configured, storage: "server-memory", message }` |
| PATCH  | `/api/admin/pricing/providers/:id`            | `{ enabled?, intervalMinutes? (10–1440) }` | updated provider                                        |
| GET    | `/api/admin/marketplace`                      |                                            | `{ rfqs, supplies, kyb, featured, audit, generatedAt }` |
| PATCH  | `/api/admin/marketplace/rfqs/:id`             | decision + `expectedRevision`              | `{ rfq }` (409 on stale revision)                       |
| PATCH  | `/api/admin/marketplace/kyb/:id`              | decision                                   | `{ review }`                                            |
| PATCH  | `/api/admin/marketplace/featured/:id`         | decision                                   | homepage placement                                      |
| POST   | `/api/admin/marketplace/external/import`      | import batch (≤256 KB)                     | import result                                           |
| PATCH  | `/api/admin/marketplace/external/:id`         | review                                     | updated record                                          |
| GET    | `/api/admin/demo/marketplace`                 |                                            | demo inbox snapshot                                     |
| PATCH  | `/api/admin/demo/marketplace/{kyb\|rfqs}/:id` | `{ workspaceId, … }`                       | decision                                                |
| GET    | `/api/admin/contacts`                         |                                            | `{ leads }`                                             |
| PATCH  | `/api/admin/contacts/:id`                     | status update                              | `{ lead }`                                              |
| GET    | `/api/admin/topups?scope=live\|demo`          |                                            | `{ requests }`                                          |
| POST   | `/api/admin/topups/:id/review?scope=`         | decision                                   | `{ request }`                                           |
| GET    | `/api/admin/instances?status=&cursor=`        | lifecycle filter, page cursor              | `{ instances, nextCursor, asOf }` (see below)           |

`GET /api/admin/instances` is served by the Python backend (SpotOrderBot, `spotbot opennext-api`),
not by `legacy/`. It lists protected Spot rental allocations across accounts, newest first, 50 per
page by default (`limit` ≤ 200; `cursor` is the opaque `nextCursor` of the previous page; `status`
is one of `Running`, `Connecting`, `Attention`, `End`). Each item (`AdminInstance`) carries `id`,
`tenantId`, `orderId`, `rfqId`, `model`, `gpuCount`, `term` (`Spot`), `region`, `zone`,
`instanceType`, `instanceId`, `generation` (increments on every server replacement), the
authoritative backend `state`, the console `lifecycle`, `error`, `degraded`, USD decimal strings
`priceCeilingHourlyUsd`, `estimatedCostUsd` and `budgetUsd`, and `createdAt`, `expiresAt`,
`closedAt`. `Running` excludes `Connecting` (being obtained, verified, handed off or replaced) and
`End`; `Attention` needs an operator. No credentials, agent tokens or server addresses are
returned. Authorization and admin-host scoping are delegated to `GET /api/admin/pricing/session`,
so the same administrator session applies; invalid filters or pages return 400.

Internal integrations (`POST /api/internal/marketplace/supplies/:id/agent`,
`POST /api/internal/marketplace/telemetry`) use a bearer integration token and are not called by
the browser.

### Console redesign: implemented reads and known gaps (2026-10-27)

The redesign reuses the endpoints above. No business route was added to Next.js and no wire
schema or `legacy/` service was changed. Routes and navigation are described in
[`ARCHITECTURE.md`](ARCHITECTURE.md#operations-console-information-architecture).

| Overview value            | Current source / definition                                                                                                                                                            | Limitation                                                                                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Available Price Sources   | Provider registry plus collected prices: enabled, implemented, required credential configured, with a non-stale positive price observed within `max(2 × intervalMinutes, 60)` minutes. | A registered logo, enabled toggle or successful old run is not proof of current data. If `meta.truncated` is true, the metric is unavailable rather than undercounted; a complete backend aggregate is required. |
| Available Spot Instance   | Eligible non-preview Spot offers in `/api/marketplace/public`, using the same `agentInventory` rules as Terminal.                                                                      | Counts offers, not GPUs or purchased running instances. A catalog price does not qualify by itself.                                                                                                              |
| Pending Top-up Requests   | Live `/api/admin/topups` requests with `status=Pending` and not solved.                                                                                                                | Demo requests must not contribute to live totals.                                                                                                                                                                |
| Pending Payment Confirmed | Not connected.                                                                                                                                                                         | Needs the bank-receipt confirmation queue, distinct from Credit top-ups.                                                                                                                                         |
| Pending KYB Requests      | `/api/admin/marketplace` KYB records with `status=Reviewing`.                                                                                                                          | Global DD review count must eventually come from an authoritative aggregate.                                                                                                                                     |
| Pending Contact Requests  | `/api/admin/contacts` records with `status=New`.                                                                                                                                       | This is currently a first-response count; backend must define whether contacted-but-unresolved cases also count as pending.                                                                                      |
| Pending RFQs              | First-party RFQs in `Reviewing`, `Open` or `Quoted` workflow states.                                                                                                                   | Includes requests awaiting review, matching or reply; not imported external source records. Backend should define resolution and order-transition boundaries.                                                    |
| Live Instances            | Not connected.                                                                                                                                                                         | Requires platform-wide purchased allocations in `Running`; do not substitute supplier offers or the current user's instance list.                                                                                |

Unavailable values render as `—`, not zero. Reads poll every 30 seconds while visible and retain
their last snapshot on transient failure with a stale warning. Authorization loss clears private
data. Recent activity currently merges available marketplace audit, top-up review and contact
history events, orders them by UTC time and shows ten. Missing actor fields remain **Not
recorded**. This is not a complete globally ordered operations ledger.

#### Existing homepage review boundary

`GET /api/admin/marketplace` returns server-selected `featured` candidates. The legacy selection
algorithm selects one eligible GPU-rental candidate per model/side: highest approved public RFQ
budget, or lowest published supply net price. Private RFQs, Demo records and arbitrary non-selected
records cannot be promoted through the current endpoint.

`PATCH /api/admin/marketplace/featured/:id` accepts
`{ status: "Approved" | "Rejected", reason, fingerprint }`. The ID is the homepage review ID,
not the RFQ/supply ID. The fingerprint must match the current server snapshot; changed or
superseded candidates return 409. Approval places RFQs in **Inside OpenNEXT → Offer Capacity**
and supply in **Inside OpenNEXT → Buy Capacity**, using the existing public card data format.
Removal is the existing Rejected decision, not deletion of the customer submission.

The Console can open this review directly from a candidate's table row and preview its public
card. It cannot manufacture candidates or promise that any arbitrary row is featureable. A new
server capability is needed for unrestricted operator selection.

#### RFQ / Supply details and missing fields

- RFQs and Ask-for-quote requests retain the existing submitted form schema and shared
  `rfq-details` rendering. RFQ decisions still send `expectedRevision` and respect the review
  gate before a public record becomes live.
- Supply detail labels/order mirror the Terminal form. The current form does **not** collect
  vCPU or per-GPU Memory. The new columns display `Not provided` when those fields are absent;
  they must not infer values from the model name. A coordinated future change must add the
  inputs, validation, persistence and response fields on both sides.
- The marketplace snapshot does not expose submitted SSH connection details. Keep those in
  the backend's privileged installer workflow; the Console shows the verification state, not
  fabricated or unmasked credentials.
- Source provenance remains attached to both imported RFQs and supply. External facts are not
  verified customer identity, guaranteed stock or completed trades.

### Backend handoff proposals — not implemented or called by this frontend

The following paths and shapes are **proposals for the Python team**, not existing API
contracts. They require backend agreement, authorization design, zod schemas and fixture tests
before the frontend may call them. The Orders, Payment Requests and User pages currently use
read-only view models in `features/console/pages/operations-records.ts`; these are not wire
schemas or browser-local customer databases.

| Proposed method / path                                 | Required capability                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/overview`                              | Complete platform-wide metrics with per-metric value or explicit unavailable state, definition, `asOf`, and freshness; latest ten operator events with stable work-item links. Never aggregate a single paginated results page.                                        |
| `GET /api/admin/users?cursor=&limit=&growthPeriod=`    | Authorized user directory, pagination, platform `totalUsers`, and registration growth for `7D`, `1M`, `3M`, `6M`, `1Y`; email, name, company, role, status and joined time. Specify whether period means rolling time or calendar months.                              |
| `GET /api/admin/orders?state=processing&kind=&cursor=` | Instance and RFQ orders across accounts, with stable order/customer IDs, email, model, GPU quantity, country, term, currency, total, status and submitted time. Linkable details must remain permission-checked.                                                       |
| `GET /api/admin/payment-requests?status=&cursor=`      | Customer-reported bank payments, order link, amount/currency, transfer reference, submitted time and receipt verification state. Reporting a transfer is not confirmation of receipt.                                                                                  |
| `POST /api/admin/payment-requests/:id/review`          | Authorized Approve/Reject, rejection reason, verified bank evidence reference, expected revision and idempotency key. Atomically update payment/order state and enqueue the owner's notification; never infer a bank receipt from a browser action.                    |
| `GET /api/admin/operations/activity?limit=10&cursor=`  | Unified audited events with event ID/type, record ID/type, verified operator ID/display name, UTC timestamp, decision and safe Console destination. An overview response may embed the first page instead of duplicating reads.                                        |
| `POST /api/admin/marketplace/featured`                 | Nominate an arbitrary eligible RFQ/supply by record ID and expected revision; backend checks publication rights, captures the public snapshot and returns its review ID/fingerprint. Reuse the existing review step only after its new selection semantics are agreed. |

All proposed writes must be administrator-only, same-origin, audited and revision-aware. No
endpoint should accept a client-supplied operator identity as proof of who performed an action.
Monetary values need documented units/currency and ledger-safe integer minor units or decimal
handling. Duplicate approval or retry must not credit funds, confirm payment or notify twice.

#### Uniform user notification requirement

Existing RFQ reviews, KYB reviews and trusted supply-verification updates already append owner
notifications in the marketplace service. Top-up review uses its existing server-side billing
notification/ledger flow. This does **not** mean every Console action has notification coverage:
homepage decisions currently audit the action without notifying the owner, and contact status
changes do not provide a uniform account notification or outgoing email guarantee. Bank-payment,
global order and user-management services are not connected.

For every user-related operation, the backend handoff requires:

1. Authorize the operator and resolve the affected owner from the stored record, never a typed
   email or browser-supplied owner ID. A contact lead may be unauthenticated; do not bind it to
   an account solely because its email matches.
2. Validate the current revision and idempotency key. Persist the business decision, audit event
   and notification-outbox event atomically. For top-ups, include the ledger transition in the
   same consistency boundary; for bank payment, require verified receipt evidence.
3. Use a stable event ID/deduplication key across retries. Delivery workers may retry at least
   once, but the account must see one logical notification per completed decision. A delivery
   failure must not repeat the financial operation.
4. Include record type/ID, outcome, relevant amount/currency, UTC time and a permission-checked
   Terminal destination. Avoid private keys, sensitive KYB evidence and provider credentials.
5. Surface queued/delivered/failed delivery state in operations diagnostics. Email requires a
   configured sender service and appropriate recipient authorization; do not claim an email
   was sent merely because a review returned 200.
6. Keep Demo and live outboxes, owners, events and ledgers isolated. Customer notifications remain
   server-owned and are read through the existing workspace/billing interfaces until a new
   notification API is agreed. Do not add a browser-controlled notification injection endpoint.

### Supplier integration reference — 24 providers

This table mirrors `features/pricing-admin/provider-references.ts`, researched against linked
official references on **2026-10-27**. **Documented API ≠ implemented OpenNEXT collector ≠ live
availability.** URLs/actions below are integration references, not requests made directly from
the browser. Provider credentials stay server-side. Entries explicitly marked unverified or
price-page-only must remain disabled until the integration and permitted access are confirmed.

The current legacy registry implements only **AWS, Vultr, Shadeform and Lambda**. Actual supported
terms remain those returned by the runtime registry: AWS On-demand (registry labels Spot/Reserved pending),
Vultr and Shadeform On-demand/Spot, Lambda On-demand. Credentials and fresh successful results
are still required where applicable. A documented upstream capability does not widen those
implemented capabilities automatically.

The AWS service also contains a credential-gated `DescribeSpotPriceHistory` collector requiring
IAM and the optional AWS SDK, despite the registry's pending label. Preserve this discrepancy
until the backend aligns capability reporting; inspect actual fresh observations rather than
assuming that a registry label proves collection success. No Reserved collector is implemented.

Console Instances pushes term, source, model, GPU count and memory filters to the current prices
endpoint. It still has a 5,000-record hard limit and no cursor. A truncated response is explicitly
labelled partial; country, vCPU and text search apply to the loaded records only. The Python
replacement needs server-side filtering, total counts and stable cursor pagination for complete
cross-source operations. Unknown vCPU/Memory remain unknown; pricing is never promoted to
executable inventory by the frontend.

| Provider / official reference                                                                           | Corresponding API or verified reference                                                                                                                                                              | Authentication                                                                  | Coverage and limits                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [AWS](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeSpotPriceHistory.html)         | AWS Price List `GetProducts` / public AmazonEC2 bulk offers; EC2 `DescribeSpotPriceHistory`; `DescribeReservedInstancesOfferings`.                                                                   | Public bulk files; signed IAM for EC2/Pricing API calls.                        | On-demand, Spot history, Reserved offerings. Amortize upfront Reserved fees over the exact commitment. Public prices are not deployable stock; the existing AWS collector uses a narrower public pricing-page feed.       |
| [GCP](https://docs.cloud.google.com/billing/docs/how-to/get-pricing-information-api)                    | `GET https://cloudbilling.googleapis.com/v1/services/{serviceId}/skus`; `GET https://cloudbilling.googleapis.com/v2beta/skus`; `GET https://cloudbilling.googleapis.com/v1beta/skus/{skuId}/prices`. | API key for public pricing; IAM/OAuth for account contract rates.               | GPU/Spot SKUs; combine GPU, CPU and RAM correctly. Consumption models need mapping; commitment discounts are not capacity reservations.                                                                                   |
| [Hyperstack](https://docs.hyperstack.cloud/docs/billing/pricebook/)                                     | `GET https://infrahub-api.nexgencloud.com/v1/pricebook`; `GET https://infrahub-api.nexgencloud.com/v1/core/flavors`.                                                                                 | Server-side `api_key` header.                                                   | Account hourly rates, `-spot` resources and contract discounts. Pricebook can contain unavailable resources; join capacity separately. Reserved contracts need their terms.                                               |
| [Vultr](https://www.vultr.com/api/)                                                                     | `GET https://api.vultr.com/v2/plans`; `GET https://api.vultr.com/v2/plans-metal`.                                                                                                                    | Existing collector reads public catalog; account operations use Bearer token.   | GPU catalog and explicitly returned preemptible rates. Respect region/deployment flags; Reserved feed unverified.                                                                                                         |
| [Packet.ai](https://dash.packet.ai/docs/ai)                                                             | `GET /api/v1/launch-options` (confirm production base in current OpenAPI); `GET https://packet.ai/api/openapi`.                                                                                      | Provider API key; confirm current OpenAPI security scheme.                      | Products, `pricePerHourCents`, GPU pools and availability. Dynamic/shared does not automatically mean Spot. Contract clusters require a quote; adapter pending.                                                           |
| [Lightning](https://api.lightning.ai/pricing/)                                                          | Official pricing page only; no public GPU price-catalog API verified.                                                                                                                                | Public page; API access/schema requires confirmation.                           | Published GPU and interruptible rates. Confirm permitted collection and enterprise contract pricing before ingestion.                                                                                                     |
| [Shadeform](https://docs.shadeform.ai/api-reference/instances/instances-types)                          | `GET https://api.shadeform.ai/v1/instances/types`.                                                                                                                                                   | `X-API-KEY`.                                                                    | Instance specifications, hourly prices and regional rental availability. Preserve underlying cloud; top-level prices are cents and regional overrides use their documented units. Reserved support requires confirmation. |
| [Vast.ai](https://docs.vast.ai/api-reference/search/search-offers)                                      | `POST https://console.vast.ai/api/v0/bundles` (read-only offer search).                                                                                                                              | Bearer API key.                                                                 | On-demand/interruptible offers with documented type filters. Storage, networking and rental conditions vary; hourly offers are not Reserved contracts.                                                                    |
| [Crusoe](https://docs.crusoecloud.com/api/)                                                             | `GET https://api.cloud.crusoe.ai/v1/projects/{project_id}/compute/vms/types`.                                                                                                                        | Account credentials and project permissions.                                    | Hardware types, **not a complete price feed**. Obtain an approved rate card/account pricing source; inference prices cannot substitute for VM prices.                                                                     |
| [RunPod](https://docs.runpod.io/sdks/graphql/manage-pods)                                               | `POST https://api.runpod.io/graphql`, read-only `gpuTypes` / `gpuType` queries.                                                                                                                      | Server-held RunPod API key.                                                     | GPU catalog and On-demand/interruptible price fields subject to current schema. Separate secure/community cloud, storage and regional availability; Reserved pricing unverified.                                          |
| [Aliyun](https://www.alibabacloud.com/help/en/ecs/developer-reference/api-ecs-2014-05-26-describeprice) | ECS actions `DescribePrice`, `DescribeSpotPriceHistory`.                                                                                                                                             | Signed OpenAPI with scoped RAM credentials.                                     | Pay-as-you-go/subscription quotes, capacity-reservation prices and Spot history. Preserve China/international account currency; verify Reserved Instance commercial terms separately.                                     |
| [Azure](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices)   | `GET https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview`.                                                                                                                     | Public retail catalog, no authentication.                                       | Consumption, Spot/low-priority, Reservation and savings-plan meters. Follow `NextPageLink`; retain region, OS, meter and commitment terms. No stock guarantee.                                                            |
| [Modal](https://modal.com/pricing)                                                                      | Official pricing page only; no public GPU price-catalog API verified.                                                                                                                                | Public page.                                                                    | Serverless GPU/CPU/RAM resource rates, not rented GPU instances. Spot/Reserved instance-price feed unverified.                                                                                                            |
| [Nebius](https://docs.nebius.com/signup-billing/spot-prices)                                            | `GET https://api.nebius.cloud/billing/v1alpha1/spot-price`; `GET https://api.nebius.cloud/billing/v1alpha1/spot-price/list-series`.                                                                  | Public Spot prices/history, no authentication.                                  | Current per-GPU Spot prices by platform/region and up to 30 days of history; follow `nextPageToken`. 15-minute history steps up to 7 days, otherwise hourly. On-demand/commitment feed and adapter pending.               |
| [OCI](https://www.oracle.com/cloud/price-list/)                                                         | Official price list; no stable documented all-terms GPU price-catalog API verified.                                                                                                                  | Public list; signed OCI APIs for account resources.                             | Published GPU rates/commitment terms. Verify preemptible availability per GPU shape; do not guess an undocumented catalog endpoint.                                                                                       |
| [Paperspace](https://docs.digitalocean.com/reference/paperspace/api-reference/machine-types/)           | `GET https://api.paperspace.com/v1/machine-availability?machineType={type}&region={region}`.                                                                                                         | Bearer API key.                                                                 | Type/region availability **without price fields**. Needs a separate approved rate source; Spot/Reserved feeds unverified.                                                                                                 |
| [Tencent](https://www.tencentcloud.com/document/product/213/33248)                                      | CVM `InquiryPriceRunInstances`; `DescribeReservedInstancesOfferings`.                                                                                                                                | Signed Tencent Cloud API requests and scoped credentials.                       | Configuration-specific hourly/prepaid quotes and Reserved offerings. Verify Spot strategy/regional SKU support separately; quoting does not reserve capacity.                                                             |
| [Volcengine](https://docs.volcengine.com/docs/ecs/Elastic-Compute-Service-API-overview?lang=zh)         | ECS `DescribeSpotPriceHistory`; `DescribeInstanceTypes`.                                                                                                                                             | Signed OpenAPI with scoped AccessKey credentials.                               | Spot history and hardware types. On-demand quotes/Reserved price contracts require confirmation. Owned reservations are not public inventory.                                                                             |
| [Lambda](https://docs.lambda.ai/api/cloud)                                                              | `GET https://cloud.lambda.ai/api/v1/instance-types`.                                                                                                                                                 | Bearer API key.                                                                 | On-demand instance prices in cents/hour and regional availability. Entire-instance rate, not per-GPU rate; availability is boolean, not quantity. Spot/Reserved catalog unverified.                                       |
| [TensorDock](https://dashboard.tensordock.com/api/docs)                                                 | Official API reference; current price schema/endpoint unverified because reference access was restricted.                                                                                            | Provider account credentials; confirm current specification.                    | Host availability is described, but no guessed legacy endpoint may be enabled.                                                                                                                                            |
| [CoreWeave](https://docs.coreweave.com/reference-home)                                                  | Infrastructure API reference; no public all-terms GPU price-catalog endpoint verified.                                                                                                               | Account/organization credentials.                                               | Negotiated pricing requires an approved rate card and commercial access.                                                                                                                                                  |
| [CUDO Compute](https://www.cudocompute.com/)                                                            | Enterprise provider contact; no current public price-catalog endpoint verified.                                                                                                                      | Confirm service/API access directly.                                            | Existing registry marks the former public On-demand platform closed; collection stays disabled. Current cluster proposals need commercial confirmation.                                                                   |
| [Verda / DataCrunch](https://api.verda.com/v1/docs)                                                     | `GET https://api.verda.com/v1/instance-types`; `/v1/instance-availability`; `/v1/long-term/periods/instances` on the same API host.                                                                  | Public catalog; account operations use OAuth2 client-credentials Bearer tokens. | Hourly/Spot prices, hardware, regional availability and long-term periods. Join availability separately; resolve period discounts to exact prices. Adapter pending; do not use deprecated price-history.                  |
| [DigitalOcean](https://docs.digitalocean.com/reference/api/reference/sizes/)                            | `GET https://api.digitalocean.com/v2/sizes`.                                                                                                                                                         | Bearer token with `sizes:read` / `regions:read`.                                | GPU-capable Droplet sizes, hourly price and available regions. Filter GPU sizes explicitly; Spot/Reserved feed unverified. Dedicated inference is a different product.                                                    |

Before adding an upstream adapter, pin the response fixture, pagination, retry/backoff and rate
limits; normalize currency and per-instance/per-GPU units; preserve source URL, observation time,
region, GPU count, memory basis and commercial term. Keep availability evidence separate from
pricing. Missing regions or uncollected terms are gaps, not zero prices, and a partially
successful run must not be reported as complete coverage. Do not trigger provisioning or a paid
purchase as part of price collection.

## Notes for the Python backend team

`GET /api/admin/instances` (Instances → Allocations in the Console) is implemented by SpotOrderBot's
`spotbot opennext-api`. That service answers the routes it owns and passes every other `/api/*`
request to the legacy API unchanged (`Host`, cookies, CSRF header and `Set-Cookie` intact), so
pointing `API_ORIGIN` at it keeps every other feature working while routes move to Python one at a
time. Run it on a private listener the web server reaches directly, not behind a host-routing
reverse proxy. It also serves the Terminal Spot market: it adds its orderable Spot offers to
`GET /api/marketplace/public` `supplies` (published rows with `term: "Spot"`, `gpuCount`, `vcpu`,
`memory`, `perGpuHourly`), answers `POST /api/marketplace/spot-purchases`, and adds the
customer's Spot orders to `GET /api/marketplace/me` `instances`.

Buyer KYB and bank transfer are **not connected**. See [the Buyer KYB handoff](BUYER_KYB_HANDOFF.md)
for frontend-only scope, proposed endpoints, private file transport, ALLScale review, notifications
and server-side payment gates. Optional ports in `src/lib/buyer-kyb.ts` are not wire contracts.
Never send Buyer data to supplier KYB or disguise bank transfers as card payments.

The 2026-10-29 frontend additions are documented in
[payment operations and instance usage](PAYMENT_OPERATIONS_HANDOFF.md). These include optional
review and usage ports, not deployed endpoints or changes to the existing wire schemas.
Top-ups credit the full transferred amount; the tentative 5% fee is purchase-only. Review receipts
must acknowledge both notification and email outboxes. Instance charts do not calculate charges.

Existing connected front-end features use the contracts in `packages/contracts/src/<resource>/index.ts`
(`auth`, `marketplace`, `billing`, `pricing`, `news`, `contact`, `demo`, `admin`, `account`).
Every call the browser makes is in one place per domain: `apps/web/src/features/*/api.ts`
(plus `terminal-kit/api.ts` for the shared workspace reads and `features/auth/server.ts` for the
server-side session read). To switch backends, set `API_ORIGIN`; nothing else changes.
The proposed Console services above remain unimplemented; they must not be mistaken for existing
contract coverage merely because their pages and read-only view models are present.

1. **Same origin is preserved.** The pass-through keeps the browser's `Host`/`Origin`, so the
   backend keeps doing its own same-origin and host-scoping checks; it never sees a Next host.
   Set-Cookie flows back untouched (HttpOnly session cookies, SameSite as today).
2. **Forwarded headers.** Only trust `X-Forwarded-*` when the front-end sends them
   (`OPENNEXT_TRUST_PROXY=1`, production). Locally the backend sees a direct `127.0.0.1` client,
   which is what grants the console its localhost administrator access.
3. **Demo namespace.** The client rewrites `/api/(auth|marketplace|billing|contact)/…` to
   `/api/demo/…` in the sandbox; keep the demo mirrors of those routes and the 403 rules.
4. **Lenient fields.** Several schemas still use `.passthrough()` and `numberOrString` because
   the legacy server mixed types (`amount`, `count`, `price` as string or number) and emitted
   extra keys. Once the Python API settles, tighten `packages/contracts` (the fixture tests in
   `packages/contracts/src/contracts.test.ts` are the place to pin the final shapes) and drop
   `.passthrough()`.
5. **Known legacy defect to not reproduce.** Demo writes compare `Origin` against a
   socket-derived origin, so `POST /api/demo/start` fails behind TLS unless `secureCookies` is
   set (see `docs/MIGRATION_STATUS.md`). Derive the expected origin from the forwarded protocol
   when `OPENNEXT_TRUST_PROXY=1`.
6. **Service adapters.** Spot purchases (`beginPurchase` through
   `/api/marketplace/spot-purchases`, charged to Credit), account SSH keys and Spot instance
   termination are connected (SpotOrderBot). Shapes are in `apps/web/src/terminal-kit/services.ts`.

Open questions per domain are collected in `docs/MIGRATION_STATUS.md`.

## Live Console operations adapter

The updated SpotOrderBot OpenNEXT adapter owns these administrator endpoints. Each
requires the existing administrator session and returns `Cache-Control: no-store`.
Writes additionally require the Console's own Origin. Frontend contracts are in
`packages/contracts/src/admin/operations.ts`; customer billing policy is unchanged.

| Endpoint                                                    | Result / operation                                                                                                                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/users?cursor=&limit=&search=&role=`         | Allowlisted users, platform total, filtered total, rolling registration growth, next cursor and as-of time.                                                             |
| `GET /api/admin/orders?cursor=&limit=&search=&kind=&state=` | Actual RFQ orders and Spot rentals, including Direct Pay awaiting confirmation; aggregate total and next cursor.                                                        |
| `GET /api/admin/overview`                                   | Full pending top-up, Direct Pay and Buyer KYB counts, active rentals and recent audited events.                                                                         |
| `GET /api/admin/operations/activity?cursor=&limit=&search=` | Durable operations events and historical customer review decisions.                                                                                                     |
| `GET /api/admin/agent`                                      | Allowlisted Bot health, real rental lifecycle counts and maintenance job history.                                                                                       |
| `POST /api/admin/agent/actions`                             | `{ action: "reconcile", idempotencyKey }` queues one durable, audited reconciliation of existing paid work. It cannot replace Agent code or create a new purchase.      |
| `GET /api/admin/agent/billing`                              | Integer-cent customer usage ledger totals and the latest 200 entries. Provider invoices remain explicitly unavailable.                                                  |
| `POST /api/admin/pricing/providers/:id/credential`          | `{ credential }` stores an encrypted provider-bound value and returns `{ ok: true, configured: true, storage: "encrypted_database" }`. It never returns the credential. |

User and RFQ order projections temporarily read the legacy backend's private
`auth-state.json` and `marketplace.json` snapshots from a shared volume, without
changing those files. Missing snapshots return 503 instead of fabricated empty
results. The frontend filters before pagination on the server. User growth and
ledger totals cover all records, not the displayed page. Private queries are keyed
by the server-issued administrator session scope and disappear after access denial.

Source capabilities remain truthful: AWS, Vultr, Lambda and Shadeform have existing
collectors; other registered providers remain pending. The legacy collector retains
price observations, history, schedules and run records. A 30-second adapter loop
restores encrypted credentials after either service restarts, without requiring an
open browser. Collection does not provision instances or promise stock or quota.

### Deployment requirements

Use an image containing the updated adapter, set `OPENNEXT_ADAPTER=1`, and retain the
private data volume. The bundled launcher sets `SPOTBOT_OPENNEXT_LEGACY_DATA_DIR` to
that volume. For a separate adapter, configure that shared directory explicitly.
Set `SPOTBOT_OPENNEXT_CONSOLE_KEY` to a separately generated, stable base64-encoded
32-byte key in the deployment secret manager. Keep `OPENNEXT_ADMIN_TOKEN` configured
for remote operator login. Existing provider environment keys continue to work;
database-saved credentials take precedence. No secret belongs in browser storage.

Console Schedules now directs operators to actual Price Source schedules. Platform
Agent and Agent billing use real backend records instead of browser-local policies
or illustrative cost charts. The existing Terminal payment, notification, rental,
SSH and Autopilot endpoints remain unchanged.
