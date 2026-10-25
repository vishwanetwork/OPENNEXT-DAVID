# Architecture decision records

Short records of the decisions that shape `apps/web`. One file per decision; a superseded
record stays in place with its status updated.

| ID                                                  | Decision                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| [0001](0001-single-next-app-host-routing.md)        | One Next.js application, host-based routing, path-based locally     |
| [0002](0002-api-pass-through-route.md)              | `/api/*` is a transparent route-handler pass-through, not a rewrite |
| [0003](0003-terminal-kit-composition-root.md)       | Terminal kit + composition root instead of registries               |
| [0004](0004-server-state-query-ui-state-zustand.md) | TanStack Query for server state, zustand for UI state               |
| [0005](0005-contracts-by-resource.md)               | Contracts package organised by backend resource, parsed with zod    |
| [0006](0006-module-size-and-boundaries.md)          | Import boundaries and module-size limits enforced by lint           |
