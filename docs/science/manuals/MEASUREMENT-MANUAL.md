# NSSP Manual — Measurement Operations

> Operational companion to
> [`../frameworks/MEASUREMENT.md`](../frameworks/MEASUREMENT.md). The framework
> defines *what* each quantity is; this manual is *how to take it reproducibly, how
> to read the artifact, and how to report it honestly*. Every command below runs a
> real, committed harness against a running platform; every JSON path is a real
> artifact under `bench/results/`. Do not invent numbers — run the harness or cite
> the recorded artifact. Evidence levels per [`../_grounding.md`](../_grounding.md).

---

## 1. Before any measurement — record the environment

A measurement without its environment is not reproducible. `bench/results/environment.json`
is the reference record (captured 2026-07-18):

- CPU **Intel Xeon @ 2.10 GHz**, **2 vCPUs**; RAM 8,216,340 kB
- Node **v22.22.2**, Ubuntu 24.04.4 LTS x86_64, Postgres **16.13**, Redis **7.0.15**
- single shared cloud container; **HTTP load client co-located with the backend**

Re-capture it whenever hardware, OS, Node, Postgres, or Redis changes. Report the
environment alongside every number — hardware-free latency figures are meaningless.

**Prerequisites:** `npm install` at the repo root; a migrated Postgres + Redis
reachable via `apps/backend/.env`; the production backend build
(`npm run build`) for startup timing.

---

## 2. Taking each measurement

Run all commands from the repo root. `--json` paths overwrite the committed
artifact — intentional, so the recorded result always matches the latest run.

### 2.1 HTTP load → `http-load.json`

```bash
# Start the backend first (bench aborts with exit 2 if /health is unreachable).
node bench/http-load.mjs \
  --base http://127.0.0.1:4000 --conc 32 --reqs 3000 --warmup 300 \
  --json bench/results/http-load.json
```

Drives the 8 real routes (liveness, `/metrics`, and the DB-backed `/store/*`
paths). Per scenario: 300-request warmup (discarded), then 3,000 measured requests
at concurrency 32 → **24,000 measured requests total**. Latency is timed with
`perf_hooks` around the full response (body drained). Prints a table and writes JSON.

### 2.2 Database latency → `db-latency.json`

```bash
DATABASE_URL='postgres://neuropause:***@127.0.0.1:5433/neuropause' \
  node bench/db-latency.mjs --iters 2000 --json bench/results/db-latency.json
```

Read-only; safe to re-run. Times 5 representative query shapes (point read,
filtered list, aggregate, join, index probe) — 100-iteration warmup then **2,000
timed round-trips per shape** (10,000 total). Uses the backend's own `pg`
dependency, so it measures the same client path the app uses.

### 2.3 Cold start + idle metrics → `startup.json`

```bash
bash bench/startup.sh          # honors $PORT (default 4000)
```

Kills any backend on the port, spawns `apps/backend/dist/index.js`, and measures
**spawn → first `/health` 200**, then snapshots the idle `/metrics` gauges (RSS,
heap, pool). Leaves the backend running for the harnesses above.

> Honest note: the script writes a single-boot schema (`cold_start_to_healthy_sec`).
> The committed `startup.json` records **two** boots
> (`..._first_cold_boot` 0.66 s, `..._warm_reboot` 0.624 s) to show run-to-run
> variance — re-running the script yields the single-key form; edit in the second
> boot only if you actually measured it.

### 2.4 Intelligence-engine timings → `intelligence-engines.json`

```bash
# Targeted run of the __bench__ budget guard:
npx vitest run apps/desktop/src/main/__bench__/performance.test.ts
# …or the full desktop suite:  npm run test -w @neuropause/desktop
```

Builds a seeded **5,000-entity** synthetic workspace and times 9 hot paths with
`performance.now()`, printing a table and asserting each stays under the **2,000 ms**
regression budget. The test does **not** write JSON — read the printed
`Performance over 5000 entities:` table and transcribe the timings into
`intelligence-engines.json` (and `docs/intelligence/performance-benchmarks.md`).

### 2.5 Argon2 and metrics-under-load (no standalone harness)

`argon2.json` and `metrics-under-load.json` have **no committed `.mjs` script** in
`bench/` — state this plainly rather than implying one exists.

- **Argon2** (`argon2.json`): measured with the backend's real Argon2id parameters
  — `memoryCost 19456` KiB, `timeCost 2`, `parallelism 1` — over **n = 50** hash and
  50 verify operations. Reproduce by timing those two calls with `perf_hooks` under
  the identical parameters the auth code uses; record mean/p50/p95/max.
- **Metrics under load** (`metrics-under-load.json`): capture by scraping `/metrics`
  immediately after a `bench/http-load.mjs` burst:
  ```bash
  curl -s http://127.0.0.1:4000/metrics | \
    grep -E 'resident_memory_bytes|heap_used_bytes|pg_pool_connections|http_requests_total'
  ```
  Record the RSS/heap gauges and `pg_pool_connections{state}` counts.

### 2.6 Reliability and deployment (procedural artifacts)

`reliability.json` (restart 0.46 s; 5 PASS / 1 PARTIAL) and `deployment.json`
(`shellcheck` CLEAN; `kubernetes-validate --strict` PASS) record executed
procedures documented in `docs/validation/`. Reproduce by following those
procedures; each row carries its own evidence string.

---

## 3. Reading the JSON artifacts

| Artifact | Key fields | How to read |
|---|---|---|
| `http-load.json` | `conc`, `reqs`, `warmup`, `results[]` | each result = one scenario; `throughput_rps` + `p50/p90/p95/p99/max_ms`; `errors` should be 0 |
| `db-latency.json` | `iters`, `results[].{mean,p50,p95,p99,max}_ms` | per query shape; DSN is masked (`:***@`) |
| `intelligence-engines.json` | `entities`, `regression_budget_ms`, `timings_ms{}` | one time per hot path (single-shot — no percentile) |
| `argon2.json` | `params`, `n`, `hash_ms{}`, `verify_ms{}` | cost check for the auth write-path |
| `startup.json` | `..._first_cold_boot`, `..._warm_reboot`, `metrics_idle{}` | idle gauges captured right after boot |
| `metrics-under-load.json` | `*_under_load`, `pg_pool_connections{}`, `http_requests_total{}` | gauges after a load burst; counter is cumulative |
| `reliability.json` | `scenarios[].{id,result,evidence}` | `result` ∈ PASS/PARTIAL; `evidence` is the recorded proof |
| `environment.json` | host/runtime versions + `note` | the reproducibility record for every run |

Percentiles are **nearest-rank** over the sorted sample (`pct()` in the harnesses,
`percentile()` in `perfMetrics.ts`). Latencies are rounded to **0.01 ms**; means in
`perfMetrics` to **0.1 ms**; uptime to **1 s**; memory is byte-exact.

---

## 4. Reporting results honestly

A result is only citable if it carries its context. Every reported number must state:

1. **Environment** — CPU/vCPU, RAM, Node/Postgres/Redis versions (from `environment.json`).
2. **Sample size** — measured n and warmup (e.g. "24,000 requests, 300 warmup/scenario, conc 32").
3. **Distribution, not just mean** — quote p50 **and** a tail (p95/p99) for any latency.
4. **Evidence level** — L3 measured / L4 validated / L2 implemented, per the ladder.
5. **Caveats** — the ones that actually apply:
   - **Co-located load client**: HTTP latency is *conservative* (2-vCPU contention
     inflates it) — never present HTTP latency as best-case.
   - **Single-shot engine timings**: `intelligence-engines.json` has one pass per
     path; do not claim a p99 for engine time.
   - **Cumulative counters**: `http_requests_total` is monotonic per process; read
     it as a difference, never as a fixed level.
   - **Run-to-run variance**: expected (see the two startup boots); don't present a
     single run as invariant.
6. **No alteration** — reproduce artifact numbers exactly; MB/s conversions are
   reading aids, marked `≈`. Never round an error count up or a latency down.

Forbidden: quoting a mean without its tail; citing a number with no artifact;
implying a harness (e.g. an Argon2 script) that is not committed; claiming an SLO is
met (SLOs are **L0 Proposed**, unenforced).

---

## 5. Checklist — adding a new measurement

1. **Define** the metric: name, **unit** (§5 of the framework), **scale**
   (ratio/interval/ordinal/nominal), and any **dimensions**.
2. **Classify evidence**: is it measured (L3), validated by a gate (L4), or only
   implemented (L2)? Do not over-claim.
3. **Instrument** with a real clock/gauge — `perf_hooks` for durations, a `/metrics`
   gauge for resources. Reuse `DurationSummary` / `summarizeDurations()`; do not
   invent a new summary shape.
4. **Warm up**, then sample at a fixed, recorded load; pick n large enough for the
   tail you intend to quote (percentiles need hundreds+; a single-shot is a point
   estimate — label it so).
5. **Aggregate** to sorted percentiles + mean; keep resolution honest (≤ 0.01 ms).
6. **Write** a JSON artifact to `bench/results/` including sample size and a `note`
   with caveats; make the harness re-runnable with a documented command.
7. **Cite** it: add a row to the framework's master register
   (metric → unit → scale → source → evidence) and to
   [`SCIENTIFIC-MATRICES.md` §3](../SCIENTIFIC-MATRICES.md) with the same evidence level.
8. **Verify reproducibility**: a second person, from the artifact + command alone,
   should reproduce the number within disclosed variance.

---

Cross-references: [`../frameworks/MEASUREMENT.md`](../frameworks/MEASUREMENT.md)
(definitions, scales, thresholds), [`../_grounding.md`](../_grounding.md) (evidence
ladder + authoring rules), [`../SCIENTIFIC-MATRICES.md`](../SCIENTIFIC-MATRICES.md)
§3 (Measurement Matrix). Honesty rule: *propose freely at L0, claim only what a
cited artifact supports at L2+.*
