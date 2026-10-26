# AGENTS.md — guide for AI coding agents (Codex, Claude Code, Cursor …)

Read this file before changing anything. It is the single source of instructions for AI agents
in this repository; `CLAUDE.md` imports it. Details live in `docs/` (linked below).

## What this repository is

One Next.js 16 application that serves three sites, plus an API contract package:

| Site               | Production host           | Local path                  | Route tree                   |
| ------------------ | ------------------------- | --------------------------- | ---------------------------- |
| Public website     | `opennextlab.ai`          | `/`                         | `apps/web/src/app/(site)/`   |
| Capacity Terminal  | `terminal.opennextlab.ai` | `/terminal`                 | `apps/web/src/app/terminal/` |
| Demo sandbox       | `terminal.…/demo/`        | `/demo/`, `/terminal/demo/` | same as Terminal             |
| Operations Console | `admin.opennextlab.ai`    | `/admin`                    | `apps/web/src/app/admin/`    |

The backend is a separate service reached through `/api/*`. Today it is the old Node server in
`legacy/`; it will be replaced by a **Python backend owned by another team**.

## Directory map

```
apps/web/                     the Next.js app (all front-end work happens here)
  src/proxy.ts                host/path → site routing (applies src/lib/apps.ts) — see "Danger zone"
  src/app/                    routes only; pages are thin
    layout.tsx                root HTML
    (site)/                   public website: layout.tsx + page.tsx
    terminal/                 Capacity Terminal
      layout.tsx              ENTRY: server session + <TerminalApp>
      terminal-app.tsx        COMPOSITION ROOT: wires every feature into the shell (slots, modals)
      <route>/page.tsx        one folder per page: market, rfqs, supply, instances, billing, …
    admin/                    Operations Console: layout.tsx (ConsoleShell) + one folder per page
    api/[...path]/route.ts    transparent proxy of /api/* to the backend — see "Danger zone"
  src/features/<domain>/      business features; each has index.ts (public API), api.ts, hooks.ts,
                              components/, its CSS and tests
      site                    public landing page, listings, ticker, contact dialog
      auth                    sign-in, email code, OAuth start, onboarding
      terminal                terminal shell, header, menus, generic pages (models, saved, cart, help…)
      market                  price catalog, history charts, insight index, news
      procurement             RFQs, supply, quotes, KYB, matches, listing table
      spot-market             buyer Spot market and checkout
      instances               GPU instances
      billing                 balances, top-ups, checkout, receipts
      account / seller / quotes   profile + SSH keys / seller insight / notifications
      rfq-details             RFQ detail renderer shared by terminal and console
      console, console-*, pricing-admin   Operations Console pages
  src/terminal-kit/           framework every terminal feature builds on: UI store, routing rules,
                              modal system, shell slots, data hooks
  src/components/             shared UI: ui/ (dialog, toast, brand), icons/, providers/, hooks/
  src/lib/                    apps.ts (host rules), env.ts, api/ (client, query keys), format, session
  src/data/                   static datasets (GPU catalog, model quotes)
  src/styles/                 tokens.css, base.css
  public/                     static files (GCI animation, provider logos)
packages/contracts/           zod schemas + TS types for every API, one folder per backend resource
legacy/                       OLD implementation + interim backend. READ-ONLY (see below)
docs/                         ARCHITECTURE, CONVENTIONS, API_CONTRACT, ADR/, reviews
scripts/dev.cjs               local runner (legacy API + next dev)
docker/, Dockerfile, docker-compose.yml   single-container production image (port 4188)
```

### Where do I put …

| Change                                 | Location                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| New terminal page                      | `src/app/terminal/<route>/page.tsx` (thin) + component in a feature                                |
| New console page                       | `src/app/admin/<route>/page.tsx` + `src/features/console*`                                         |
| Change a page's UI                     | the owning `src/features/<domain>/components/`                                                     |
| New backend call                       | schema in `packages/contracts/src/<resource>/`, call in the feature's `api.ts`, hook in `hooks.ts` |
| Plug a feature into the terminal shell | `src/app/terminal/terminal-app.tsx` (the only file that knows all features)                        |
| Something two features both need       | `src/terminal-kit/` (terminal-only) or `src/components/` / `src/lib/`                              |
| Static data                            | `src/data/`                                                                                        |

## Rules (enforced by lint/CI unless noted)

1. Layers only point downward: `app → features → terminal-kit → components → lib → contracts`.
   Import another feature only via its `index.ts` (`@/features/x`), never `@/features/x/components/…`.
2. Server data lives in TanStack Query (`hooks.ts`); zustand stores hold UI state only.
3. Every backend call goes through `useApi()` and the feature's `api.ts`, parsed with a contract
   schema. Never call `fetch` directly; never add a Next.js API route that implements business logic.
4. Links use `useApp().href()` / `crossHref()`. Never hard-code `/terminal`, `/admin` or a hostname.
5. JSX only — no `innerHTML`/`dangerouslySetInnerHTML`. Every `<button>` has a `type`.
6. Files: kebab-case names; warn at 300 lines, error at 500. TypeScript strict, no `any`, no `!`,
   no `@ts-ignore`.
7. Keep visible copy, `aria-*`, `data-*` attributes and CSS class names unless the task says
   otherwise (styles and tests depend on them).
8. Only display preferences may use `localStorage`; identity, balances and records are server-owned.

## Danger zone — do not change without an explicit request

- `legacy/` — never edit. It is the interim backend and the reference for behaviour.
- `apps/web/src/lib/apps.ts`, `src/proxy.ts` — host routing for all three production domains.
- `apps/web/src/app/api/[...path]/route.ts`, `src/lib/env.ts` (`backendHeaders`) — the backend's
  same-origin, CSRF and admin checks depend on the exact headers forwarded here.
- `src/lib/api/client.ts` demo rules — the demo sandbox must never reach real or admin APIs.
- `Dockerfile`, `docker/start.cjs`, `docker-compose.yml`, `.github/workflows/deploy.yml` —
  production deployment (1Panel, port 4188).
- Wire formats in `packages/contracts` — change only together with the backend team; update
  `docs/API_CONTRACT.md` in the same change.
- Generated / ignored: `apps/web/AGENTS.md` and `next-env.d.ts` (written by `next dev`),
  `.next/`, `coverage/`, `*.tsbuildinfo`. Do not edit or commit them.

## Commands

```sh
pnpm install
pnpm dev            # http://localhost:4188 → /  /terminal  /admin  /demo (starts the legacy API too)
pnpm lint           # eslint incl. layer boundaries
pnpm typecheck
pnpm test           # vitest (web + contracts)
pnpm test:legacy    # original backend tests (must stay green; you should not touch legacy/)
pnpm format         # prettier
pnpm build          # production build
```

## Definition of done

Before you finish a task: `pnpm format`, `pnpm lint` (0 errors), `pnpm typecheck`, `pnpm test`
and `pnpm build` all pass; new logic has a test next to it; docs updated when you change
architecture, routes or API usage. Keep changes inside the folders the task concerns, and say
which files you changed.

## Further reading

- `docs/ARCHITECTURE.md` — design, dependency graph, page recipes
- `docs/CONVENTIONS.md` — full coding conventions
- `docs/API_CONTRACT.md` — every endpoint the front-end uses (backend hand-off)
- `docs/ADR/` — why the key decisions were made
