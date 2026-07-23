# NeuroPause — Deployment Enablement Program

The GEAP deployment deliverable. It **packages the already-validated deployment
assets into ready-to-run kits** — it adds no runtime, no manifest, and no
architecture. Every kit points at real files that ship in the repo and are
schema-/shell-validated (`docs/validation/DEPLOYMENT-VALIDATION.md`, run
2026-07-18). Where a capability is external (managed Postgres, an ingress
controller) or **proposed** (multi-region, PodDisruptionBudget), it is labelled
so, drawing the same line as `deploy/README.md:83-90`.

- **Maturity anchor:** Validated Release Candidate (`ENTERPRISE-VALIDATION-REPORT.md`) — not GA, not "proven at scale."
- **Build-on, don't duplicate:** the step-by-step mechanics live in `docs/validation/DEPLOYMENT-PLAYBOOKS.md`; incident procedures in `docs/validation/OPERATIONAL-RUNBOOKS.md`; topology in `docs/validation/REFERENCE-ARCHITECTURES.md`. This program indexes and sequences them into kits — it does not restate them.
- **Honesty on numbers:** performance figures below are **reference-env measured characteristics** (`docs/validation/_grounding.md`), never SLAs presented as achieved.

**Configuration contract (identical in every kit).** The backend refuses to start
without `DATABASE_URL`, `REDIS_URL`, and `JWT_ACCESS_SECRET` (≥ 32 chars). Every
production manifest sets `RUN_MIGRATIONS_ON_BOOT=false` (migrations are a gated
step) and `SEED_STORE_ON_BOOT=false` (empty store catalog — no fabricated apps).
Probes are `/live` (liveness), `/health` (readiness; checks Postgres + Redis, 200/503),
`/metrics` (Prometheus text — keep network-restricted).

---

## Kit-selection matrix

Pick the smallest kit that satisfies the durability and scale you actually need.

| Kit                 | Best for                                | Datastores                    | Replicas / scaling | Real assets                                                                | Validation status                                             |
| ------------------- | --------------------------------------- | ----------------------------- | ------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **A · Developer**   | Local eval, contribution, demos         | Containers on host (+ Qdrant) | 1 (hot-reload)     | `docker-compose.yml`, `npm run infra:up`, `npm run dev`                    | real, operational                                             |
| **B · Single-node** | Single-tenant / private cloud, pilots   | Containers on host            | 1                  | `docker-compose.prod.yml`, `apps/backend/Dockerfile`, `docs/DEPLOYMENT.md` | real, operational (**today's shipped prod path**)             |
| **C · Kubernetes**  | Cloud, horizontal scale, zero-downtime  | **Managed / HA (external)**   | 2 → 6 (HPA)        | `deploy/kubernetes/*`, `deploy/helm/neuropause-backend/*`                  | manifests **kubeconform strict PASS** (k8s 1.29)              |
| **D · Air-gapped**  | No registry pull / no outbound internet | Containers on host (offline)  | 1                  | `scripts/build-offline-bundle.sh`                                          | script **shellcheck CLEAN**; save/load round-trip **PARTIAL** |

> Kits B and D are the same topology (single-host Compose); D is B delivered
> offline. Kit C is the only horizontally-scalable shape, and it deliberately runs
> **only** the stateless backend — datastores are your managed HA services.

---

## 1. Reference deployment kits

Each kit = **which real files + the steps + how it was validated.** Commands are the
minimal path; the full playbook reference is cited per kit.

### Kit A — Developer / evaluation

| Concern                               | Real asset                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| Infra (Postgres + Redis + Qdrant)     | `docker-compose.yml`; `npm run infra:up` → `docker compose up -d` (`package.json:21`) |
| Run backend + desktop (hot-reload)    | `npm run dev`; backend-only `npm run dev:backend`                                     |
| Migrations (forward-only, 0001..0012) | `npm run db:migrate` (`package.json:20`)                                              |

```bash
npm install
npm run infra:up
cp .env.example apps/backend/.env      # set JWT_ACCESS_SECRET (openssl rand -base64 48)
npm run db:migrate
npm run dev:backend                     # http://127.0.0.1:4000
```

**Validation.** Full gate reproduces green on a clean tree: typecheck 0, lint 0,
**3,856 tests**, build exit 0, **0 production npm-audit vulns** (`docs/validation/DEPLOYMENT-PLAYBOOKS.md §A`). Full steps: Playbook A.

### Kit B — Single-node / private cloud

| Concern                                  | Real asset                                                            |
| ---------------------------------------- | --------------------------------------------------------------------- |
| Prod stack (API + Postgres 16 + Redis 7) | `docker-compose.prod.yml`                                             |
| Image (multi-stage, non-root uid 1001)   | `apps/backend/Dockerfile`                                             |
| Operate / back up / restore              | `docs/DEPLOYMENT.md`; `scripts/backup-db.sh`, `scripts/restore-db.sh` |

```bash
cp .env.example .env                    # set POSTGRES_PASSWORD, JWT_ACCESS_SECRET (>=32 chars)
docker compose -f docker-compose.prod.yml up -d --build
curl -fsS http://localhost:4000/live && curl -fsS http://localhost:4000/health
```

**Validation.** This is the documented _"fully-operational production deployment
today"_ (`deploy/README.md:87-90`). Cold-start → healthy **0.66 s**, idle RSS ≈
**117 MB** (reference env). **Honest note:** single Postgres + single Redis = **not
HA**; `./backups` is co-located with the data — add off-host copies (§5).

### Kit C — Kubernetes

| Object                                                         | Kind         | Path                                    |
| -------------------------------------------------------------- | ------------ | --------------------------------------- |
| Namespace / ConfigMap / migrate **Job** / Deployment / Service | core         | `deploy/kubernetes/backend.yaml`        |
| HPA (min 2 / max 6, cpu 70%) + Ingress (nginx, TLS)            | optional     | `deploy/kubernetes/optional.yaml`       |
| Secret (`DATABASE_URL`/`REDIS_URL`/`JWT_ACCESS_SECRET`)        | example only | `deploy/kubernetes/secret.example.yaml` |
| Parameterized equivalent (8 templates)                         | Helm chart   | `deploy/helm/neuropause-backend/`       |

```bash
kubectl apply -f deploy/kubernetes/secret.example.yaml   # EDIT real values first
kubectl apply -f deploy/kubernetes/backend.yaml
kubectl apply -f deploy/kubernetes/optional.yaml
kubectl -n neuropause rollout status deploy/neuropause-backend
```

**Validation.** `backend.yaml` and `optional.yaml` pass **kubeconform strict**
(k8s 1.29) — recorded PASS in `bench/results/deployment.json`. Migrations run as a
gated one-off Job so a bad migration **blocks the rollout** rather than serving a
partial schema. Full steps + Helm path: Playbook B. Cloud detail: §2.

### Kit D — Air-gapped

| Step                                               | Real asset                                                |
| -------------------------------------------------- | --------------------------------------------------------- |
| Build bundle (backend + pg + redis, `docker save`) | `scripts/build-offline-bundle.sh`                         |
| Offline Compose + loader (emitted into the bundle) | generated `docker-compose.offline.yml`, `load-and-run.sh` |

```bash
# CONNECTED build host (needs Docker + internet):
scripts/build-offline-bundle.sh neuropause-backend:1.0.0
#   → dist/offline-bundle/neuropause-offline-neuropause-backend__1.0.0.tar.gz
```

**Validation.** Script is **shellcheck-CLEAN**. **Honest caveat:** a full
`docker save`/`load` round-trip needs a Docker daemon and was **not executed** in
the validation harness → status **PARTIAL** (`bench/results/reliability.json`
scenario `offline-bundle`). Run the end-to-end flow on real hosts to complete the
proof. Full steps: §3 and Playbook C.

---

## 2. Cloud deployment guides (Kubernetes + Helm)

Prerequisites the **cluster** must already provide (the repo ships manifests, not
these): an ingress controller (nginx) + cert-manager if you enable Ingress;
metrics-server if you enable the HPA; a Prometheus stack to consume the scrape hints.

### 2.1 Validate before you apply

```bash
helm lint deploy/helm/neuropause-backend
helm template np deploy/helm/neuropause-backend --namespace neuropause > /tmp/rendered.yaml
kubeconform -strict -summary -kubernetes-version 1.29.0 \
  deploy/kubernetes/backend.yaml deploy/kubernetes/optional.yaml /tmp/rendered.yaml
```

### 2.2 Secret out-of-band (recommended)

Point at **managed, HA** datastores; prefer sealed-secrets / external-secrets in prod.

```bash
kubectl -n neuropause create secret generic neuropause-backend-secrets \
  --from-literal=DATABASE_URL='postgresql://user:pass@managed-pg:5432/neuropause' \
  --from-literal=REDIS_URL='redis://managed-redis:6379' \
  --from-literal=JWT_ACCESS_SECRET="$(openssl rand -hex 32)"
```

### 2.3 Helm install — real values

```bash
helm install np deploy/helm/neuropause-backend \
  --namespace neuropause --create-namespace \
  --set image.repository=<registry>/neuropause-backend --set image.tag=<tag> \
  --set existingSecret=neuropause-backend-secrets \
  --set autoscaling.enabled=true --set ingress.enabled=true
```

**Real `values.yaml` reference** (defaults that matter for adoption):

| Key                                                                            | Default                                                           | Effect                                                             |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `replicaCount`                                                                 | `2`                                                               | Replicas when `autoscaling.enabled=false`                          |
| `image.repository` / `image.tag`                                               | `neuropause-backend` / `1.0.0`                                    | Set to your pushed image                                           |
| `existingSecret`                                                               | `""`                                                              | Set it → no in-chart Secret rendered (`_helpers.tpl` `secretName`) |
| `migrations.enabled`                                                           | `true`                                                            | Renders the one-off migrate Job (`templates/migrate-job.yaml`)     |
| `autoscaling.{enabled,minReplicas,maxReplicas,targetCPUUtilizationPercentage}` | `false / 2 / 6 / 70`                                              | HPA (needs metrics-server)                                         |
| `ingress.{enabled,className,host,tls.secretName}`                              | `false / nginx / api.neuropause.example / neuropause-backend-tls` | TLS terminates at ingress; backend speaks plain HTTP by design     |
| `resources`                                                                    | req 100m/256Mi, lim 1/512Mi                                       | Per-pod sizing                                                     |
| `podAnnotations`                                                               | `prometheus.io/scrape,path,port`                                  | In-cluster Prometheus auto-discovers each pod                      |
| `affinity` / `nodeSelector` / `tolerations`                                    | `{}` / `{}` / `[]`                                                | Placement knobs (see §4 for anti-affinity)                         |

**Verify.**

```bash
kubectl -n neuropause get pods            # 2 backend Running; migrate Job Completed
kubectl -n neuropause rollout status deploy/np-neuropause-backend
```

Full Helm + raw-manifest walkthrough (including upgrade/rollback): `docs/validation/DEPLOYMENT-PLAYBOOKS.md §B, §D`.

---

## 3. Air-gapped deployment (the real `build-offline-bundle.sh` flow)

One script builds a single self-contained tarball; nothing is fabricated — it
`docker save`s the real backend image plus `postgres:16-alpine` and
`redis:7-alpine`, and emits an offline Compose file (no build, no registry) and a
loader (`scripts/build-offline-bundle.sh`).

```bash
# 1. CONNECTED build host (Docker + internet)
scripts/build-offline-bundle.sh neuropause-backend:1.0.0

# 2. Transfer dist/offline-bundle/neuropause-offline-*.tar.gz on approved media

# 3. AIR-GAPPED target host (Docker; no internet)
tar -xzf neuropause-offline-*.tar.gz -C /opt/neuropause && cd /opt/neuropause
cp .env.example .env        # set POSTGRES_PASSWORD + >=32-char JWT_ACCESS_SECRET
./load-and-run.sh           # docker load -i images.tar → compose up -d (backend on loopback :4000)
curl -fsS http://127.0.0.1:4000/health
```

**Honest status & caveats.**

- **Requires a Docker daemon** on both hosts; the loader **refuses to start without `.env`**.
- Script shellcheck-CLEAN; full save/load round-trip **not executed in validation → PARTIAL** (`bench/results/reliability.json` `offline-bundle`).
- Topologically identical to Kit B once running — **single Postgres/Redis, not HA**; apply the same off-host backup discipline (§5). Full steps: Playbook C.

---

## 4. HA deployment

**What the real manifests actually provide** (Kit C) — all schema-valid and shipped:

| Capability                   | Real basis                                                                                         | Status                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Multiple replicas            | Deployment `replicas: 2` (`backend.yaml:105`) / Helm `replicaCount`                                | **shipped**                                                                            |
| Zero-downtime rollout        | `RollingUpdate maxUnavailable: 0, maxSurge: 1` + `/health` readiness gate (`backend.yaml:107-162`) | **shipped**; restart recovery measured **0.46 s**                                      |
| Replica autoscaling          | HPA min 2 / max 6 @ 70% CPU (`optional.yaml:19-27`)                                                | manifest **kubeconform PASS**; live scale-up needs metrics-server, **not load-tested** |
| DB connection-pool autoscale | `pg` pool `1 → 10` under the 24k-request load                                                      | **PROVEN under load** (`docs/validation/OPERATIONAL-RUNBOOKS.md §4`)                   |
| Fail-open under Redis loss   | rate limiter serves reads during Redis outage                                                      | **PROVEN** (`redis-down-fail-open` PASS)                                               |
| DB auto-reconnect            | pool re-establishes with no backend restart                                                        | **PROVEN** (`db-down-degradation-autorecover` PASS)                                    |

> **Distinguish the two "auto-scales."** The **pg pool 1→10 was measured** under
> load; the **HPA 2→6 replica scale-up is a validated _manifest_ but an unexercised
> _event_** — it depends on a metrics-server the repo does not ship. State it that way.

**Datastore HA is external, by design.** Postgres/Redis HA/PITR/replicas live in the
**managed services** behind `DATABASE_URL`/`REDIS_URL`, not in these manifests
(`deploy/kubernetes/secret.example.yaml:11`, `deploy/README.md:17-19`).

**HA hardening knobs available but not defaulted (set these for real HA):**

- **Pod anti-affinity** to spread replicas across nodes — Helm `affinity` value (`values.yaml:75`), empty by default. Set a `podAntiAffinity` rule; the raw manifest has none.
- **More headroom** — raise `replicaCount`/`autoscaling.maxReplicas` and per-pod `resources`.

**PROPOSED (no real manifest exists — do not present as shipped):**

- **PodDisruptionBudget** to bound voluntary-disruption concurrency — **not in the repo**; add one if you need it.
- **Multi-region / cross-region failover.** The Federation "DR" module is a **data model only** — metadata records, modeled replication, no second cluster (`docs/guides/DISASTER-RECOVERY-GUIDE.md §7.1`). Genuine multi-region = replicated managed Postgres across regions + tested failover, implemented in **your** infrastructure. Its RPO/RTO targets (300s / 900s) are **design goals, not achieved figures.**

---

## 5. Disaster recovery

Built on the **proven** backend backup/restore drill and the full
`docs/guides/DISASTER-RECOVERY-GUIDE.md`. Do not rewrite it — this is the deployment-kit index.

**Proven mechanism** (`backup-restore` scenario PASS): `pg_dump -Fc` (136 KB in the
drill) → fresh DB → `pg_restore` → **row counts match exactly** (applications 20,
versions 40, categories 14). Migrator re-run is **idempotent** — 12 migrations,
re-run applied **0 new** (`migration-idempotency` PASS).

```bash
scripts/backup-db.sh                                     # keeps 14 most recent, gzip
scripts/restore-db.sh backups/neuropause-db-YYYYMMDD-HHMMSS.sql.gz   # destructive; prompts 'yes'
```

| Concern         | Real state                                                                     | Adoption action                                        |
| --------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Backend RPO     | = **age of last operator-run dump** (no scheduler ships)                       | Wire `backup-db.sh` to cron / systemd timer            |
| Backend RTO     | time to `gunzip \| psql` a whole dump + backend restart                        | Size-dependent; test it                                |
| Granularity     | **whole-dump only — no PITR/WAL in-repo**                                      | Managed Postgres for PITR (`DR-GUIDE §8.1`)            |
| Off-host copy   | none shipped (`./backups` is co-located)                                       | Ship dumps to object storage in another failure domain |
| Rollback        | **data-side only** — app-binary downgrade is advisory (`allowDowngrade=false`) | Restore pre-upgrade dump, then re-point image tag      |
| Multi-region DR | **MODELED**, not real                                                          | See §4 "PROPOSED"                                      |

**Golden rule (from the DR guide):** a backup you have never restored is a
hypothesis. Run the restore drill on a scratch DB regularly (Runbook 5). Upgrade/
rollback sequence: Playbook D — **take a verified backup before every upgrade.**

---

## 6. Scaling guide

The backend ships **counts, not latency histograms** — `/metrics` has no `_bucket`
series. Scale on saturation signals, and treat capacity as a **framework you run in
your own environment**, not a published number.

**Real signals (all exist in source — `docs/validation/OPERATIONAL-RUNBOOKS.md`):**

| Signal          | Series / source                                                  | Scale trigger                                                |
| --------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| Pool saturation | `neuropause_pg_pool_connections{state="waiting"}` > 0, sustained | Requests queued for a DB connection → scale out / raise pool |
| Pool exhaustion | `{state="total"}` pinned at max, `idle` ≈ 0                      | Same                                                         |
| Error rate      | `neuropause_http_requests_total{status=~"5.."}` climbing         | Errors, not just latency — investigate first                 |
| Memory pressure | `neuropause_backend_resident_memory_bytes` → limit               | Raise `resources.limits.memory` (default 512Mi) or scale out |
| CPU             | (HPA target)                                                     | HPA scales 2→6 at 70% CPU (needs metrics-server)             |

**Reference-env datapoints (a _starting_ calibration, not a guarantee).** Concurrency
32, **24,000 requests, 0 errors**: p50 `/health` 22 ms, `/store/apps` 52 ms (p99 80 ms),
point-read 72 ms (p99 118 ms); direct DB point-read p50 **0.23 ms**. Pool auto-scaled
**1 → 10**; RSS grew **117 → 213 MB**. Takeaway: _DB is sub-ms; app-layer + vCPU
contention dominates HTTP latency_ — so scale CPU/replicas, not the DB, first.

**Capacity-planning framework (run it yourself):**

1. Reproduce the HTTP profile in your env: `node bench/http-load.mjs --base http://<host> --conc 32 --reqs 3000`.
2. Confirm the DB isn't the bottleneck: `node bench/db-latency.mjs` (expect sub-ms).
3. Find the knee where `pg_pool_connections{state="waiting"}` goes sustained-positive → that concurrency is one pod's ceiling.
4. Set HPA `maxReplicas` and `resources` from your target throughput ÷ per-pod ceiling, with headroom.
5. For real latency SLOs, add a blackbox probe on `/health` + Prometheus recording rules (the app ships counts, not histograms).

---

## 7. Operations handbook (day-2 index)

A single entry point that **consolidates the real runbooks and guides** — no new
procedures. Each row is symptom/task → the shipped doc that owns it → first command.

| Day-2 task                   | Owning doc                               | First move                                                           |
| ---------------------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| Redis down (fail-open)       | `OPERATIONAL-RUNBOOKS.md §1`             | Do **not** restart backend; restore Redis; watch request-rate        |
| Postgres down (auto-recover) | `OPERATIONAL-RUNBOOKS.md §2`             | Do **not** restart; restore PG; pool re-establishes itself           |
| Backend restart / recovery   | `OPERATIONAL-RUNBOOKS.md §3`             | `kubectl -n neuropause rollout restart deploy/...` (~0.46 s healthy) |
| High latency                 | `OPERATIONAL-RUNBOOKS.md §4`             | Check `pg_pool_connections{state="waiting"}`; scale CPU/replicas     |
| Backup & restore drill       | `OPERATIONAL-RUNBOOKS.md §5`             | `scripts/backup-db.sh` → restore into scratch DB, compare row counts |
| Upgrade / rollback           | `DEPLOYMENT-PLAYBOOKS.md §D`             | Backup first; migrate Job gates the rollout; rollback is data-side   |
| Monitoring & health          | `docs/guides/OPERATIONS-GUIDE.md`        | Scrape `/metrics`; probe `/live` + `/health`                         |
| Disaster recovery            | `docs/guides/DISASTER-RECOVERY-GUIDE.md` | See §5                                                               |
| Administration / RBAC        | `docs/guides/ADMINISTRATOR-GUIDE.md`     | 57-scope model, roles, org/tenancy                                   |
| Security hardening           | `docs/guides/SECURITY-GUIDE.md`          | Network hardening, OAuth PKCE, secrets                               |
| Release gates                | `docs/guides/RELEASE-CHECKLIST.md`       | Quality gates → packaging → post-release verify                      |
| First-line issues            | `docs/guides/TROUBLESHOOTING.md`         | Common install/run failures                                          |

**Known operational gaps to staff externally** (from `OPERATIONS-GUIDE.md` "Known
Operational Gaps" — none of the runbooks assume these): **no native alerting/paging**
(author Prometheus + Alertmanager rules on the shipped series — e.g.
`neuropause_backend_up == 0`, 5xx ratio, pool `waiting`); **no distributed tracing**
(OTel Collector); **no capacity forecasting** (external, over the metric time-series);
**no log rotation** (logrotate / Docker logging driver); `/metrics` is **unauthenticated
by design** — network-restrict it.

---

## Validated vs proposed — one place to check

| Item                                                                                      | Standing                                                                                                  |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Kits A/B (dev, single-node Compose)                                                       | **Validated / operational** — today's shipped prod path                                                   |
| Kit C manifests + Helm chart (schema)                                                     | **Validated** — kubeconform strict PASS (k8s 1.29); `helm` render in CI only (CLI unavailable in harness) |
| Reliability behaviours (restart, redis/db degrade, backup-restore, migration idempotency) | **Validated** — reliability scenarios PASS                                                                |
| pg pool auto-scale 1→10                                                                   | **Validated** — measured under load                                                                       |
| Kit D air-gapped bundle                                                                   | **PARTIAL** — shellcheck CLEAN; save/load round-trip not executed                                         |
| HPA 2→6 live scale event                                                                  | **Ready but unexercised** — needs metrics-server                                                          |
| macOS release automation                                                                  | **Absent** — mac packaging/signing is manual (`DEPLOYMENT-VALIDATION.md`)                                 |
| Desktop test CI per-PR                                                                    | **Absent** — 3,548 desktop tests not gated per PR                                                         |
| PodDisruptionBudget                                                                       | **Proposed** — no manifest in repo                                                                        |
| Multi-region / cross-region failover                                                      | **Proposed** — Federation DR is modeled, not infra; RPO/RTO 300s/900s are goals                           |
| Apple `id_token` JWKS verification; unsigned-install-when-trust-store-empty               | **Open items** — carried from prior reports                                                               |

Everything in the "Validated" rows is built on; everything else is labelled here so
deployment readiness is never over-claimed.
