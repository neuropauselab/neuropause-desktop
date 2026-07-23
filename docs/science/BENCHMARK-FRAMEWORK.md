# NeuroPause — Benchmark Framework

> Part of the NeuroPause Scientific & Standards Program (NSSP). This document
> **formalizes the benchmark methodology over the harnesses and artifacts that
> already exist** and **describes the real measured results unaltered**, citing
> each to its artifact. It invents no numbers; a benchmark not yet run is
> labelled **Proposed (L0)**, never measured. Evidence ladder (`_grounding.md`):
> **L4 Validated · L3 Measured · L2 Implemented · L1 Modeled · L0 Proposed** — an
> executed benchmark with a committed artifact is **L3**; a spec for a path not
> yet exercised is **L0**.

---

## 1. Scope and terminology

This framework governs *performance characterization* — latency, throughput,
memory, cold-start, and engine hot-path timing. It is deliberately narrow: it
does **not** cover the correctness gates (tests, typecheck, lint, audit) or the
reliability/chaos runs, which have their own records (`SCIENTIFIC-MATRICES.md`
§4, `docs/validation/RELIABILITY-RESULTS.md`), referenced here only as context.
Consistent terms, used identically everywhere below:

| Term | Meaning |
|---|---|
| **Harness** | A committed, re-runnable script that drives the real system and emits measurements. |
| **Artifact** | The committed JSON output of a harness run, under `bench/results/`. The unit of evidence. |
| **Scenario / shape** | One measured route (HTTP) or one query form (DB) or one engine hot path. |
| **Warmup** | Unmeasured iterations run first to stabilize JIT, caches, and pools; discarded. |
| **Measured phase** | The iterations whose latencies are recorded and reduced to percentiles. |
| **Cold start / warm re-boot** | Time from process spawn to first `GET /health` = `200` with DB **and** Redis `up`, against a cold OS page cache (cold) or a warm one (warm re-boot). |
| **Co-located client** | The load client runs on the *same* 2-vCPU container as the backend, contending for cores — so HTTP figures are a conservative lower bound. |
| **Measured (L3) / Proposed (L0)** | A number produced by executing a harness and committed to an artifact (L3); vs a specification defined here but not yet executed, no number (L0). |

Governing honesty rule: **a benchmark number without a committed artifact does
not exist** — cite only what an artifact under `bench/results/` supports.

---

## 2. Reference benchmark specifications

Six measured probes, all **L3** (each writes/updates one artifact); the first
four are committed re-runnable harnesses, the last two (P1, P2) are documented
procedures over the same running system rather than standalone scripts.

| # | Harness / probe | Runtime | Object of study | Artifact |
|---|---|---|---|---|
| H1 | `bench/http-load.mjs` | Node (`fetch`, `perf_hooks`), no deps | HTTP route latency + throughput | `http-load.json` |
| H2 | `bench/db-latency.mjs` | Node + backend's own `pg` | Postgres query-shape latency | `db-latency.json` |
| H3 | `bench/startup.sh` | Bash + `curl` | Cold/warm start; idle `/metrics` | `startup.json` |
| H4 | `apps/desktop/src/main/__bench__/performance.test.ts` | Vitest, `performance.now()` | Intelligence-engine hot paths | `intelligence-engines.json` |
| P1 | Argon2id cost probe (direct hasher call) | Node | Auth work-factor cost | `argon2.json` |
| P2 | `/metrics` scrape after a load burst | `curl` | Under-load memory/pool/counters | `metrics-under-load.json` |

### 2.1 H1 — HTTP load (`bench/http-load.mjs`)

Measures per-request wall latency (response body **fully drained**, so
serialization and transfer are included, not just time-to-first-byte) and
aggregate throughput at fixed concurrency. **Inputs:** `--base` (default
`http://127.0.0.1:4000` / `NP_BENCH_BASE`), `--conc` (32), `--reqs` measured/
scenario (3,000), `--warmup` (300), `--json`. **Scenarios (8, the real route
surface):** `GET /health`, `/live`, `/metrics`, `/store/apps`,
`/store/apps?q=ai&sort=trending`, `/store/featured`, `/store/categories`,
`/store/apps/:slug` — spanning no-DB liveness, DB list/filter/aggregate/join,
and point-read. It first probes `/health` and exits `2` (claiming nothing) if
the backend is unreachable. **Outputs/scenario:** `requests`, `errors`,
`concurrency`, `throughput_rps`, `mean_ms`, `p50/p90/p95/p99/max_ms`. The auth
write path (Argon2) is excluded — CPU-bound and low-RPS by design, measured as P1.

### 2.2 H2 — Database latency (`bench/db-latency.mjs`)

Measures direct Postgres round-trip latency per query shape via the backend's
own `pg` dependency (no HTTP client in the path); read-only, safe to re-run.
**Inputs:** `DATABASE_URL` (required; exits `2` if absent), `--iters` (2,000),
`--json`. **Shapes (5):** point read (by slug), filtered list (published, limit
24), aggregate (count by status), join (app + latest version), index probe
(`SELECT 1`, a floor). **Outputs/shape:** `iters`, `errors`, `mean_ms`,
`p50/p95/p99/max_ms`; the connection string is redacted (`:***@`) in the artifact.

### 2.3 H3 — Cold start + idle metrics (`bench/startup.sh`)

Measures time from spawning the production build (`apps/backend/dist/index.js`)
to the first `GET /health` = `200`, then snapshots the **idle** `/metrics`
gauges. **Inputs:** `PORT` (4000); env from `apps/backend/.env` (same
`DATABASE_URL`/`REDIS_URL`/`JWT_ACCESS_SECRET` the app uses). It kills any
process on the port (ensuring a true cold spawn), records `t0`, polls `/health`
every 0.1 s ×150, then scrapes `resident_memory_bytes`, `heap_used_bytes`,
`pg_pool_connections{state="total"}`. **Outputs:** `cold_start_to_healthy_sec_*`,
the `/health` body, the idle `metrics_idle` block; leaves the backend up for
H1/H2/P2.

### 2.4 H4 — Intelligence-engine hot paths (`__bench__/performance.test.ts`)

Measures wall time (`performance.now()`) of each deterministic main-process
engine hot path over a synthetic **5,000-entity** workspace (§5.2); runs headless
(no Electron UI dependency). **Hot paths (9):** `graph.project`,
`memory.project/index/recall`, `search.index/query`, `timeline.query`,
`briefing.generate`, `recommendations.generate`. Each asserts `< 2000 ms` — a
generous regression guard, not the headline. **Outputs:** a printed `ms` table,
transcribed to `intelligence-engines.json` (`entities`, `regression_budget_ms`, `timings_ms{…}`).

### 2.5 P1 — Argon2id cost probe

Measures hash (register/set-password) and verify (login) cost of the platform's
hasher (`@node-rs/argon2`) with the **exact production parameters** from
`apps/backend/src/auth/passwords.ts`: `argon2id`, `memoryCost 19,456 KiB`,
`timeCost 2`, `parallelism 1` (OWASP-aligned); `n = 50`. **Outputs:** `params`,
`n`, `hash_ms{mean,p50,p95,max}`, `verify_ms{…}` → `argon2.json`. No standalone `bench/` script — a direct call into the production hasher.

### 2.6 P2 — Under-load metrics scrape

Captures the stateful `/metrics` gauges by `curl`-ing `/metrics` immediately
after an H1 burst: resident memory, heap, `pg_pool_connections`, and the
`http_requests_total` counter (ops probes for `/metrics|/health|/live` are
excluded from that counter by design). **Outputs:**
`resident_memory_bytes_under_load`, `heap_used_bytes_under_load`,
`pg_pool_connections{total,idle,waiting}`, `http_requests_total{…}` →
`metrics-under-load.json`. Because the gauges reflect the *specific* preceding
burst, the artifact is point-in-time (§7).

---

## 3. Benchmark methodology

**Warmup.** Every measured harness discards unmeasured warmup first: H1 runs
`--warmup` (default 300) requests/scenario; H2 runs 100 warmup queries/shape; H4
runs `projectMemory` once before timing `memory.project`; H3 does none by design
(it *is* the cold-start measurement) but records a warm re-boot for contrast.

**Sample size.** H1: 3,000 measured requests × 8 scenarios = **24,000** total.
H2: 2,000 iterations × 5 shapes = **10,000** total. P1: 50 hash + 50 verify. H4:
one timed pass per hot path over 5,000 entities (dataset size, not repetition,
gives the signal). Sample sizes are inputs and are recorded in each artifact.

**Percentiles.** H1 and H2 use an identical nearest-rank estimator over the
sorted latency array: `idx = ceil((p/100) × n) − 1`, clamped to `[0, n−1]`. H1
reports mean/p50/p90/p95/p99/max, H2 mean/p50/p95/p99/max, P1 mean/p50/p95/max;
all latencies are ms rounded to two decimals (`Math.round(n×100)/100`).
Percentiles, not means, are the headline — the mean hides tail behaviour.

**Co-located-client caveat.** The reference run used a single 2-vCPU shared
container with the H1 load client **co-located** with the backend, contending
for the same two cores; HTTP latency and throughput are therefore a
**conservative lower bound** — dedicated hardware with the client off-box does
materially better. H2 (direct `pg`), H4 (in-process engines), and P1 (direct
hasher) have **no** HTTP-client contention and are representative as-is.

**Cold vs warm.** Cold start is measured against a cold OS page cache, the warm
re-boot after it is warm; both are real, reported as distinct figures, neither
derived from the other.

---

## 4. Measurement procedures (exact commands)

Run from the repository root against a migrated, seeded Postgres + Redis
(prerequisites and step order are in `manuals/BENCHMARK-GUIDE.md`).

| Step | Command |
|---|---|
| Bring up infra | `docker compose up -d` (postgres:16-alpine, redis:7-alpine, qdrant) |
| Apply migrations | `npm run db:migrate` (→ `tsx src/db/migrate.ts`, 12 migrations) |
| Seed catalog | `cd apps/backend && npx tsx src/db/seed.ts` (clean re-seed) |
| Build backend | `npm run build -w @neuropause/backend` |
| H3 cold start | `bash bench/startup.sh` (writes `bench/results/startup.json`) |
| H1 HTTP load | `node bench/http-load.mjs --conc 32 --reqs 3000 --warmup 300 --json bench/results/http-load.json` |
| H2 DB latency | `DATABASE_URL=... node bench/db-latency.mjs --iters 2000 --json bench/results/db-latency.json` |
| H4 engines | `cd apps/desktop && npx vitest run src/main/__bench__/performance.test.ts` |
| P2 under-load scrape | run an H1 burst, then `curl -s http://127.0.0.1:4000/metrics` and record the gauges |

> Reference-environment note: the captured run used local Postgres/Redis on
> non-default ports `:5433`/`:6380` (via `apps/backend/.env`); the committed
> `docker compose` maps the defaults `:5432`/`:6379`. Point `DATABASE_URL` /
> `REDIS_URL` at whichever instance is live — the harness measures what it connects to.

---

## 5. Benchmark datasets

Both datasets are **deterministic** — that is what makes the harnesses
reproducible rather than merely repeatable, so timings compare across runs.

### 5.1 Seeded 20-app store catalog (H1 / H2)

**Source:** `apps/backend/src/db/seeds/0001_store_seed.sql`, applied by
`apps/backend/src/db/seed.ts`. **Generation:** plain SQL `INSERT`s with
slug-based parent lookups against a freshly-truncated store, so re-seeding is
idempotent and order-stable — `seedStoreIfEmpty()` seeds on boot only when the
catalog is empty, while `tsx src/db/seed.ts` forces a clean `reset:true` re-seed
(truncates the 23 store tables with `RESTART IDENTITY CASCADE`, preserving `users`).
**Contents** (verified against `reliability.json` backup-restore row
counts): **20 applications, 40 versions, 14 categories**, plus organizations,
developers, verification tiers, ratings, reviews, collections, and featured apps
— the exact catalog H1's `/store/*` scenarios and H2's query shapes read.

### 5.2 Deterministic 5,000-entity synthetic workspace (H4)

**Source:** `buildEntities(5000)` in `__bench__/performance.test.ts`.
**Generation:** fully deterministic — **no RNG**. Each entity is derived from
its index `i`: titles/bodies pick from a fixed 12-word list by `i`-indexed
arithmetic, timestamps march from `2026-01-01` in fixed 600,000 ms steps, and
the kind is chosen by `i % 10` — `0` → `project` (10%), `1–5` → `task` linked to
a project (50%), `6–7` → `document` (20%), `8` → `message` on a channel (10%),
`9` → `calendar_event` (10%). Because construction is a pure function of `N`, the
identical workspace is rebuilt every run; `N` and the 2,000 ms budget are recorded in the artifact.

---

## 6. Benchmark reporting format

**JSON artifacts (`bench/results/*.json`).** Each harness writes a self-describing
object recording its own inputs alongside results, so an artifact is
interpretable without the command that produced it:

| Artifact | Top-level schema |
|---|---|
| `http-load.json` | `{ base, conc, reqs, warmup, results:[{ scenario, requests, errors, concurrency, throughput_rps, mean_ms, p50/p90/p95/p99/max_ms }] }` |
| `db-latency.json` | `{ db (redacted), iters, results:[{ query, iters, errors, mean_ms, p50/p95/p99/max_ms }] }` |
| `startup.json` | `{ cold_start_to_healthy_sec_first_cold_boot, …_warm_reboot, health, metrics_idle:{ resident_memory_bytes, heap_used_bytes, pg_pool_total }, note }` |
| `intelligence-engines.json` | `{ harness, entities, regression_budget_ms, timings_ms:{…} }` |
| `argon2.json` | `{ params, n, hash_ms:{mean,p50,p95,max}, verify_ms:{…} }` |
| `metrics-under-load.json` | `{ resident_memory_bytes_under_load, heap_used_bytes_under_load, pg_pool_connections:{total,idle,waiting}, http_requests_total:{…}, note }` |
| `environment.json` | the reference environment (§7) |
| `reliability.json`, `deployment.json` | companion evidence (chaos runs; k8s / shellcheck / yamllint), owned by the validation record |

**Markdown tables.** H1 and H2 also print a pipe-delimited table to stdout — the
format transcribed into `docs/validation/PERFORMANCE-BENCHMARKS.md`, where each
table names its harness and reproduction command.

---

## 7. Benchmark reproducibility

**Environment recording.** Every measured run records its environment in
`bench/results/environment.json` so numbers are never quoted without context:

| Property | Value (captured 2026-07-18) |
|---|---|
| CPU | Intel Xeon @ 2.10 GHz, **2 vCPU** |
| Memory | 8 GB |
| OS | Ubuntu 24.04.4 LTS (x86_64) |
| Node | v22.22.2 |
| Postgres | 16.13 (`:5433`) |
| Redis | 7.0.15 (`:6380`) |
| Backend | production build, single instance |

**Re-run variance.** Latency and gauge figures vary run-to-run; the framework
treats this as expected and honest, not noise to hide. Cold start legitimately
differs cold vs warm (0.66 s vs 0.624 s); the artifact records both. Percentile
stability improves with sample size — the chosen 3,000/2,000 samples keep
p95/p99 stable while staying fast to re-run. Most importantly, **`/metrics`
gauges are stateful and point-in-time**: they reflect the *specific* preceding
load. The committed `metrics-under-load.json` captures a smaller burst
(`http_requests_total.GET_200 = 8000`; RSS 212.9 MB; heap 55.0 MB; pool 10),
whereas §3 of `PERFORMANCE-BENCHMARKS.md` narrates the gauges after the full
24k-request run (RSS 213 MB; heap 70 MB; pool 10; `status="200"` counter
16,510). Both are real captures of the same instrumentation at different points
— which is exactly why gauges must be captured per-run and never carried over.

To reproduce a baseline, pin the environment, run the §4 commands in order, and
commit the refreshed `bench/results/*.json` — a number is reproducible only once its artifact is committed.

---

## 8. Measured baseline (cited, unaltered)

The **real recorded results**, transcribed unaltered from
`docs/validation/PERFORMANCE-BENCHMARKS.md` and the cited artifacts — **L3
(Measured)**. Do not edit to match expectations; re-measure and re-commit.

**Cold start** (`startup.json`): first cold boot **0.66 s**, warm re-boot
**0.62 s**; `/health` at readiness `{"status":"ok","components":{"database":
"up","redis":"up"}}`; idle snapshot RSS 117 MB, heap 20 MB, pool 1.

**HTTP load** (`http-load.json`): concurrency 32, 3,000 req/scenario, 300
warmup; **24,000 requests, 0 errors**.

| Scenario | rps | mean | p50 | p90 | p95 | p99 | max |
|---|---:|---:|---:|---:|---:|---:|---:|
| `GET /health` | 1221 | 26.1 | 22.0 | 42.6 | 51.5 | 89.7 | 132.8 |
| `GET /live` | 2103 | 15.2 | 11.5 | 27.8 | 35.9 | 64.1 | 78.6 |
| `GET /metrics` | 1789 | 17.8 | 16.0 | 29.5 | 35.4 | 46.7 | 71.4 |
| `GET /store/apps` | 610 | 52.2 | 51.9 | 64.3 | 68.5 | 79.8 | 127.0 |
| `GET /store/apps?q=ai&sort=trending` | 639 | 49.9 | 49.1 | 61.5 | 68.2 | 87.4 | 118.8 |
| `GET /store/featured` | 529 | 60.3 | 59.9 | 69.1 | 75.5 | 93.9 | 120.5 |
| `GET /store/categories` | 1559 | 20.5 | 19.1 | 28.1 | 32.9 | 40.2 | 45.6 |
| `GET /store/apps/:slug` | 424 | 75.3 | 72.2 | 94.8 | 104.4 | 117.8 | 131.9 |

**Database latency** (`db-latency.json`): 2,000 iters/shape, 0 errors.

| Query shape | mean | p50 | p95 | p99 | max |
|---|---:|---:|---:|---:|---:|
| point read (application by slug) | 0.30 | 0.23 | 0.46 | 2.37 | 15.88 |
| filtered list (published, limit 24) | 0.20 | 0.16 | 0.26 | 0.67 | 7.60 |
| aggregate (count by status) | 0.13 | 0.12 | 0.17 | 0.23 | 5.76 |
| join (app + latest version) | 0.27 | 0.24 | 0.38 | 0.55 | 5.23 |
| index probe (`SELECT 1`) | 0.07 | 0.06 | 0.10 | 0.13 | 2.73 |

**Intelligence engines** (`intelligence-engines.json`): 5,000 entities, 2,000 ms
budget. `graph.project` 92.84 · `memory.index` 74.37 · `timeline.query` 76.80 ·
`search.index` 55.91 · `briefing.generate` 24.34 · `recommendations.generate`
17.13 · `memory.project` 13.66 · `search.query` 6.09 · `memory.recall` 4.43 (ms).

**Argon2id** (`argon2.json`, n=50): hash mean 21.36 / p50 19.66 / p95 30.03 /
max 33.30 ms; verify mean 20.06 / p50 19.63 / p95 24.44 / max 25.55 ms. The
~20 ms cost is the intentional, tunable work factor, bounding ~50 verifies/s/
core — a real capacity input, not a defect.

---

## 9. Proposed (L0) future benchmark specifications

These are **specifications only** — the paths are **not yet exercised** and have
**no measured numbers**. Instrumentation for the desktop specs already exists
(`perfMetrics.ts`, `lib/perf/perfRecorder.ts`, `state/PerfSampler.tsx`,
`shell/PerformanceOverlay.tsx`, `IpcChannelStat`, `DurationSummary`); only the
target-hardware run is missing. Each is a remaining validation task in the
EVP/GA report, not claimed as done.

| ID | Proposed benchmark | Would measure | Blocker (why not-yet-run) | Reuses |
|---|---|---|---|---|
| L0-D1 | Desktop cold start (macOS) | Electron spawn → first interactive paint | needs macOS Apple-Silicon target; cannot launch headless on this Linux env | `perfRecorder`, `PerfSampler` |
| L0-D2 | IPC round-trip | main↔renderer round-trip p50/p95/max | same target-hardware blocker | `IpcChannelStat{channel,count,avgMs,maxMs}` |
| L0-D3 | Renderer frame time / memory | rAF frame time, `performance.memory` heap | same target-hardware blocker | `RenderSample`, `DurationSummary{p50,p95}` |
| L0-A1 | AI-model latency | prompt→first-token / completion latency, tokens/s | needs live model credentials | agent reasoner surfaces |
| L0-C1 | Connector throughput | fetch/sync entities/s per connector | needs live external services | connector clients |
| L0-C2 | Cross-device sync convergence | end-to-end sync latency across devices | needs multiple devices on a real network | sync/device models |

Each L0 spec must, when run, produce a committed `bench/results/*.json` artifact
in the §6 format before any number is published; until then it stays L0 and is
*proposed*, never measured.

---

## Reading note

This framework is the methodological backbone; `docs/validation/PERFORMANCE-BENCHMARKS.md`
is the measured record and `manuals/BENCHMARK-GUIDE.md` the how-to-run — all three
must agree on terminology, harness names, and artifact paths. The composite rule
holds throughout: **propose freely at L0, but claim only what a committed
artifact supports at L3.**
