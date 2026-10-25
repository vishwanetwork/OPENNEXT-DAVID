# OpenNEXT architecture

## Repository layout

```
apps/web/            Next.js 16 application (all three front-ends)
  src/app/(site)/    opennextlab.ai            public website
  src/app/terminal/  terminal.opennextlab.ai   Capacity Terminal (buyer / seller workspace, /demo sandbox)
  src/app/admin/     admin.opennextlab.ai      Operations Console
  src/features/      business domains (market, auth, procurement, billing, console-*, …)
  src/components/    shared UI primitives and providers
  src/lib/           host resolution, API client, formatting, stores
  src/proxy.ts       host → application routing (see below)
packages/contracts/  zod schemas and TypeScript types for every API the web app calls
legacy/              the previous vanilla-JS site and its Node preview server (interim API)
docker/              container entry point
docs/                this folder
```

The backend is a separate process. Today it is the legacy Node server in `legacy/`
(zero dependencies, JSON-file persistence, background collectors). It will be replaced by the
Python API; `packages/contracts` and `docs/API_CONTRACT.md` describe what the front-end expects.

## One deployment, three hosts

`src/lib/apps.ts` contains the pure routing rule and `src/proxy.ts` applies it on every request:

| Request                                  | Served by                       | Link base |
| ---------------------------------------- | ------------------------------- | --------- |
| `opennextlab.ai/*`                       | `src/app/(site)`                | ``        |
| `terminal.opennextlab.ai/*`              | `src/app/terminal/*`            | ``        |
| `terminal.opennextlab.ai/demo/*`         | `src/app/terminal/*` (demo on)  | `/demo`   |
| `admin.opennextlab.ai/*`                 | `src/app/admin/*`               | ``        |
| local `/`, `/terminal/*`, `/admin/*`     | same route trees                | `/terminal`, `/admin` |

Hosts come from `SITE_HOST`, `TERMINAL_HOST`, `ADMIN_HOST` (unset locally). The proxy rewrites
to the internal path and tags the request with `x-on-app`, `x-on-base`, `x-on-demo`; the
application layouts read the tags (`src/lib/request-app.ts`) and expose them through
`useApp()` so components never hard-code a prefix:

```tsx
const { href, crossHref } = useApp();
<Link href={href('/market')} />                 // inside the current app
<a href={crossHref('terminal', '/market')} />  // from the site to the terminal
```

Legacy entry points keep working: `/admin/`, `/terminal`, `/demo/` redirect exactly as the old
server did, and `#terminal/<route>` / `#<page>` hashes are mapped to real paths on the client.

### API proxy

`next.config.ts` rewrites `/api/:path*` to `API_ORIGIN` (default `http://127.0.0.1:4189`). The
backend receives `x-forwarded-host`, so host-scoped endpoints (`/api/admin/*` only on the admin
host, `/api/homepage/*` never on it) keep working with `OPENNEXT_TRUST_PROXY=1`.

Cookies, CSRF and the OAuth callback URLs are unchanged because the browser only ever talks to
its own host.

## Front-end structure

- **Pages** (`src/app/**/page.tsx`) are thin: they pick a feature component and pass route params.
- **Features** (`src/features/<domain>`) own components, hooks, API calls and the domain stylesheet.
- **Server state** goes through TanStack Query (`useApi()` + `useQuery`), which gives the 30 s
  refresh, window-focus refetch and stale-data retention the legacy modules implemented by hand.
- **Client state** that crosses pages (filters, cart, modals) lives in zustand stores per app.
- **Contracts** (`@opennext/contracts`) are the only place wire formats are declared.
- **Demo workspace**: `createApiClient({ demo: true })` rewrites sandboxed namespaces to
  `/api/demo/*` and refuses administrative calls; nothing else in the UI knows about demo mode.

## Local development

```sh
pnpm install
pnpm dev         # http://localhost:4188 → /  /terminal  /admin  /demo
pnpm test        # vitest (web + contracts)
pnpm test:legacy # the original node --test suite
```

`pnpm dev` (`scripts/dev.cjs`) starts the interim API on 4189 and `next dev` on 4190 behind a
small local proxy on 4188. The proxy forwards `/api/*` to the API **without** adding forwarded
headers, so the backend sees a direct localhost client just like before (the console works
without an administrator token, same-origin checks pass). Everything else goes to Next with HMR.
`pnpm dev:web` / `pnpm dev:api` run the pieces separately (then Next proxies `/api` itself, which
is the production path and requires `OPENNEXT_ADMIN_TOKEN` for the console).

## Production

`Dockerfile` builds the Next standalone output and bundles the legacy API; `docker/start.cjs`
runs both in one container on port 4188 (same container name, port and volume as before), so
the 1Panel reverse proxy and the GitHub deploy workflow are unchanged. Set `API_ORIGIN` to
switch the container to an external backend.
