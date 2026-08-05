# NEMS Docker Guide

## Multi-stage image (`docker/Dockerfile`)
Targets: `base`, `deps`, `build`, `production`, `development`, `worker`, `ai-runtime`, `migration`.

```
docker build -f packages/deploy/assets/docker/Dockerfile --target production -t nems:prod .
docker build -f packages/deploy/assets/docker/Dockerfile --target worker     -t nems:worker .
```

## Compose
- **Development**: `docker/docker-compose.yml` — Postgres, Redis, Qdrant, Ollama, Nginx, API, Workers.
- **Production**: `docker/docker-compose.production.yml` — production image target, replicas, resource
  limits, restart policies; secrets come from the environment, never the file.

```
docker compose -f packages/deploy/assets/docker/docker-compose.yml up
```

The production image runs as a non-root user (`nems`, uid 10001) and ships a `/health/live` healthcheck.
