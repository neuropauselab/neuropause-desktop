# Validation Grounding — REAL FACTS ONLY (authoring reference)

> This file is the shared source of truth for every validation document. If a
> claim is not traceable to something here or to a real file in the repo, it does
> not go in a validation doc. **No invented customers. No fabricated metrics. No
> fake certifications.** Vertical packs are **reference deployments + validation
> protocols**, not records of real production installs.

## What NeuroPause actually is
- A secure **Electron desktop** app (main/preload/renderer, context isolation, sandbox, strict CSP, allow-listed + Zod-validated IPC with a **fail-closed RBAC permission gate**) plus a **Node/Express backend** (Postgres + Redis; Qdrant configured for semantic search).
- Version `1.0.0-rc.1`. Classification prior to this program: **Release Candidate** (see `ENTERPRISE-GA-REPORT.md`).

## Real telemetry / observability sources (cite these for KPIs)
- Backend **`GET /metrics`** (Prometheus text). Real series names:
  `neuropause_backend_up`, `neuropause_backend_uptime_seconds`,
  `neuropause_backend_resident_memory_bytes`, `neuropause_backend_heap_used_bytes`,
  `neuropause_pg_pool_connections{state="total|idle|waiting"}`,
  `neuropause_http_requests_total{method,status}`.
- Backend **`GET /health`** → `{status: ok|degraded, components:{database, redis}, uptime}`; **`GET /live`** liveness.
- Backend **`audit_log`** table (append-only audit trail; schema present, populated as privileged actions occur).
- Renderer perf instrumentation: `apps/desktop/src/renderer/src/lib/perf/perfRecorder.ts`, `PerfSampler.tsx`, `ProfiledSection.tsx`, `packages/shared/src/types/perfMetrics.ts`.
- Deterministic engine bench: `apps/desktop/src/main/__bench__/performance.test.ts`.

## Real security controls (cite these for security checklists / compliance MAPPING)
- Backend-brokered OAuth **PKCE / RFC 8252**; no provider secrets on the client.
- Refresh-token **rotation + reuse detection**; server stores only SHA-256 hashes; **Argon2id** passwords (memoryCost 19456 KiB, timeCost 2, parallelism 1).
- Refresh tokens encrypted at rest via **Keychain (`safeStorage`)**.
- **SSRF guard** on outbound webhooks (`apps/desktop/src/main/webhooks/webhookStore.ts`, tested).
- **Ed25519** supply-chain signing (`verifyManifest`/`verifySignature`).
- **RBAC** fail-closed IPC permission gate in the secure bridge.
- `SEED_STORE_ON_BOOT=false` in production configs → no fabricated catalog data.
- **Known open items (state honestly):** Apple `id_token` not yet JWKS-verified (`apps/backend/src/auth/providers/apple.ts`); marketplace **app** install accepts unsigned packages when the trust store is empty (worker path fail-closed); rate limiter **fails open** if Redis is down (deliberate availability choice).

## Real MEASURED benchmarks (reference env: 2-vCPU Xeon @2.10GHz, 8 GB, Node 22.22.2, PG 16.13, Redis 7.0.15; load client co-located → latency conservative). Reference by name; do NOT alter the numbers.
- Backend **cold start → healthy: 0.66 s** (DB + Redis connected).
- **HTTP load** (concurrency 32, 3000 req/scenario, 24,000 total, **0 errors**): `/health` 1221 rps p50 22 ms; `/live` 2103 rps p50 11 ms; `/metrics` 1789 rps p50 16 ms; `/store/apps` (DB list, 20 rows) 610 rps p50 52 ms p99 80 ms; `/store/apps` filter+sort 639 rps p50 49 ms; `/store/featured` 529 rps p50 60 ms; `/store/categories` 1559 rps p50 19 ms; `/store/apps/:slug` point read 424 rps p50 72 ms p99 118 ms.
- **DB latency** (direct pg, 2000 iters, 0 errors): point read p50 0.23 ms / p95 0.46 ms; filtered list p50 0.16 ms; aggregate p50 0.12 ms; join p50 0.24 ms. (DB is sub-ms; app-layer + 2-vCPU contention dominates HTTP latency.)
- **Intelligence engines** over 5000 entities (budget 2000 ms): graph.project 92.8 ms, memory.index 74.4 ms, timeline.query 76.8 ms, search.index 55.9 ms, briefing.generate 24.3 ms, recommendations.generate 17.1 ms, search.query 6.1 ms, memory.recall 4.4 ms.
- **Argon2id** (auth cost): hash p50 19.7 ms, verify p50 19.6 ms → bounds auth throughput deliberately.
- **Memory:** RSS 117 MB idle → 213 MB under 24k-request load; heap 20 → 70 MB; pg pool auto-scaled 1 → 10.
- **Quality gates:** typecheck 0, lint 0, **3,856 tests pass**, build exit 0, **0 production npm-audit vulns**.

## Real RELIABILITY results (executed this program)
- Migration **idempotency**: 12 forward-only migrations; re-run applied 0 new. PASS.
- **Backup/restore**: `pg_dump -Fc` (136 KB) → fresh DB → `pg_restore` → row counts match exactly. PASS.
- **Restart recovery**: SIGTERM → down → restart → healthy in **0.46 s**. PASS.
- **Redis-down fail-open**: Redis stopped → `/store/apps` served 200×5; `/health` reported `degraded/redis:down`; no crash. PASS.
- **DB-down degradation + auto-recovery**: Postgres stopped → process survived, `/health` `degraded/database:down`, DB reads → clean 500; on PG restart the pool **auto-reconnected without a backend restart**. PASS.
- **Offline/air-gapped**: `scripts/build-offline-bundle.sh` shellcheck-CLEAN + documented procedure; full `docker save/load` needs a Docker daemon (not run here). PARTIAL.

## Real DEPLOYMENT assets + validation
- Docker (`apps/backend/Dockerfile`), **Kubernetes** (`deploy/kubernetes/*.yaml`, **kubernetes-validate strict PASS**), **Helm** chart (8 templates), offline bundle script (shellcheck CLEAN). CI: `backend-ci.yml`, `deploy-validation.yml`, `windows-release.yml` (no macOS/desktop CI yet).

## What CANNOT be measured in this environment (label ABSENT/HARNESS-ONLY, never fake)
- Electron desktop **startup / render / IPC / renderer memory** (macOS-only; cannot launch headless here) — perf harness exists; execution pending target hardware.
- **Real AI model** execution latency (needs live model credentials).
- **Real connector** execution and **cross-device sync** under real networks.
- Vertical **sensor/device integrations** (e.g., agriculture IoT, clinical systems) are **modeled** — schema/surfaces exist, not wired to live equipment.

## Authoring rules
1. Reference deployments = "here is how an org in X would deploy and validate," not "org Y runs this."
2. KPIs must name a real telemetry source above.
3. Compliance = **mapping** of real controls to framework requirements, explicitly a **self-assessment, not a certification**.
4. Validation protocols must reference real harnesses (`bench/http-load.mjs`, `bench/db-latency.mjs`, the `__bench__` test) and the reliability procedures above.
5. Label modeled/absent honestly. When in doubt, under-claim.
