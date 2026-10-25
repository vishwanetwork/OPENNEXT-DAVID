# API contract (what the front-end expects from the backend)

Source of truth for shapes: `packages/contracts/src/**` (zod). This document lists every
endpoint the web application calls, with the auth model and envelopes the legacy Node server
implements today. The Python backend must keep paths, methods, status codes and envelopes
identical so the front-end is unaffected by the switch (`API_ORIGIN`).

## Cross-cutting rules

- All endpoints live under `/api/`. The browser calls its own host; Next proxies to the backend
  and forwards `X-Forwarded-Host` (the backend must trust it only when `OPENNEXT_TRUST_PROXY=1`).
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

## Marketplace (verified customer; writes need CSRF) — contracts: `procurement`

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

## Operations Console (administrator session; admin host only) — contracts: `console`, `pricing-admin`

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

Internal integrations (`POST /api/internal/marketplace/supplies/:id/agent`,
`POST /api/internal/marketplace/telemetry`) use a bearer integration token and are not called by
the browser.

## Open questions for the backend team

Collected per domain in `docs/MIGRATION_STATUS.md` as modules are ported.
