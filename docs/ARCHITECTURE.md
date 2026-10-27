# OpenNEXT architecture

## Buyer verification and bank transfer extension

`features/buyer-kyb` owns Buyer forms and payment gates separately from supplier review.
`features/bank-transfer` owns shared top-up / Direct Pay instructions; `features/console-buyer-kyb`
owns private operations review. Optional ports in `lib/buyer-kyb.ts` have no live adapters until
secure backend contracts exist. Modals register in the Terminal composition root; `/admin/kyb`
defaults to Buyer, while `?tab=supplier` preserves the existing supplier queue.
ISO country data lives in `lib/countries.ts` with the procurement re-export retained, avoiding a
Buyer KYB / procurement import cycle. See [the handoff](BUYER_KYB_HANDOFF.md) for activation gates.

One Next.js application serves three hosts; one independent backend serves `/api/*`. Decisions
with lasting consequences are recorded in [`docs/ADR/`](ADR/README.md).

## Repository layout

```
apps/web/                 Next.js 16 application (all three front-ends)
  src/app/(site)/         opennextlab.ai            public website (static, ISR 5 min)
  src/app/terminal/       terminal.opennextlab.ai   Capacity Terminal (buyer / seller workspace, /demo sandbox)
  src/app/admin/          admin.opennextlab.ai      Operations Console
  src/app/api/[...path]/  transparent pass-through to the backend
  src/features/           business domains (one folder per domain, see below)
  src/terminal-kit/       the Capacity Terminal framework features build on
  src/components/         shared UI (dialog, icons, toast, providers, hooks)
  src/lib/                host resolution, env, API client, query keys, formatting, session store
  src/data/               static datasets (GPU catalog, model quotes)
  src/styles/             design tokens and base stylesheet
  src/test/               shared test harness
  src/proxy.ts            host → application routing
packages/contracts/       zod schemas and TypeScript types for every API the web app calls
legacy/                   the previous vanilla-JS site and its Node server (interim API, never edited)
docker/                   container entry point
docs/                     this folder (+ ADR/)
```

The backend is a separate process. Today it is the legacy Node server in `legacy/`
(zero dependencies, JSON-file persistence, background collectors). It will be replaced by the
Python API; `packages/contracts` and `docs/API_CONTRACT.md` describe what the front-end expects.

## Module graph

Imports may only point downwards. `eslint-plugin-boundaries` enforces the arrows and
`no-restricted-imports` forbids reaching into a feature past its `index.ts` (or `server.ts`).

```
src/app  (routes, layouts, composition roots)
  │
  ▼
src/features/<domain>   ──barrels only──►  src/features/<other>
  │
  ▼
src/terminal-kit  (UI store, routing, modal registry, slots, data hooks)
  │
  ▼
src/components  (dialog, icons, toast, providers, hooks)
  │
  ▼
src/lib  (apps, env, api client, query keys, format, session store)
  │
  ▼
@opennext/contracts        src/data, src/styles are leaves usable from any layer
```

`src/proxy.ts` is imported by nothing (Next loads it); `src/lib/env.ts` is `server-only`.

## One deployment, three hosts

`src/lib/apps.ts` contains the pure routing rule and `src/proxy.ts` applies it on every request:

| Request                              | Served by                      | Link base             |
| ------------------------------------ | ------------------------------ | --------------------- |
| `opennextlab.ai/*`                   | `src/app/(site)`               | ``                    |
| `terminal.opennextlab.ai/*`          | `src/app/terminal/*`           | ``                    |
| `terminal.opennextlab.ai/demo/*`     | `src/app/terminal/*` (demo on) | `/demo`               |
| `admin.opennextlab.ai/*`             | `src/app/admin/*`              | ``                    |
| local `/`, `/terminal/*`, `/admin/*` | same route trees               | `/terminal`, `/admin` |
| any other host (e.g. `127.0.0.1`)    | same route trees, by path      | `/terminal`, `/admin` |

Hosts come from `SITE_HOST`, `TERMINAL_HOST`, `ADMIN_HOST` (unset locally; read by
`src/lib/env.ts`). The proxy rewrites to the internal path and tags the request with the
`APP_HEADERS` (`x-on-app`, `x-on-base`, `x-on-demo`, `x-on-host`); the terminal and admin layouts
read the tags through `src/lib/request-app.ts` and expose them with `useApp()` so components never
hard-code a prefix. The public site layout reads nothing from the request so `/` stays static.

```tsx
const { href, crossHref } = useApp();
<Link href={href('/market')} />                 // inside the current app
<a href={crossHref('terminal', '/market')} />  // from the site to the terminal
```

**Unconfigured hosts.** When the hosts are configured but a request arrives on a different host
(the production image opened at `http://127.0.0.1:4188`, an IP, a staging alias), the apps are
served by path on that host and cross-app links stay there instead of jumping to production.
The console stays isolated: with `ADMIN_HOST` set, `/admin` on such a host is served to loopback
hosts only (`localhost`, `127.0.0.1`, `[::1]`) and is a 404 otherwise; its API still requires the
administrator session. Because the public site is statically rendered, `useApp()` resolves the
final cross-app origins from `location.host` right after hydration (`appOrigins(hosts, host)`).

Legacy entry points keep working: `/admin/`, `/terminal`, `/demo/` redirect exactly as the old
server did, and `#terminal/<route>` / `#<page>` hashes are mapped to real paths on the client
(`src/components/hooks/use-legacy-hash-redirect.ts`).

### API pass-through

`src/app/api/[...path]/route.ts` forwards every `/api/*` request to `API_ORIGIN` (default
`http://127.0.0.1:4189`) as a transparent pass-through: the client-facing `Host`, `Origin`,
cookies and CSRF headers reach the backend unchanged, so its same-origin checks and host scoping
(`/api/admin/*` only on the admin host, `/api/homepage/*` never on it) behave exactly as before.
`X-Forwarded-*` headers are passed through only when `OPENNEXT_TRUST_PROXY=1` (the production
container behind the HTTPS reverse proxy); locally they are dropped so the backend sees a direct
localhost client. The header policy lives in `backendHeaders()` in `src/lib/env.ts` and is shared
with the server-side session read in `src/features/auth/server.ts`. A `next.config` rewrite was
not usable because it replaces `Host` and invents forwarded headers
([ADR 0002](ADR/0002-api-pass-through-route.md)). The behaviour is covered by
`src/app/api/[...path]/route.test.ts`.

## Front-end structure

### Features

`src/features/<domain>/` owns one business domain and exports through `index.ts` (plus
`server.ts` for server-only helpers). The standard layout:

```
index.ts         public surface (components, hooks, modal maps, pure helpers)
api.ts           every backend call of the domain: (api: ApiClient, …) => Promise<Contract>
hooks.ts         TanStack Query / mutation wrappers around api.ts (optional)
store.ts         zustand store for UI state that crosses pages (optional)
components/      UI, one responsibility per file
<domain>.css     the domain stylesheet, imported once by the root component
*.test.ts(x)     vitest; render tests use src/test/render.tsx
```

Domains: `site`, `auth`, `market`, `terminal` (shell and generic pages), `procurement`,
`spot-market`, `instances`, `billing`, `account`, `seller`, `quotes`, `rfq-details`, `console`
(shell, store, dialogs and pages of the Operations Console), `console-leads`,
`console-marketplace`, `console-topups`, `pricing-admin`.

### Operations Console information architecture

The Console sidebar is organised around operations work, in this order: **Overview, Requests,
Orders, Instances, Price Source, Buyer RFQs, Supplier capacity, Platform agent, User**. `CONSOLE_PAGES` still
recognises older routes for compatibility; sidebar membership is the smaller `SIDEBAR_PAGES`
list in `features/console/pages.ts`. Hiding a route is not an authorization rule: administrator
host and session checks remain mandatory.

Paths below are Console-relative. Locally they have the `/admin` prefix; on the dedicated
Console host they do not. Build links with `useApp().href()`, not hard-coded prefixes.

| Section           | Relative route                                              | Ownership and behaviour                                                                                                                                         |
| ----------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview          | `/`                                                         | `console/pages/overview.tsx`; eight metrics and ten recent recorded decisions. Existing services are read through `console/api.ts` and query hooks.             |
| Requests          | `/requests`                                                 | Hub for `/payments`, `/topups`, `/leads`, `/kyb`, in that order. Payment confirmation and Credit top-up review are separate workflows.                          |
| Orders            | `/orders`                                                   | Platform-wide in-progress instance and RFQ orders; administrator order service pending.                                                                         |
| Instances         | `/instances?term=Spot`, `?term=On-demand`, `?term=Reserved` | Collected prices and a separate `view=terminal` view of eligible Terminal offers, with filters and Terminal-aligned columns.                                    |
| Price Source      | `/pricing`                                                  | `pricing-admin`; independent sidebar page between Instances and Buyer RFQs. Provider cards, run status/logs, configuration and official integration references. |
| Buyer RFQs        | `/rfqs`                                                     | `console-marketplace`; shared `rfq-details` renderer, revision-aware operations review and eligible homepage candidate review.                                  |
| Supplier capacity | `/supplies`                                                 | `console-marketplace`; submitted supply form details, filters, provenance and eligible homepage candidate review.                                               |
| Platform agent    | `/agent`, `/agent?tab=billing`                              | `AgentWorkspace` composes existing Platform agent and Agent billing pages without changing their execution policy.                                              |
| User              | `/users`                                                    | Platform user directory and server-owned totals/growth for `7D`, `1M`, `3M`, `6M`, `1Y`; administrator user service pending.                                    |

RFQ, supply, KYB and homepage review routes accept `?record=<id>` to open the matching work item
in a details dialog. Activity links use stable record IDs and UTC timestamps, not array
positions. Missing operator identity is shown as **Not recorded**, not invented. The current
activity view combines available marketplace audit, top-up reviews and contact history; it is
not a complete cross-service event ledger.

#### Server facts versus interface scaffolding

- Overview derives available metrics from provider, pricing, marketplace, top-up and contact
  responses. Missing services show `—` / **Awaiting backend**, never a fabricated zero. Queries
  refresh every 30 seconds while visible, retain a previous snapshot on transient failure and
  clear private data on authorization loss.
- A **price observation is not inventory**. Collected prices come from `/api/pricing/prices`;
  the separate Terminal feed comes from approved `/api/marketplace/public` offers through the
  same `spot-market` eligibility rules as Terminal. Offer counts, GPU counts and running
  purchased-instance counts must not be substituted for one another.
- The current collected-price read is capped at 5,000 records. Partial table lengths are not
  authoritative platform-wide aggregates. Complete Overview totals require backend aggregation
  as described in `API_CONTRACT.md`.
- `console/pages/operations-records.ts` contains read-only **view models**, not new wire
  contracts. Orders, payment confirmations, the complete user directory and running-instance
  totals remain unconnected until backend endpoints and contract tests are agreed.
- The 24 provider references document official integration surfaces and limitations. They do
  not implement collectors, grant permissions, establish inventory or imply that every provider
  supports all three rental terms. Availability comes from the backend registry and current
  records, not the number of logos.
- Homepage placement reuses the current-candidate/fingerprint review API. It covers the
  backend-selected highest public RFQ budget / lowest live supply price per GPU model.
  Arbitrary selection needs a new backend capability; the UI does not forge candidates or
  bypass review. RFQs map to **Inside OpenNEXT → Offer Capacity**; supply maps to
  **Inside OpenNEXT → Buy Capacity**.
- User notifications are backend-owned effects of completed operations. A successful browser
  request must not manufacture notifications or change Credit locally. Notification coverage
  and the proposed audited, idempotent outbox are documented in `API_CONTRACT.md`.

This redesign changes neither `legacy/` nor `packages/contracts`. Backend handoff proposals are
explicitly unimplemented until the backend team agrees the wire contracts.

### Terminal kit and composition root

`src/terminal-kit/` is the framework every terminal feature builds on and the only thing a
feature may depend on besides sibling barrels ([ADR 0003](ADR/0003-terminal-kit-composition-root.md)):

| Module                | Provides                                                                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `store.ts`            | `useWorkspaceStore`: UI-only state (role, filters, saved offers, cart, pending intents, modal). No server records.                                                                                                                                           |
| `context.tsx`         | `TerminalProvider`, `useTerminal()` (`route`, `go`, `openModal`, `closeModal`, `modal`).                                                                                                                                                                     |
| `routing.ts`          | terminal routes, role rules, `#terminal/…` hash mapping.                                                                                                                                                                                                     |
| `modal.tsx`           | typed modal registry: features augment `TerminalModalMap`, export a `ModalComponents` map, the root merges them with `composeModals` (duplicate keys throw). `ModalShell` is the frame.                                                                      |
| `slots.tsx`           | `TerminalSlots` (`headerBell`, `listingTable`, `matchesPanel`, `sshLibrary`, `modals`, `openContact`, `openOpportunity`, `services`) and `useTerminalSlots()`.                                                                                               |
| `services.ts`         | backend adapter interfaces (`AccountService`, `InstanceLifecycleAdapter`, Spot purchase). Undefined until the backend exposes them; features fail closed.                                                                                                    |
| `data.ts`             | every account / marketplace read as a query hook: `useWorkspace`, `usePublicMarket`, `useReferenceCatalog`, `useMatches`, `useSettlements`, `useBillingAccount`, `useBalance`, `useNotifications`, `useInvalidateWorkspace`, `useIntentResume`, `useIsDemo`. |
| `ui.tsx`, `export.ts` | `PageHeading`, `EmptyState`, `StatusTag`, `Button`; workspace CSV/JSON export.                                                                                                                                                                               |

`src/app/terminal/terminal-app.tsx` is the composition root: it is the only module that knows
every feature. It fills the slots (`NotificationBell` from quotes, `ListingTable` and
`MatchesPanel` from procurement, `SshKeyLibrary` from account), merges the modal maps of terminal,
procurement, billing, instances, spot-market and account, mounts headless integrations
(`ProcurementIntentResumer`, `BillingPolling`) and the `SpotCheckoutProvider`, and wires
`openContact` to the site's `ContactDialog`. `src/app/terminal/terminal-app.test.tsx` proves the
wiring. There are no registries, no `register*` functions and no DOM events between features.

### State

- **Server state** is TanStack Query only ([ADR 0004](ADR/0004-server-state-query-ui-state-zustand.md)).
  Keys come from `src/lib/api/query-keys.ts`; the legacy 30 s refresh is `refetchInterval`
  (visible tab only), writes call `useInvalidateWorkspace()`. Errors surface through
  `describeError()` (`src/lib/api/errors.ts`) and `useApiErrorToast()`.
- **UI state** lives in zustand stores: the kit workspace store plus feature stores (`seller`,
  `quotes`, `spot-market`, `console`, …). Stores hold preferences, drafts and open dialogs, never
  server records.
- **Session** is `useSessionStore` (`src/lib/session-store.ts`), seeded on the server by the
  terminal layout and confirmed by `GET /api/auth/session`.
- **Demo workspace**: `createApiClient({ demo: true })` rewrites sandboxed namespaces to
  `/api/demo/*` and refuses administrative calls; nothing else in the UI knows about demo mode.
- **Persistence**: only display preferences touch `localStorage` (`usePersistedPreference`), plus
  the illustrative instance example state (`features/instances/preview.ts`).

### Shared UI, styles, data

- `src/components/ui/dialog.tsx` is the single dialog implementation (native `<dialog>`, focus
  restore, Escape, outside click) used by every modal frame; `components/icons/` holds all icons;
  `components/ui/toast.tsx` the toast system.
- `src/styles/tokens.css` is the only `:root` (console overrides scoped to `.app-console`);
  fonts load through `next/font/google`. Feature stylesheets keep the legacy class names.
- `src/data/` holds the static GPU catalog and model quotes used by the site and the terminal.
- `packages/contracts/src/<resource>/` mirrors the backend resources (`auth`, `marketplace`,
  `billing`, `pricing`, `news`, `contact`, `demo`, `admin`, `account`); `_shared.ts` has the
  lenient parsers ([ADR 0005](ADR/0005-contracts-by-resource.md)).

## Page-authoring recipes

**Add a terminal page.** Create `src/app/terminal/<route>/page.tsx` that renders
`<TerminalPage><YourPage /></TerminalPage>` (the gate handles sign-in and onboarding), add the
route to `src/terminal-kit/routing.ts`, implement `YourPage` in a feature and export it from the
feature barrel. Read server data with the kit hooks, UI state with `useWorkspaceStore`.

**Add a modal.** In the feature, augment the map and export the component:

```ts
declare module '@/terminal-kit/modal' {
  interface TerminalModalMap {
    'my-feature-confirm': { id: string };
  }
}
export const myFeatureModals: ModalComponents = { 'my-feature-confirm': ConfirmDialog };
```

Add `myFeatureModals` to `composeModals(...)` in `terminal-app.tsx`; open it anywhere with
`useTerminal().openModal('my-feature-confirm', { id })`.

**Add a console page.** Add the key to `CONSOLE_PAGES` in `src/features/console/pages.ts`, the
page component under `src/features/console/pages/` (or a `console-<domain>` feature), and a thin
`src/app/admin/<route>/page.tsx`. Dialogs go in `src/features/console/dialogs/<domain>-dialogs.tsx`.

**Add an API call.** Declare the response schema in `packages/contracts/src/<resource>/index.ts`
(with a fixture in `contracts.test.ts`), add the typed call to the feature's `api.ts`, wrap it in
a hook in `hooks.ts` using a key from `src/lib/api/query-keys.ts`, and document the endpoint in
`docs/API_CONTRACT.md`.

**Add a slot or service.** Extend `TerminalSlots` / `TerminalServices` in the kit, fill it in
`terminal-app.tsx`, consume it with `useTerminalSlots()`; features must render the legacy
"not connected" copy when a service is undefined.

## Quality gates

`pnpm lint` (boundaries, `max-lines` warn 300 / error 500, `button-has-type`), `pnpm typecheck`
(strict + `noUncheckedIndexedAccess`), `pnpm test` (vitest with coverage thresholds), `prettier
--check` and `next build` run on every pull request (`.github/workflows/ci.yml`).

## Local development

```sh
pnpm install
pnpm dev         # http://localhost:4188 → /  /terminal  /admin  /demo
pnpm test        # vitest (web + contracts)
pnpm test:legacy # the original node --test suite
```

`pnpm dev` (`scripts/dev.cjs`) starts the interim API on 4189 and `next dev` on 4188 together;
`pnpm dev:web` / `pnpm dev:api` run them separately. The console works locally without an
administrator token because the backend sees a direct localhost client (see "API pass-through").

## Production

`Dockerfile` builds the Next standalone output and bundles the legacy API; `docker/start.cjs`
runs both in one container on port 4188 (same container name, port and volume as before), so
the 1Panel reverse proxy and the GitHub deploy workflow are unchanged. Set `API_ORIGIN` to
switch the container to an external backend and keep `OPENNEXT_TRUST_PROXY=1` behind the TLS
proxy.
