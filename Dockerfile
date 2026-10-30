# syntax=docker/dockerfile:1
# Builds the Next.js front-end (standalone output) and bundles the interim legacy API.
# With SPOTBOT_SOURCE=image it also bundles the SpotOrderBot adapter (Spot purchases, Credit
# charges, Buyer KYB, bank transfers, payment review, instance usage, notices) and ClamAV,
# taken from the private spot-order-bot image; the container runs them when OPENNEXT_ADAPTER=1.
ARG SPOTBOT_SOURCE=none
ARG SPOTBOT_IMAGE=ghcr.io/vishwanetwork/spot-order-bot:ee488d1565fcf680ba151bf0627072c4bcbb1554

# Adapter source: the spot-order-bot image (its /app), or nothing for the plain image.
FROM ${SPOTBOT_IMAGE} AS spotbot-image
FROM node:22-alpine AS spotbot-none
RUN mkdir -p /app
FROM spotbot-${SPOTBOT_SOURCE} AS spotbot

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
# Hosts baked into the statically rendered public site; runtime env still wins after revalidation.
ARG SITE_HOST=opennextlab.ai
ARG TERMINAL_HOST=terminal.opennextlab.ai
ARG ADMIN_HOST=admin.opennextlab.ai
ENV SITE_HOST=$SITE_HOST TERMINAL_HOST=$TERMINAL_HOST ADMIN_HOST=$ADMIN_HOST
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
COPY docker/start.cjs docker/clamd.conf docker/freshclam.conf ./docker/
# Bundled adapter (only when built with SPOTBOT_SOURCE=image): Python, the spotbot package in a
# virtual environment, and ClamAV. Signatures live in the data volume, refreshed by freshclam.
COPY --from=spotbot /app /opt/spotbot-src
RUN if [ -f /opt/spotbot-src/pyproject.toml ]; then \
      apk add --no-cache python3 clamav clamav-daemon freshclam \
      && python3 -m venv /opt/spotbot \
      && /opt/spotbot/bin/pip install --no-cache-dir '/opt/spotbot-src[mysql]' \
      && rm -rf /opt/spotbot-src; \
    else rm -rf /opt/spotbot-src; fi
RUN mkdir -p /app/.opennext-data && chown -R node:node /app
USER node
EXPOSE 4188
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4188/api/pricing/status >/dev/null || exit 1
CMD ["node", "docker/start.cjs"]
