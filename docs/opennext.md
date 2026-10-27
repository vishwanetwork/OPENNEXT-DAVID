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
| any    | `/api/*` (everything else)              | Passed to `SPOTBOT_OPENNEXT_LEGACY_ORIGIN` unchanged           |

`/api/admin/instances` follows OpenNEXT's contract (`AdminInstancesResponse` in
`packages/contracts/src/admin/instances.ts` there): newest first, `limit` up to 200 (default 50),
an opaque `nextCursor`, and `status` filters on the console lifecycle `Running`, `Connecting`,
`Attention` or `End`. The response omits agent tokens, credentials and server addresses.

Authorization is not reimplemented. The adapter asks the legacy API's
`GET /api/admin/pricing/session` with the browser's own headers and answers 404 when that route
is hidden (not the admin host) and 401 unless the session is authorized. Administrators therefore
sign in exactly as before, and localhost development keeps its administrator rule.

## Pass-through

Every other request keeps its method, path, query, body, `Host`, `Origin`, cookies and CSRF header;
responses keep their status, body bytes and repeated `Set-Cookie` headers. Hop-by-hop headers are
dropped, as the OpenNEXT web server does. Upstream failures return 502 without upstream details.

## Running it

```sh
SPOTBOT_OPENNEXT_LEGACY_ORIGIN=http://127.0.0.1:4189 spotbot opennext-api --host 127.0.0.1 --port 4190
```

It reads rentals from the bot's configured storage (`SPOTBOT_STORAGE_BACKEND` and its settings),
read-only, so run it with the same environment as the bot, without a second worker. Then set
`API_ORIGIN=http://127.0.0.1:4190` for the OpenNEXT web server.

Deployment requirements:

- Bind it to a private address that only the OpenNEXT web server reaches directly. Do not publish
  it through a host-routing reverse proxy: the pass-through keeps the browser's `Host`, and the
  legacy API's localhost administrator rule must only ever see genuine local requests.
- The OpenNEXT web server's `OPENNEXT_TRUST_PROXY` setting still decides which forwarded headers
  arrive; the adapter forwards them as received.
- The adapter needs network access to both the legacy API and the bot's database.
