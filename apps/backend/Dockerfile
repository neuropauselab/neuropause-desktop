# syntax=docker/dockerfile:1
#
# Production image for the NeuroPause backend. Build context is the repo root
# (the backend is an npm workspace):
#   docker build -f apps/backend/Dockerfile -t <ref> .
#
# tsup bundles ALL @neuropause/* workspace packages into a self-contained dist,
# so the runtime image never resolves a workspace symlink (which would dangle
# once node_modules is copied out of the build tree).

# ---- Builder ----
FROM node:20-bookworm-slim AS builder
WORKDIR /repo

# Electron is a devDependency of apps/desktop and is never used by this image.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

# npm ci validates EVERY workspace manifest against the lockfile, so all 47
# workspaces must be present -- not the three this file used to copy.
# .dockerignore keeps node_modules/dist/out/release/.git out of the context.
# tsconfig.base.json is required: apps/backend/tsconfig.json declares
#   "extends": "../../tsconfig.base.json"
# Without it in the build context that target is absent inside /repo, esbuild
# treats the unresolvable extends as non-fatal, and the bundle compiles under
# the local compilerOptions alone. That is what happened in rc.1 and rc.2.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN npm ci

# Build the backend (dist/index.js + dist/db/migrate.js), stage the SQL migrations
# beside BOTH entrypoints and the seeds beside the bundle, then drop devDeps.
# The trailing `rm -rf node_modules/@neuropause` deletes 47 workspace symlinks
# whose targets (packages/, apps/) are never copied into the runtime stage, so
# they arrive there dangling. The assertion below proves dist carries no
# unbundled @neuropause/* requires, so nothing resolves them at runtime. A
# dangling symlink and an absent file fail identically; removing them only
# stops shipping 47 broken links.
RUN npm run build -w @neuropause/backend \
 && cp -r apps/backend/src/db/migrations apps/backend/dist/db/migrations \
 && cp -r apps/backend/src/db/seeds apps/backend/dist/seeds \
 && cp -r apps/backend/src/db/migrations apps/backend/dist/migrations \
 && npm prune --omit=dev \
 && rm -rf node_modules/@neuropause

# Build-time assertion. Any surviving require() of a workspace package is a
# guaranteed MODULE_NOT_FOUND at container start, because @neuropause/* resolve
# through symlinks that dangle in the runtime stage. Fail here, where it is cheap.
RUN if grep -rqE 'require\(.@neuropause/' --include='*.js' apps/backend/dist; then \
      echo 'FATAL: dist still resolves @neuropause/* at runtime (tsup noExternal miss)' >&2; \
      grep -rnE 'require\(.@neuropause/' --include='*.js' apps/backend/dist | head -20 >&2; \
      exit 1; \
    fi; \
    echo 'ASSERTION PASSED: no unbundled @neuropause/* requires in dist'

# ---- Runtime ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Provenance. .dockerignore excludes .git, so these arrive as build args.
ARG GIT_SHA=unknown
ARG GIT_TAG=unknown
LABEL org.opencontainers.image.title="neuropause-backend" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${GIT_TAG}"

# Run as a non-root user (uid 1001). The pod spec must ALSO set runAsNonRoot,
# runAsUser, allowPrivilegeEscalation=false, capabilities.drop=[ALL] and
# seccompProfile=RuntimeDefault to satisfy the restricted PSA policy.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs neuropause

COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/apps/backend/dist ./dist
COPY --from=builder /repo/apps/backend/package.json ./package.json

USER neuropause
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Kept for compose parity. WARNING: this runs migrations on every start and is
# NOT suppressed by RUN_MIGRATIONS_ON_BOOT=false. The k8s Deployment (4.4e) and
# migrate Job (4.6) MUST each set an explicit `command` to override it.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
