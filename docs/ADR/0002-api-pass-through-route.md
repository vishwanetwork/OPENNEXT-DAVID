# 0002 — `/api/*` is a transparent route-handler pass-through

Status: accepted (2026-10)

## Context

The backend (today the legacy Node server, later the Python API) enforces same-origin checks
by comparing `Origin` with `Host`, scopes admin routes to the admin host, grants administrator
access to direct localhost clients, and issues HttpOnly cookies. `next.config` rewrites replace
`Host` with the upstream address and add synthetic `X-Forwarded-*` headers, which broke all four
behaviours.

## Decision

`src/app/api/[...path]/route.ts` forwards every method with Node's `http`/`https` client,
copying the incoming headers minus hop-by-hop ones, streaming the body, and relaying the
response headers (including `Set-Cookie`). The forwarded-header policy is one function,
`backendHeaders()` in `src/lib/env.ts`: `X-Forwarded-*` pass through only when
`OPENNEXT_TRUST_PROXY=1`; otherwise they are dropped so the backend sees a direct client. The
server-side session read (`features/auth/server.ts`) uses the same function. `API_ORIGIN`
selects the backend; the default is the interim server on `127.0.0.1:4189`.

## Consequences

- Cookies, CSRF and OAuth callbacks are unchanged: the browser only ever talks to its own host.
- The console works locally without a token (localhost rule) and only behind TLS with one.
- The policy is unit-tested without a browser (`route.test.ts`).
- Streaming responses add no buffering; the handler is `force-dynamic` on the Node runtime.
