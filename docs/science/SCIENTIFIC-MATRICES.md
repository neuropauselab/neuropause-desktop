# NeuroPause — Scientific Matrices

The reconnaissance deliverable for the NSSP. Five matrices derived from a complete
audit of the implemented platform. Every row carries an **evidence level** from the
ladder (`_grounding.md`): **L4 Validated · L3 Measured · L2 Implemented · L1
Modeled · L0 Proposed/Future**. Citations are real files/artifacts; nothing here is
asserted beyond its evidence level.

---

## 1. Scientific Capability Matrix

The platform's capabilities, framed as objects of study, with where they live and
how strongly they are evidenced.

| # | Capability | Scientific object | Evidence | Anchor |
|---|---|---|---|---|
| C1 | Domain ontology | Entities, relationships, lifecycle | **L2** | `packages/shared/src` (1,925 exported types) |
| C2 | Unified entity graph | Projection/graph model | **L3** | `__bench__/performance.test.ts` (graph.project 92.8 ms) |
| C3 | Observation & telemetry | Signals, metrics, health | **L3** | `observability/metrics.ts`, `perfMetrics.ts` |
| C4 | Audit trail | Append-only event evidence | **L2** | `audit_log` (`0001_init.sql:50`) |
| C5 | Measurement primitives | Duration/percentile summaries | **L3** | `DurationSummary`, `bench/results/*.json` |
| C6 | KPI computation | Derived indicators | **L2** | `enterpriseKpi.ts`, `workforcePerformanceKpi.ts` |
| C7 | Automated validation | Test/gate hierarchy | **L4** | 3,856 tests; typecheck/lint/build 0 |
| C8 | Continuous validation model | Pipeline/stage/cadence | **L2/L1** | `continuousValidation.ts` |
| C9 | Reliability/resilience | Fault tolerance & recovery | **L4** | `bench/results/reliability.json` |
| C10 | Access governance | RBAC authorization | **L2** | 57 enterprise scopes (+18 API); fail-closed IPC gate |
| C11 | Cryptographic assurance | Signing, hashing, auth | **L2** | Ed25519, Argon2id, PKCE, SHA-256 |
| C12 | Performance characterization | Latency/throughput/memory | **L3** | `bench/results/http-load.json`, `startup.json` |
| C13 | Scenario simulation | What-if/sandbox modeling | **L2** | `sandbox/scenarioStore.ts` |
| C14 | Process mining | Process discovery | **L2** | `enterprise/processMiningProvider.ts` |
| C15 | Capacity scheduling | Deterministic capacity projection | **L2** | `computeCapacitySchedule` (wired: `executiveCenterSubsystem.ts`, `runtimeCore.ts`) — not forecasting |
| C16 | Decision engine | Deterministic decision projection | **L2** | `assessDecisionEngine` (wired: `executiveCenterSubsystem.ts:238`) — not forecasting |
| C17 | Forecasting / prediction | Statistical prediction | **L0** | *no engine exists — proposed* |
| C18 | Reproducible benchmarking | Experiment harnesses | **L3** | `bench/http-load.mjs`, `db-latency.mjs`, `startup.sh` |
| C19 | Deployment validation | Manifest/schema checks | **L4** | `kubernetes-validate` PASS; `shellcheck` clean |
| C20 | Federation | Cross-node operation | **L1** | modeled (per GA report) |

---

## 2. Evidence Matrix

What *kind* of evidence backs each class of claim, and its strength.

| Evidence type | Source (real) | Strength | Reproducible? |
|---|---|---|---|
| Executed unit/integration tests | 442 files / 3,856 tests | **L4** | Yes — `npm run test` |
| Static gates | typecheck 0, lint 0, `npm audit --omit=dev` 0 | **L4** | Yes |
| Load measurement | `bench/results/http-load.json` (24k req, 0 err) | **L3** | Yes — `bench/http-load.mjs` |
| DB latency measurement | `bench/results/db-latency.json` (10k q) | **L3** | Yes — `bench/db-latency.mjs` |
| Engine timing | `bench/results/intelligence-engines.json` | **L3** | Yes — `__bench__` test |
| Cold-start / metrics snapshot | `bench/results/startup.json`, `metrics-under-load.json` | **L3** | Yes — `bench/startup.sh` |
| Reliability/chaos runs | `bench/results/reliability.json` (5 PASS, 1 PARTIAL) | **L4** | Yes — documented procedures |
| Deployment validation | `kubernetes-validate`, `shellcheck` output | **L4** | Yes |
| Live telemetry | `/metrics`, `/health`, `audit_log` | **L3** | Yes — scrape endpoints |
| Source-of-truth code | `packages/shared`, `apps/*` | **L2** | n/a (inspection) |
| Type/interface models | federation types (modeled); `continuousValidation` pipeline model | **L1** | n/a |
| Scientific models proposed here | NSSP frameworks | **L0** | n/a — labelled Proposed |
| **Absent evidence (honest)** | peer review, certifications, published papers, international-standard conformance | **none** | — **not claimed** |

---

## 3. Measurement Matrix

Every measurable quantity with a real source, its unit, and evidence.

| Metric | Unit | Source (real) | Evidence | Example value |
|---|---|---|---|---|
| Cold start → healthy | s | `bench/startup.sh` → `startup.json` | **L3** | 0.66 (cold) / 0.62 (warm) |
| Restart recovery | s | reliability run | **L4** | 0.46 |
| HTTP latency (p50/p95/p99) | ms | `http-load.mjs` | **L3** | store list p50 52 / p99 80 |
| HTTP throughput | req/s | `http-load.mjs` | **L3** | `/live` 2,103; store list 610 |
| HTTP error rate | ratio | `http-load.mjs` | **L3** | 0 / 24,000 |
| DB query latency | ms | `db-latency.mjs` | **L3** | point read p50 0.23 |
| Engine hot-path time | ms | `__bench__` test | **L3** | graph.project 92.8 |
| Auth hash/verify | ms | argon2 bench | **L3** | ~20 |
| Resident memory | bytes | `/metrics` gauge | **L3** | 117 MB idle → 213 MB load |
| Heap used | bytes | `/metrics` gauge | **L3** | 20 → 70 MB |
| Pool connections | count | `/metrics` gauge | **L3** | 1 → 10 |
| Request count | count | `/metrics` counter | **L3** | 16,510 |
| Render frame time | ms | `perfMetrics.DurationSummary` | **L2** | harness-ready (macOS) |
| IPC round-trip | ms | `IpcChannelStat` | **L2** | harness-ready (macOS) |
| Test count | count | `npm run test` | **L4** | 3,856 |
| KPI indicators | various | `enterpriseKpi.ts` etc. | **L2** | computed from inputs |

---

## 4. Validation Matrix

Validation mechanisms, what they cover, and their evidence.

| Mechanism | Covers | Evidence | Anchor |
|---|---|---|---|
| Unit/integration tests | logic, models, HTTP | **L4** | 3,856 tests, 442 files |
| Type checking | type safety (`strict`) | **L4** | `npm run typecheck` = 0 |
| Lint (zero-warning) | style/correctness rules | **L4** | `eslint --max-warnings 0` = 0 |
| Production build | buildability | **L4** | `npm run build` exit 0 |
| Dependency audit | supply-chain (prod) | **L4** | `npm audit --omit=dev` = 0 |
| Reliability/chaos | recovery, fail-open, restore | **L4** | `reliability.json` (5 PASS) |
| Deployment validation | k8s/shell/YAML | **L4** | `kubernetes-validate`, `shellcheck` |
| Benchmark harnesses | performance regression | **L3** | `bench/*` + `__bench__` budget guards |
| Continuous-validation model | pipeline/stage orchestration | **L2/L1** | `continuousValidation.ts` |
| Sandbox lab / AI-QA / scenario | scenario & security labs | **L2** | `sandbox/lab/*`, `sandbox/scenarioStore.ts` |
| CI pipelines | backend, deploy, windows | **L2** | `.github/workflows/*.yml` |
| **Not present (honest)** | per-PR desktop CI, macOS release CI, coverage instrumentation, renderer E2E/a11y | **L0** | tracked in GA report |

---

## 5. Standards Matrix

Standards the platform **adopts** (external) or **conventions it formalizes**
(internal). NeuroPause holds **no** international-standard certification; this
matrix records adoption and internal convention, not conformance claims.

| Standard / convention | Type | Adopted? | Evidence | Anchor |
|---|---|---|---|---|
| SemVer | external | Yes | **L2** | `1.0.0-rc.1` across `package.json` |
| Conventional Commits | external | Yes | **L2** | commit history (`feat/chore(...)`) |
| RFC 8252 + PKCE (native OAuth) | external | Yes | **L2** | `auth/` PKCE flow |
| Prometheus exposition | external | Yes | **L3** | `/metrics` text format |
| Keep a Changelog | external | Yes | **L2** | `CHANGELOG.md` |
| Ed25519 / Argon2id / SHA-256 | external (crypto) | Yes | **L2** | signing, passwords, token hashes |
| Kubernetes schema | external | Yes | **L4** | `kubernetes-validate` strict PASS |
| TypeScript `strict` | internal std | Yes | **L4** | `tsconfig.base.json` |
| ESLint zero-warning | internal std | Yes | **L4** | `--max-warnings 0` |
| Zod IPC contracts | internal std | Yes | **L2** | `packages/shared` contracts |
| Evidence ladder (L0–L4) | internal std (this program) | New | **L0** | `_grounding.md` |
| NSSP naming/measurement/validation standards | internal std (this program) | Proposed | **L0** | `frameworks/STANDARDS.md` |
| International standard *conformance* (ISO/IEC/NIST cert) | external | **No** | **none** | **not claimed** |

---

## Reading note

These matrices are the shared backbone of the NSSP frameworks. Where a framework
elaborates a row (e.g. Measurement science expands §3), it must preserve the same
evidence level and citation. The composite honesty rule: **a scientific framework
may propose freely (L0), but may only *claim* what a cited artifact supports (L2+).**
