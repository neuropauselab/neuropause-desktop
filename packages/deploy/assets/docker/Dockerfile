# NeuroPause Enterprise Management System — multi-stage production Dockerfile.
# Targets: base, deps, build, production, development, worker, ai-runtime, migration.
# syntax=docker/dockerfile:1.7

# ---- base: shared runtime ----
FROM node:22-bookworm-slim AS base
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --gid 10001 nems && useradd --uid 10001 --gid nems --shell /bin/bash --create-home nems

# ---- deps: install workspace dependencies ----
FROM base AS deps
COPY package.json package-lock.json* ./
COPY packages ./packages
RUN --mount=type=cache,target=/root/.npm npm ci --workspaces --include-workspace-root || npm install

# ---- build: typecheck + assemble ----
FROM deps AS build
COPY . .
RUN npx tsc --noEmit -p tsconfig.base.json || true

# ---- production: minimal API image ----
FROM base AS production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/package.json ./package.json
USER nems
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8080/health/live',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "packages/nems/dist/server.js"]

# ---- development: hot-reload image ----
FROM deps AS development
ENV NODE_ENV=development
COPY . .
USER nems
EXPOSE 8080 9229
CMD ["npx", "vitest", "--watch"]

# ---- worker: background/automation workers ----
FROM production AS worker
USER nems
CMD ["node", "packages/nems/dist/worker.js"]

# ---- ai-runtime: AI workforce runtime ----
FROM production AS ai-runtime
USER nems
CMD ["node", "packages/ai-runtime/dist/server.js"]

# ---- migration: one-shot database migration job ----
FROM deps AS migration
USER nems
CMD ["node", "packages/persistence/dist/migrate.js"]
