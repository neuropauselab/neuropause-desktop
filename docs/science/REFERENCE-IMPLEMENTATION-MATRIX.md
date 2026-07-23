# NSSP — Reference Implementation Matrix

> **What this is.** A forensic map from every scientific concept in the NSSP
> frameworks to its **existing** implementation in the NeuroPause platform. Each
> row is classified **Implemented (L2/L3/L4) · Partially implemented · Modeled
> (L1) · Future work (L0)** and carries a **real anchor** (file / artifact) that
> was verified to exist by `Grep`/`Read` before being written here. Nothing is
> asserted beyond its cited evidence. Source of truth: `_grounding.md` and
> `SCIENTIFIC-MATRICES.md`.

## Reuse guarantee (read first)

The NSSP is a **formalization** program. It **adds documentation only**:

- **No new runtime.** Every `L2/L3/L4` row below points at code, a workflow, or a
  measured artifact that **already existed** before this program. The NSSP writes
  no engine, service, migration, or endpoint.
- **No duplicate systems.** Where a framework elaborates a concept (measurement,
  validation, assurance, …), it maps onto the *existing* module. This matrix is
  the proof-of-reuse: if a concept is real, its anchor is a pre-existing path.
- **`L0` is never built by the NSSP.** Future-work rows are labelled `L0` and left
  as honest gaps — the program documents them, it does not implement them.
- **No inflated claims.** Absent evidence (peer review, certification, published
  papers, statistical forecasting, international-standard conformance) is recorded
  as absent, not implied.

## Evidence ladder (from `_grounding.md`)

| Level | Meaning | Cite with |
|---|---|---|
| **L4 Validated** | Implemented **and** verified by executed tests/gates/reliability runs | test/gate output + `bench/results/*.json` |
| **L3 Measured** | Implemented **and** has recorded measurements/telemetry | metric series / `bench/results/*.json` |
| **L2 Implemented** | Exists and **runs** in the codebase | source file path |
| **L1 Modeled** | Schema/types/surfaces exist and are tested, not wired to live external execution | type file path |
| **L0 Proposed/Future** | Concept defined by the framework; not yet in code | none — labelled |

---

## 1. Ontology — the platform's real vocabulary

| Concept | Status | Level | Real anchor | Note |
|---|---|---|---|---|
| Domain type system (1,925 exported types) | Implemented | **L2** | `packages/shared/src` (verified count 1,925) | 40+ domain files: `capacityScheduler.ts`, `continuousValidation.ts`, `enterprise*.ts`, `connectors.ts`, … |
| `UnifiedEntity` core object | Implemented | **L2** | `packages/shared/src/types/unified.ts` | The unifying domain object consumed by the intelligence engines |
| RBAC scope vocabulary (57 enterprise + 18 API) | Implemented | **L2** | `packages/shared/src/types/enterprise.ts` (`EnterprisePermission`, 57), `ecosystem.ts` (`ApiScope`, 18) | 57 canonical enterprise scopes (committed ADMINISTRATOR-GUIDE); ~85 total scope literals across registries |
| Relationship / timeline event model | Implemented | **L2** | `packages/shared/src/types/enterpriseTimeline.ts` | Event-stream domain shape; feeds intelligence + audit surfaces |
| Typed system-health model | Modeled | **L1** | `packages/shared/src/types/systemHealth.ts` | Schema surface; the *live* health signal is the `/health` endpoint (row B2) |

---

## 2. Observation / Telemetry

| Concept | Status | Level | Real anchor | Note |
|---|---|---|---|---|
| Prometheus `/metrics` series | Implemented | **L3** | `apps/backend/src/observability/metrics.ts` | Verified series: `neuropause_backend_up`, `_uptime_seconds`, `_resident_memory_bytes`, `_heap_used_bytes`, `neuropause_pg_pool_connections{state}`, `neuropause_http_requests_total{method,status}` |
| `/health` (ok\|degraded) + `/live` | Implemented | **L2** | `apps/backend/src/app.ts:84,88,92` | Honest degradation with `components:{database,redis}` |
| Append-only audit trail | Implemented | **L2** | `apps/backend/src/db/migrations/0001_init.sql:50` | `CREATE TABLE audit_log` at line 50; indexed on `user_id`, `action` (l.59–60) |
| Renderer perf telemetry | Implemented | **L2** | `packages/shared/src/types/perfMetrics.ts`, `.../lib/perf/perfRecorder.ts`, `.../state/PerfSampler.tsx`, `.../shell/PerformanceOverlay.tsx` | Samples real rAF frame-rate + `performance.memory`; `RenderSample`, `IpcChannelStat`, `PerfContext` |
| Structured logs with redaction | Implemented | **L2** | `apps/backend/src/app.ts` (pino, `autoLogging`) | Redaction noted in GA report §16 |

---

## 3. Measurement

| Concept | Status | Level | Real anchor | Note |
|---|---|---|---|---|
| `DurationSummary` primitive | Implemented | **L2** | `packages/shared/src/types/perfMetrics.ts:35` | `{count, avgMs, p50Ms, p95Ms, maxMs}` — the platform's measurement shape |
| KPI computation modules | Implemented | **L2** | `enterprise/intelligence/enterpriseKpi.ts`, `enterprise/workIntelligenceKpis.ts`, `workforce/intelligence/workforcePerformanceKpi.ts`, `enterprise/workforceHealth.ts` | All under `apps/desktop/src/main`; each has a co-located `.test.ts` |
| Recorded benchmark artifacts | Implemented | **L3** | `bench/results/*.json` (9 files verified) | `environment, http-load, db-latency, intelligence-engines, argon2, startup, metrics-under-load, reliability, deployment` |
| HTTP latency / throughput / error-rate | Implemented | **L3** | `bench/results/http-load.json` | 8 scenarios × 3,000 = 24,000 req, **0 errors**; `/live` 2,102.96 rps; `/store/apps` p50 51.87 ms |
| DB query latency | Implemented | **L3** | `bench/results/db-latency.json` via `bench/db-latency.mjs` | Point-read/list latency series |
| Engine hot-path timing | Implemented | **L3** | `bench/results/intelligence-engines.json` | `graph.project` **92.84 ms** (verified); `memory.project` 13.66 ms |
| Cold-start / restart timing | Implemented | **L3/L4** | `bench/results/startup.json`, `reliability.json` | Restart recovery **0.46 s** (reliability run) |
| Render / IPC frame timing on target HW | Partially implemented | **L2** | `perfMetrics.ts`, `apps/desktop/src/main/__bench__/performance.test.ts` | Harness + primitives exist; **not yet measured on macOS Apple-Silicon target** (GA §Observability) |

---

## 4. Validation

| Concept | Status | Level | Real anchor | Note |
|---|---|---|---|---|
| Automated test suite | Implemented | **L4** | `npm run test` (3,856 tests / 442 files per program count) | desktop 3,548 / backend 263 / sdk 15 / cli 30 |
| Static quality gates | Implemented | **L4** | `tsconfig.base.json` (`strict`), `eslint --max-warnings 0`, `npm run build`, `npm audit --omit=dev` | typecheck 0 / lint 0 / build 0 / **0 prod vulns** |
| Continuous-validation orchestration | Implemented | **L2** | `apps/desktop/src/main/sandbox/validation/{certification,regression,scheduler,dashboard}.ts` + model `packages/shared/src/types/continuousValidation.ts` | **Wired, not type-only** — runtime calls `certifyLevel`, `classifyRegression`, `computeTrend`, `cadenceDue` |
| Reliability / chaos runs | Implemented | **L4** | `bench/results/reliability.json`, `docs/validation/RELIABILITY-RESULTS.md` | 6 scenarios: **5 PASS / 1 PARTIAL** (offline-bundle needs Docker daemon) |
| Sandbox lab (chaos / load / perf-security) | Implemented | **L2** | `apps/desktop/src/main/sandbox/lab/{chaosEngine,loadEngine,lab}.ts` | Real lab engines with tests |
| Deployment validation | Implemented | **L4** | `bench/results/deployment.json`, `docs/validation/DEPLOYMENT-VALIDATION.md` | `kubernetes-validate` strict **PASS** (both manifests); `shellcheck` **CLEAN** |
| CI pipelines | Implemented | **L2** | `.github/workflows/{backend-ci,deploy-validation,windows-release}.yml` | backend (ubuntu: typecheck/lint/test/build + docker); deploy (yamllint + helm lint); windows-release (build/sign/publish) |
| Per-PR desktop test CI | Future work | **L0** | *absent* — `.github/workflows/` runs backend only | Desktop's 3,548 tests not gated per PR (GA TD-4 / PR-4) |
| macOS release CI (package/sign/notarize) | Future work | **L0** | *absent* — no macOS workflow | Mac packaging is manual (GA TD-4 / PR-5) |
| Coverage instrumentation, renderer E2E/a11y | Future work | **L0** | *absent* | Tracked honestly in GA report |

---

## 5. Assurance (security)

| Concept | Status | Level | Real anchor | Note |
|---|---|---|---|---|
| RBAC fail-closed IPC permission gate | Implemented | **L2** | `apps/desktop/src/main` (route/connector/cloud authz registries) | 57 enterprise scopes; deny-by-default |
| Backend-brokered PKCE / RFC 8252 | Implemented | **L2** | `apps/backend/src/auth/pkce.ts`, `apps/desktop/src/main/auth/authService.ts` | Native OAuth flow |
| Refresh rotation + reuse detection (SHA-256) | Implemented | **L2** | `apps/backend/src/auth/tokens.ts` | Hashed refresh tokens; reuse detection |
| Argon2id password hashing | Implemented | **L2** | `apps/backend/src/auth/passwords.ts` (`@node-rs/argon2`); params in `users/service.ts` | Verified `m=19456, t=2, p=1` |
| Keychain-backed secure storage | Implemented | **L2** | `apps/desktop/src/main/security/secureStore.ts`, `connectors/connectorVault.ts` | Electron `safeStorage` |
| SSRF guard | Implemented | **L2** | `apps/desktop/src/main/infrastructure/{aws,gcp,cloudflare,docker,databricks}Client.ts` | Tested (co-located `.test.ts`) |
| Ed25519 manifest/package signing | Implemented | **L2** | `apps/desktop/src/main/nps/signature.ts` (`verifySignature`/`verifyManifest`), `marketplace/`, `federation/` | Signature verification |
| Zero production vulnerabilities | Implemented | **L4** | `npm audit --omit=dev` = 0 | Supply-chain (prod) gate |
| Apple `id_token` JWKS verification | Future work | **L0** | seam: `apps/backend/src/auth/providers/apple.ts` (explicit `HARDENING TODO`, `jwt.decode` not `.verify`) | GA TD-1 / PR-1 (HIGH) |
| Marketplace unsigned-install enforcement | Partially implemented | **L2→L0** | `apps/desktop/src/main/nps/packageService.ts:184` | Integrity always checked; signature enforced only **when present** → unsigned bypass on empty trust store (GA TD-2, HIGH) |
| Rate-limiter fail-open alerting | Partially implemented | **L2→L0** | `apps/backend/src/middleware/rateLimit.ts:37` | Fail-open on Redis loss is **deliberate + implemented**; alerting on it is future work (GA TD-3) |

---

## 6. Prediction

> **Honest framing (unchanged guardrail):** there is **no statistical /
> time-series / ML forecasting engine**. Verified absent — no `ARIMA`,
> `exponentialSmoothing`, `holtWinters`, `linearRegression`, `timeSeries`, or
> `forecastEngine` anywhere in `apps` or `packages`. What exists is **scenario
> simulation, process mining, AI-agent reasoning, and deterministic
> planning/decision math** — real and runnable, but not statistical prediction.

| Concept | Status | Level | Real anchor | Note |
|---|---|---|---|---|
| Scenario simulation (what-if / sandbox) | Implemented | **L2** | `apps/desktop/src/main/sandbox/scenarioStore.ts`, `sandbox/agent/scenarioTemplates.ts` | Runnable simulation surfaces |
| Process mining / discovery | Implemented | **L2** | `apps/desktop/src/main/enterprise/processMiningProvider.ts` | |
| AI-agent reasoning / reflection | Implemented | **L2** | `apps/desktop/src/main/sandbox/agent/reasoner.ts`, `reflection.ts` | This is agent reasoning, **not** statistical forecasting |
| Deterministic capacity-scheduling engine | Implemented | **L2** | `packages/shared/src/types/capacityScheduler.ts` → **wired** at `apps/desktop/src/main/enterprise/executiveCenterSubsystem.ts:220`, `runtimeCore.ts:1792` | 721-line engine (`computeCapacitySchedule`, `deriveCapacityInsights`, …). See reconciliation note — richer than the reconnaissance "type-only" label |
| Deterministic decision / recovery engine | Implemented | **L2** | `packages/shared/src/types/enterpriseDecisionEngine.ts` → **wired** at `executiveCenterSubsystem.ts:238`, KPIs at `executiveCenter.ts:453` | `assessDecisionEngine`, `buildRecoveryPlans` — deterministic recovery-plan generation |
| Digital-twin / MRP deterministic engines | Implemented | **L2** | `packages/shared/src/types/manufacturingDigitalTwin.ts` (re-runs `computeCapacitySchedule`, MRP) | Clone-and-re-run over existing pure engines |
| Autonomous decision-making (as *science*) | Modeled | **L1** | `enterpriseDecisionEngine.ts` | The *autonomous / self-directed* framing beyond deterministic recovery plans is modeled, not live |
| Statistical / time-series / ML forecasting engine | Future work | **L0** | *none exists* (verified absent) | Do **not** imply a forecasting engine |
| Capacity-forecasting baseline | Future work | **L0** | *none* — GA TD-6 | Day-2 predictive baseline is proposed only |

---

## 7. Replication / Reproducibility

| Concept | Status | Level | Real anchor | Note |
|---|---|---|---|---|
| Reproducible benchmark harnesses | Implemented | **L3** | `bench/http-load.mjs`, `bench/db-latency.mjs`, `bench/startup.sh`, `apps/desktop/src/main/__bench__/performance.test.ts` | Re-runnable |
| Recorded result artifacts | Implemented | **L3** | `bench/results/*.json` (9 files) | The program's real runs, unaltered |
| Forward-only idempotent migrations | Implemented | **L4** | `apps/backend/src/db/migrations/*.sql` (12 files) | Proven: `reliability.json` migration-idempotency PASS (re-run applied 0 new) |
| Deterministic seeded engine bench | Implemented | **L3** | `apps/desktop/src/main/__bench__/performance.test.ts` | Seeded synthetic 5,000-entity workspace |
| Git version traceability | Implemented | **L2** | repo history + `1.0.0-rc.1` tags | Version-anchored evidence |

---

## 8. Standards (adopted external + internal conventions)

> NeuroPause holds **no** international-standard certification. This section records
> **adoption** (external standards used) and **internal conventions** — not
> conformance claims.

| Standard / convention | Status | Level | Real anchor | Note |
|---|---|---|---|---|
| SemVer | Implemented | **L2** | `package.json`, `apps/desktop/package.json` (`1.0.0-rc.1`) | sdk at `0.1.0` |
| Conventional Commits | Implemented | **L2** | commit history | `feat/chore(...)` |
| RFC 8252 + PKCE | Implemented | **L2** | `apps/backend/src/auth/pkce.ts` | See A2 |
| Prometheus exposition | Implemented | **L3** | `apps/backend/src/observability/metrics.ts` | Text exposition format |
| Keep a Changelog | Implemented | **L2** | `CHANGELOG.md` | |
| Ed25519 / Argon2id / SHA-256 | Implemented | **L2** | `nps/signature.ts`, `auth/passwords.ts`, `auth/tokens.ts` | Crypto primitives |
| Kubernetes schema (strict) | Implemented | **L4** | `bench/results/deployment.json`, `docs/validation/DEPLOYMENT-VALIDATION.md` | `kubernetes-validate` strict **PASS** |
| TypeScript `strict` | Implemented | **L4** | `tsconfig.base.json` (`"strict": true`) | Internal std |
| ESLint zero-warning | Implemented | **L4** | `.eslintrc.cjs` + `--max-warnings 0` | Internal std |
| Zod IPC contracts | Implemented | **L2** | `packages/shared/src/ipc/contracts.ts` | Internal std |
| Evidence ladder (L0–L4) | Future work | **L0** | `docs/science/_grounding.md` | **New, doc-only** internal standard authored by this program |
| NSSP naming/measurement/validation manual | Future work | **L0** | NSSP frameworks (documentation) | Proposed internal std; doc-only |
| International-standard *conformance* (ISO/IEC/NIST cert) | Not claimed | **none** | — | Explicitly **not** claimed |

---

## Summary tally

Counting the **65 concept rows** above:

| Bucket | Count | Rows |
|---|---|---|
| **Implemented (L2/L3/L4)** | **51** | Ontology 4 · Observation 5 · Measurement 6 · Validation 7 · Assurance 8 · Prediction 6 · Replication 5 · Standards 10 |
| **Partially implemented** | **3** | Render/IPC target-HW timing · marketplace unsigned enforcement · rate-limit fail-open alerting |
| **Modeled (L1)** | **2** | Typed system-health model · autonomous decision-making (science framing) |
| **Future work (L0)** | **8** | per-PR desktop CI · macOS release CI · coverage/E2E/a11y · Apple JWKS · statistical forecasting engine · capacity-forecasting baseline · evidence ladder (doc) · NSSP standards manual (doc) |
| **Not claimed (none)** | **1** | International-standard conformance |

Within **Implemented**: L4 = 11 (gates, tests, reliability, deploy-validation, k8s/strict, migrations, 0-vuln), L3 = 11 (metrics, bench series, engine timing, harnesses), L2 = 29 (source that runs).

**Headline:** the platform is overwhelmingly **Implemented and reused**; the only
genuine gaps are the **8 `L0` future-work items** (2 of which are NSSP
documentation, not platform code), plus 3 partial hardening/measurement items.

---

## Known Future-work items (all `L0` — NOT built by the NSSP)

| # | Future-work item | Level | Where the gap lives / seam | Source |
|---|---|---|---|---|
| F1 | **Statistical forecasting engine** (time-series / ML prediction) | **L0** | *no engine exists* — grounded only on existing scenario/simulation/AI surfaces | `_grounding.md` Prediction; verified absent |
| F2 | **Per-PR desktop CI** (gate the 3,548 desktop tests) | **L0** | `.github/workflows/` runs backend only | GA TD-4 / PR-4 |
| F3 | **macOS release CI** (package / sign / notarize) | **L0** | no macOS workflow; mac packaging manual | GA TD-4 / PR-5 |
| F4 | **Apple JWKS verification** of `id_token` | **L0** | seam present: `apps/backend/src/auth/providers/apple.ts` (`HARDENING TODO`) | GA TD-1 / PR-1 (HIGH) |
| F5 | **Alerting** (alert routing off `/metrics`) | **L0** | observability layer — day-2 gap | GA TD-6 / PR-6 |
| F6 | **Distributed tracing** | **L0** | observability layer — day-2 gap | GA TD-6 |
| F7 | **Capacity forecasting** baseline (day-2) | **L0** | observability layer — depends on F1 | GA TD-6 |

Adjacent honestly-tracked gaps: marketplace unsigned-install **enforcement**
(`packageService.ts:184`, GA TD-2, HIGH) and update-rollback / federation-DR are
**modeled** not live (GA TD-5). None of these are implemented by the NSSP.

---

## Forensic reconciliation note (transparency)

Two rows in the earlier reconnaissance (`SCIENTIFIC-MATRICES.md` C15/C16, and
`_grounding.md` Prediction) label **`capacityScheduler.ts`** and
**`enterpriseDecisionEngine.ts`** as *type-only (L1)*. Direct code inspection for
this matrix shows they are **not** type-only: `capacityScheduler.ts` is a 721-line
deterministic engine whose functions (`computeCapacitySchedule`,
`deriveCapacityInsights`, `capacityInsightsToKpis`) are **called from runtime** at
`executiveCenterSubsystem.ts:220`, `executiveCenter.ts:448`, and
`runtimeCore.ts:1792`; `enterpriseDecisionEngine.ts` (`assessDecisionEngine`,
`buildRecoveryPlans`) is called at `executiveCenterSubsystem.ts:238`. By the
ladder's definition of L2 ("exists and **runs** in the codebase"), these are
**Implemented (L2)** and are recorded as such here.

The correction **strengthens** the reuse guarantee (more existing code to reuse,
not less) and does **not** weaken any honesty guardrail: these are **deterministic
pure-function engines over in-memory `PlanningInput`**, not statistical forecasting
and not wired to a live external MES/ERP feed. The *predictive / autonomous*
framing of decision-making remains **L1**, and statistical forecasting remains
**L0 (F1)** — exactly as the frameworks require. All other rows preserve the
reconnaissance evidence levels.

---

## Reading note

Every `L2+` anchor in this document was verified to exist prior to writing (via
`Grep`/`Read` over `apps/` and `packages/`). The composite rule holds: **a
framework may propose freely (L0), but may only *claim* what a cited artifact
supports (L2+).** The NSSP contributes this mapping — documentation over an
existing platform — and builds nothing new.
