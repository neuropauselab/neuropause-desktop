# NSSP Framework — Measurement Science

> Part of the NeuroPause Scientific & Standards Program (NSSP). A **formalization** of
> the measurement science already practised over the existing platform — not a proposal
> to build measurement. Every quantity is traceable to a real harness, artifact, or
> type; anything the framework merely *proposes* is labelled **L0**. Evidence levels
> follow the ladder in [`_grounding.md`](../_grounding.md): **L4 Validated · L3 Measured
> · L2 Implemented · L1 Modeled · L0 Proposed/Future**. This framework expands
> [`SCIENTIFIC-MATRICES.md` §3](../SCIENTIFIC-MATRICES.md), preserving its evidence
> levels; measured numbers are reproduced **unaltered** from `bench/results/*.json`.

---

## 0. Scope and grounding

Measurement science in NeuroPause answers one question rigorously: *what real
quantity was observed, by what instrument, with what confidence?* The platform
already carries the apparatus, which this framework names, classifies, and governs:

- **primitive** — `DurationSummary { count, avgMs, p50Ms, p95Ms, maxMs }`
  (`packages/shared/src/types/perfMetrics.ts`), the canonical duration distribution;
- **harnesses** — `bench/http-load.mjs`, `bench/db-latency.mjs`, `bench/startup.sh`,
  and the `apps/desktop/src/main/__bench__/performance.test.ts` vitest budget guard;
- **artifacts** — `bench/results/{environment,http-load,db-latency,intelligence-engines,argon2,startup,metrics-under-load,reliability,deployment}.json`;
- **telemetry** — the Prometheus `GET /metrics` exposition
  (`apps/backend/src/observability/metrics.ts`) and the renderer sampler
  (`apps/desktop/src/renderer/src/state/PerfSampler.tsx`, `.../lib/perf/perfRecorder.ts`, `.../shell/PerformanceOverlay.tsx`);
- **derived indicators** — the KPI modules (`enterprise/intelligence/enterpriseKpi.ts` and siblings).

The operational companion — *how* to take each measurement — is
[`../manuals/MEASUREMENT-MANUAL.md`](../manuals/MEASUREMENT-MANUAL.md).

Reference environment for every measured number below (`environment.json`, **L3**):
Intel Xeon @ 2.10 GHz, **2 vCPUs**, 8,216,340 kB RAM, Node v22.22.2, Ubuntu 24.04.4,
Postgres 16.13, Redis 7.0.15, single shared cloud container (captured 2026-07-18).

---

## 1. Measurement taxonomy

Measured quantities form a small tree of **metric families**. Every leaf cites the
harness or telemetry surface that produces it.

```
NeuroPause measurements
├── Performance
│   ├── Latency (ms) ....... HTTP req (http-load L3) · DB query (db-latency L3) ·
│   │                        auth hash/verify (argon2 L3) · IPC round-trip (perfMetrics L2)
│   ├── Throughput (req/s) . HTTP requests/sec (http-load → http-load.json L3)
│   ├── Engine time (ms) ... graph/memory/search/timeline/briefing/recommendations
│   │                        (__bench__/performance.test.ts L3)
│   └── Startup (s) ........ cold-start→healthy (startup.sh L3) · restart recovery (reliability L4)
├── Resource
│   ├── Memory (bytes) ..... resident RSS & heap used (/metrics gauges L3) · renderer JS-heap (perfMetrics L2)
│   └── Pool (count) ....... pg pool connections (/metrics gauge{state} L3)
├── Rendering ............. frame rate fps (PerfFps L2) · render duration ms (DurationSummary L2)
├── Traffic / counters .... HTTP request count (/metrics counter{method,status} L3) · error rate (http-load L3)
└── Derived indicators .... KPI value 0..100 (ExecutiveKpi.value L2) · band (ordinal L2) · trend (L2)
```

The load-bearing metrics of the program are the three **performance** families
(**latency**, **throughput**, **engine time**) plus **memory** (resource).

---

## 2. Metrics (real)

A **metric** is a directly observed quantity with an instrument, a unit, and a
scale. The four core metrics are all L3 (measured) or better.

### 2.1 Latency

Elapsed wall-clock time for one operation, in **ms**. Captured with
`node:perf_hooks` `performance.now()` around a single operation (`once()` in
`http-load.mjs`, the timed loop in `db-latency.mjs`, `ms()` in the engine bench).
Reported as a distribution — p50/p95/p99/max plus mean — never as a bare average.
Recorded examples (unaltered): HTTP `/store/apps` p50 **51.87 ms** / p99 **79.77 ms**;
DB point read p50 **0.23 ms**; Argon2 hash mean **21.36 ms**, verify **20.06 ms**
(full rows in §12).

### 2.2 Throughput

Completed operations per unit time, in **req/s**, computed as
`requests / wallMs × 1000` over the measured phase at fixed concurrency (32).
Recorded span (unaltered, `http-load.json`): `GET /live` **2,102.96 req/s** (no DB)
down to `GET /store/apps/:slug` **423.72 req/s** (DB point read). Latency and
throughput are inversely coupled under fixed concurrency, so both are always reported
together.

### 2.3 Memory (resource)

Process memory as integer **bytes**, read from real Prometheus gauges
(`neuropause_backend_resident_memory_bytes`, `_heap_used_bytes`). Idle → under-load
(unaltered): RSS **117,813,248 → 223,260,672 B**; heap **20,579,624 → 57,694,488 B**
(`startup.json` → `metrics-under-load.json`). Byte counts are authoritative; any MB
gloss (÷10⁶) is a reading aid marked `≈`.

### 2.4 Engine time

Hot-path execution time (**ms**) of the deterministic intelligence engines over a
seeded synthetic **N = 5,000-entity** workspace (`performance.test.ts` →
`intelligence-engines.json`). The engines are pure, so timings are stable functions
of input size — slowest `graph.project` **92.84 ms**, fastest `memory.recall`
**4.43 ms** (all 9 paths in the artifact), far under the 2,000 ms budget (§7).

---

## 3. Derived indicators (KPIs)

A **KPI** is not measured directly; it is *computed* from inputs (**L2**). The
canonical shape is `ExecutiveKpi` (`packages/shared/src/types/executiveCenter.ts`):

```ts
interface ExecutiveKpi { key: string; label: string; deepLink?: string;
  value: number | null;                          // 0..100 index, or null for a status/string
  display: string;                               // human-readable value
  band?: 'healthy' | 'watch' | 'at-risk' | 'critical'; trend?: 'up' | 'down' | 'flat'; }
```

Producers project domain insights into this one shape to plug into the existing
Executive Center strip — no parallel surface: `enterpriseInsightsKpi()`
(`enterpriseKpi.ts`), `capacityInsightsToKpis()` (`capacityScheduler.ts`),
`crmInsightsToKpis()` (`crm.ts`), and siblings. The distinction the framework
enforces: a **metric** carries a physical unit and true zero; a **KPI** is a bounded
index or qualitative band *derived* from metrics and domain state.

---

## 4. Dimensions

A **dimension** is a categorical facet partitioning a metric into series — all four are real labels on shipped telemetry.

| Dimension | Values (examples) | Where it lives | Evidence |
|---|---|---|---|
| **method** | `GET`, `POST` | `neuropause_http_requests_total{method,…}` | L3 |
| **status** | `200`, `500` | `neuropause_http_requests_total{…,status}` | L3 |
| **state** | `total`, `idle`, `waiting` | `neuropause_pg_pool_connections{state}` | L3 |
| **channel** | IPC channel name | `IpcChannelStat.channel` (`perfMetrics.ts`) | L2 |

Harness-level facets (artifact axes, not telemetry labels) add **scenario** (8 HTTP
routes) and **query shape** (5 DB shapes). A metric plus a full set of dimension
values identifies one series.

---

## 5. Units

Every metric carries exactly one unit. NeuroPause uses six.

| Unit | Symbol | Quantity | Canonical source |
|---|---|---|---|
| millisecond | ms | latency, engine time, render/IPC time | `perf_hooks`; `DurationSummary.*Ms` |
| second | s | startup, restart, uptime | `startup.json`; `_uptime_seconds` gauge |
| byte | B | memory (RSS, heap) | `_resident_memory_bytes`, `_heap_used_bytes` |
| requests/second | req/s | throughput | `http-load.mjs` `throughput_rps` |
| count | (n) | requests, pool connections, tests, entities | `_http_requests_total`, `_pg_pool_connections` |
| ratio | (unitless) | error rate, memory percent, KPI index | `errors/requests`; `PerfMemory.usedPercent` |

**Unit hygiene:** never mix ms and s; bytes are integers; a *rate* (req/s) is not a
*count*; a *ratio* is dimensionless (a fraction or labelled percent). MB/s conversions
are `≈` reading aids only.

---

## 6. Scales (measurement theory)

Stevens' scale typology fixes which arithmetic and aggregation are *legal* per metric.

| Scale | Admits | Legal statistic | NeuroPause examples |
|---|---|---|---|
| **Ratio** | true zero, ratios | mean, %, CV, percentiles | latency, throughput, memory bytes, counts, uptime, error rate, fps, KPI 0..100 index |
| **Interval** | order + equal intervals, arbitrary zero | differences, not ratios | wall-clock timestamps (`createdAt`/`updatedAt`, event times) |
| **Ordinal** | rank only | median, percentile rank | KPI `band` (healthy < watch < at-risk < critical); `StageStatus`; confidence low/medium/high; KPI `trend` (down < flat < up) |
| **Nominal** | identity only | mode, count | `method`, `status` code identity, pool `state`, IPC `channel`, `scenario`, entity `kind` |

Per-metric classification is carried in the **Scale** column of the master register
(§12): all duration/rate/memory/count metrics and the bounded KPI index (0 = none,
100 = full) are **ratio**; KPI `band` and `trend` are **ordinal**; `method`,
`status`, pool `state`, and `channel` are **nominal** (status also reads ordinal by
2xx/4xx/5xx class); wall-clock timestamps are **interval** (their *difference* is
ratio). **Rule:** never take a mean of an ordinal band; never treat an interval
timestamp as a ratio. Percentiles are computed only on ratio-scaled durations.

---

## 7. Thresholds

A **threshold** is a fixed boundary a metric is judged against. The framework
distinguishes *real, in-code* thresholds from *proposed* SLOs.

### 7.1 Real thresholds (implemented)

| Threshold | Value | Where | Evidence |
|---|---|---|---|
| Engine regression budget | **2,000 ms** per hot path | `performance.test.ts` (`expect(v).toBeLessThan(2000)`); `intelligence-engines.json` `regression_budget_ms` | **L3/L4** (executed guard) |
| Frame-rate targets | 60 fps target / 45 fps low | `DEFAULT_PERF_THRESHOLDS.targetFps`, `.lowFps` | L2 |
| Latency warnings | 200 ms slow-IPC / 16 ms slow-render | `.slowIpcMs`, `.slowRenderMs` | L2 |
| Resource warnings | 80 % heap / 8 in-flight async | `.highMemoryPercent`, `.manyPendingAsync` | L2 |

The 2,000 ms budget is deliberately wide: the max measured engine time
(`graph.project` **92.84 ms**) sits ~21× under it, so it catches gross regressions,
not micro-drift. `DEFAULT_PERF_THRESHOLDS` drive `generatePerfRecommendations()`.

### 7.2 Proposed SLOs (L0 — not yet enforced)

**Placeholders defined by this framework only** — no code enforces them, no artifact
certifies them, candidates for promotion once a measurement window and enforcement
point exist: store-read p99 < 150 ms; liveness availability ≥ 99.9 %; HTTP error
budget < 0.1 % over window; cold-start → healthy < 1.0 s. All **L0 Proposed** — until
promoted they are explicit non-claims.

---

## 8. Accuracy, precision, and resolution

These three are defined separately; conflating them is a common measurement error.

**Accuracy** — closeness to the true value (freedom from *systematic* bias). The
dominant known bias (`environment.json`): the HTTP **load client is co-located with
the backend**, so client and server contend for the same 2 vCPUs. This *inflates*
latency and *depresses* throughput, making HTTP figures a **conservative**
(pessimistic) bound, never optimistic. DB, engine, and Argon2 measurements are taken
**in-process** and escape this cross-process contention.

**Precision** — repeatability, the *spread* of repeats. Captured by reporting the
full distribution (p50/p95/p99/max), not a mean alone — the p50→p99 gap *is* the
precision statement. Variance is disclosed: `startup.json` records two boots
(0.66 s cold, 0.624 s warm) to show run-to-run spread is honest.

**Resolution** — the smallest increment the instrument can distinguish.

| Instrument | Underlying resolution | Reported resolution |
|---|---|---|
| `perf_hooks` `performance.now()` | sub-ms (theoretically sub-µs; subject to timer coarsening) | rounded to **0.01 ms** by `round()` in the `.mjs` harnesses |
| `perfMetrics.summarizeDurations` | float ms in | mean rounded to **0.1 ms** (`round1`) |
| `_uptime_seconds` gauge | float seconds | rounded to **1 s** (`Math.round(process.uptime())`) |
| memory gauges | byte-exact | integer **bytes** |

Reporting latency to more than two decimals would over-state resolution — the
harnesses deliberately stop at 0.01 ms.

---

## 9. Confidence and sample sizes

Confidence here means **sample size and coverage**, stated honestly: the program
reports *empirical* percentiles over recorded samples and does **not** yet compute
confidence intervals (an L0 item, §11).

| Measurement | Sample size (n) | Warmup (unmeasured) | Errors |
|---|---|---|---|
| HTTP load | **3,000 requests × 8 scenarios = 24,000** | 300 / scenario | **0 / 24,000** |
| DB latency | **2,000 iterations × 5 shapes = 10,000** | 100 / shape | 0 |
| Argon2 hash / verify | **n = 50** each | — | — |
| Engine hot paths | **N = 5,000 entities**, one timed pass × 9 paths | (JIT warm pass for `memory.project`) | — |
| Startup | **2 boots** (1 cold, 1 warm) | — | — |

Interpretation rules the framework fixes: larger n tightens the **percentile**, not
a mean — 24,000 HTTP samples make p99 stable, whereas the **single-shot engine
timings** (one pass per path) are point estimates, so no p99 is claimed for engine
time. `n = 50` for Argon2 is small by design (the op is deliberately CPU-bound and
slow — adequate for a cost check, not a tight tail). Zero errors across 24,000 HTTP
requests and 10,000 queries is a real, cited observation, reproduced unaltered.

---

## 10. Measurement lifecycle

Every measured quantity passes through five stages; each maps to real code.

| Stage | Definition | Realized by |
|---|---|---|
| **Define** | fix the metric, unit, scale, dimensions, threshold | this framework; the `SCENARIOS` / `QUERIES` arrays in the harnesses |
| **Instrument** | attach a real clock/gauge to the operation | `performance.now()` wraps (`once`, `ms`); `/metrics` gauges; IPC-client wrap feeding `IpcChannelStat` |
| **Sample** | warm up, then collect n observations at fixed load | measured phase at concurrency 32 / `--iters` / N=5,000 |
| **Aggregate** | sort → percentile → mean → `DurationSummary`/result row | `summarizeDurations()`; `pct()` + mean in the `.mjs` harnesses |
| **Report** | write JSON artifact + table; state env, n, caveats | `bench/results/*.json`; markdown tables; this framework + the manual |

The lifecycle is closed-loop: an artifact plus its harness lets any stage be re-run
and the number re-derived — a reproducible measurement by definition.

---

## 11. Measurement quality

The quality attributes the program holds itself to, with honest current status:

| Attribute | Meaning | Status |
|---|---|---|
| **Validity** | the metric measures what it claims | L2 — metrics map to real operations (a store read *is* a DB-backed route) |
| **Reliability / repeatability** | same setup → same distribution | L3 — percentiles reported; variance disclosed |
| **Reproducibility / traceability** | independent re-run reproduces it; number → artifact → harness → commit | L3 — committed harness + recorded env; every figure cites a `bench/results/*.json` |
| **Determinism** | pure aggregation, no hidden state | L2 — `perfMetrics.ts` is clock-free/IO-free/random-free; unit-pinned |
| **Honesty** | caveats stated, biases disclosed | L2 — co-located-client, single-shot engine timings, cumulative counters all noted |
| **Interval estimation** | confidence intervals on estimates | **L0 Proposed** — not yet computed |
| **Continuous capture** | metrics retained over time, outside benches | **L0 Proposed** — telemetry exists (`/metrics`, `PerfSampler`); long-run series not yet retained |

Cumulative-counter caveat: `neuropause_http_requests_total` is monotonic per process
— an absolute value (`metrics-under-load.json` records **8,000** `GET`/`200`) reflects
requests served *so far*, not a constant; read counters as differences, never levels.

---

## 12. Master measurement register

The consolidated `metric → unit → scale → source → evidence` table; example values
are reproduced unaltered from the artifacts.

| Metric | Unit | Scale | Source (real) | Evidence | Example value |
|---|---|---|---|---|---|
| HTTP request latency (p50/p95/p99) | ms | ratio | `http-load.mjs` → `http-load.json` | **L3** | store list p50 51.87 / p99 79.77 |
| HTTP throughput / error rate | req/s; ratio | ratio | `http-load.mjs` → `http-load.json` | **L3** | `/live` 2,102.96 req/s; errors 0 / 24,000 |
| DB query latency | ms | ratio | `db-latency.mjs` → `db-latency.json` | **L3** | point read p50 0.23 |
| Engine hot-path time | ms | ratio | `__bench__/performance.test.ts` → `intelligence-engines.json` | **L3** | `graph.project` 92.84 |
| Auth hash / verify | ms | ratio | `argon2.json` | **L3** | hash mean 21.36; verify 20.06 |
| Cold start → healthy / restart recovery | s | ratio | `startup.sh`→`startup.json`; `reliability.json` | **L3/L4** | 0.66 cold / 0.624 warm; restart 0.46 |
| Resident memory / heap used | bytes | ratio | `/metrics` gauges → `startup.json` / `metrics-under-load.json` | **L3** | RSS 117,813,248→223,260,672; heap 20,579,624→57,694,488 |
| Pool connections / request count | count | ratio | `/metrics` gauge `{state}` / counter `{method,status}` | **L3** | 1→10 pool; `GET`/`200` 8,000 (cumulative) |
| Process uptime | s | ratio | `/metrics` gauge (1 s resolution) | **L3** | 0.547 at first health |
| Renderer perf (frame time/fps, IPC, heap %) | ms; fps; ratio | ratio | `perfMetrics` `DurationSummary`/`PerfFps`/`IpcChannelStat`/`PerfMemory` | **L2** | harness-ready (macOS); vs 200 ms / 80 % |
| Test count | count | ratio | `npm run test` | **L4** | 3,856 |
| KPI numeric value | index (0..100) | ratio | `enterpriseKpi.ts` (`ExecutiveKpi.value`) | **L2** | coverage % |
| KPI band / trend | — | ordinal | `ExecutiveKpi.band`, `.trend` | **L2** | healthy…critical / up·flat·down |
| HTTP method / status / pool state / IPC channel | — | nominal | `/metrics` labels; `IpcChannelStat.channel` | **L3/L2** | `GET`,`200`,`idle`,`<channel>` |

---

## Terminology and cross-references

**Metric** — a directly observed quantity with a unit, scale, and instrument.
**KPI** — a *derived* indicator (bounded index or band) computed from metrics.
**Dimension** — a categorical label partitioning a metric into series.
**DurationSummary** — the canonical distribution primitive (`count/avgMs/p50Ms/p95Ms/maxMs`).
**Budget / SLO** — a threshold; the 2,000 ms engine budget is real, SLOs are L0.

Consistent with [`SCIENTIFIC-MATRICES.md`](../SCIENTIFIC-MATRICES.md) §3 and the
evidence ladder in [`_grounding.md`](../_grounding.md); procedures in
[`../manuals/MEASUREMENT-MANUAL.md`](../manuals/MEASUREMENT-MANUAL.md). Composite
honesty rule: *propose freely at L0, but claim only what a cited artifact supports at L2+.*
