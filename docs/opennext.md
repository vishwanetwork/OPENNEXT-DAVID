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
| any    | `/api/*` (everything else)              | Passed to `SPOTBOT_OPENNEXT_LEGACY_ORIGIN` unchanged           |

The three marketplace routes need `SPOTBOT_OPENNEXT_BOT_URL`; without it they behave as plain
pass-through (purchases answer 503).

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
409 `PRICE_CHANGED`; an offer that left the catalog answers 409 `OFFER_UNAVAILABLE`. **No Credit is
charged yet.** The rental's RFQ names the offer's Region and instance type, a price ceiling of the
listed instance price plus 20%, a 60-minute acquisition deadline, an end time of the deadline
plus the purchased duration, a 100 GiB root disk, the customer's public key for `ubuntu`, and
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
RFQ end. With `SPOTBOT_OPENNEXT_GATEWAY_URL` and `SPOTBOT_OPENNEXT_GATEWAY_TOKEN` (the gateway's
API key), running rentals include the gateway's SSH entry point (`sshHost`, `sshPort`, `sshUser`);
server addresses are never returned.

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
