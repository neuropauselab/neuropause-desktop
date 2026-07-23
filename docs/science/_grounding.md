# NSSP Grounding — REAL FACTS + EVIDENCE LADDER (authoring anchor)

> Shared source of truth for every NeuroPause Scientific & Standards Program
> (NSSP) document. This is a **formalization** program, not engineering: we
> describe the science *over the platform that already exists*. If a claim is not
> traceable to a real file/artifact below, it is labelled **Proposed** or
> **Future Research** — never asserted as fact.
>
> **Hard rules (non-negotiable):** Never claim scientific proof without evidence.
> Never claim international standards NeuroPause holds. Never invent benchmark
> numbers, peer review, certification, published papers, or experimental results.
> Every concept carries an **evidence level**. Never invent implementation that
> does not exist. Never duplicate or redesign existing systems.

## The Evidence Ladder (use on every concept/row)

| Level | Name | Meaning | How to cite |
|---|---|---|---|
| **L4** | **Validated** | Implemented **and** verified by executed tests/gates/reliability runs with recorded evidence | test file + `bench/results/*.json` or gate output |
| **L3** | **Measured** | Implemented **and** has real recorded measurements/telemetry | metric series / `bench/results/*.json` |
| **L2** | **Implemented** | Exists and runs in the codebase; not independently measured/validated *as a scientific claim* | source file path |
| **L1** | **Modeled** | Schema/types/surfaces exist and are tested, but not wired to a live external system/execution | type file path |
| **L0** | **Proposed / Future Research** | A model/concept defined *by this framework*; not yet in code | none — explicitly labelled |

Map to the mission's five buckets: L4=Validated, L3=Measured, L2=Implemented,
L1=Modeled (a kind of Implemented-but-not-live), L0=Proposed/Future Research.

## Real inventory (with evidence levels)

### Ontology (the platform's actual vocabulary) — L2/L1
- **1,925 exported types/interfaces** in `packages/shared/src` across 40+ domain files (`enterprise*.ts`, `connectors.ts`, `automation.ts`, `autonomousOperations.ts`, `cloud.ts`, `continuousValidation.ts`, `capacityScheduler.ts`, `enterpriseScenario.ts`, `enterpriseTimeline.ts`, `device.ts`, `billing.ts`, …).
- Core entity example: `UnifiedEntity` (kind: project|task|message|…) — the unifying domain object used by the intelligence engines.
- Governance vocabulary: **57 enterprise RBAC scopes** (`EnterprisePermission`, `enterprise.ts`; matches the committed ADMINISTRATOR-GUIDE) plus **18 developer API scopes** (`ApiScope`, `ecosystem.ts`); ~85 total scope literals exist across all authorization registries (e.g. `automation:read`, `backup:create`, `cloud:manage`).

### Observation / Telemetry — L3 (measured), L2 (implemented)
- Backend `GET /metrics` (Prometheus). Real series: `neuropause_backend_up`, `_uptime_seconds`, `_resident_memory_bytes`, `_heap_used_bytes`, `neuropause_pg_pool_connections{state}`, `neuropause_http_requests_total{method,status}` (`apps/backend/src/observability/metrics.ts`).
- Backend `GET /health` → `{status: ok|degraded, components:{database,redis}, uptime}`; `GET /live`.
- **`audit_log`** table — append-only, indexed on `user_id` and `action` (`apps/backend/src/db/migrations/0001_init.sql:50`).
- Renderer perf telemetry (samples **real** values — rAF frame rate, `performance.memory` JS-heap): `perfMetrics.ts` (`RenderSample`, `IpcChannelStat{channel,count,avgMs,maxMs}`, `RenderComponentStat`, `DurationSummary{count,avgMs,p50Ms,p95Ms,maxMs}`, `PerfContext`), `lib/perf/perfRecorder.ts`, `state/PerfSampler.tsx`, `shell/PerformanceOverlay.tsx`.
- `packages/shared/src/types/systemHealth.ts`; `enterpriseTimeline.ts` (event stream).

### Measurement — L3/L2
- Primitive: `DurationSummary` (count, avg, p50, p95, max) — the real measurement shape.
- KPI modules: `enterprise/intelligence/enterpriseKpi.ts`, `enterprise/workIntelligenceKpis.ts`, `workforce/intelligence/workforcePerformanceKpi.ts`, `enterprise/workforceHealth.ts` (all with tests).
- **Measured artifacts** (this program's real runs): `bench/results/{environment,http-load,db-latency,intelligence-engines,argon2,startup,metrics-under-load,reliability,deployment}.json`.
- Measurement harnesses: `bench/http-load.mjs`, `bench/db-latency.mjs`, `bench/startup.sh`, `apps/desktop/src/main/__bench__/performance.test.ts`.

### Validation — L4/L2
- **3,856 automated tests** across 442 files (desktop 3,548 / backend 263 / sdk 15 / cli 30) — L4.
- Quality gates: `typecheck` 0, `lint` 0 (`--max-warnings 0`), `build` 0, `npm audit --omit=dev` 0 prod vulns — L4.
- **`continuousValidation.ts`** domain model: `ValidationPipeline`, `PipelineStage`, `StageKind` (scenario|ai-qa|lab), `CadenceKind` (manual|nightly|weekly|interval), `StageResult`, `StageStatus` (pass|fail|warn|error|skipped) — L2/L1 (real orchestration model over the sandbox lab).
- EVP executed reliability (migration idempotency, backup/restore, restart 0.46s, Redis fail-open, Postgres degrade+auto-reconnect) — L4, in `docs/validation/RELIABILITY-RESULTS.md` + `bench/results/reliability.json`.
- CI: `backend-ci.yml`, `deploy-validation.yml`, `windows-release.yml`.

### Assurance — L4/L2
- RBAC fail-closed IPC permission gate (57 enterprise scopes + 18 developer API scopes); backend-brokered PKCE/RFC 8252; refresh rotation + reuse detection (SHA-256 hashes); **Argon2id** (memoryCost 19456, timeCost 2, parallelism 1); Keychain `safeStorage`; **SSRF guard** (tested); **Ed25519** signing (`verifyManifest`/`verifySignature`); `audit_log`; `/health` honest degradation; **0 production vulns**.
- **Open items (state honestly):** Apple `id_token` not JWKS-verified; marketplace app install accepts unsigned packages when trust store empty; rate limiter fails open on Redis loss (deliberate). Source: `ENTERPRISE-GA-REPORT.md`.

### Prediction — mostly **L0 Proposed** / **L1 Modeled**
- Real & runnable: scenario simulation (`sandbox/scenarioStore.ts`, `sandbox/agent/scenarioTemplates.ts`), process mining (`enterprise/processMiningProvider.ts`), AI-agent reasoning (`sandbox/agent/reasoner.ts`, `reflection.ts`) — L2.
- **Wired deterministic projections — L2 (not forecasting):** `computeCapacitySchedule` (`capacityScheduler.ts`) and `assessDecisionEngine` (`enterpriseDecisionEngine.ts`) are invoked at runtime in `enterprise/executiveCenterSubsystem.ts` and `runtimeCore.ts:1792`. They are **rule-based deterministic projections, not statistical forecasting** — statistical/ML forecasting remains L0.
- **There is NO statistical forecasting / time-series / ML-prediction engine.** "forecast/predict/trend" occurrences are AI-agent reasoning, not statistical prediction. Therefore Prediction science is **predominantly Proposed (L0)**, grounded on the scenario/simulation/AI surfaces that do exist. Do not imply a forecasting engine.

### Replication — L3/L2
- Reproducible harnesses (`bench/*`), recorded artifacts (`bench/results/*.json`), forward-only migrations (idempotent, proven), git version traceability, deterministic engine bench (seeded synthetic 5,000-entity workspace). The EVP `_grounding.md` + reports are the narrative record.

### Standards — **adopted external + internal conventions**, formalized here (NOT NeuroPause-held international standards)
- Adopted/real: TypeScript `strict`, ESLint zero-warning, Prettier, npm workspaces, **Zod** IPC contracts, Conventional Commits, **SemVer** (`1.0.0-rc.1`), **RFC 8252 + PKCE**, **Prometheus** exposition, **Keep a Changelog**, `kubernetes-validate`, **Ed25519/Argon2id/SHA-256** primitives.
- The NSSP **formalizes these into an internal standards manual**. It does **not** claim NeuroPause authored or is certified against any international standard.

## Authoring rules
1. Every concept/row carries an evidence level (L0–L4) with a citation for L2+.
2. Distinguish "the platform does X" (cite file) from "the framework proposes X" (label L0).
3. Prediction & most Standards content is L0/L1 — say so plainly; ground it on what exists.
4. Reference real measured numbers only from `bench/results/` or the EVP/GA reports, unaltered.
5. No fabricated proofs, papers, peer review, certifications, or benchmark numbers.
6. Never duplicate/redesign existing systems — map to them (Sub Agent 9 discipline).
7. Terminology must be internally consistent — reuse the glossary terms.
