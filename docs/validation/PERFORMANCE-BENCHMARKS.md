# NeuroPause — Performance Benchmarks (measured)

**Every number here came from executing the real system.** Nothing is estimated,
scaled, or carried over from a prior run. Each table names the harness that
produced it and the command to reproduce it.

## Reference environment

| Property | Value |
|---|---|
| CPU | Intel Xeon @ 2.10 GHz, **2 vCPU** |
| Memory | 8 GB |
| OS | Ubuntu 24.04.4 LTS (x86_64) |
| Node | v22.22.2 |
| Postgres | 16.13 (local, `:5433`) |
| Redis | 7.0.15 (local, `:6380`) |
| Backend | production build (`apps/backend/dist`), single instance |
| Captured | 2026-07-18 |

> **Reading these numbers honestly.** This is a **2-vCPU shared container**, and
> the HTTP load client runs **co-located** with the backend — they contend for the
> same two cores. So the HTTP latencies and throughput are a **conservative lower
> bound**: dedicated hardware with the client off-box will do materially better.
> The database, intelligence-engine, and Argon2 microbenchmarks are measured
> directly (no HTTP client contention) and are representative. Desktop/renderer
> timings are **not** in this document — they require macOS target hardware (see
> "Not measured here").

---

## 1. Backend cold start

Measured from process spawn to the first `GET /health` returning `200` with both
`database` and `redis` reporting `up`.

| Metric | Value |
|---|---|
| Cold start → healthy (first cold boot) | **0.66 s** |
| Cold start → healthy (warm re-boot) | **0.62 s** |
| `/health` at readiness | `{"status":"ok","components":{"database":"up","redis":"up"}}` |

Both figures are real (cold OS page cache vs warm). Artifact:
`bench/results/startup.json` — which also records the idle metrics snapshot (RSS
117 MB, heap 20 MB, pool 1), corroborating §3.

Reproduce: `bash bench/startup.sh` (boots the production build against a migrated
DB + Redis, times spawn → first `/health` 200, snapshots `/metrics`).

---

## 2. HTTP API load

Harness: `bench/http-load.mjs` (no external deps; `perf_hooks` per request, body
fully drained). Concurrency **32**, **3,000 measured requests/scenario** after a
300-request warmup. **24,000 total requests, 0 errors.**

Reproduce: `node bench/http-load.mjs --conc 32 --reqs 3000 --warmup 300 --json bench/results/http-load.json`

| Scenario | rps | mean ms | p50 | p90 | p95 | p99 | max |
|---|---:|---:|---:|---:|---:|---:|---:|
| `GET /health` (liveness, no DB) | 1221 | 26.1 | 22.0 | 42.6 | 51.5 | 89.7 | 132.8 |
| `GET /live` (readiness) | 2103 | 15.2 | 11.5 | 27.8 | 35.9 | 64.1 | 78.6 |
| `GET /metrics` (Prometheus) | 1789 | 17.8 | 16.0 | 29.5 | 35.4 | 46.7 | 71.4 |
| `GET /store/apps` (DB list, 20 rows) | 610 | 52.2 | 51.9 | 64.3 | 68.5 | 79.8 | 127.0 |
| `GET /store/apps?q=ai&sort=trending` | 639 | 49.9 | 49.1 | 61.5 | 68.2 | 87.4 | 118.8 |
| `GET /store/featured` (DB join) | 529 | 60.3 | 59.9 | 69.1 | 75.5 | 93.9 | 120.5 |
| `GET /store/categories` (DB agg) | 1559 | 20.5 | 19.1 | 28.1 | 32.9 | 40.2 | 45.6 |
| `GET /store/apps/:slug` (DB point read) | 424 | 75.3 | 72.2 | 94.8 | 104.4 | 117.8 | 131.9 |

Observations (honest): all scenarios served with **zero errors** under sustained
concurrency. The store point-read is the slowest path — it composes multiple joins
(versions, ratings, developer) per request. Because the DB layer is sub-millisecond
(§4), the HTTP latency is dominated by the app/serialization layer plus 2-vCPU
contention with the load client, not by Postgres.

---

## 3. Live metrics under load

Real `GET /metrics` after the 24k-request run (excerpt; ops probes for
`/metrics|/health|/live` are intentionally excluded from the request counter):

| Series | Idle | Under load |
|---|---|---|
| `neuropause_backend_resident_memory_bytes` | 117 MB | **213 MB** |
| `neuropause_backend_heap_used_bytes` | 20 MB | **70 MB** |
| `neuropause_pg_pool_connections{state="total"}` | 1 | **10** (auto-scaled) |
| `neuropause_http_requests_total{status="200"}` | — | **16,510** |
| `neuropause_http_requests_total{status="404"}` | — | 3 |

The pool grew from 1 → 10 under concurrency and drained back to idle afterward —
real, expected pooling behaviour. The 16,510 counted requests are ≈ the five store
scenarios × 3,300 (warmup + measured = 16,500), the small remainder being ad-hoc
probes during setup — confirming the counter's accuracy and that
health/live/metrics probes are correctly excluded. Raw capture:
`bench/results/metrics-under-load.json`.

---

## 4. Database latency

Harness: `bench/db-latency.mjs` (uses the backend's own `pg` dependency; direct
round-trips, 2,000 iterations/shape after warmup, **0 errors**).

Reproduce: `DATABASE_URL=... node bench/db-latency.mjs --iters 2000 --json bench/results/db-latency.json`

| Query shape | mean ms | p50 | p95 | p99 | max |
|---|---:|---:|---:|---:|---:|
| point read (application by slug) | 0.30 | 0.23 | 0.46 | 2.37 | 15.88 |
| filtered list (published, limit 24) | 0.20 | 0.16 | 0.26 | 0.67 | 7.60 |
| aggregate (count by status) | 0.13 | 0.12 | 0.17 | 0.23 | 5.76 |
| join (app + latest version) | 0.27 | 0.24 | 0.38 | 0.55 | 5.23 |
| index probe (`SELECT 1`) | 0.07 | 0.06 | 0.10 | 0.13 | 2.73 |

The database is **sub-millisecond at p50/p95** for every query shape against the
seeded catalog (20 applications, 40 versions, 14 categories). This is the evidence
that the app layer — not the DB — is the HTTP latency floor here.

---

## 5. Deterministic intelligence engines

Harness: `apps/desktop/src/main/__bench__/performance.test.ts` (headless Vitest;
`performance.now()`; synthetic workspace of **5,000 entities**; regression budget
2,000 ms/engine). Runs in the cloud because these are pure main-process engines
with no Electron UI dependency.

Reproduce: `cd apps/desktop && npx vitest run src/main/__bench__/performance.test.ts`

| Engine hot path | ms (5,000 entities) |
|---|---:|
| `graph.project` | 92.84 |
| `memory.index` | 74.37 |
| `timeline.query` | 76.80 |
| `search.index` | 55.91 |
| `briefing.generate` | 24.34 |
| `recommendations.generate` | 17.13 |
| `memory.project` | 13.66 |
| `search.query` | 6.09 |
| `memory.recall` | 4.43 |

Every engine completes far under the 2,000 ms guard — the slowest full projection
is ~93 ms over 5,000 entities. Query-time paths (`search.query`, `memory.recall`)
are single-digit milliseconds.

---

## 6. Argon2id auth cost

Harness: direct call into the platform's hasher (`@node-rs/argon2`) with the exact
production parameters (`apps/backend/src/auth/passwords.ts`): `memoryCost 19,456
KiB, timeCost 2, parallelism 1` (OWASP-aligned). 50 iterations.

| Operation | mean ms | p50 | p95 | max |
|---|---:|---:|---:|---:|
| hash (register / password set) | 21.4 | 19.7 | 30.0 | 33.3 |
| verify (login) | 20.1 | 19.6 | 24.4 | 25.6 |

This ~20 ms cost is **intentional** — it is the tunable work factor that resists
offline brute force. It bounds per-core auth throughput (~50 verifies/s/core),
which is the correct trade-off and a real capacity input for sizing.

---

## 7. Build & test (from the quality gates)

| Gate | Result |
|---|---|
| `npm run typecheck` | 0 errors (5 workspace projects, `strict: true`) |
| `npm run lint` | 0 warnings (`--max-warnings 0`) |
| `npm run test` | **3,856 tests pass** (desktop 3,548 / backend 263 / sdk 15 / cli 30) |
| `npm run build` | exit 0, ~25 s |
| `npm audit --omit=dev` | **0 production vulnerabilities** |

---

## Not measured here (honest scope)

These require target hardware or live third-party systems and are **not** given
fabricated numbers:

- **Electron desktop**: startup, render, IPC round-trip, renderer memory — macOS
  Apple-Silicon only; cannot launch headless in this Linux environment. The
  instrumentation exists (`perfRecorder`, `PerfSampler`, `ProfiledSection`) and the
  desktop `__bench__` harness runs its engine subset here; the UI-bound timings are
  pending a target-hardware run.
- **Real AI model execution**: needs live model credentials.
- **Real connector execution / cross-device sync**: needs live external services
  and multiple devices on a real network.

Each is listed as a remaining validation task in the EVP final report, not claimed
as done.
