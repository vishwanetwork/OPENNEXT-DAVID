# Porting conventions (legacy → apps/web)

These rules keep the migration consistent. Every ported module must follow them.

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
  index.ts              public exports of the feature
  <domain>.css          legacy stylesheet(s) copied here, class names unchanged
  api.ts                typed calls: (api: ApiClient) => Promise<Contract>
  hooks.ts              useQuery/useMutation wrappers around api.ts
  store.ts              zustand store when state crosses pages (optional)
  components/*.tsx      UI
  *.test.tsx            vitest + testing-library
src/app/<app>/<route>/page.tsx   thin page → feature component
packages/contracts/src/<domain>/index.ts   zod schemas + types for every endpoint used
```

Domains: `site` (landing, listings, ticker, contact), `auth`, `market` (prices, history,
charts, insight), `procurement` (RFQs, supply, quotes, rfq-details), `instances`, `billing`
(billing, payments, top-ups), `account` (profile, settings, help), `seller`, `console-*`
(admin pages), `pricing-admin` (provider console).

## Code rules

1. **JSX, never HTML strings.** No `innerHTML`, `dangerouslySetInnerHTML` (except the static
   GCI iframe), no manual escaping. Event handlers replace `data-act` dispatch tables.
2. **Links** use `useApp().href()` / `crossHref()`; never hard-code `/terminal` or a hostname.
   Prefer `next/link` for in-app navigation.
3. **API** calls go through `useApi()` (`src/lib/api/client.ts`). Never call `fetch` directly.
   Declare the response schema in `@opennext/contracts` and parse with `Schema.parse` in `api.ts`.
4. **Server data** uses TanStack Query. Replicate legacy refresh behaviour with
   `refetchInterval` (visible-only via `refetchIntervalInBackground: false`),
   `refetchOnWindowFocus`, and keep the last snapshot on error (`placeholderData: keepPreviousData`).
5. **Session** comes from `useSessionStore` (`src/lib/session-store.ts`) populated by the auth
   feature. Role, onboarding and credit come from the verified user only.
6. **Persistence**: only display preferences may touch `localStorage`, through
   `usePersistedPreference` in `src/lib/persisted-preference.ts`. Legacy keys that stored
   customer records are dropped (the server owns them).
7. **Formatting** helpers live in `src/lib/format.ts` (`money`, `stampUtc`, `dateUtc`, `number`).
8. **Styles**: copy the legacy CSS file into the feature folder and import it once from the
   feature's root component (or the app layout for shell styles). Do not rename classes and keep
   each file's `:root` block as-is for now (each app loads its own set, so they do not clash).
   Add new rules only when React structure forces it.
9. **Icons and logos**: port only the SVGs actually referenced, as small React components in
   `src/components/icons/` (terminal) or `public/provider-logos/*.svg` (console).
10. **No window globals**, no cross-feature imports of internals. Shared things go to
    `src/components` or `src/lib`.
11. **TypeScript strict.** No `any`; use the contract types. Narrow unknown API payloads with zod.
12. **Tests**: at least one vitest file per feature covering the pure logic that legacy tests
    covered (look in `legacy/tests/*.test.cjs` for the behaviours worth keeping) and one render
    smoke test per page.
13. **Lint and typecheck clean** (`pnpm lint`, `pnpm typecheck`) before finishing.

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
gate) and import what they need from `@/features/terminal`:

| Need | Use |
| --- | --- |
| Legacy `S` state | `useWorkspaceStore` (fields match `S`; `patch()` / `setExtra()` for feature-specific data), `findOffer` |
| Legacy `go()` | `useGo()` (role rules + pending route), `useTerminal().route` |
| Legacy `open()` / modals | `useOpenModal()`, `useCloseModal()`; register your modal types with `registerTerminalModal(modal => ModalRender | null)`; `ModalShell` for the frame |
| Legacy `toast()` | `useToast()` |
| Legacy `pageHead()` / `badge()` / `button()` | `PageHeading`, `StatusTag`, `TButton`, `EmptyState` |
| Workspace refresh loop (30 s) | `registerWorkspaceRefresher(async () => …)` in a `useEffect`; call `refreshWorkspace()` after writes |
| Listing / opportunity intents from the site | `registerIntentResumer(fn)`; pending intents live in `pendingListing` / `pendingOpportunity` |
| Hook points the shell exposes | `registerOpportunityOpener`, `registerContactOpener`, `registerHeaderBell`, `registerMatchesPanel`, `registerListingTable` |
| Market data | `@/features/market`: `usePrices`, `useRegions`, `useRegionalHistory`, `offersFor`, `RegionalHistoryChart`, `InsightIndex`, `listModelQuotes` |

Replace a stub page by editing `src/app/terminal/<route>/page.tsx`; keep the `TerminalPage` wrapper.
Demo mode needs nothing special: `useApi()` already routes sandboxed calls to `/api/demo/*`.
