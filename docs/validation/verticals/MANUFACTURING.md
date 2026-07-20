# Manufacturing — Validation Pack

> **Nature of this document.** This is a **reference deployment + validation
> protocol** for a discrete or process manufacturer evaluating NeuroPause. It is
> *not* a record of a real production install, and it names no customer. Every
> control, telemetry signal, benchmark, and reliability result cited here traces
> to a real repository artifact or to `docs/validation/_grounding.md` (the shared
> source of truth). Thresholds are framed as **recommended SLOs** for a manufacturer
> to adopt and verify on their own hardware — **not certifications**. Anything that
> is modeled rather than wired to live equipment is labeled **MODELED**; anything
> not measurable in the reference environment is labeled **ABSENT** or
> **HARNESS-ONLY**. When in doubt, this pack under-claims.

**Product under validation.** NeuroPause `1.0.0-rc.1` — a secure Electron desktop
app (main/preload/renderer, context isolation, sandbox, strict CSP, allow-listed
+ Zod-validated IPC behind a fail-closed RBAC permission gate) plus a Node/Express
backend (Postgres + Redis; Qdrant configured for semantic search). Pre-program
classification: **Release Candidate** (`ENTERPRISE-GA-REPORT.md`).

---

## 1. Reference deployment

A discrete/process manufacturer runs NeuroPause in two tiers: **desktop operator
clients** at engineering, quality, and shop-floor-office workstations, and the
**backend service** on-prem or in a private cluster near the plant network. The
backend is the only stateful tier; the desktop app is a signed client that talks
to it over HTTPS terminated at the ingress.

All deployment assets below are **real, deployable artifacts** in this repository
(see `deploy/README.md`). None of them stands up a fabricated cluster, region, or
failover the repo does not contain.

| Tier / concern | Asset (real path) | Notes |
|---|---|---|
| Container image | `apps/backend/Dockerfile` | Multi-replica pattern: migrate-then-serve |
| Single-host / private cloud | `docker-compose.prod.yml` | Postgres + Redis + API; loopback-bound metrics |
| Kubernetes (raw) | `deploy/kubernetes/backend.yaml`, `secret.example.yaml`, `optional.yaml` | Namespace, ConfigMap, migrate `Job`, Deployment (`replicas: 2`), Service, HPA + Ingress. **kubernetes-validate strict PASS** (`bench/results/deployment.json`) |
| Kubernetes (Helm) | `deploy/helm/neuropause-backend/` | 8 templates; `helm lint` + `helm template` + kubeconform in CI |
| Air-gapped / shop-floor island | `scripts/build-offline-bundle.sh` | `docker save`/`load` bundle; shellcheck **CLEAN** |
| CI validation | `.github/workflows/backend-ci.yml`, `deploy-validation.yml`, `windows-release.yml` | No macOS/desktop CI yet (honest gap) |

**On-prem / K8s backend.** The Kubernetes manifests deploy the *actual* backend
with its real liveness (`/live`) and readiness (`/health`) probes. Migrations run
as a one-off `Job` (`node dist/db/migrate.js`) so pods only serve; the
`RollingUpdate` strategy with `maxUnavailable: 0` plus the readiness gate gives
zero-downtime rollouts on a real cluster. Pods run hardened: `runAsNonRoot`
(uid 1001), `readOnlyRootFilesystem`, all Linux capabilities dropped, and
`seccompProfile: RuntimeDefault` (`deploy/kubernetes/backend.yaml`). Postgres and
Redis are expected to be **managed / HA** services referenced only through
`DATABASE_URL` / `REDIS_URL` in a Secret — the manifests deliberately do not stand
up a single-pod database and call it HA. Production config pins
`SEED_STORE_ON_BOOT: "false"` and `RUN_MIGRATIONS_ON_BOOT: "false"`
(`deploy/kubernetes/backend.yaml`, `deploy/helm/neuropause-backend/values.yaml`),
so no fabricated catalog data is ever loaded.

**Air-gapped shop floor.** Plants that isolate the OT network from the internet
use `scripts/build-offline-bundle.sh`, which produces a single tarball with the
backend image plus pinned Postgres 16 / Redis 7 images, an offline compose file, an
`.env` template, and a `load-and-run.sh` loader. On the air-gapped host: extract,
create `.env` (set `POSTGRES_PASSWORD` and a ≥32-char `JWT_ACCESS_SECRET`), then
run `./load-and-run.sh`. The backend binds metrics to loopback by default.

**Desktop operators.** Each workstation runs the Electron client. On Windows shop
floors, releases are produced by `windows-release.yml`. TLS terminates at the
ingress; the backend speaks plain HTTP by design behind it.

---

## 2. KPIs (recommended SLOs)

Every KPI below names a **real telemetry source**. Thresholds are **recommended
SLOs** for a manufacturer to adopt and confirm against their own hardware — they
are not certified guarantees, and the reference numbers in §4 come from a
constrained 2-vCPU box, so on-prem headroom will typically exceed them.

| KPI | Telemetry source (real) | Recommended SLO | Basis |
|---|---|---|---|
| Backend availability | `GET /health` → `status: ok`; `neuropause_backend_up` | ≥ 99.5% of scrapes `ok` per plant shift | `/health` returns 200/`ok` only when DB **and** Redis reachable |
| Liveness | `GET /live` → `status: alive` | 100% during steady state | Liveness is DB-independent (won't restart on a transient blip) |
| Store/read throughput | `neuropause_http_requests_total{method,status}` | ≥ 400 rps sustained per replica (DB-backed read) | Ref: `/store/apps` 610 rps (§4) |
| Read latency (p95) | derived from `neuropause_http_requests_total` + scrape timing; measured in `bench/http-load.mjs` | p95 ≤ 120 ms for DB-backed reads | Ref: `/store/apps/:slug` p99 118 ms (§4) |
| Error rate | `neuropause_http_requests_total{status=~"5.."}` / total | < 0.1% over rolling 1h | Ref load ran **0 errors** across 24,000 requests (§4) |
| Backend memory headroom | `neuropause_backend_resident_memory_bytes`, `neuropause_backend_heap_used_bytes` | RSS alert at 80% of pod limit (512Mi) | Ref: RSS 117→213 MB under load (§4) |
| DB pool saturation | `neuropause_pg_pool_connections{state="waiting"}` | `waiting` sustained > 0 → alert | Ref: pool auto-scaled 1→10, no starvation (§4) |
| Uptime / restart signal | `neuropause_backend_uptime_seconds` | unexpected reset → page | Drops to ~0 on restart; recovery measured at 0.46 s (§6) |
| Privileged-action audit coverage | `audit_log` table row growth | every privileged action produces a row | Append-only trail (§3) |

Recommended alerting cut: page on `neuropause_backend_up == 0` or `/health`
`status: degraded` persisting beyond one scrape interval; warn on
`neuropause_pg_pool_connections{state="waiting"} > 0` or RSS approaching the pod
limit.

---

## 3. Telemetry — signals to scrape

Three real backend surfaces plus the desktop perf instrumentation cover the
operational picture. Keep `/metrics` network-restricted (loopback bind in Compose;
a scrape-only path / NetworkPolicy in K8s); pod annotations already advertise
`prometheus.io/scrape` (`deploy/kubernetes/backend.yaml`,
`deploy/helm/neuropause-backend/values.yaml`).

**`GET /metrics` — Prometheus text exposition (v0.0.4).** Implemented in
`apps/backend/src/observability/metrics.ts`. Aggregate, non-sensitive only (no
request bodies, no identifiers, no PII). Series to scrape:

| Series | Type | Use |
|---|---|---|
| `neuropause_backend_up` | gauge | Serving signal (1 when scraped) |
| `neuropause_backend_uptime_seconds` | gauge | Restart / flap detection |
| `neuropause_backend_resident_memory_bytes` | gauge | RSS trend / leak watch |
| `neuropause_backend_heap_used_bytes` | gauge | V8 heap trend |
| `neuropause_pg_pool_connections{state="total\|idle\|waiting"}` | gauge | DB pool health / saturation |
| `neuropause_http_requests_total{method,status}` | counter | Throughput + error rate by method/status |

**`GET /health` — readiness.** Returns `{status: ok\|degraded, components:
{database, redis}, uptime}`; HTTP 200 when healthy, 503 when degraded
(`apps/backend/src/app.ts`). Wire this to the readiness probe and to an external
uptime check. `components` pinpoints whether Postgres or Redis is the degraded
dependency.

**`GET /live` — liveness.** Returns `{status: alive, uptime}`, DB-independent by
design so a transient datastore blip does not trigger a pod restart.

**`audit_log` — append-only audit trail.** Written by
`apps/backend/src/middleware/audit.ts` (`INSERT INTO audit_log (user_id, action,
detail, ip)`); audit writes never break the request they describe. Ship this table
to the manufacturer's SIEM for privileged-action forensics.

**Desktop renderer perf.** `apps/desktop/src/renderer/src/lib/perf/perfRecorder.ts`,
`PerfSampler.tsx`, `ProfiledSection.tsx`, and the types in
`packages/shared/src/types/perfMetrics.ts` instrument operator-side render/IPC
timing. (Execution on target hardware is HARNESS-ONLY here — see §8.)

---

## 4. Production metrics — what "good" looks like

The numbers below are **measured** and must not be re-stated as targets. They come
from the **reference box: 2-vCPU Intel Xeon @2.10GHz, 8 GB, Node 22.22.2, PG 16.13,
Redis 7.0.15** (`bench/results/environment.json`), with the load client
**co-located** with the backend — so 2-vCPU contention makes these latencies
**conservative**. On-prem plant hardware with dedicated cores and managed Postgres
should comfortably exceed them.

**Startup.** Backend cold start → healthy (DB + Redis connected): **0.66 s**.

**HTTP load** (`bench/http-load.mjs`, concurrency 32, 3,000 req/scenario, **24,000
total, 0 errors**):

| Endpoint | Throughput | p50 | p99 |
|---|---|---|---|
| `/health` (liveness, no DB) | 1221 rps | 22 ms | — |
| `/live` (readiness) | 2103 rps | 11 ms | — |
| `/metrics` (Prometheus) | 1789 rps | 16 ms | — |
| `/store/apps` (DB list, 20 rows) | 610 rps | 52 ms | 80 ms |
| `/store/apps?q=…&sort=…` (filter+sort) | 639 rps | 49 ms | — |
| `/store/featured` (DB join) | 529 rps | 60 ms | — |
| `/store/categories` (DB agg) | 1559 rps | 19 ms | — |
| `/store/apps/:slug` (point read) | 424 rps | 72 ms | 118 ms |

**Database latency** (`bench/db-latency.mjs`, direct pg, 2,000 iters, 0 errors):
point read **p50 0.23 ms / p95 0.46 ms**; filtered list p50 0.16 ms; aggregate
p50 0.12 ms; join p50 0.24 ms. The DB is sub-millisecond — the app layer plus
2-vCPU contention dominates HTTP latency, not Postgres.

**Deterministic intelligence engines** over 5,000 entities, 2,000 ms budget
(`apps/desktop/src/main/__bench__/performance.test.ts`): graph.project 92.8 ms,
memory.index 74.4 ms, timeline.query 76.8 ms, search.index 55.9 ms,
briefing.generate 24.3 ms, recommendations.generate 17.1 ms, search.query 6.1 ms,
memory.recall 4.4 ms.

**Auth cost (deliberate).** Argon2id hash p50 **19.7 ms**, verify p50 **19.6 ms**
(memoryCost 19456 KiB, timeCost 2, parallelism 1) — this bounds auth throughput on
purpose.

**Memory & pool.** RSS **117 MB idle → 213 MB** under 24k-request load; heap
**20 → 70 MB**; pg pool auto-scaled **1 → 10**.

**Quality gates.** typecheck 0, lint 0, **3,856 tests pass**, build exit 0,
**0 production npm-audit vulnerabilities**.

---

## 5. Operator workflows

These are the **real desktop surfaces** a manufacturing operator uses. Navigation
is defined in `apps/desktop/src/renderer/src/shell/sections.ts`. Equipment-linked
surfaces are labeled **MODELED** — they present schema and UI, not live device
data (see §6 and §8).

| Operator action | Real surface (path) | What it does |
|---|---|---|
| **Launch / install apps** | `apps/desktop/src/renderer/src/store/` (`StoreApp.tsx`, `AppDetail.tsx`, `InstallFlow.tsx`) | Browse the AI Store catalog and launch/install approved apps for a workstation |
| **Connect sources** | `apps/desktop/src/renderer/src/connectors/` (`ConnectorsPage.tsx`, `ConnectorDetail.tsx`, `IntegrationHealthPanel.tsx`, `LiveConnectorInspector.tsx`) | Authorize and inspect connectors; per-connector health panel |
| **Sandbox / validate** | `apps/desktop/src/renderer/src/sandbox/` (`SandboxView.tsx`, panels: Overview, Scenarios, Validation, Regression, Certification, Lab, Artifacts, History) | Run validation scenarios and regression checks, view a certification verdict, and keep run history — the operator's dry-run surface before promoting a change |
| **Ops Center** | `apps/desktop/src/renderer/src/operationsCenter/` (`OpsCenterView.tsx`, `opsModel.ts`) | Health, risk, capacity, incidents, dependencies, root-cause, graph, timeline, diagnostics — a read-only operating lens over the intelligence reports the backend already computed |
| **Operations / Infrastructure** | `.../operations/`, `.../infrastructure/InfrastructurePage.tsx` | Service and infrastructure status views |
| **Digital Twin / Industry Center** | `.../twinCenter/TwinCenterView.tsx`, `.../industryCenter/IndustryCenterView.tsx` | **MODELED** enterprise digital-twin domains (enterprise, org, infrastructure, workforce, application, connector, federation…). These are software/enterprise twins, **not** physical PLC/line/sensor twins |

**Typical shift flow.** An operator launches the desktop client (authenticated via
backend-brokered OAuth PKCE), opens **Ops Center** to confirm health/risk are green,
uses **Connectors** to confirm upstream sources are live, and — before promoting a
configuration or app change — runs it through the **Sandbox** validation scenarios
and reviews the certification verdict. Privileged actions along the way land in
`audit_log`.

> **MODELED equipment integration.** The Digital Twin and Industry surfaces render
> domain models and their health bands from existing enterprise data. They are
> **not** connected to a live MES, historian, PLC, or sensor bus. Treat any
> "equipment" node in these views as a modeled placeholder pending a real
> integration the manufacturer would build and validate separately.

---

## 6. Failure scenarios

Each row maps to a **real reliability result executed in this program**
(`bench/results/reliability.json`; procedures in `_grounding.md`). Results are from
the reference environment; a manufacturer should re-run them on their own cluster
(§7).

| Scenario | Injected fault | Observed behavior | Result |
|---|---|---|---|
| Redis outage (rate-limit store down) | Stop Redis | `/store/apps` still served 200×5 (**fail-open** — deliberate availability choice); `/health` reported `degraded` / `redis:down`; no crash | **PASS** |
| Database outage | Stop Postgres | Process survived; `/health` `degraded` / `database:down`; DB-dependent reads returned a **clean 500**; on PG restart the pool **auto-reconnected without a backend restart** | **PASS** |
| Backend restart | SIGTERM → restart | Down → back to **healthy in 0.46 s** | **PASS** |
| Migration idempotency | Re-run migrations | 12 forward-only migrations; re-run applied **0 new** | **PASS** |
| Backup / restore | `pg_dump -Fc` → fresh DB → `pg_restore` | 136 KB dump restored; row counts match exactly (applications 20, versions 40, categories 14) | **PASS** |
| Offline / air-gapped bundle | Build + shellcheck the bundle | `scripts/build-offline-bundle.sh` shellcheck **CLEAN** + documented procedure; full `docker save`/`load` needs a Docker daemon (not run here) | **PARTIAL** |

**Rate-limiter fail-open is intentional.** If Redis is down the limiter fails open
(`_grounding.md`, "known open items") — availability is preferred over rate
enforcement. A manufacturer that requires strict limiting under a Redis outage
should treat this as a configuration decision to revisit, not a defect.

> **Shop-floor sensor / PLC integration is MODELED, not wired.** None of the above
> injects a real PLC, SCADA, historian, or field-sensor fault, because NeuroPause is
> **not connected to live plant equipment** in this reference. Failure modes for
> OT integration (bus dropout, PLC comm loss, sensor drift) are **out of scope** of
> the measured results and must be validated against a real integration by the
> manufacturer.

---

## 7. Validation protocol (reproducible)

An engineer can re-run every claim in this pack with the real harnesses below and
collect evidence (JSON + `/metrics` snapshots). Steps are ordered so each produces
an artifact for the validation record.

**Prerequisites.** A running backend (`docker-compose.prod.yml`, or `deploy/kubernetes`
/ Helm on a cluster) with reachable Postgres + Redis; `DATABASE_URL` exported for
the DB harness; `npm install` completed.

1. **Deploy validation.** Confirm K8s manifests schema-validate
   (kubernetes-validate strict — see `bench/results/deployment.json`) and
   `helm lint` / `helm template` pass in CI (`.github/workflows/deploy-validation.yml`).
   Verify `scripts/build-offline-bundle.sh` is shellcheck-clean.
2. **Startup.** Cold-start the backend; time to first `GET /health` → `200 ok`.
   Reference: **0.66 s**. Record the value.
3. **Health & telemetry baseline.** Curl `GET /live`, `GET /health`, and
   `GET /metrics`; confirm `neuropause_backend_up 1` and that `components.database`
   / `components.redis` are `up`. Save the `/metrics` snapshot.
4. **HTTP load.** Run `node bench/http-load.mjs --json bench/results/http-load.json`
   (defaults: base `http://127.0.0.1:4000`, conc 32, 3000 reqs, 300 warmup).
   Confirm **0 errors** and compare throughput/p50/p99 to §4.
5. **DB latency.** Run `DATABASE_URL=… node bench/db-latency.mjs --json
   bench/results/db-latency.json`. Confirm point-read p50 ≈ 0.23 ms and 0 errors.
6. **Intelligence engines.** Run the deterministic bench
   `apps/desktop/src/main/__bench__/performance.test.ts` (vitest) over 5,000
   entities; confirm every engine stays under the 2,000 ms budget and compare to §4.
7. **Reliability — Redis fail-open.** Stop Redis; hit `/store/apps` (expect 200)
   and `/health` (expect `degraded` / `redis:down`); confirm no crash. Restart Redis.
8. **Reliability — DB degrade + auto-recover.** Stop Postgres; confirm process
   survives, `/health` is `degraded` / `database:down`, DB reads return a clean 500;
   restart Postgres and confirm the pool **auto-reconnects without a backend restart**
   and `/health` returns `ok`.
9. **Reliability — restart recovery.** `SIGTERM` the backend, restart, and time to
   `healthy`. Reference: **0.46 s**.
10. **Backup / restore.** Run `scripts/backup-db.sh`, restore into a fresh DB with
    `scripts/restore-db.sh`, and confirm row counts match (applications 20,
    versions 40, categories 14 in the reference).
11. **Migration idempotency.** Re-run migrations; confirm **0 new** applied.
12. **Quality gates.** Confirm typecheck 0, lint 0, **3,856 tests pass**, build
    exit 0, **0 production npm-audit vulns**.
13. **Audit trail.** Perform a privileged action; confirm a new row in `audit_log`
    (`user_id, action, detail, ip`) and that it ships to the SIEM.

Collect each step's JSON / snapshot / log as the evidence bundle. Re-running on the
manufacturer's own cluster is expected — the reference numbers are a floor, not a
certification.

---

## 8. Honest limitations (MODELED / ABSENT for manufacturing)

- **Live PLC / SCADA / MES / historian integration — ABSENT.** NeuroPause ships no
  OPC-UA, Modbus, MQTT, or fieldbus drivers and is not wired to any control system.
  All "equipment"/twin surfaces (§5) are **MODELED**.
- **Shop-floor IoT sensors — MODELED.** Schema and UI (Digital Twin, Industry
  Center) exist; they are not connected to live devices, and no sensor-fault
  failure mode is in the measured reliability results (§6).
- **Desktop startup / render / IPC / renderer memory — HARNESS-ONLY.** The perf
  instrumentation (`perfRecorder.ts`, `PerfSampler.tsx`, `perfMetrics.ts`) exists,
  but headless launch is not possible in the reference env (macOS-only); execution
  is pending target hardware. No macOS/desktop CI yet.
- **Real AI model execution latency — ABSENT.** Requires live model credentials;
  only the deterministic engines (§4) are measured.
- **Real connector execution & cross-device sync under real networks — ABSENT.**
  Not exercised against live third-party systems here.
- **Offline/air-gapped bundle — PARTIAL.** Script is shellcheck-clean and documented;
  a full `docker save`/`load` round-trip needs a Docker daemon and was not executed.
- **Known open security items (state honestly).** Apple `id_token` not yet
  JWKS-verified (`apps/backend/src/auth/providers/apple.ts`); marketplace **app**
  install accepts unsigned packages when the trust store is empty (worker path
  fail-closed); the rate limiter **fails open** if Redis is down (deliberate
  availability choice). These are mapped, not hidden.

**Bottom line.** NeuroPause provides a real, hardened, observable backend + secure
desktop client that a manufacturer can deploy on-prem, in K8s, or air-gapped, and
validate end-to-end with the harnesses above. Its value for manufacturing today is
in operator workflows, validation/sandboxing, auditability, and enterprise
intelligence — **not** in live OT/shop-floor equipment control, which remains an
integration the manufacturer must build and validate separately.
