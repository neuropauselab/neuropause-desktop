# syntax=docker/dockerfile:1
#
# Production image for the NeuroPause backend. Build context is the repo root
# (the backend is an npm workspace):
#   docker build -f apps/backend/Dockerfile -t neuropause-backend .
#
# tsup bundles @neuropause/shared into a self-contained dist, so the runtime image
# only needs the backend's external production dependencies.

# ---- Builder ----
FROM node:20-bookworm-slim AS builder
WORKDIR /repo

# Workspace manifests first, for dependency-layer caching.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/desktop/package.json apps/desktop/
RUN npm ci

# Build the backend (produces dist/index.js and dist/db/migrate.js), stage the SQL
# migrations next to the compiled migrator, then drop dev dependencies. The Electron
# app's heavy tooling is all dev-only, so the pruned tree stays lean.
COPY packages/shared packages/shared
COPY apps/backend apps/backend
RUN npm run build -w @neuropause/backend \
# Runtime assets must ship beside BOTH entrypoints (bundle resolves dist/*, standalone migrator dist/db/*)
# Seeds must ship beside the bundle (seed.ts resolves dist/seeds) — omission crashed fresh-DB prod boots; fixed 2026-07-03.
 && cp -r apps/backend/src/db/migrations apps/backend/dist/db/migrations \
 && cp -r apps/backend/src/db/seeds apps/backend/dist/seeds \
 && cp -r apps/backend/src/db/migrations apps/backend/dist/migrations \
 && npm prune --omit=dev

# ---- Runtime ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Run as a non-root user.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs neuropause

COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/apps/backend/dist ./dist
COPY --from=builder /repo/apps/backend/package.json ./package.json

USER neuropause
EXPOSE 4000

# Liveness probe (process up; dependency checks live at /health for readiness).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Apply pending migrations, then start the API. For multi-replica deploys, run
# migrations as a separate one-off step instead of on every container start.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
