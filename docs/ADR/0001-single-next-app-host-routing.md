# 0001 — One Next.js application with host-based routing

Status: accepted (2026-10)

## Context

Three products share one brand, one session model and one backend: the public site
(`opennextlab.ai`), the Capacity Terminal (`terminal.opennextlab.ai`) and the Operations Console
(`admin.opennextlab.ai`). The legacy implementation was one Node server choosing a bundle per
host; locally everything ran under one origin by path (`/`, `/terminal`, `/admin`). The
refactor had to keep every existing URL, redirect and cookie behaviour.

## Decision

A single Next.js App Router application (`apps/web`) serves all three hosts. `src/lib/apps.ts`
holds the pure host/path → app rule, `src/proxy.ts` applies it per request (rewrite to the app's
route tree, tag the request with `x-on-app`/`x-on-base`/`x-on-demo`/`x-on-host`), and layouts
read the tags through `requestApp()`. Production selects the app by host (`SITE_HOST`,
`TERMINAL_HOST`, `ADMIN_HOST`); without those variables the same build routes by path prefix.
The public site layout never reads request headers, so `/` is statically rendered.

React alone (SPA) was rejected: no server rendering for the marketing site, no server-side
session seeding, and a second routing layer for the host split.

## Consequences

- One build, one container, one deploy; the reverse-proxy configuration is unchanged.
- Links never hard-code a prefix: `useApp().href()` / `crossHref()`.
- Host-specific behaviour is testable as a pure function (`src/lib/apps.test.ts`).
- The demo sandbox is a base-path variant of the terminal (`/demo`), not a separate app.
- A request on a host that is not configured (IP, `localhost`, staging alias) is served in path
  mode with links that stay on that host; `/admin` there is loopback-only when `ADMIN_HOST` is set.
