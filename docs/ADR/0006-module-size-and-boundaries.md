# 0006 — Import boundaries and module-size limits enforced by lint

Status: accepted (2026-10)

## Context

The vibe-coded origin left 1,289-line hook files, 700-line pages and imports that reached
anywhere. Review comments do not scale; the rules had to be mechanical.

## Decision

`eslint-plugin-boundaries` defines folder elements (`app`, `proxy`, `terminal-kit`, `features`,
`components`, `lib`, `data`, `styles`, `test`) and allows imports only down the graph
(app → features → terminal-kit → components → lib → contracts; `data`/`styles` are leaves).
Features are entered only through `index.ts`/`server.ts`; `no-restricted-imports` blocks
`@/features/terminal` internals and `@/proxy`. `max-lines` warns at 300 and fails at 500
(static fixtures and the spot checkout state machine are the only exemptions). TypeScript runs
with `strict` and `noUncheckedIndexedAccess`; coverage thresholds in `vitest.config.ts` only
move up. CI runs format, lint, typecheck, tests and build on every pull request.

## Consequences

- Structure violations fail the build instead of waiting for a reviewer.
- Splitting a module is routine: by responsibility, following `docs/CONVENTIONS.md`.
- Raising a threshold or adding an exemption is a visible, reviewable diff.
