# Replication Science — NeuroPause Scientific & Standards Program

> **Formalization, not engineering.** This framework describes the replication
> science *over the platform that already exists*. It invents no harnesses, no
> numbers, and no results. Every property below is traced to a real harness or
> artifact in the repository and carries an **evidence level** from the ladder in
> [`_grounding.md`](../_grounding.md): **L4 Validated · L3 Measured · L2
> Implemented · L1 Modeled · L0 Proposed/Future**. Citations are real file paths
> ("anchors"); nothing here is asserted beyond its evidence level.

Replication is the strongest evidence NeuroPause can offer as a scientific
program: the measurement harnesses and their artifacts are genuinely re-runnable
(**L3 Measured**), and the reliability and deployment checks are executed with
recorded pass/fail evidence (**L4 Validated**). This document defines what
"reproducible" means here, the protocols that produce the evidence, and the chain
that preserves it.

---

## 0. Terminology

| Term | Meaning in this framework |
|---|---|
| **Harness** | An executable that drives the real platform and records measurements (`bench/*.mjs`, `bench/startup.sh`, the `__bench__` test). |
| **Artifact** | A committed JSON record of a harness run under `bench/results/`. |
| **Reference environment** | The recorded machine profile a run was measured on (`bench/results/environment.json`). |
| **Anchor** | The real file/path a claim is cited against. |
| **Reproducibility** | Same inputs → same **outputs** (deterministic content/results). |
| **Repeatability** | Re-run **variance** of a *measured* quantity (timings under noise). |

We deliberately separate **reproducibility** (do the *outputs* match?) from
**repeatability** (how much do the *measurements* move between runs?). A timing is
never "reproducible" bit-exact; the workspace and engine *outputs* behind it are.

---

## 1. Reproducibility — same inputs, same outputs

The clearest reproducibility claim in the platform is the **deterministic
intelligence-engine workspace** built by
[`apps/desktop/src/main/__bench__/performance.test.ts`](../../../apps/desktop/src/main/__bench__/performance.test.ts).
It constructs a synthetic workspace of `N = 5000` `UnifiedEntity` records and runs
nine engine hot paths over them.

The construction is deterministic by design:

- **No RNG.** Entity fields are derived from the loop index via
  `pick(WORDS, i)` (index-modulo selection), not `Math.random()`.
- **Fixed clock.** Timestamps derive from a constant base
  (`2026-01-01T00:00:00.000Z`) and a fixed evaluation instant
  (`NOW = 2026-02-10T18:00:00.000Z`).
- **Fixed shape.** The kind mix (`project`/`task`/`document`/`message`/
  `calendar_event`) is decided by `i % 10`, so the same `N` yields the same
  workspace on every host.

Consequently the **workspace content and the engine outputs are reproducible**
(same inputs → same outputs). What varies run to run is the *timing* of those
outputs — that is a repeatability question (§2), recorded honestly in
[`bench/results/intelligence-engines.json`](../../../bench/results/intelligence-engines.json).

| Reproducibility property | Mechanism | Evidence | Anchor |
|---|---|---|---|
| Deterministic workspace | Index-derived fields, fixed clock, no RNG | **L2** | `__bench__/performance.test.ts` (`buildEntities`, `N=5000`, `NOW`) |
| Reproducible engine outputs | Pure projection/index/query engines over that workspace | **L3** | `intelligence-engines.json` (9 recorded timings) |
| Regression guard on the run | `expect(v).toBeLessThan(2000)` per hot path | **L4** | executed test (part of the 3,856-test suite) |

---

## 2. Repeatability — recording variance honestly

Where a quantity is a *measurement*, the program records run-to-run variance
rather than hiding it. The canonical example is **cold vs. warm boot**, captured
by [`bench/startup.sh`](../../../bench/startup.sh) into
[`bench/results/startup.json`](../../../bench/results/startup.json):

- `cold_start_to_healthy_sec_first_cold_boot`: **0.66 s** (cold OS page cache)
- `cold_start_to_healthy_sec_warm_reboot`: **0.624 s** (warm re-boot)

Both are real spawn → first `/health 200` measurements, and the artifact states
plainly: *"Run-to-run variance is expected and honest."* The framework treats the
gap between the two as the *repeatability envelope* of cold start, not as noise to
be suppressed.

The load and latency harnesses express repeatability as **percentile spread** —
each scenario reports p50/p90/p95/p99/max so tail variance is visible (store
point-read p50 72.19 ms vs. p99 117.82 ms in
[`http-load.json`](../../../bench/results/http-load.json)).

| Repeatability property | Mechanism | Evidence | Anchor |
|---|---|---|---|
| Cold vs. warm boot spread | Two recorded spawn→healthy measurements | **L3** | `startup.json` (0.66 / 0.624 s) |
| Latency tail spread | p50/p90/p95/p99/max per scenario | **L3** | `http-load.json`, `db-latency.json` |
| Restart-recovery repeatability | SIGTERM → restart → healthy timing | **L4** | `reliability.json` (`backend-restart-recovery`, 0.46 s) |

---

## 3. Experiment protocols — the harness contract

Every measurement harness obeys the same three-part contract: **warm up, then
measure a fixed sample, then report percentiles**. The contract is what makes a
run an experiment rather than an anecdote.

| Contract element | HTTP load (`http-load.mjs`) | DB latency (`db-latency.mjs`) | Engine bench (`performance.test.ts`) |
|---|---|---|---|
| Warmup (unmeasured) | `--warmup 300` requests | 100 iterations/query | JIT-warmed by first `projectMemory` call |
| Sample size | `--reqs 3000` / scenario | `--iters 2000` / query | `N = 5000` entities |
| Concurrency | `--conc 32` in-flight | 1 (single `Client`) | single-threaded |
| Timer | `perf_hooks.performance.now()` | `perf_hooks.performance.now()` | `performance.now()` via `ms()` |
| Reported stats | mean, p50/p90/p95/p99, max, rps | mean, p50/p95/p99, max | per-hot-path ms |
| Pre-flight guard | aborts (exit 2) unless `/health` OK | requires `DATABASE_URL` | test setup builds workspace |

Two protocol details are load-bearing for honesty:

1. **Full-response measurement.** `http-load.mjs` drains the response body
   (`await res.arrayBuffer()`) before stopping the timer, so latency includes
   transfer, not just time-to-first-byte.
2. **Nearest-rank percentiles.** Both `.mjs` harnesses compute percentiles with
   the same estimator — `idx = ceil((p/100)·n) − 1` over the sorted sample — so
   percentiles are comparable across harnesses and runs.

The engine bench additionally encodes a **budget guard**: every hot path must
complete in under 2000 ms (`expect(v).toBeLessThan(2000)`). This turns the
experiment into a regression gate as well as a measurement.

---

## 4. Benchmark protocols — per-harness specification

| Harness | What it drives (real surface) | Recorded artifact | Level |
|---|---|---|---|
| [`bench/http-load.mjs`](../../../bench/http-load.mjs) | 8 live routes: `/health`, `/live`, `/metrics`, and 5 DB-backed `/store/*` paths at conc 32 | `http-load.json` (24,000 reqs, **0 errors**) | **L3** |
| [`bench/db-latency.mjs`](../../../bench/db-latency.mjs) | 5 query shapes (point read, filtered list, aggregate, join, `SELECT 1`) against live Postgres | `db-latency.json` (10,000 queries, **0 errors**) | **L3** |
| [`bench/startup.sh`](../../../bench/startup.sh) | Production backend build spawn → first healthy `/health`, then idle `/metrics` snapshot | `startup.json` | **L3** |
| [`apps/desktop/src/main/__bench__/performance.test.ts`](../../../apps/desktop/src/main/__bench__/performance.test.ts) | 9 deterministic intelligence engines over 5,000 entities | `intelligence-engines.json` | **L3 / L4** |
| Argon2 auth-cost bench | `argon2id` hash/verify cost (memoryCost 19456, timeCost 2, parallelism 1) | `argon2.json` | **L3** |
| Metrics-under-load scrape | `/metrics` gauges after a load burst | `metrics-under-load.json` | **L3** |

Each `.mjs` harness is dependency-free (it uses Node's built-in `fetch` /
`perf_hooks`, or the backend's own hoisted `pg`), so a benchmark run introduces no
software the platform does not already ship. This keeps the *measurement apparatus*
inside the same supply chain as the platform under test.

---

## 5. Execution environments — the reference machine

Reproducibility claims are only meaningful against a recorded environment. The
program captures one in
[`bench/results/environment.json`](../../../bench/results/environment.json):

| Facet | Recorded value |
|---|---|
| CPU | Intel(R) Xeon(R) @ 2.10 GHz, **2 vCPUs** |
| Memory | 8,216,340 kB (~**8 GB**) |
| Runtime | Node **v22.22.2** |
| OS | Ubuntu 24.04.4 LTS x86_64 |
| Datastores | Postgres **16.13**, Redis **7.0.15** |
| Captured | 2026-07-18 |

**The co-located-client caveat (stated in the artifact).** The reference machine
is a *single shared cloud container*, and for the HTTP load harness the client is
**co-located with the backend**. On 2 vCPUs the client and server contend for the
same cores, which makes the recorded HTTP latencies **conservative** (worse than a
dedicated-client topology would show), not optimistic. The DB, intelligence, and
Argon2 benches are measured directly and are not subject to this contention. The
framework must never restate these numbers as best-case; they are honest
lower-bounds on throughput and upper-bounds on latency for this topology.

| Environment property | Mechanism | Evidence | Anchor |
|---|---|---|---|
| Reference profile recorded | Captured CPU/mem/runtime/datastore versions | **L3** | `environment.json` |
| Co-located-client disclosure | Note field documents contention & its direction | **L3** | `environment.json` (`note`) |

---

## 6. Data integrity — content-addressed delivery & migration idempotency

Two independent integrity mechanisms exist in the platform, both real.
**(a) SHA-256 content-addressed delivery.** Worker packages (the installable
delivery unit) are content-hashed and signed in
[`apps/desktop/src/main/workforce/install/packaging.ts`](../../../apps/desktop/src/main/workforce/install/packaging.ts):

- `canonicalize()` produces stable, key-order-independent JSON (keys sorted
  recursively; arrays keep order).
- `digestManifest()` = `createHash('sha256').update(canonicalize(manifest)).digest('hex')`.
- `verifyWorkerPackage()` recomputes the digest, requires the package `checksum`
  to equal it, **and** verifies a detached **Ed25519** signature over the checksum
  via `verifySignature()`
  ([`apps/desktop/src/main/nps/signature.ts`](../../../apps/desktop/src/main/nps/signature.ts)).

Because the digest is taken over a *canonical* form, the same manifest always
yields the same checksum — a reproducibility property in the delivery path. This
mechanism is exercised by executed tests (`packaging.test.ts`, `manifest.test.ts`,
`installService.test.ts`).

**(b) Migration idempotency — proven.** The forward-only runner
[`apps/backend/src/db/migrate.ts`](../../../apps/backend/src/db/migrate.ts) records
each applied file in a `schema_migrations` table (filename primary key), applies
only pending files in filename order, each inside a transaction. Re-running is a
no-op. This is not merely designed — it is *recorded as executed* in
[`bench/results/reliability.json`](../../../bench/results/reliability.json):
*"12 migrations applied; re-run applied 0 new (forward-only)"* → **PASS**.

| Integrity property | Mechanism | Evidence | Anchor |
|---|---|---|---|
| Canonical SHA-256 manifest digest | `canonicalize` + `digestManifest` | **L2** | `packaging.ts` |
| Signed delivery (Ed25519 over digest) | `verifyWorkerPackage` / `verifySignature` | **L2** | `packaging.ts`, `nps/signature.ts` |
| Migration idempotency (proven) | `schema_migrations` + forward-only re-run | **L4** | `migrate.ts` + `reliability.json` |
| Backup/restore round-trip | `pg_dump` → fresh DB → row-count match | **L4** | `reliability.json` (`backup-restore`) |

---

## 7. Artifact management — the `bench/results/` schema

Every artifact under `bench/results/` is a committed JSON record with a
predictable shape, so artifacts are machine-comparable across runs.

| Convention | Rule |
|---|---|
| Location | `bench/results/<name>.json`, one file per harness concern |
| Parameters | Each artifact embeds the run parameters it was produced with (`conc`, `reqs`, `warmup`, `iters`, `entities`, Argon2 params) |
| Results shape | Latency artifacts use the uniform `{mean_ms,p50_ms,p95_ms,p99_ms,max_ms}` primitive (mirrors `DurationSummary`) |
| Error accounting | Load/latency artifacts record an explicit `errors` count (0 across `http-load.json` and `db-latency.json`) |
| Provenance note | Most artifacts carry a `note` field describing how the values were captured and any caveat |
| Secret hygiene | Connection strings are redacted (`db-latency.json` stores `postgres://neuropause:***@…`) |

The uniform latency shape is deliberate: it mirrors the `DurationSummary`
primitive the live platform uses in `perfMetrics.ts`, so benchmark artifacts and
live telemetry speak the same measurement language.

| Artifact property | Mechanism | Evidence | Anchor |
|---|---|---|---|
| Self-describing artifacts | Params + results + note embedded per file | **L3** | `bench/results/*.json` |
| Uniform latency schema | Shared percentile primitive | **L3** | `http-load.json`, `db-latency.json` |
| Secret redaction | URL password masked before write | **L2** | `db-latency.mjs` (`replace(/:[^:@/]*@/, ':***@')`) |

---

## 8. Version traceability — SemVer & Conventional Commits

The platform is versioned so that a claim can be tied to a release line.

- **SemVer.** The root and desktop packages are `1.0.0-rc.1`; backend and shared
  are `0.1.0` (per their `package.json`). This is the release-candidate line the
  current artifacts describe.
- **Conventional Commits.** The commit history uses the `feat/chore(...)`
  convention (matrices §5, **L2**), giving a change-typed history behind each
  version.

| Traceability property | Mechanism | Evidence | Anchor |
|---|---|---|---|
| SemVer release identity | `version` fields across packages | **L2** | `package.json` (`1.0.0-rc.1`) |
| Change-typed history | Conventional Commits | **L2** | commit history (per matrices §5) |
| Dated capture provenance | `captured` date on the environment record | **L3** | `environment.json` (`2026-07-18`) |
| **Commit-SHA-stamped artifacts** | Embed the producing git commit in each artifact | **L0** | *Proposed — artifacts currently carry a capture date, not a commit SHA* |

The last row is honest **Future Research**: artifacts record a capture *date*, not
the producing commit. Stamping each with its git SHA would close the loop between a
number and its source revision — proposed, not implemented; do not claim it.

---

## 9. Evidence preservation — artifacts committed alongside code

Reproducibility decays if the evidence lives apart from the code. In this
repository it does not: the harnesses (`bench/*.mjs`, `bench/startup.sh`), their
artifacts (`bench/results/*.json`), and the narrative reports
(`docs/validation/RELIABILITY-RESULTS.md`, `docs/validation/PERFORMANCE-BENCHMARKS.md`)
are all committed **together with the source they measure**. A checkout therefore
contains, at one revision: the code, the harness that measures it, and the last
recorded measurement.

| Preservation property | Mechanism | Evidence | Anchor |
|---|---|---|---|
| Co-located harness + artifact | Both live in-tree under `bench/` | **L2** | `bench/`, `bench/results/` |
| Narrative record preserved | Reliability/perf reports in-repo | **L2** | `docs/validation/*` |
| Live-telemetry cross-check | Same `DurationSummary` shape live and benched | **L3** | `metrics.ts`, `perfMetrics.ts` |

---

## 10. Master table — reproducibility property → mechanism → evidence → anchor

| # | Reproducibility property | Mechanism | Level | Anchor |
|---|---|---|---|---|
| R1 | Deterministic bench workspace | No RNG, fixed clock, index-derived fields | **L2** | `__bench__/performance.test.ts` |
| R2 | Reproducible engine outputs | Pure engines over the deterministic workspace | **L3** | `intelligence-engines.json` |
| R3 | Cold/warm boot repeatability | Two recorded spawn→healthy measurements | **L3** | `startup.json` |
| R4 | HTTP experiment protocol | warmup→3000 reqs→percentiles, conc 32 | **L3** | `http-load.mjs` → `http-load.json` |
| R5 | DB benchmark protocol | 100 warmup→2000 timed queries, 5 shapes | **L3** | `db-latency.mjs` → `db-latency.json` |
| R6 | Reference environment | Recorded CPU/mem/runtime/datastore profile | **L3** | `environment.json` |
| R7 | Co-located-client honesty | Contention documented in the artifact | **L3** | `environment.json` (`note`) |
| R8 | Canonical SHA-256 delivery digest | `canonicalize` + `digestManifest` + Ed25519 | **L2** | `packaging.ts`, `nps/signature.ts` |
| R9 | Migration idempotency (proven) | `schema_migrations`, forward-only re-run | **L4** | `migrate.ts` + `reliability.json` |
| R10 | Self-describing artifacts | Params + results + note per JSON file | **L3** | `bench/results/*.json` |
| R11 | Version traceability | SemVer + Conventional Commits | **L2** | `package.json`, commit history |
| R12 | Evidence preservation | Harness + artifact committed with code | **L2** | `bench/`, `docs/validation/*` |
| R13 | Commit-SHA-stamped artifacts | Embed producing commit per artifact | **L0** | *Proposed* |

---

## 11. Honest limits

- **No independent replication, single topology.** Every artifact was produced by
  this program on the one reference container; there is no third-party or
  multi-host reproduction (cross-environment replication is **L0 Proposed**), and
  all HTTP numbers carry the co-located-client caveat.
- **Timings are not bit-exact.** Only *outputs* (workspace content, engine
  results, manifest digests) are reproducible; *timings* are measurements with a
  repeatability envelope, presented as percentiles.
- **`offline-bundle` is PARTIAL, not PASS.** The air-gapped procedure is
  shellcheck-clean and documented, but a full `docker save/load` was not runnable
  in the reference env (`reliability.json`) — not fully validated.

## Reading note

Replication is where NeuroPause's evidence is strongest, precisely because it is
bounded honestly. A framework may *propose* freely (L0) but may only *claim* what a
cited harness or artifact supports (L2+): when another NSSP document restates a
`bench/results/` number, it carries the same value, the same evidence level, and
the same co-located-client caveat — unaltered.
