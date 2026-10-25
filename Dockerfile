# syntax=docker/dockerfile:1
# Builds the Next.js front-end (standalone output) and bundles the interim legacy API.
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY legacy/package.json legacy/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @opennext/web build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=4188 API_PORT=4189
WORKDIR /app
# Next standalone output (includes its own pruned node_modules)
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
# Interim backend (dependency-free Node service)
COPY legacy/package.json ./legacy/
COPY legacy/*.cjs legacy/*.js legacy/*.html legacy/*.css ./legacy/
COPY legacy/admin ./legacy/admin
COPY legacy/data ./legacy/data
COPY docker/start.cjs ./docker/start.cjs
RUN mkdir -p /app/.opennext-data && chown -R node:node /app
USER node
EXPOSE 4188
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4188/api/pricing/status >/dev/null || exit 1
CMD ["node", "docker/start.cjs"]
