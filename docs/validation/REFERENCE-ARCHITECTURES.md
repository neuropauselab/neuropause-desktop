# NeuroPause — Reference Architectures

**Audience:** platform engineers and architects deciding how to stand up the NeuroPause
backend (`apps/backend`) for dev, cloud, or on-prem/air-gapped use.

**Scope of honesty.** Every architecture below is assembled *only* from artifacts that
exist in this repository — the production Dockerfile, the Compose files, the raw
Kubernetes manifests, the Helm chart, and the offline-bundle script. Where a tier is
supplied by external infrastructure (managed Postgres, an ingress controller, a Prometheus
stack) or is **modeled** rather than shipped (federation DR, enterprise SAML SSO), it is
labelled as such. Nothing here implies a running cluster, region, or failover the repo does
not contain — the same line `deploy/README.md:83-90` draws.

This document is the *topology* view. It complements — does not duplicate — the day-2
`docs/guides/OPERATIONS-GUIDE.md`, the `docs/guides/DISASTER-RECOVERY-GUIDE.md`, and the
step-by-step `docs/validation/DEPLOYMENT-PLAYBOOKS.md`.

---

## Building blocks (the real components)

| Component | What it is | Where it comes from | Notes |
|---|---|---|---|
| **Backend API** | Node 20 + Express, stateless | `apps/backend/Dockerfile` (multi-stage, non-root uid 1001, `EXPOSE 4000`) | Serves `/live`, `/health`, `/metrics` + auth/store routers. `CMD` = `node dist/db/migrate.js && node dist/index.js` |
| **Postgres** | System of record | `postgres:16-alpine` (Compose) or **managed** (K8s) | Reached only via `DATABASE_URL`. 12 forward-only migrations in `apps/backend/src/db/migrations/` |
| **Redis** | OAuth-flow state + rate-limit backing | `redis:7-alpine` (Compose, `--appendonly yes`) or **managed** (K8s) | Reached only via `REDIS_URL`. Rate limiter **fails open** when Redis is down (deliberate availability choice, `_grounding.md`) |
| **Qdrant** | Vector store for semantic search | `qdrant/qdrant:v1.9.0` (dev `docker-compose.yml` only) | Reserved for later phases; not wired into the prod Compose/K8s paths |
| **Desktop client** | Electron app (macOS) | `apps/desktop` | Talks to the backend over HTTPS; its telemetry is **in-process/IPC-only**, never a network scrape target (`OPERATIONS-GUIDE.md`) |

**Configuration contract (identical across every architecture).** The backend refuses to
start without `DATABASE_URL`, `REDIS_URL`, and a `JWT_ACCESS_SECRET` (≥ 32 chars). Two flags
are set to the safe value in every production manifest:

- `RUN_MIGRATIONS_ON_BOOT=false` — migrations run as a deliberate step, not on every pod boot.
- `SEED_STORE_ON_BOOT=false` — the store catalog starts **empty**; no fabricated apps/ratings.

---

## Telemetry plane (where signals are scraped, in every architecture)

Only **one** network-reachable scrape target exists: the backend `/metrics` endpoint. Fix
this in your head before reading the diagrams.

| Signal | Endpoint / source | Series / fields | Consumer |
|---|---|---|---|
| Liveness | `GET /live` (`app.ts:84`) | `{status:'alive', uptime}` | Orchestrator liveness probe; container `HEALTHCHECK` |
| Readiness | `GET /health` (`app.ts:88`) | `{status:'ok'\|'degraded', components:{database,redis}, uptime}`; 200 up / 503 degraded | LB / K8s readiness; blackbox probe |
| Metrics | `GET /metrics` (`app.ts:99`) | `neuropause_backend_up`, `..._uptime_seconds`, `..._resident_memory_bytes`, `..._heap_used_bytes`, `neuropause_pg_pool_connections{state="total\|idle\|waiting"}`, `neuropause_http_requests_total{method,status}` | Prometheus |
| Audit trail | Postgres `audit_log` table | append-only privileged-action records | SQL query / log pipeline (not scraped) |

`/metrics` is **unauthenticated by design** and must be network-restricted — loopback bind in
Compose, a scrape-only path / `NetworkPolicy` in Kubernetes (`app.ts:98`, `deploy/README.md:76-81`).

---

## Architecture 1 — Single-node / dev

The fully-operational baseline today: the whole stack (API + Postgres + Redis) on one host
via Docker Compose. Also the shape a developer runs locally with `npm run dev`.

```
                         single host (dev laptop / one VM)
   ┌───────────────────────────────────────────────────────────────────┐
   │                                                                     │
   │   docker-compose.prod.yml            (or dev: docker-compose.yml    │
   │   ┌───────────────────────┐           + `npm run dev`)              │
   │   │  backend (Express)    │  :4000 bound to 127.0.0.1 (loopback)    │
   │   │  apps/backend/Dockerfile ─┐                                     │
   │   └──────┬─────────┬──────┘   │  GET /live  /health  /metrics       │
   │          │         │          └──────────────► (local Prometheus,   │
   │  DATABASE_URL   REDIS_URL                        or curl)            │
   │          │         │                                                │
   │   ┌──────▼─────┐ ┌─▼──────────┐                                     │
   │   │ postgres   │ │ redis      │  (dev also: qdrant :6333/:6334)     │
   │   │ 16-alpine  │ │ 7-alpine   │                                     │
   │   │ vol pgdata │ │ appendonly │                                     │
   │   └────────────┘ └────────────┘                                     │
   └───────────────────────────────────────────────────────────────────┘
```

**Components & real assets.**

| Concern | Asset | Path |
|---|---|---|
| Dev infra (PG/Redis/Qdrant) | dev Compose; `npm run infra:up` → `docker compose up -d` | `docker-compose.yml`, `package.json:21` |
| Prod single-host stack | prod Compose (`up -d --build`) | `docker-compose.prod.yml` |
| Image | multi-stage build, non-root | `apps/backend/Dockerfile` |
| Migrations | forward-only migrator | `apps/backend/src/db/migrations/` (12 files) |
| Backup / restore | operator-run `pg_dump`/`psql` | `scripts/backup-db.sh`, `scripts/restore-db.sh` |

**Data flow.** Desktop/client → `http://127.0.0.1:4000` → backend → Postgres (`DATABASE_URL`)
for the system of record and Redis (`REDIS_URL`) for OAuth-flow state. In prod Compose the
backend port is bound to `127.0.0.1:${BACKEND_PORT:-4000}` (`docker-compose.prod.yml:63`), so
`/metrics` is loopback-only until you put a reverse proxy in front.

**Telemetry scrape.** `/metrics` on loopback — a co-located Prometheus or a `curl` scrape. No
external target. `audit_log` is queried directly in Postgres.

**Honest notes.** Single Postgres and single Redis container: **not HA**. No off-host backup
by default (`./backups` sits on the same host). This is the documented
"fully-operational production deployment today" for a single-tenant/private-cloud footprint
(`deploy/README.md:87-90`), not a resilient multi-node design.

---

## Architecture 2 — Kubernetes + managed Postgres/Redis

The horizontally-scalable cloud shape. The cluster runs **only** the stateless backend; the
datastores are **managed, HA services** reached through a Secret. This is the pattern the
manifests were written for (`deploy/kubernetes/backend.yaml:6-7`).

```
        ┌─────────────── managed / HA (outside the cluster) ───────────────┐
        │   Managed Postgres (PITR, replicas)      Managed Redis (HA)       │
        └───────▲──────────────────────────────────────────▲───────────────┘
                │ DATABASE_URL (Secret)                     │ REDIS_URL (Secret)
   ┌────────────┼───────────────────── Kubernetes namespace: neuropause ────┐
   │            │                                                            │
   │   ┌────────┴─────────┐   run-once, before serving                      │
   │   │ Job: ...-migrate │  node dist/db/migrate.js  (backoffLimit 3)      │
   │   └──────────────────┘                                                 │
   │                                                                        │
   │   Deployment neuropause-backend  (replicas: 2, RollingUpdate           │
   │   ┌─────────┐ ┌─────────┐         maxUnavailable:0 / maxSurge:1)       │
   │   │ pod :4000│ │ pod :4000│  livenessProbe /live  readinessProbe /health│
   │   └────┬────┘ └────┬────┘   annot. prometheus.io/scrape /metrics :4000 │
   │        └─────┬─────┘                                                    │
   │        Service (ClusterIP :80 → http)                                  │
   │              │                                                         │
   │        Ingress (nginx, TLS terminates here)  ── optional.yaml ──►      │
   │              │                                HPA cpu 70% (2→6)        │
   └──────────────┼─────────────────────────────────────────────────────────┘
                  ▼
             clients (https://api.neuropause.example)     Prometheus ──scrapes──► pod :4000/metrics
```

**Components & real assets.**

| Object | Kind | Path |
|---|---|---|
| Namespace / ConfigMap / migrate Job / Deployment / Service | core manifest | `deploy/kubernetes/backend.yaml` |
| HPA (autoscaling/v2, min 2 / max 6, cpu 70%) + Ingress (nginx, TLS) | optional manifest | `deploy/kubernetes/optional.yaml` |
| Secret (`DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`) | example only | `deploy/kubernetes/secret.example.yaml` |
| Same, parameterized | Helm chart (8 templates) | `deploy/helm/neuropause-backend/` |

**Hardening baked into the manifests.** `runAsNonRoot` uid 1001, `readOnlyRootFilesystem:
true`, `allowPrivilegeEscalation: false`, `capabilities.drop: ["ALL"]`, `seccompProfile:
RuntimeDefault`, and a writable `emptyDir` at `/tmp` only (`backend.yaml:126-180`). The
Deployment's `maxUnavailable: 0` + the `/health` readiness probe give a zero-downtime
rolling update on a real cluster.

**Data flow.** Client → Ingress (TLS terminates; backend speaks plain HTTP by design,
`optional.yaml:4-5`) → Service `:80` → pod `:4000`. Each pod reaches managed Postgres/Redis
via the Secret. Migrations are a **gated one-off Job** so a bad migration fails the rollout
instead of letting pods serve a partial schema (`DISASTER-RECOVERY-GUIDE.md §4.2`).

**Telemetry scrape.** Pods advertise `prometheus.io/scrape: "true"`, `prometheus.io/path:
"/metrics"`, `prometheus.io/port: "4000"` (`backend.yaml:122-124`; Helm `values.yaml:69-71`).
An in-cluster Prometheus discovers and scrapes each pod. Readiness alerting should add a
blackbox probe on `/health`. Pool saturation is visible as
`neuropause_pg_pool_connections{state="waiting"}`.

**Honest notes / what is EXTERNAL or MODELED.**

- **Prometheus/Alertmanager, the ingress controller, cert-manager, metrics-server** are
  prerequisites the cluster must supply — the repo ships the *scrape hints and manifests*,
  not the monitoring stack (`OPERATIONS-GUIDE.md` "Known Operational Gaps").
- **HA / PITR live in the managed datastores**, not in these manifests.
- **Enterprise SSO:** backend-brokered OAuth PKCE (RFC 8252) to Google/GitHub/Microsoft/Apple
  is real (Microsoft directory tenants via `MICROSOFT_TENANT`, default `common`). **SAML 2.0,
  SCIM provisioning, and a dedicated IdP broker are NOT shipped.** Apple `id_token` is decoded
  but **not yet JWKS-verified** (`apps/backend/src/auth/providers/apple.ts`) — tracked blocker.
- **Federation multi-region DR is MODELED** — a data model in
  `apps/desktop/src/main/federation/dr/drStore.ts`, no second cluster, no cross-region
  replication (`DISASTER-RECOVERY-GUIDE.md §7.1`). Do not present it as failover.

---

## Architecture 3 — On-prem / air-gapped

For networks with no registry pull and no outbound internet. A bundle is built once on a
connected host, transferred on physical media, and loaded on the isolated host. Topologically
it is Architecture 1 (single-host Compose) delivered offline.

```
   CONNECTED BUILD HOST                         AIR-GAPPED TARGET HOST
   ┌───────────────────────────┐                ┌──────────────────────────────┐
   │ scripts/build-offline-    │                │  extract tarball               │
   │   bundle.sh <tag>         │                │  create .env  (POSTGRES_PASSWORD│
   │                           │   transfer     │   + JWT_ACCESS_SECRET ≥32)     │
   │  docker build backend     │  ═══════════►  │  ./load-and-run.sh:            │
   │  docker pull pg / redis   │  (USB / secure │    docker load -i images.tar   │
   │  docker save → images.tar │   file move)   │    docker compose -f \         │
   │  + docker-compose.offline │                │      docker-compose.offline.yml│
   │  + load-and-run.sh        │                │      up -d                     │
   │  → dist/offline-bundle/   │                │                                │
   │    neuropause-offline-*.tgz│               │  backend :4000 (loopback)      │
   └───────────────────────────┘                │  ┌─────────┐ ┌────────┐        │
                                                │  │postgres │ │ redis  │        │
                                                │  │16-alpine│ │7-alpine│        │
                                                │  └─────────┘ └────────┘        │
                                                └──────────────────────────────┘
```

**Components & real assets.**

| Step | Asset | Path |
|---|---|---|
| Bundle builder (shellcheck CLEAN) | pulls `postgres:16-alpine` + `redis:7-alpine`, `docker save`s all three images, emits offline Compose + loader | `scripts/build-offline-bundle.sh` |
| Offline Compose (embedded in bundle) | no build, no registry — images referenced by tag | generated `docker-compose.offline.yml` |
| Loader (embedded, `chmod +x`) | `docker load -i images.tar` then `docker compose … up -d` | generated `load-and-run.sh` |
| Env template | copied if `.env.example` present | `.env.example` |

**Data flow.** Identical to Architecture 1 once running: backend `:4000` (loopback) →
Postgres + Redis containers on the same host, wired by the offline Compose's internal
`DATABASE_URL`/`REDIS_URL` (`build-offline-bundle.sh:74-75`).

**Telemetry scrape.** `/metrics` on loopback; in a truly air-gapped site, scrape with a
co-located Prometheus or export snapshots. No outbound telemetry leaves the host.

**Honest notes.** The **script is shellcheck-CLEAN and the procedure is documented**, but a
full `docker save`/`docker load` round-trip **requires a Docker daemon and was not executed**
in the validation environment → status **PARTIAL** (`_grounding.md`;
`bench/results/reliability.json` scenario `offline-bundle`). Air-gapped Postgres still needs
the same off-host backup discipline as Architecture 1 — there is no HA in a single-host bundle.

---

## Cross-architecture summary

| Property | 1 · Single-node | 2 · Kubernetes | 3 · Air-gapped |
|---|---|---|---|
| Datastores | Containers on host | **Managed / HA (external)** | Containers on host (offline) |
| Backend replicas | 1 | 2 → 6 (HPA) | 1 |
| TLS termination | add a proxy | Ingress (`optional.yaml`) | add a proxy |
| Migrations | Dockerfile `CMD` or `db:migrate` | gated one-off **Job** | Dockerfile `CMD` on first boot |
| `/metrics` reach | loopback | pod annotations → Prometheus | loopback |
| Validation status | real, operational | manifests kubeconform **strict PASS** (k8s 1.29) | script shellcheck CLEAN, save/load **PARTIAL** |
| Primary evidence | `docker-compose.prod.yml` | `bench/results/deployment.json` | `bench/results/reliability.json` |

**Modeled or absent across all three (state plainly):** enterprise SAML/SCIM SSO; federation
multi-region DR and failover; blue-green/canary controllers; PITR/WAL (belongs to managed
Postgres); native alerting/paging, distributed tracing, capacity forecasting, and log rotation
(adopt external tooling — `OPERATIONS-GUIDE.md` "Known Operational Gaps"). App-binary rollback
is **advisory only**; real recovery is data-side (`DISASTER-RECOVERY-GUIDE.md §5.1`).
