# NEMS DevOps Guide

## Pipelines (`github-workflows/`, install to `.github/workflows/`)
- **ci.yml** — typecheck, lint, and the full `packages` test suite on every push/PR.
- **container.yml** — build & push the production image on tags.
- **release.yml** — release candidate → production release (gated by an environment approval).
- **tag.yml** — validate semver and create a `v*` tag.
- **nightly.yml** — nightly full-suite run.
- **rollback.yml** — Helm rollback to a chosen revision (environment-gated).

## Local development
```
docker compose -f packages/deploy/assets/docker/docker-compose.yml up
```

## Promotion flow
`dev` → `qa` → `staging` → `production`. Production promotion requires a human approval on the
GitHub `production` environment; nothing self-promotes.
