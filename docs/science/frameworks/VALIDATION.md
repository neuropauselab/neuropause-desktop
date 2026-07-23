# Validation — NSSP Framework

> Part of the NeuroPause Scientific & Standards Program (NSSP). This document
> **formalizes the validation science over the platform that already exists**; it
> engineers nothing new. It is grounded in the shared facts and evidence ladder of
> [`_grounding.md`](../_grounding.md) and elaborates §4 (Validation Matrix) of
> [`SCIENTIFIC-MATRICES.md`](../SCIENTIFIC-MATRICES.md), preserving the same
> evidence levels and citations. Every mechanism below is anchored to a real file,
> test, gate, or recorded artifact; anything the framework merely proposes is
> labelled **L0**. Measured facts are transcribed unaltered.
>
> **Evidence ladder** (from `_grounding.md`): **L4 Validated** · **L3 Measured** ·
> **L2 Implemented** · **L1 Modeled** · **L0 Proposed/Future**.

---

## 1. Validation models — what "validated" means at each level

"Validated" is not a single predicate. The NSSP fixes its meaning to the evidence
ladder: a claim is validated *to the level its evidence supports*, and no higher.
The composite honesty rule holds throughout — **the framework may propose freely
(L0), but may only *claim* what a cited artifact supports (L2+)**.

| Level | Name | What "validated" means here | Weakest acceptable evidence |
|---|---|---|---|
| **L0** | Proposed / Future | A model, criterion, or procedure defined *by this framework*; internally consistent and reviewed, but not in code. Not a validation claim — a proposal. | none — explicitly labelled Proposed |
| **L1** | Modeled | The schema/type surface and its **pure decision logic** exist and pass unit tests, but are not wired to a live external system or execution path. "Validated" = the shape type-checks and its pure helpers are green. | type file + pure-helper test |
| **L2** | Implemented | Code exists, runs, and is exercised by tests; correct by construction and inspection, but not independently *measured* as a scientific claim. | source file path + exercising test |
| **L3** | Measured | Implemented **and** carries a real, reproducible recorded measurement (bench artifact or live telemetry). "Validated" = a measurement exists and can be re-taken. | `bench/results/*.json` or `/metrics` series |
| **L4** | Validated | Implemented **and** verified by executed tests, static gates, or reliability/deployment runs, with recorded evidence. Validation in the strong sense. | test file + gate output or `bench/results/*.json` |

The five NSSP buckets map directly: L4 = Validated, L3 = Measured, L2 =
Implemented, L1 = Modeled (an Implemented-but-not-live variant), L0 = Proposed.

---

## 2. Acceptance criteria — the release gates

A build is **acceptable** when every gate below passes at its stated threshold.
These thresholds are not aspirational: they are the ones enforced by the
[Release Checklist](../../guides/RELEASE-CHECKLIST.md) §2–§3 and re-run for every
release. All are **L4** (verified by executed tooling with a binary result).

| Gate | Command (repo root) | Threshold | Evidence |
|---|---|---|---|
| Type safety | `npm run typecheck` | **0 errors** (TypeScript `strict`, all workspaces) | **L4** |
| Lint | `npm run lint` (`eslint . --max-warnings 0`) | **0 warnings** (zero-warning policy) | **L4** |
| Tests | `npm run test` | **all green** — 3,856 tests, 0 failed | **L4** |
| Build | `npm run build` | **exit 0** (backend then desktop) | **L4** |
| Format | `npm run format:check` | **no drift** (Prettier) | **L4** |
| Prod supply chain | `npm audit --omit=dev` | **0 production vulnerabilities** | **L4** |
| Deployment schema | `kubeconform -strict`, `helm lint`, `shellcheck` | **strict PASS / CLEAN** | **L4** |

The four core gates (typecheck 0, lint 0, tests green, build 0) plus the
0-production-vulnerability audit are the non-negotiable acceptance floor. Numbers
in release notes must be **re-run and copied from actual output**, never
transcribed from a prior release (Release Checklist §2).

---

## 3. Evidence requirements — per L-level

To *raise* a claim to a given level, it must carry the evidence that level
demands. This is the citation contract every NSSP document inherits.

| Target level | Required evidence to assert it | Example anchor |
|---|---|---|
| **L4 Validated** | An executed test, static gate, or reliability/deployment run with recorded output | `continuousValidation.test.ts`; `npm run typecheck` = 0; `bench/results/reliability.json` |
| **L3 Measured** | A reproducible measurement — bench artifact or live metric series | `bench/results/http-load.json`; `/metrics` gauges |
| **L2 Implemented** | A source path that implements and is exercised in the codebase | `sandbox/validation/platform.ts`; `observability/metrics.ts` |
| **L1 Modeled** | A type/schema file plus green pure-helper tests | `continuousValidation.ts` + its pure-helper suite |
| **L0 Proposed** | None — must be **explicitly labelled** Proposed/Future | NSSP framework prose only |
| **(absent)** | Peer review, certification, published papers, international-standard conformance | **not claimed anywhere** |

The last row is a standing prohibition: the platform holds no such artifacts, so
no NSSP document may imply them.

---

## 4. Test hierarchy

Validation ascends five tiers, from the narrowest pure-function check to
whole-system perturbation and deployment-artifact conformance. The tiers are real
and executed; the counts are the canonical NSSP figures from `_grounding.md`
(**3,856 tests across 442 files** — desktop 3,548 / backend 263 / sdk 15 / cli 30;
441 files run in the infra-free default gate, +1 Postgres-gated integration file).

| Tier | What it validates | Where (real) | Evidence |
|---|---|---|---|
| 1. Unit | Pure logic, models, decision helpers, engine hot paths | Vitest suites across `apps/desktop`, `packages/shared`; e.g. `continuousValidation.test.ts` helper cases | **L4** |
| 2. Integration | Cross-module composition, IPC channels, DB-backed flows | `sandbox/validation/validationRun.test.ts`, `validationChannels.test.ts`; `apps/backend/src/__integration__/organizations.test.ts` (gated behind real Postgres) | **L4** |
| 3. HTTP | Backend routes/middleware behaviour and load | Backend router/webhook tests (263 backend unit/HTTP tests) + `bench/http-load.mjs` (24,000 req, 0 errors) | **L4** functional / **L3** load |
| 4. Reliability / chaos | Recovery, fail-open, restore under real perturbation | `docs/validation/RELIABILITY-RESULTS.md` + `bench/results/reliability.json` (5 PASS, 1 PARTIAL) | **L4** |
| 5. Deployment | K8s/Helm/YAML/shell artifact conformance | `deploy-validation.yml`: `kubeconform -strict`, `helm lint`; `shellcheck` (`bench/results/deployment.json`) | **L4** |

Each tier is a strictly stronger statement than the one below it: unit tests
assert local correctness, integration asserts composition, HTTP asserts the wire
contract, reliability asserts behaviour under fault, and deployment asserts that
the shipping artifacts are schema-valid. A claim inherits the highest tier that
actually exercises it.

---

## 5. Verification process

Verification is the act of moving a claim to the level its evidence supports, and
recording the anchor. The process is uniform:

1. **State the claim and its intended level.** e.g. "restart-to-healthy is
   sub-second" → intended **L4** (a reliability run).
2. **Identify the required evidence** for that level from §3.
3. **Execute** the corresponding mechanism — a gate command, a test suite, a
   bench harness, or a reliability scenario.
4. **Record the artifact** — a `bench/results/*.json` file, a gate exit code, or a
   row in `RELIABILITY-RESULTS.md` — transcribed unaltered.
5. **Assign the level and cite the anchor.** If the evidence is weaker than the
   intended level, the claim is *demoted*, not asserted. A modeled-but-unwired
   surface stays **L1** no matter how confident the design.

The discipline is subtractive: absence of evidence caps the level. This is why
prediction/forecasting is **L0** (no engine exists) and the continuous-validation
scheduler is described as a model, not a live production service (§9).

---

## 6. Validation workflow — the continuous-validation model

The platform contains a real **orchestration model** for validation runs: the AI
Sandbox *Continuous Validation Platform* (S6), whose contract lives in
[`continuousValidation.ts`](../../../packages/shared/src/types/continuousValidation.ts)
and whose orchestrator lives under
[`apps/desktop/src/main/sandbox/validation/`](../../../apps/desktop/src/main/sandbox/validation/).
It is an **L2 orchestration layer with L1 type/decision surfaces** — it composes
the existing S1–S5 sandbox executors into named pipelines and adds *no* new engine
(`pipelineRunner.ts`: "It executes nothing itself and never bypasses an
executor"). It orchestrates the **sandbox**; it is **not** the mechanism that
gates the shipping repository per PR (that is §9).

**Workflow shape** (each element is a real type or pure function):

| Concept | Type / function | Role | Evidence |
|---|---|---|---|
| Pipeline | `ValidationPipeline` (`PipelineKind`: quick…certification) | A named, ordered set of stages; `certifies` flag | **L1** `continuousValidation.ts` |
| Stage | `PipelineStage` (`StageKind`: `scenario` \| `ai-qa` \| `lab`) | Dispatches to exactly one existing executor | **L2** `pipelineRunner.ts` |
| Cadence | `ScheduleCadence` (`CadenceKind`: `manual` \| `nightly` \| `weekly` \| `interval`) | When a schedule is due | **L1** `continuousValidation.ts` |
| Stage result | `StageResult` / `StageStatus` (`pass`\|`fail`\|`warn`\|`error`\|`skipped`) | Per-stage outcome + metrics | **L2** `pipelineRunner.ts` |
| Run status | `runStatusFrom(stages)` | Rolls stages into `running`\|`passed`\|`warning`\|`failed`\|`error` | **L4** (pure, unit-tested) |
| Regression | `classifyRegression()` / `worstSeverity()` | Benchmark-delta severity (see §7) | **L4** (pure, unit-tested) |
| Certification | `certifyLevel()` → `CertificationReport` | `pass`\|`warning`\|`fail` from stages + regression + security | **L4** (pure, unit-tested) |
| Cadence due | `cadenceDue()` / `computeTrend()` | Wall-clock due-window + trend direction | **L4** (pure, unit-tested) |

**Execution path** (from `platform.ts` → `runValidationPipeline`): dispatch each
stage to its existing executor → aggregate `StageResult`s → analyze regression
against the S5 benchmark store → certify (if `pipeline.certifies`) → record history
→ emit notifications → persist the run. The pure decision functions
(`certifyLevel`, `runStatusFrom`, `classifyRegression`, `worstSeverity`,
`computeTrend`, `cadenceDue`) are all covered by
[`continuousValidation.test.ts`](../../../apps/desktop/src/main/sandbox/validation/continuousValidation.test.ts)
and are therefore **L4** in isolation, even though the orchestration they drive is
**L2**.

**Scheduler — stated honestly.** `scheduler.ts` reuses the existing task scheduler
via an injected `SchedulerPort` (a 1-minute tick with wall-clock cadence
matching); `defaultSchedules()` proposes nightly regression + weekly
certification. The cadence logic is unit-tested (**L4** as pure logic), and the
scheduler is **implemented** (**L2**). There is **no evidence in the codebase that
this scheduler runs as a live, always-on production service validating the
shipping platform** — it is a model wired through dependency injection. The NSSP
does not claim a live scheduler.

---

## 7. Regression validation

Regression validation asks a different question from acceptance: *did a change make
something measurably worse?* Two real mechanisms answer it.

**Benchmark budget guards (`__bench__`).** The deterministic intelligence engines
run over a **seeded synthetic 5,000-entity workspace** in
[`apps/desktop/src/main/__bench__/performance.test.ts`](../../../apps/desktop/src/main/__bench__/performance.test.ts).
Each hot path is timed and asserted **under a 2,000 ms regression budget**
(`expect(v).toBeLessThan(2000)`). The recorded timings
(`bench/results/intelligence-engines.json`) include `graph.project` 92.84 ms,
`memory.index` 74.37 ms, `timeline.query` 76.80 ms — all far inside budget. This
is **L3** for the measurements and **L4** for the guard assertion.

**Benchmark-delta classification.** `classifyRegression(kind, metric, current,
baseline)` in `continuousValidation.ts` is the model's severity rule (lower is
better): deltas **≤ 5 %** are treated as noise/improvement and ignored; then
**≥ 10 % → minor**, **≥ 25 % → major**, **≥ 50 % → critical**. `worstSeverity()`
reduces findings to the worst band, and a regressed run degrades certification to
`warning` via `certifyLevel()`. These thresholds are exactly the cases asserted in
`continuousValidation.test.ts` (+12 % minor, +30 % major, +60 % critical) — **L4**
as pure logic.

**Functional regression.** The full **3,856-test** suite is itself the functional
regression guard: any change that breaks a modeled behaviour turns a gate red. The
reproducible bench harnesses (`bench/http-load.mjs`, `bench/db-latency.mjs`,
`bench/startup.sh`) provide the **L3** performance baselines a regression is
measured against.

| Regression mechanism | Baseline source | Threshold | Evidence |
|---|---|---|---|
| Engine budget guard | 5,000-entity synthetic run | < 2,000 ms per hot path | **L4** guard / **L3** timing |
| Benchmark-delta classifier | S5 benchmark store | 5 % noise; 10/25/50 % minor/major/critical | **L4** (pure, tested) |
| Functional regression | 3,856-test suite | all green | **L4** |
| Performance baseline | `bench/results/*.json` | reproducible re-run | **L3** |

---

## 8. Operational validation — executed reliability (EVP)

Operational validation is the strongest single class of evidence in the program:
the system was **perturbed against a live backend** (production build, Postgres
16.13, Redis 7.0.15, on 2026-07-18) and its actual recovery recorded. The results
are transcribed unaltered from
[`RELIABILITY-RESULTS.md`](../../validation/RELIABILITY-RESULTS.md) and
[`bench/results/reliability.json`](../../../bench/results/reliability.json).

| # | Scenario | Result | Recorded evidence |
|---|---|---|---|
| 1 | Migration idempotency | **PASS** | 12 migrations applied; re-run applied 0 new (forward-only) |
| 2 | Backup & restore (pg_dump/pg_restore) | **PASS** | row counts match exactly — applications 20, versions 40, categories 14 |
| 3 | Backend restart recovery | **PASS** | SIGTERM → down → restart → **healthy in 0.46 s** |
| 4 | Redis-down fail-open | **PASS** | `/store/apps` served 200 ×5 through outage; `/health` = `degraded/redis:down`; no crash |
| 5 | Postgres-down degradation + auto-recovery | **PASS** | process survived; DB read → clean 500; pool **auto-reconnected with no restart** |
| 6 | Offline / air-gapped bundle | **PARTIAL** | script `shellcheck`-CLEAN + documented; full `docker save/load` needs a daemon (not in harness) |

Scenarios 1–5 are **L4** (executed, recorded). Scenario 6 is honestly **PARTIAL**:
the mechanism is statically validated but not fully executed in this environment.
Scenario 5 — surviving datastore loss, reporting honest health, refusing
DB-dependent work cleanly, and self-healing — is the strongest resilience evidence
the platform carries. **Not executed** (stated in the source): failure injection at
scale, multi-node network partitions, automated application rollback (the real
recovery path is the proven data-side restore, §2), and federation DR (modeled).

---

## 9. Continuous validation — model plus CI, stated honestly

The NSSP distinguishes two things that both get called "continuous validation":

**(a) The S6 model (§6).** An implemented orchestration layer that *can* run
pipelines on a cadence within the desktop sandbox. It is **L2/L1**: real,
type-checked, unit-tested in its decision logic — but a model, not a running
production service. Do not read it as a live scheduler continuously certifying the
shipping platform.

**(b) The repository's real continuous validation — CI.** Three GitHub Actions
workflows actually gate the repo, and their scope is deliberately bounded:

| Workflow | Triggers on | What it runs | Evidence |
|---|---|---|---|
| `backend-ci.yml` | push/PR touching `apps/backend/**`, `packages/shared/**` | typecheck (backend), `eslint --max-warnings 0`, backend tests, backend build, Docker image build (no push) | **L2** |
| `deploy-validation.yml` | push/PR touching `deploy/**` | `yamllint`, `helm lint`, `helm template`, `kubeconform -strict` (raw + rendered) | **L2** (yields L4 deployment PASS) |
| `windows-release.yml` | release flow | Windows packaging automation | **L2** |

**The honest gap (Release Checklist §8; GA report TD-4).** There is **no per-PR
desktop CI**: the **3,548 desktop tests are not gated per PR by CI** — they run
locally and at the RC gate. There is **no macOS release CI** (mac packaging is
manual). Renderer component/E2E and accessibility suites are **absent**, and
**coverage instrumentation is not wired**. These are tracked, not hidden; the NSSP
records them as **L0/absent** rather than implying coverage that does not exist.

---

## 10. Master matrix — validation mechanism → coverage → evidence → anchor

The consolidated view. This preserves the evidence levels of §4 of
`SCIENTIFIC-MATRICES.md` and is the single table other NSSP documents should cite
for validation claims.

| Mechanism | Coverage | Evidence | Anchor |
|---|---|---|---|
| Unit/integration tests | Logic, models, IPC, HTTP contracts | **L4** | 3,856 tests / 442 files |
| Type checking (`strict`) | Type safety, all workspaces | **L4** | `npm run typecheck` = 0 |
| Lint (zero-warning) | Style + correctness rules | **L4** | `eslint . --max-warnings 0` = 0 |
| Production build | Buildability (backend + desktop) | **L4** | `npm run build` exit 0 |
| Format check | Formatting drift | **L4** | `npm run format:check` |
| Dependency audit (prod) | Supply-chain, production deps | **L4** | `npm audit --omit=dev` = 0 |
| Reliability / chaos | Recovery, fail-open, restore | **L4** | `bench/results/reliability.json` (5 PASS) |
| Deployment validation | K8s / Helm / YAML / shell | **L4** | `kubeconform -strict`, `helm lint`, `shellcheck` |
| Benchmark budget guards | Performance regression | **L4** guard / **L3** timing | `__bench__/performance.test.ts` (< 2,000 ms) |
| Benchmark harnesses | Latency / throughput baselines | **L3** | `bench/http-load.mjs`, `db-latency.mjs`, `startup.sh` |
| Live telemetry | Runtime health / resource gauges | **L3** | `/metrics`, `/health`, `audit_log` |
| Continuous-validation model (S6) | Pipeline/stage/cadence orchestration | **L2/L1** | `continuousValidation.ts`, `sandbox/validation/*` |
| Sandbox lab / AI-QA / scenario | Scenario + security labs | **L2** | `sandbox/lab/*`, `sandbox/scenarioStore.ts` |
| CI pipelines | Backend, deploy, windows | **L2** | `.github/workflows/*.yml` |
| **Not present (honest)** | Per-PR desktop CI, macOS release CI, coverage instrumentation, renderer E2E/a11y | **L0 / absent** | tracked in GA report (TD-4, TD-7) |

---

## Scope and honesty note

This framework claims exactly what the anchors support and no more. The platform
holds **no** peer review, certification, published papers, or international-standard
conformance, and this document asserts none. Where a validation mechanism is a
model rather than a live, measured system — the S6 continuous-validation platform,
its scheduler — it is labelled **L2/L1** and described as a model. Where a control
is absent — per-PR desktop CI, macOS release CI, renderer E2E/a11y, coverage
instrumentation — it is disclosed as **L0/absent**. Reaching the end of the gates
in §2 with every threshold met is what "validated to ship" means for NeuroPause;
everything beyond that floor is validated only to the level its evidence proves.
