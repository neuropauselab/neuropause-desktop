# Deploying the NeuroPause Backend

This guide covers running the NeuroPause backend (the cloud API) in production with
Docker Compose: build, configure, run, observe, and back up. The desktop app is
distributed separately; this is the server it talks to.

## What runs

The production stack (`docker-compose.prod.yml`) is three containers:

- **backend** — the Express API, built from `apps/backend/Dockerfile`. It applies
  database migrations on start, then serves on port 4000.
- **postgres** — PostgreSQL 16, the system of record, on a named volume `pgdata`.
- **redis** — Redis 7 (append-only persistence) on a named volume `redisdata`.

`docker-compose.yml` (no `.prod`) is a *different* file: local-dev infrastructure
(Postgres, Redis, Meilisearch, Qdrant) with no backend container, for running the API
from source via `npm`. Use the `.prod` file for deployment.

## Prerequisites

- Docker Engine + Compose v2 (`docker compose version`).
- Roughly 1 GB RAM for the stack to start comfortably.

## 1. Configure

Copy the template and fill in the required values:

```
cp .env.example .env
```

The backend validates its configuration at boot and refuses to start if it is
malformed. Required values:

- `POSTGRES_PASSWORD` — a strong password for the database.
- `JWT_ACCESS_SECRET` — at least 32 characters. Generate one:

  ```
  openssl rand -hex 32
  ```

Everything else is optional or defaulted:

- OAuth providers (`GOOGLE_*`, `GITHUB_*`, `MICROSOFT_*`, `APPLE_*`) — leave blank to
  disable a provider.
- Billing (`RAZORPAY_*`) — billing stays disabled until the key id and secret are set.
- `BACKEND_PORT` — the host port to publish (the container always listens on 4000).

`DATABASE_URL` and `REDIS_URL` are **injected by Compose** to point at the service
containers; you do not set them for the production stack.

## 2. Build and run

```
docker compose -f docker-compose.prod.yml config
docker compose -f docker-compose.prod.yml up -d --build
```

`config` validates the file and prints the fully resolved configuration. `up` builds
the backend image and starts the stack. Because `depends_on` is gated on health, the
backend starts only after Postgres and Redis report healthy; on start it runs
`node dist/db/migrate.js` to apply pending migrations, then launches the API.

Check it:

```
docker compose -f docker-compose.prod.yml ps
curl -fsS http://localhost:4000/live
curl -fsS http://localhost:4000/health
```

## 3. Health and readiness

The backend exposes two probes:

- **`/live`** — liveness. Returns 200 whenever the process is up; it performs no
  dependency checks, so a transient database/redis blip will not cause an orchestrator
  to restart the container. The container `HEALTHCHECK` uses this.
- **`/health`** — readiness. Checks Postgres and Redis and returns 200 when both are
  reachable, 503 otherwise. Use this for a load balancer's readiness check.

## 4. Migrations

For the single-instance Compose stack, migrations run automatically on container
start. If you scale the backend to multiple replicas, do **not** rely on every
replica migrating on boot — run migrations once as a separate step and start the API
without the migrate command, for example:

```
docker compose -f docker-compose.prod.yml run --rm backend node dist/db/migrate.js
```

## 5. Backups and restore

Two scripts wrap `pg_dump`/`psql` against the Compose Postgres container. They read
the database name and user from the container's own environment, so they need no
credentials.

Back up (writes a timestamped, gzip-compressed dump to `./backups`, keeping the most
recent 14 by default):

```
scripts/backup-db.sh
```

Restore from a specific dump (asks for confirmation; overwrites the database):

```
scripts/restore-db.sh backups/neuropause-db-YYYYMMDD-HHMMSS.sql.gz
```

Schedule regular backups with cron, e.g. nightly at 02:30:

```
30 2 * * * cd /path/to/neuropause-desktop && scripts/backup-db.sh >> backups/backup.log 2>&1
```

Keep the `./backups` directory (and the `pgdata` volume) on durable, backed-up
storage. Test a restore periodically — an untested backup is not a backup.

## 6. Logs and monitoring

The backend logs structured JSON (pino), one line per request plus application events.

```
docker compose -f docker-compose.prod.yml logs -f backend
```

Ship these to your log stack (Loki, ELK, CloudWatch, …) via your Docker logging
driver. For metrics/alerting, poll `/health` from your monitoring system and alert on
non-200 or on container restarts.

## 7. Updating

Pull the new code, rebuild, and roll the stack. Migrations apply on start.

```
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Take a backup first (`scripts/backup-db.sh`) so you can roll back the data if needed.

## 8. Teardown

Stop the stack (data volumes are preserved):

```
docker compose -f docker-compose.prod.yml down
```

Stop **and delete the data volumes** (irreversible — destroys the database):

```
docker compose -f docker-compose.prod.yml down -v
```

## Security notes

- Never commit a real `.env`. Secrets belong in your secret manager or the host's
  environment, not in the image.
- The backend runs as a non-root user inside the container.
- Terminate TLS at a reverse proxy in front of the backend; the API speaks plain HTTP
  inside the Compose network.
