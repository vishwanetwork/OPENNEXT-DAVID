# OpenNEXT backend adapter

The OpenNEXT web app (`vishwanetwork/OPENNEXT-DAVID`) forwards every `/api/*` request to one backend
origin (`API_ORIGIN`). Its interim backend is the legacy Node server; SpotOrderBot is the Python
backend that replaces it route by route. `spotbot opennext-api` serves the routes SpotOrderBot owns
and passes every other `/api/*` request to the legacy API unchanged, so pointing `API_ORIGIN` at it
keeps every other OpenNEXT feature working.

## Routes

| Method | Path                                    | Purpose                                                       |
| ------ | --------------------------------------- | ------------------------------------------------------------- |
| GET    | `/api/admin/instances?status=&cursor=`  | Protected rental allocations across tenants (Console → Instances → Allocations) |
| GET    | `/api/marketplace/public`               | Existing public market plus the bot's Spot offers (Terminal → Spot market) |
| POST   | `/api/marketplace/spot-purchases`       | Spot "Buy Now": creates a protected rental for the customer's public key |
| GET    | `/api/marketplace/me`                   | Existing workspace plus the customer's rentals in `instances` |
| GET    | `/api/billing/account`                  | Existing Credit less open Spot charges (`spotCharges`)        |
| GET/PUT/POST | `/api/marketplace/instances/{id}/ssh-keys` | The customer keys installed on one of their Spot instances |
| POST   | `/api/marketplace/instances/{id}/end`   | End one of the customer's Spot instances (`{"confirmation":"END"}`) |
| GET/PUT/POST/DELETE | `/api/marketplace/instances/{id}/autopilot` | The task the server runs once delivered, and what happens after |
| POST   | `/api/marketplace/instances/{id}/autopilot/stop` | Stop the running task; the server keeps running |
| GET/POST | `/api/account/ssh-keys`               | The account's saved SSH public keys (`{label, publicKey}` to add) |
| DELETE | `/api/account/ssh-keys/{id}`            | Remove a saved key (instances keep keys already installed)    |
| any    | `/api/*` (everything else)              | Passed to `SPOTBOT_OPENNEXT_LEGACY_ORIGIN` unchanged           |

The Spot routes need `SPOTBOT_OPENNEXT_BOT_URL`; without it the existing routes behave as plain
pass-through, purchases answer 503 and instance routes 404. Writes need the session's CSRF token
and a same-origin `Origin`.

`/api/admin/instances` follows OpenNEXT's contract (`AdminInstancesResponse` in
`packages/contracts/src/admin/instances.ts` there): newest first, `limit` up to 200 (default 50),
an opaque `nextCursor`, and `status` filters on the console lifecycle `Running`, `Connecting`,
`Attention` or `End`. The response omits agent tokens, credentials and server addresses.

Authorization is not reimplemented. The adapter asks the legacy API's
`GET /api/admin/pricing/session` with the browser's own headers and answers 404 when that route
is hidden (not the admin host) and 401 unless the session is authorized. Administrators therefore
sign in exactly as before, and localhost development keeps its administrator rule.

## Spot market

The adapter reads the bot API with `SPOTBOT_API_KEY` and keeps every purchase in the tenant
`SPOTBOT_OPENNEXT_TENANT` (default `opennext`).

**Offers.** `GET /v1/prices/latest?provider=aws&market=spot&can_attempt_only=true`, cached for 60
seconds, limited to the rental Regions (`SPOTBOT_RENTAL_REGIONS`), whole GPUs and x86_64 servers (rentals
start from the Region's x86_64 base image). Each Region and
instance type becomes one supply row (the cheapest zone): `id` `spotbot-<region>-<instance type>`,
`term` `Spot`, `model`, `region`, `gpuCount`, `vcpu`, `memory` (marketed GB per GPU) and
`perGpuHourly`. The instance price is the Spot quote rounded up to whole cents. Rows carry the
published-record markers the web app requires for checkout (`status: Published`,
`serverRecord: true`, `agentStatus: Succeeded`) and no supplier or instance details. When the bot
is unavailable the existing response is returned unchanged.

**Purchases.** `POST /api/marketplace/spot-purchases` takes the web app's checkout request:

```json
{"pricingVersion": "duration-v1", "offerId": "spotbot-us-west-2-g6.xlarge",
 "durationHours": 1.5, "expectedPricing": {"currency": "USD", "durationHours": 1.5,
 "hourlyCents": 39, "baseCents": 59, "feeCents": 3, "totalCents": 62},
 "sshPublicKey": "ssh-ed25519 AAAA… user@host", "idempotencyKey": "<uuid>"}
```

The adapter verifies the session with `GET /api/auth/session` (a signed-in, non-demo Buyer), the
CSRF token and a same-origin `Origin`, then recomputes the totals with the web app's arithmetic
(duration subtotal plus 5% fee, JavaScript rounding) from the current offer. A mismatch answers
409 `PRICE_CHANGED`; an offer that left the catalog answers 409 `OFFER_UNAVAILABLE`; too little
Credit answers 409 `INSUFFICIENT_CREDIT`. The total is held from the account's Credit as the
order's maximum and billed by usage (see below). `durationHours` is 1 to 720 hours.
`sshPublicKey` is optional: keys can be set on the instance later. The rental's RFQ names the
offer's Region and instance type, a price ceiling of the listed instance price plus 20%, a
60-minute acquisition deadline, `service_seconds` for the purchased duration (the paid time starts
at delivery, so the bot moves the end time to the delivery time plus the duration), a 100 GiB root
disk, the customer's public key (if any) for `ubuntu`, and
`customer_ref` `opennext:<user id>`. Its budget is a safety bound for the bot (ceiling for the
whole duration plus storage, with margin). The answer is

```json
{"confirmed": true, "offerId": "…", "orderId": "<rental id>", "currency": "USD",
 "durationHours": 1.5, "totalCents": 62}
```

The RFQ reference derives from the user and `idempotencyKey`, so a retry after an uncertain
answer returns the same order instead of creating another; reusing a key for a different offer or
duration answers 409 `IDEMPOTENCY_CONFLICT`.

**Instances.** `GET /api/marketplace/me` appends the signed-in customer's rentals to `instances`:
`status` `active`, `pending` (first acquisition), `recovering` (replacing an interrupted server),
`ended`, or the lower-case bot state; `rate` is the listed price per GPU-hour; `serviceEnd` is the
RFQ end (the delivery time plus the purchased duration, once delivered). With `SPOTBOT_OPENNEXT_GATEWAY_URL` and `SPOTBOT_OPENNEXT_GATEWAY_TOKEN` (the gateway's
API key), running rentals include the gateway's SSH entry point (`sshHost`, `sshPort`, `sshUser`);
server addresses are never returned.

**Credit.** The existing API keeps each account's Credit (approved top-ups plus promotional
Credit) and has no debits. The adapter records one charge per purchase in the bot database,
keyed by the purchase reference so a retry never charges twice, and `GET /api/billing/account`
subtracts them, promotional Credit first, listing them in `spotCharges` (`totalCents` is what
the charge takes now, `heldCents` the purchase total). A charge is refunded in full when the bot
refuses the order, when no rental appears within 10 minutes of an unanswered order, or when the
rental ends before the customer ever had a running server.

Usage billing: the purchase total stays held while the order is open. When a delivered rental
closes, the charge is billed for the bot's service periods (`service_intervals`: the time the
rental was `ACTIVE`; a Spot replacement pauses it), per started minute with a 1-hour minimum,
plus the 5% fee, never more than the hold; the rest returns to the Credit. Charges from before
usage billing have no `hourly_cents` and stay prepaid. Charges for an account are serialized in
one process, so run a single adapter instance.

**Order notices.** Every 30 seconds the adapter settles every customer's charges, so usage is
billed without a page visit, and emails the address captured from the session at purchase:
server running (with the SSH command), being replaced, running again, ending in 30 minutes,
ended (time used, billed and returned amounts), and not filled (refunded). Each notice is
recorded in the bot database (`opennext_notice`) once sent and retried up to 5 times. Email
needs `SPOTBOT_OPENNEXT_SMTP_HOST` and `SPOTBOT_OPENNEXT_SMTP_FROM` (the OpenNEXT API's SMTP
account; `_PORT` default 587 with required STARTTLS, `_SECURE=true` or port 465 for implicit TLS,
`_USER`, `_PASSWORD`); `SPOTBOT_OPENNEXT_PUBLIC_URL` adds a Terminal link.

**SSH keys.** The account key library (`/api/account/ssh-keys`, up to 50 keys) only stores keys.
`PUT` (or `POST`) `/api/marketplace/instances/{id}/ssh-keys` with `{"keys": [...]}` replaces the keys on one
instance through the bot (`PUT /v1/rentals/{id}/ssh-keys`); the guest agent installs them for
`ubuntu` within about 15 seconds, also on replacement servers, and `installed` turns true once
the running server has them. No administrator SSH key is involved.

**Autopilot.** `PUT` (or `POST`) `/api/marketplace/instances/{id}/autopilot` with `{script, env,
secrets, onSuccess, onFailure, onReplacement, maxMinutes}` sets the bot's managed task
(`docs/rentals.md`); it can change until its first run starts, then only be stopped. Secrets are
write-only: answers carry `secretNames`, and a null value keeps a stored secret. Instance rows
gain `autopilot` (state, choices, outcome) and `endedBy: "autopilot"` when the task ended the
server. The notifier emails the outcome with the exit code, what happened to the server and the
last lines of the log. The guest agent runs the task on the customer's own server only; the
adapter and the bot never execute customer code.

**Buyer KYB, bank transfers and payment review.** These back the Terminal's and the Console's
service ports (OPENNEXT-DAVID `docs/BUYER_KYB_HANDOFF.md`, `docs/PAYMENT_OPERATIONS_HANDOFF.md`).

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/api/buyer-kyb/me` | The Buyer's KYB case, or none |
| POST | `/api/buyer-kyb/documents` | One document as base64 JSON: `{kind, fileName, contentType, dataBase64}` |
| POST | `/api/buyer-kyb/submissions` | Company, mode, consent and document ids; a new revision, `Reviewing` |
| POST | `/api/billing/bank-transfer-intents` | A top-up (face value, no fee) or Direct Pay intent: amount, `ONX-…` reference, 7-day expiry |
| GET | `/api/billing/bank-transfer-intents/{id}` | The owner's intent and its status |
| POST | `/api/billing/bank-transfer-intents/{id}/report-sent` | The customer's transfer report |
| GET | `/api/marketplace/instances/{id}/usage` | Intervals, events and hourly billing entries of one Spot instance |
| GET | `/api/admin/operations/session` | The operator session scope |
| GET | `/api/admin/payment-requests?kind=topup\|direct_pay` | The payment review queue |
| POST | `/api/admin/payment-requests/{id}/decision` | Confirm (Add Credit for top-ups) or Fail with a reason |
| GET | `/api/admin/buyer-kyb` | The Buyer KYB queue |
| GET | `/api/admin/buyer-kyb/{case}/documents/{doc}?revision=` | One document as base64 JSON, audited |
| POST | `/api/admin/buyer-kyb/{case}/decision` | Approve (external review confirmed) or Reject with a reason |

Operator routes need the existing administrator session; operator writes must come from the
same origin. Credit purchases and bank transfers require an approved Buyer KYB. A decision is one
compare-and-swap write of the case or transfer that also appends the owner notice (shown in
`GET /api/billing/account` `notifications`) and the email, which the notifier delivers. A
confirmed top-up adds its full amount to paid Credit. A confirmed Direct Pay queues provisioning:
the payment is held for the order and the rental is created under a reference derived from the
payment, retried every 30 seconds until the bot answers. Usage billing returns unused time to
Credit, and an order that is never delivered leaves the whole payment as Credit.

KYB documents are checked by content signature (PDF, PNG, JPEG; 10 MiB per file, 50 MiB per
submission), scanned by ClamAV (`SPOTBOT_OPENNEXT_CLAMD`, `host:port`) and stored under
`SPOTBOT_OPENNEXT_FILES_DIR` encrypted with AES-256-GCM (`SPOTBOT_OPENNEXT_FILES_KEY`, base64 of
32 bytes; the document id is bound as associated data). Without the key, or without a scanner,
uploads are refused (`SPOTBOT_OPENNEXT_ALLOW_UNSCANNED=true` is for local testing only).
Unsubmitted uploads are deleted after a day; a decided case's documents after
`SPOTBOT_OPENNEXT_KYB_RETENTION_DAYS` (default 365). Back up the files directory and keep the key
outside it: losing the key makes the documents unreadable.

## Pass-through

Every other request keeps its method, path, query, body, `Host`, `Origin`, cookies and CSRF header;
responses keep their status, body bytes and repeated `Set-Cookie` headers. Hop-by-hop headers are
dropped, as the OpenNEXT web server does. Upstream failures return 502 without upstream details.

## Running it

```sh
SPOTBOT_OPENNEXT_LEGACY_ORIGIN=http://127.0.0.1:4189 \
SPOTBOT_OPENNEXT_BOT_URL=https://spotbot.example.com \
spotbot opennext-api --host 127.0.0.1 --port 4191
```

It reads rentals from the bot's configured storage (`SPOTBOT_STORAGE_BACKEND` and its settings),
read-only, so run it with the same environment as the bot, without a second worker. Then set
`API_ORIGIN=http://127.0.0.1:4191` for the OpenNEXT web server. Avoid port 4190:
it is on the fetch specification's blocked-port list, so the web server's server-side session
reads to it fail.

Deployment requirements:

- Bind it to a private address that only the OpenNEXT web server reaches directly. Do not publish
  it through a host-routing reverse proxy: the pass-through keeps the browser's `Host`, and the
  legacy API's localhost administrator rule must only ever see genuine local requests.
- The OpenNEXT web server's `OPENNEXT_TRUST_PROXY` setting still decides which forwarded headers
  arrive; the adapter forwards them as received.
- The adapter needs network access to the legacy API, the bot's database, the bot API and, for
  SSH details, the gateway API.
- It writes its own records (charges, KYB cases and documents, bank transfers, notices) to that
  database, so the database must be backed up with the KYB files directory.

Topology for the current hosts. The OpenNEXT container (one web server with the legacy API bound to
`127.0.0.1:4189` inside it) and the bot (with its MySQL) run on different machines.

- Run the adapter as a sidecar sharing the OpenNEXT container's network namespace
  (`network_mode: service:web`). It reaches the legacy API at `127.0.0.1:4189`, and the web server
  reaches it at `API_ORIGIN=http://127.0.0.1:4191`, with nothing published.
- Give it a private, encrypted route to the bot's MySQL. A security group should allow only the
  OpenNEXT host; alternatively, run a dedicated database.
- Run ClamAV (`clamav/clamav`) next to it for `SPOTBOT_OPENNEXT_CLAMD`.
- Reuse the OpenNEXT `SMTP_*` values for `SPOTBOT_OPENNEXT_SMTP_*`.
- Mount persistent volumes for `SPOTBOT_OPENNEXT_FILES_DIR`.

Customer instance lists send `customer_ref` to the bot; purchase retries also send
`upstream_order_id`. Individual instance actions read the rental directly and verify its
`customer_ref`, rather than loading all tenant rentals. Run a bot with `query_version: 1`
to enable indexed customer lookups; older bots retain a compatibility fallback.

### Local Autopilot testing

`PYTHONPATH=. .venv/bin/python examples/local_opennext.py --skip-kyb --port 4191`
starts a loopback-only adapter. Set `SPOTBOT_OPENNEXT_LEGACY_ORIGIN` and
`SPOTBOT_OPENNEXT_PUBLIC_URL` to local HTTP origins, plus the usual bot/gateway credentials
and a separate local adapter database. Point the local web server's `API_ORIGIN` at it.
Only this explicit development entry point can skip Buyer KYB; it projects Approved cases
in memory without changing saved verification records. Production `opennext-api` remains
unchanged. Sign-in, CSRF, customer ownership and Credit checks remain enabled. Purchases
against a real bot can still incur cloud charges; the helper never purchases on startup.

Single-instance usage reads settle only the already authorized rental, without fetching the
customer's whole rental inventory. Partial reconciliation never expires unrelated held
purchases; full inventory reconciliation remains responsible for missing-order refunds.
