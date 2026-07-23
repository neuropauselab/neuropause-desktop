# NSSP Framework — Observation Science

> **Formalization, not engineering.** This document describes the science of
> *observation* **over the platform that already exists**. Every concept carries an
> evidence level from the ladder in [`_grounding.md`](../_grounding.md)
> (**L4 Validated · L3 Measured · L2 Implemented · L1 Modeled · L0 Proposed**). L2+
> claims cite a real file or artifact; L0 items are labelled Proposed and are the
> framework's own models, not code. The backbone is
> [`SCIENTIFIC-MATRICES.md`](../SCIENTIFIC-MATRICES.md) row **C3** (Observation &
> telemetry, L3) and **C4** (Audit trail, L2). Nothing here is asserted beyond its
> evidence level.
>
> **Composite honesty rule (restated):** *an observation may be modeled freely
> (L0), but may only be **claimed** as measured (L3+) where a cited artifact
> records it.* No observation implies more than its evidence level.

---

## 1. Observation models — what constitutes an observation

An **observation** in this platform is a *recorded fact about the running system at
a point in time*, produced by an existing subsystem and never fabricated. The
platform has two structurally distinct observation planes, and this framework keeps
them separate because their evidence differs:

- **Server-side observations** — emitted by the backend process and **measured live
  in this environment** (Ubuntu 24.04 / Node v22.22.2 / Postgres 16.13 / Redis
  7.0.15, per `bench/results/environment.json`). These reach **L3** because real
  scrapes are recorded in `bench/results/`.
- **Renderer/desktop observations** — emitted by the Electron renderer and main
  process. These are **implemented and unit-pinned (L2)** but **harness-ready on
  macOS**, not measured in this Linux container (no `performance.memory`, no
  Electron runtime here). They are honestly **L2, not L3**.

The framework proposes (**L0**) a canonical **observation tuple** to describe any
recorded fact uniformly — it is a *lens over existing fields*, not a new system:

```
observation := ⟨ subject, signal, value, unit, at, source-of-truth, evidence-level ⟩
```

Every real field below already exists (e.g. `at` = the `created_at` of `audit_log`,
or the ISO `at` of an `EnterpriseTimelineEntry`; `value/unit` = a `DurationSummary`
or a Prometheus gauge). The tuple is a description, labelled **L0**.

### Master observation table — type → real source → evidence

| # | Observation type | Real source (cited) | Plane | Evidence |
|---|---|---|---|---|
| O1 | Process liveness / uptime gauge | `observability/metrics.ts:51‑57` (`neuropause_backend_up`, `_uptime_seconds`) | server | **L3** |
| O2 | Resident-memory / heap gauge | `metrics.ts:59‑65`; `bench/results/metrics-under-load.json`, `startup.json` | server | **L3** |
| O3 | Postgres pool gauge | `metrics.ts:67‑73` fed by `app.ts:102` (`pool.totalCount/idleCount/waitingCount`) | server | **L3** |
| O4 | HTTP request counter | `metrics.ts:14‑21` (`recordHttpRequest`); `app.ts:74‑79` finish hook | server | **L3** |
| O5 | Readiness snapshot (`/health`) | `app.ts:88‑96`; `bench/results/startup.json` (`status:"ok"`) | server | **L3** |
| O6 | Liveness probe (`/live`) | `app.ts:84‑86` | server | **L3** |
| O7 | Health state transition ok↔degraded | `docs/validation/RELIABILITY-RESULTS.md`; `bench/results/reliability.json` | server | **L4** |
| O8 | Structured request log (redacted) | `config/logger.ts`; `app.ts:65‑71` (`pinoHttp`); `middleware/requestId.ts` | server | **L2** |
| O9 | Security audit event (append-only) | `middleware/audit.ts`; `db/migrations/0001_init.sql:50` | server | **L2** |
| O10 | Unified event stream | `packages/shared/src/types/enterpriseTimeline.ts` (*types-only*) | desktop | **L1** |
| O11 | Composed system-health snapshot | `packages/shared/src/types/systemHealth.ts` (`composeSystemHealth`, pure + tested) | desktop | **L2** |
| O12 | Renderer frame rate (rAF FPS) | `state/PerfSampler.tsx:36‑59` (requestAnimationFrame counter) | renderer | **L2** |
| O13 | Renderer JS-heap | `PerfSampler.tsx:23‑29` (`performance.memory`) | renderer | **L2** |
| O14 | IPC round-trip / channel stat | `lib/ipc.ts:372‑375` → `lib/perf/perfRecorder.ts:37‑54` → `IpcChannelStat` | renderer | **L2** |
| O15 | React render duration | `components/perf/ProfiledSection.tsx:11‑13` (Profiler → `recordRender`) | renderer | **L2** |
| O16 | Duration distribution summary | `perfMetrics.ts:161‑172` (`summarizeDurations` → `DurationSummary`) | shared | **L2** |
| O17 | Reproducible benchmark artifact | `bench/results/*.json` (+ `bench/*.mjs`, `startup.sh`) | harness | **L3** (reliability **L4**) |

---

## 2. Signals

A **signal** is the lowest-level raw sample, before any aggregation. All three
mandated signal classes are real and each is captured, never simulated.

| Signal | What it samples | Source | Evidence |
|---|---|---|---|
| rAF frame rate | frames per elapsed second, from a `requestAnimationFrame` loop | `PerfSampler.tsx:41‑52` (`fps = frames*1000/elapsed`) | **L2** |
| JS-heap (renderer) | `performance.memory.usedJSHeapSize` / `jsHeapSizeLimit`, `null` when unsupported | `PerfSampler.tsx:23‑29`, `perfMetrics.ts:87‑88` | **L2** |
| Pool gauges (server) | live `pg` pool `total`/`idle`/`waiting` counts | `metrics.ts:24‑28` (`PoolStats`), `app.ts:102` | **L3** |
| Process memory (server) | `process.memoryUsage().rss` / `.heapUsed` | `metrics.ts:48,61,65` | **L3** |

The renderer collector file header is explicit: *"Nothing is simulated: every
duration comes from a real `performance.now()` delta around a real IPC call"*
(`perfRecorder.ts:1‑8`). Where a signal is unavailable (e.g. `performance.memory`
outside Chromium/Electron) it is reported as `null` / `supported:false`
(`perfMetrics.ts:250‑261`) — **absence is recorded honestly, never back-filled**.
Because the renderer signals depend on the Electron runtime, they are **L2 here**
(harness-ready on macOS), not L3.

## 3. Telemetry

**Telemetry** is the aggregated, externally-scrapeable surface. The backend exposes
three endpoints (`app.ts`), all measured live in this container.

| Endpoint | Shape | Series / fields (real) | Evidence |
|---|---|---|---|
| `GET /metrics` | Prometheus text v0.0.4 | `neuropause_backend_up`, `_uptime_seconds`, `_resident_memory_bytes`, `_heap_used_bytes` (gauges); `neuropause_pg_pool_connections{state}`; `neuropause_http_requests_total{method,status}` (counter) | **L3** |
| `GET /health` | JSON | `{status: ok\|degraded, components:{database,redis}, uptime}` | **L3** |
| `GET /live` | JSON | `{status:"alive", uptime}` — no dependency checks | **L3** |

Real recorded values (unaltered, from `bench/results/`):

- **Idle** (`startup.json`): rss `117,813,248` B (~112 MiB), heap `20,579,624` B
  (~20 MiB), pool total `1`; `/health` = `{status:"ok", database:"up",
  redis:"up"}`.
- **Under load** (`metrics-under-load.json`, scraped after a `bench/http-load.mjs`
  burst): rss `223,260,672` B (~213 MiB), heap `57,694,488` B (~55 MiB), pool
  `{total:10, idle:10, waiting:0}`, `http_requests_total.GET_200 = 8000`.
- **Endpoint characterization** (`http-load.json`, 3,000 req × 32 conc, 0 errors):
  `/live` 2,102.96 rps (p50 11.46 ms); `/metrics` 1,789.27 rps; `/store/apps` 610.29
  rps (p50 51.87 ms).

The metrics module is deliberately **privacy-preserving**: its header states it
exposes *"ONLY non-sensitive aggregate operational signals … No request bodies, no
paths with identifiers, no PII, no secrets"* (`metrics.ts:1‑12`). `/metrics`,
`/health`, and `/live` are **excluded from the HTTP counter** to avoid self-noise
(`app.ts:75`). This bounds what the telemetry can warrant (see §11).

## 4. Logs

**Logs** are the structured, per-request narrative — distinct from telemetry
(aggregate) and audit (durable evidence).

- **Structured JSON logging** via `pino` + `pino-http` (`app.ts:65‑71`), one line
  per request, with the request id as `genReqId` and `/health` excluded from
  auto-logging to keep probe noise out (`app.ts:69`). **L2**.
- **Redaction is built in** (`config/logger.ts:8‑11`): the paths
  `req.headers.authorization`, `password`, `*.password`, `refreshToken`,
  `accessToken` are censored to `[redacted]`. This is a real, cited safeguard — a log
  observation **cannot** carry those secrets. **L2**.
- **Correlation**: `middleware/requestId.ts` attaches a stable `x-request-id`
  (incoming if ≤128 chars, else a fresh `randomUUID`) echoed on the response and
  reused across logs and error bodies — the join key for tracing one request across
  observations. **L2**.

## 5. Events

**Events** are discrete "what happened" records on a stream (as opposed to sampled
signals). The mandated surface is the **`enterpriseTimeline`** read-model.

- `EnterpriseTimelineEntry` (`enterpriseTimeline.ts:25‑52`) unifies two existing
  sources — durable **platform** events and **activity** derived from the Unified
  Data Model — into one typed, ordered, filterable, replayable, exportable
  (`ndjson`) stream. It *"owns no storage of its own"* and *"composes … at read
  time"*. The file is explicitly **`Types-only.`** → **L1 (Modeled)**, not L3. Do
  not imply a running event bus from this file alone.
- The desktop **composed system-health snapshot** (`systemHealth.ts`,
  `composeSystemHealth`, **L2**: pure + unit-tested) surfaces an event-throughput
  rollup (`eventsPerMinute`, `bufferedEvents`, `avgDispatchMs`) — but it *composes*
  signals other subsystems already produce; it re-measures nothing
  (`systemHealth.ts:1‑9`).

## 6. State transitions

A **state transition** is an observed change in a system-state variable — the one
observation class here that reaches **L4**, because transitions were *executed and
recorded*, not merely defined.

`/health` is a two-state observer, `ok ↔ degraded`, computed live from real
dependency pings (`app.ts:88‑96`, `healthy = db && cache`; 200 vs 503). The
`RELIABILITY-RESULTS.md` runs (2026-07-18, live backend) drove and captured the
transitions in `bench/results/reliability.json`:

| Perturbation | Observed transition | Result |
|---|---|---|
| Redis stopped | `ok → degraded` (`components.redis:"down"`), requests still served 200×5 (fail-open) | **PASS (L4)** |
| Postgres stopped | `ok → degraded` (`database:"down"`), DB reads fail-fast 500, process survives | **PASS (L4)** |
| Postgres restarted | `degraded → ok`, pool **auto-reconnects with no backend restart** | **PASS (L4)** |
| `SIGTERM` → restart | reachable → `000` → **healthy again in 0.46 s** | **PASS (L4)** |

This is the platform's strongest observation evidence: honest degradation is
*proven*, not asserted. (The desktop `SystemHealthLevel` machine —
`healthy/degraded/critical/offline/unknown`, `systemHealth.ts:15` — is the richer
**L2** model of the same idea, unit-tested but not driven under live chaos here.)

## 7. Execution traces

An **execution trace** captures the cost/shape of a single unit of work.

- **IPC channel stats** — the renderer wraps `invoke` (`ipc.ts:372‑375`,
  *"behavior-preserving … observes timing on a detached branch"*) so every real IPC
  round-trip feeds `perfRecorder.ipcStart` (`perfRecorder.ts:37‑54`). Per-channel
  aggregation yields `IpcChannelStat{channel,count,avgMs,maxMs}`
  (`perfMetrics.ts:19‑24`); in-flight count is the real pending counter. **L2**.
- **React render trace** — `ProfiledSection` feeds a real `Profiler` commit duration
  into `recordRender` (`ProfiledSection.tsx:11‑13`), rolled up as
  `RenderComponentStat`. **L2**.
- **`DurationSummary`** (`perfMetrics.ts:35‑41`: `count, avgMs, p50Ms, p95Ms,
  maxMs`) is the platform's canonical trace-summary shape, produced by the pure,
  deterministic `summarizeDurations` (`perfMetrics.ts:161‑172`, nearest-rank
  percentile). It is the shared vocabulary between renderer traces and the
  Measurement framework's §3. **L2** (server-side latency percentiles in
  `http-load.json` are the separately **L3** measurements).

## 8. Evidence collection

**Evidence** is the durable, replayable residue of observation — what survives after
the process moves on.

- **`audit_log`** (`0001_init.sql:50‑60`) — an **append-only** table
  (`BIGSERIAL id`, `user_id`, `action`, `detail JSONB`, `ip INET`, `created_at`),
  indexed on `user_id` and `action`. Writes go through `middleware/audit.ts`, which
  *"must never break the request … so failures are logged and swallowed"* — audit is
  best-effort-durable and non-blocking. **L2** (implemented; not independently
  measured as a scientific claim → not L3).
- **Benchmark artifacts** — `bench/results/*.json` are the recorded, reproducible
  observations of this program: `startup.json`, `metrics-under-load.json`,
  `http-load.json`, `db-latency.json`, `reliability.json`, etc. Reproducible via
  `bench/http-load.mjs`, `bench/db-latency.mjs`, `bench/startup.sh`. **L3**;
  `reliability.json` is **L4** (executed chaos with recorded pass/fail).

## 9. Observation lifecycle — emit → collect → aggregate → retain

Observations move through four stages. The two planes share the shape but differ in
evidence, so the pipeline is drawn as two lanes:

```
                         OBSERVATION PIPELINE  (signal → collector → aggregate → sink)

  SERVER PLANE (L3, measured live here)
  ┌────────────────────────┐   ┌──────────────────────────┐   ┌────────────────────────┐   ┌───────────────────┐
  │ EMIT (signal)          │   │ COLLECT                  │   │ AGGREGATE              │   │ SINK / RETAIN     │
  │ process.memoryUsage()  │──▶│ httpRequests Map counter │──▶│ renderMetrics() →      │──▶│ GET /metrics      │
  │ pg pool total/idle/wait│   │ (metrics.ts:15)          │   │ Prometheus text v0.0.4 │   │ (scrape target)   │
  │ res.on('finish') hook  │   │ (app.ts:74‑79)           │   │ (metrics.ts:47‑83)     │   │                   │
  │ pingDatabase/pingRedis │──▶│ Promise.all (app.ts:89)  │──▶│ ok|degraded + 200|503  │──▶│ GET /health,/live │
  │ pino-http per request  │──▶│ redact (logger.ts:8‑11)  │──▶│ structured JSON line   │──▶│ log stream        │
  │ audit(action,detail…)  │──▶│ INSERT (audit.ts:17)     │──▶│ (append-only)          │──▶│ audit_log table   │
  └────────────────────────┘   └──────────────────────────┘   └────────────────────────┘   └───────────────────┘

  RENDERER PLANE (L2, harness-ready on macOS — not measured in this Linux container)
  ┌────────────────────────┐   ┌──────────────────────────┐   ┌────────────────────────┐   ┌───────────────────┐
  │ rAF frame counter      │   │ perfRecorder ring buffers│   │ buildPerfSnapshot()    │   │ perfStore.publish │
  │ performance.memory     │──▶│ IPC_RING=200 renders=100 │──▶│ summarizeDurations →   │──▶│ → Performance      │
  │ ipc.ts invoke wrap     │   │ (perfRecorder.ts:26‑101) │   │ DurationSummary +      │   │   Overlay /        │
  │ Profiler onRender      │   │ read() copies buffers    │   │ recommendations        │   │   Diagnostics      │
  │ (PerfSampler tick 1s)  │   │ (PerfSampler.tsx:106‑134)│   │ (perfMetrics.ts:238)   │   │                   │
  └────────────────────────┘   └──────────────────────────┘   └────────────────────────┘   └───────────────────┘
```

- **Emit** — a subsystem produces a signal/event (rAF tick, pool read, `audit()`
  call, request finish).
- **Collect** — a bounded, non-blocking holder buffers it: an in-process counter
  `Map` (`metrics.ts:15`), best-effort audit `INSERT`, or the renderer's bounded ring
  buffers (200 IPC / 100 render samples — *observation is intentionally lossy at the
  tail*).
- **Aggregate** — a **pure, deterministic** function summarizes: `renderMetrics()`
  server-side, `buildPerfSnapshot`/`summarizeDurations` renderer-side (no clock,
  no randomness, no I/O — `perfMetrics.ts:1‑10`, so the same input always yields the
  same snapshot and tests pin it).
- **Retain / sink** — exposed for scrape (`/metrics`), stored durably (`audit_log`),
  streamed to logs, or published to the UI store. Retention is bounded by design
  (ring buffers) or by the datastore (audit rows).

## 10. Observation quality

Quality attributes, each tied to a real mechanism (not aspirational):

| Attribute | Real mechanism | Evidence |
|---|---|---|
| **Completeness** | pool gauge only emitted when `poolStats` present (`metrics.ts:67`); unsupported memory → `null`/`supported:false` (`perfMetrics.ts:250‑261`); missing subsystems omitted, never faked "healthy" (`systemHealth.ts:98‑113`) | **L2** |
| **Timeliness** | renderer publishes every `SAMPLE_MS = 1000` ms (`PerfSampler.tsx:18,127`); `/metrics` & `/health` are pull-time-fresh (read `process.memoryUsage()` / ping deps per scrape) | **L2 / L3** |
| **Determinism** | aggregation layers are pure — no clock/randomness/I/O (`perfMetrics.ts:1‑10`); unit-pinned | **L2** |
| **Non-interference** | audit failures swallowed (`audit.ts:23‑25`); IPC timing on a *detached branch*, behavior-preserving (`ipc.ts:368‑375`); probes excluded from the request counter (`app.ts:75`) | **L2** |
| **Boundedness** | ring buffers cap memory (`perfRecorder.ts:11‑14`); metrics carry no PII/bodies (`metrics.ts:1‑12`) | **L2 / L3** |
| **Reproducibility** | harnesses re-emit the same observations on demand (`bench/*.mjs`, `startup.sh`) | **L3 / L4** |

Honest quality gaps (do not paper over): renderer observations have **no recorded
measurement in this environment** (Linux, no Electron) — they are L2, harness-ready
on macOS. `audit_log` completeness is *best-effort* (writes are swallowed on
failure), so absence of an audit row is **not** proof an action did not occur.

## 11. Observation confidence — what a signal does / does not warrant

The discipline that keeps this framework honest: each signal warrants a claim **only
up to its evidence level and its measured scope**.

| Signal / observation | Warrants | Does **not** warrant | Level |
|---|---|---|---|
| `neuropause_backend_up = 1` | the process answered *this* scrape | that it was up between scrapes, or that work succeeded | **L3** |
| `/health = ok` | database **and** redis pinged healthy now (`app.ts:90`) | correctness of business logic, or absence of degraded sub-features | **L3** |
| `/health = degraded` | a named dependency is down; service may still serve (fail-open proven §6) | that the app is down (it survives — `reliability.json`) | **L4** |
| `pg_pool waiting > 0` | requests queued for a connection at scrape time | a specific latency SLA breach (no live SLA measured) | **L3** |
| `http_requests_total` | count of finished requests by method+status | latency, payloads, or per-user behavior (counter carries none) | **L3** |
| FPS avg / JS-heap % | a renderer-side sample *when the harness runs* | a measured production baseline (not measured in this container) | **L2** |
| `IpcChannelStat.maxMs` | the worst observed round-trip in a 200-sample window | the true tail (bounded buffer is lossy) or a p99.9 | **L2** |
| `audit_log` row | a security-relevant action *was* recorded | that every action was recorded (best-effort write) | **L2** |
| `enterpriseTimeline` entry | a **modeled** unified-stream shape exists | a running event bus (file is types-only) | **L1** |
| `bench/results/*.json` | a real, reproducible measurement on the stated env | vendor-neutral generalization, peer review, or certification | **L3/L4** |

**No forecasting is implied by any observation.** Per `_grounding.md`, the platform
has **no statistical/time-series/ML prediction engine**; observation supplies the
*present and past*, never a forecast. Any predictive reading of these signals is
**L0 (Proposed)** and belongs to the Prediction framework, not here.

---

## 12. Terminology (consistent across NSSP)

**signal** (raw sample) · **telemetry** (aggregate scrape surface) · **log**
(redacted per-request narrative) · **event** (discrete stream record) · **state
transition** (observed state change) · **execution trace** (per-unit-of-work cost) ·
**evidence** (durable, replayable residue) · **`DurationSummary`** (canonical
distribution shape) · **observation tuple** (L0 lens). "Observe/measure" describe
what a cited artifact records; "propose/model" describe framework-authored L0/L1
constructs — the two are never blurred.

## 13. Closing honesty note

Server-side observation is **measured live here (L3)**, with **state transitions
validated under executed chaos (L4)**. Renderer observation is **implemented and
unit-pinned (L2)**, harness-ready on macOS but **not measured in this Linux
container** — stated plainly, not inflated. The unified event stream
(`enterpriseTimeline`) is **modeled (L1)**. There are **no** fabricated numbers,
no implied forecasting engine, and no standards-conformance claims. Every row traces
to a real file or `bench/results/` artifact, and **no observation in this document
implies more than its evidence level.**
