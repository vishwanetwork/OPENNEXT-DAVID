# 0004 — TanStack Query for server state, zustand for UI state

Status: accepted (2026-10)

## Context

Legacy modules refreshed `/api/marketplace/me` from their own 30 s loops, kept records in a
mutable `S` object and re-narrowed `Record<string, unknown>` collections at every use. The
first port carried that over: a shell interval calling registered refreshers, a 17-collection
untyped workspace store, and a parallel set of `useQuery` calls.

## Decision

Server records are read only through TanStack Query hooks in `src/terminal-kit/data.ts` (and
feature `hooks.ts`), with keys from `src/lib/api/query-keys.ts`. The legacy refresh behaviour is
expressed as `refetchInterval` (visible tab only), `refetchOnWindowFocus` and
`placeholderData: keepPreviousData`; writes call `useInvalidateWorkspace()`. zustand stores hold
UI state only (role, filters, cart, drafts, open dialogs) and are typed from the contracts.
Module-level singletons are not allowed; what must outlive a component lives in a store.

## Consequences

- One source of truth per record; identity switches (sign-out, demo) are a key change.
- Components subscribe to slices, so a refresh re-renders only what changed.
- Tests seed the query cache (`seedAccount`) instead of mocking refresh loops.
- The 30 s cadence is a per-query setting, visible in one place per endpoint.
