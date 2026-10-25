# Conventions (apps/web)

These rules keep the code base consistent. Most of them are enforced by `pnpm lint`,
`pnpm typecheck` and the CI workflow; the rest are reviewed.

## Goal: functional and visual parity first

- Reproduce the legacy behaviour, copy and layout exactly. Do not "improve" wording, flows or
  validation while porting; note ideas in `docs/MIGRATION_STATUS.md` instead.
- Keep every element that a user, a test or another module relies on: text, `aria-*`,
  `data-*` hooks that drive CSS, status labels, empty states, error messages.
- Keep safety semantics: server-owned identity, CSRF on writes, no fabricated confirmations,
  demo isolation, no admin calls from terminal code.

## Where things go

```
src/features/<domain>/
  index.ts              public exports of the feature (the only import path for other features)
  server.ts             server-only helpers (optional)
  <domain>.css          the domain stylesheet, legacy class names unchanged
  api.ts                every backend call: (api: ApiClient, …) => Promise<Contract>
  hooks.ts              useQuery/useMutation wrappers around api.ts (optional)
  store.ts              zustand store for UI state that crosses pages (optional)
  components/*.tsx      UI, one responsibility per file
  *.test.ts(x)          vitest + testing-library
src/app/<app>/<route>/page.tsx            thin page → feature component
src/app/terminal/terminal-app.tsx         composition root (slots, modal maps, integrations)
src/terminal-kit/                         framework for terminal features (store, routing, modals, slots, data hooks)
src/components/{ui,icons,hooks,providers} shared UI
src/lib/                                  apps, env, api client, errors, query keys, format, session store
src/data/                                 static datasets
packages/contracts/src/<resource>/index.ts zod schemas + types, one per backend resource
```

Domains: `site`, `auth`, `market`, `terminal`, `procurement`, `spot-market`, `instances`,
`billing`, `account`, `seller`, `quotes`, `rfq-details`, `console`, `console-leads`,
`console-marketplace`, `console-topups`, `pricing-admin`. See `docs/ARCHITECTURE.md` for the
dependency graph and the page-authoring recipes.

## Lint rules (what CI enforces)

| Rule                                 | Meaning                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `boundaries/element-types`           | app → features → terminal-kit → components → lib → contracts; `data`/`styles` are leaves.       |
| `boundaries/entry-point`             | other modules import a feature only through `index.ts` / `server.ts` (`modal.tsx` for the kit). |
| `no-restricted-imports`              | nothing imports `@/features/terminal` internals or `@/proxy`.                                   |
| `max-lines`                          | warn at 300, error at 500 (see "Module size").                                                  |
| `react/button-has-type`              | every `<button>` declares its type.                                                             |
| `react-hooks` (React Compiler rules) | no ref access during render, no synchronous `setState` in effects, stable deps.                 |
| prettier                             | `printWidth` 100, single quotes; `pnpm format` / `prettier --check` in CI.                      |
| TypeScript                           | `strict` + `noUncheckedIndexedAccess`; no `any`, no `!` assertions, no `@ts-ignore`.            |

## Code rules

1. **JSX, never HTML strings.** No `innerHTML`, `dangerouslySetInnerHTML` (except the static
   GCI iframe), no manual escaping. Event handlers replace `data-act` dispatch tables.
2. **Links** use `useApp().href()` / `crossHref()`; never hard-code `/terminal` or a hostname.
   Prefer `next/link` for in-app navigation.
3. **API** calls go through `useApi()` (`src/lib/api/client.ts`) and live in the feature's
   `api.ts`. Never call `fetch` directly. Declare the response schema in `@opennext/contracts`
   and parse with `Schema.parse` in `api.ts`. Report failures with `describeError()` /
   `useApiErrorToast()` from `src/lib/api/errors.ts`; a silent `catch {}` needs a comment.
4. **Server data** uses TanStack Query. Replicate legacy refresh behaviour with
   `refetchInterval` (visible-only via `refetchIntervalInBackground: false`),
   `refetchOnWindowFocus`, and keep the last snapshot on error (`placeholderData: keepPreviousData`).
5. **Session** comes from `useSessionStore` (`src/lib/session-store.ts`) populated by the auth
   feature. Role, onboarding and credit come from the verified user only.
6. **Persistence**: only display preferences may touch `localStorage`, through
   `usePersistedPreference` in `src/lib/persisted-preference.ts`. Legacy keys that stored
   customer records are dropped (the server owns them).
7. **Formatting** helpers live in `src/lib/format.ts` (`money`, `stampUtc`, `dateUtc`, `number`).
8. **Styles**: one stylesheet per feature, imported once from the feature's root component (or
   the app layout for shell styles); class names stay as in legacy. Design tokens live only in
   `src/styles/tokens.css` (`:root`, console overrides under `.app-console`); fonts come from
   `next/font`. No `@import url(` and no new `:root` blocks.
9. **Dialogs and icons**: every modal frame uses `src/components/ui/dialog.tsx` (`Dialog`,
   `NativeDialog`, `useDialogBehavior`); icons are React components in `src/components/icons/`
   (provider logos are static files under `public/provider-logos/`).
10. **No window globals, no registries.** Features never import each other's internals and never
    talk through DOM events or module-level mutable state. Cross-feature hooks go through the
    terminal kit slots and services, filled in the composition root. Shared things go to
    `src/components` or `src/lib`.
11. **TypeScript strict** (`noUncheckedIndexedAccess` on). No `any`; use the contract types.
    Narrow unknown API payloads with zod.
12. **Tests**: at least one vitest file per feature covering its pure logic and one render test
    per page. Render tests use `src/test/render.tsx` (`renderWithProviders`, `renderTerminal`
    with `slots` / `workspace` / `billing` seeding, `renderConsole`, `mockFetch`, `signIn`); the
    `next/navigation` mock is global (`vitest.setup.ts`). Coverage thresholds in
    `vitest.config.ts` only go up.
13. **Naming**: kebab-case file names, PascalCase components and types, camelCase everything else.
    Name things by what they are (`workspace`, `billing`, `selection`), never by legacy
    shorthand (`S`, `go`, `TButton`).
14. **Lint, typecheck and tests clean** (`pnpm lint`, `pnpm typecheck`, `pnpm test`) before
    finishing; `pnpm --filter @opennext/web build` for anything touching routing or layouts.

## Module size

`max-lines` warns at 300 lines and fails at 500 (blank lines and comments excluded). A file that
grows past 300 is a prompt to split by responsibility, not to compress. The usual seams are:

- a page keeps its data hooks and layout; tables, toolbars and cells move to sibling components
  (`inbox-page.tsx` → `inbox-tables.tsx`, `inbox-toolbar.tsx`, `inbox-cells.tsx`);
- dialogs live one domain per file (`billing/components/{order-modal,payment-flow}.tsx`);
- pure logic leaves the component (`console/pages/market-data.ts`, `market/regional-history.ts`).

Exempt from the hard limit: `src/data/**` (static fixtures) and the spot checkout state machine.

## Legacy sources

The minified originals are in `legacy/`. Make pretty-printed copies for reading (never edit
`legacy/` itself):

```sh
mkdir -p /tmp/legacy-pretty && cp legacy/OpenNEXT-*.js legacy/OpenNEXT-*.cjs legacy/OpenNEXT-*.css /tmp/legacy-pretty/
npx prettier@3 --print-width 110 --write "/tmp/legacy-pretty/*.{js,cjs,css}"
```

## Tracking

Update `docs/MIGRATION_STATUS.md` when a module is ported: legacy file → new location, what was
intentionally left out, open questions for the backend team.

## Terminal feature API

Pages under `src/app/terminal/<route>` wrap their content in `TerminalPage` (sign-in / onboarding
gate). Features import only from `@/terminal-kit` and sibling barrels:

| Need                                       | Use                                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI state (role, filters, cart, intents)    | `useWorkspaceStore` (select fields; `patch()` to update)                                                                                                                              |
| Server records                             | `useWorkspace()`, `useWorkspaceData()`, `usePublicMarket()`, `useReferenceCatalog()`, `useMatches()`, `useSettlements()`, `useBillingAccount()`, `useBalance()`, `useNotifications()` |
| After a write                              | `useInvalidateWorkspace()`; `useRefreshBillingAccount()` for billing                                                                                                                  |
| Navigation                                 | `useTerminal().go(route)` (role rules + pending route), `useTerminal().route`                                                                                                         |
| Modals                                     | augment `TerminalModalMap`, export a `ModalComponents` map, `useTerminal().openModal(type, payload)` / `closeModal()`; `ModalShell` frame                                             |
| Toasts / errors                            | `useToast()`, `useApiErrorToast()`                                                                                                                                                    |
| Page chrome                                | `PageHeading`, `StatusTag`, `Button`, `EmptyState`                                                                                                                                    |
| Hook points filled by the composition root | `useTerminalSlots()`: `headerBell`, `listingTable`, `matchesPanel`, `sshLibrary`, `openContact`, `openOpportunity`, `services`                                                        |
| Site → terminal intents                    | `useIntentResume(handler)`; pending intents live in `pendingListing` / `pendingOpportunity`                                                                                           |
| Market data                                | `@/features/market`: `usePrices`, `useRegions`, `useRegionalHistory`, `offersFor`, `RegionalHistoryChart`, `InsightIndex`                                                             |

Demo mode needs nothing special: `useApi()` already routes sandboxed calls to `/api/demo/*`, and
`useIsDemo()` tells a feature when it runs inside the sandbox.
