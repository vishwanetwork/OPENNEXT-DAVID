# 0003 — Terminal kit and a composition root instead of registries

Status: accepted (2026-10)

## Context

The first port of the terminal connected features through 17 `register*` functions, module
`let` slots and DOM `CustomEvent`s (`registerHeaderBell`, `registerTerminalModal`,
`registerWorkspaceRefresher`, …). Features imported each other's internals (152 deep imports,
4 import cycles), nothing was typed across the seams, and six hook points were never wired.

## Decision

`src/terminal-kit/` is the framework every terminal feature depends on: a UI-only zustand
workspace store, `TerminalProvider`/`useTerminal()`, routing rules, a typed modal registry
(`TerminalModalMap` augmentation, `composeModals`), `TerminalSlots` with backend `services`, and
the data hooks. `src/app/terminal/terminal-app.tsx` is the single composition root: it fills the
slots, merges the modal maps and mounts headless integrations. Features import only
`@/terminal-kit` and other features' barrels; lint enforces it.

## Consequences

- Every cross-feature dependency is visible in one 90-line file and proven by one test.
- Adding a feature means exporting a modal map and a component, then one line in the root.
- Backend capabilities that do not exist yet are `undefined` services; features fail closed
  with the legacy copy instead of fabricating results.
- Tests render features with explicit `slots` (`renderTerminal`), no global setup order.
