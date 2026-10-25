# OpenNEXT

Monorepo for the OpenNEXT website (`opennextlab.ai`), the Capacity Terminal
(`terminal.opennextlab.ai`) and the Operations Console (`admin.opennextlab.ai`).

- `apps/web` — Next.js front-end serving all three hosts (path-based locally)
- `packages/contracts` — API schemas shared with the backend team
- `legacy` — the previous implementation; its Node server is the interim backend
- `docs` — [architecture](docs/ARCHITECTURE.md), [porting conventions](docs/CONVENTIONS.md),
  [API contract](docs/API_CONTRACT.md), [migration status](docs/MIGRATION_STATUS.md)

```sh
pnpm install
pnpm dev:api   # interim backend on http://127.0.0.1:4189
pnpm dev       # http://localhost:4188  → /  /terminal  /admin  (/demo = sandbox)
pnpm test && pnpm lint && pnpm typecheck
```

Production: one container (`Dockerfile`) on port 4188 behind the existing reverse proxy, with
`SITE_HOST`, `TERMINAL_HOST`, `ADMIN_HOST` selecting the application per host. See
`docker-compose.yml` and `.env.example`.
