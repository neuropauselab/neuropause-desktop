# NSSP Framework — Prediction Science

> Part of the NeuroPause Scientific & Standards Program (NSSP). This is a
> **formalization** of the *prediction* discipline **over the platform that already
> exists** — not an engineering proposal to build one. Read together with
> [`../_grounding.md`](../_grounding.md) (§Prediction) and
> [`../SCIENTIFIC-MATRICES.md`](../SCIENTIFIC-MATRICES.md) (row **C17**).
>
> ## ⚠️ Honesty banner — read first
>
> **NeuroPause has NO statistical forecasting, time-series, or ML-prediction
> engine.** There is no model that ingests historical series and emits a
> quantitative future estimate with error bars. What genuinely exists and runs is
> **scenario simulation**, **process mining**, and **deterministic AI-agent
> reasoning** — plus two **deterministic projection models** in the shared types
> layer. Consequently, Prediction science is **predominantly L0 (Proposed / Future
> Research)**, grounded conceptually on the real what-if / mining / reasoning
> surfaces that do exist. Nothing in this document may be read as a claim that a
> forecasting engine, a trained model, or any measured predictive accuracy exists.
> No accuracy number, hit rate, or error metric is stated anywhere — because none
> has been measured.

## Evidence ladder (from `_grounding.md`)

`L4` Validated · `L3` Measured · `L2` Implemented · `L1` Modeled · `L0`
Proposed / Future Research. Citations are given for L2+; L0 items carry an
explicit **PROPOSED — not implemented** banner and cite no code.

---

## What exists vs what is proposed

The single most important table in this framework. Every prediction concept is
mapped to its honest status and to a **real anchor** or the word *proposed*.

| Prediction concept | Status | Real anchor (or "proposed") |
|---|---|---|
| Scenario analysis (what-if) | **L2** | `apps/desktop/src/main/sandbox/scenarioStore.ts`, `sandbox/agent/scenarioTemplates.ts` |
| Process mining (retrospective discovery) | **L2** | `apps/desktop/src/main/enterprise/processMiningProvider.ts` |
| AI-agent reasoning (deterministic-first) | **L2** | `sandbox/agent/reasoner.ts`, `sandbox/agent/reflection.ts` |
| Descriptive trend deltas / indicators | **L2/L1** | `packages/shared/src/types/executiveCenter.ts` (`ExecutiveKpi.trend`, `ExecutiveTrend`, `MonthlyTrend`) |
| Capacity projection (deterministic, wired — not forecasting) | **L2** | `computeCapacitySchedule` (`capacityScheduler.ts`; called in `enterprise/executiveCenterSubsystem.ts`, `runtimeCore.ts:1792`) |
| Decision / recovery-plan projection (deterministic, wired — not forecasting) | **L2** | `assessDecisionEngine` (`enterpriseDecisionEngine.ts`; called in `executiveCenterSubsystem.ts:238`) |
| **Predictive models (statistical/ML)** | **L0** | *proposed* |
| **Forecast models (time-series)** | **L0** | *proposed — none exist* |
| **Predictive trend extrapolation** | **L0** | *proposed* |
| **Risk prediction (scored likelihood engine)** | **L0** | *proposed — real register is human-authored (`ENTERPRISE-GA-REPORT.md` §5)* |
| **Failure prediction (pre-failure)** | **L0** | *proposed — real reflection classifies failures **after** they occur* |
| **Calibrated confidence estimation** | **L0** | *proposed — real confidence values are deterministic heuristics* |

The rule that governs the rest of the document: **we may propose freely (L0), but
may only *claim* what a cited artifact supports (L2+).** A deterministic
projection over modeled inputs is **not** a validated forecast.

---

## Predictive models

**Status: L0 (Proposed) — grounded conceptually on real L2 surfaces.**

> **PROPOSED — not implemented.** No trained or statistical predictive model
> exists in the codebase. The description below is a *proposed* framework layer;
> it names the real surfaces it *would* sit on, none of which perform statistical
> prediction today.

The nearest real capability to "prediction" that the platform actually runs is
**deterministic what-if simulation**, not statistical inference. A scenario is a
named, versioned, checksummed definition
(`SandboxScenarioStore.createVersion` in `scenarioStore.ts` appends immutable,
deduped versions); deterministic builders in `scenarioTemplates.ts` (e.g.
`procureToPay`, `manufacturingFlow`, `financeFlow`) emit specs that the sandbox
executors run to observe an outcome. This answers *"if these steps execute, what
happens?"* — a **projected outcome of a defined procedure**, not a probabilistic
forecast of an uncertain future.

A genuine predictive-model layer (L0, proposed) would draw features from the
**real** entity graph, timeline event stream, and KPI modules; fit/estimate a
model **off-platform** and expose only its *typed outputs* through a modeled
surface (mirroring how `capacityScheduler.ts` exposes typed projections without
embedding an optimizer); and record realized-vs-predicted outcomes with a
calibrated confidence so the claim can climb the ladder with measured backing.
Until such a model exists **and** is measured, predictive-model claims remain L0.

## Forecast models

**Status: L0 — none exist.**

> **PROPOSED — not implemented.** There is **no** time-series forecasting engine,
> no ARIMA/ETS/Prophet/ML forecaster, no horizon-N numeric projection of a metric
> series anywhere in the codebase. Matrix row **C17** records this as L0 with the
> anchor *"no engine exists — proposed."*

Occurrences of the words *forecast* / *predict* in the source tree are **type
names and AI-agent-reasoning narrative**, never a statistical forecaster (see
`_grounding.md` §Prediction). The platform can compute a **delta between two
observed snapshots** (see *Trend analysis*), but it never **extrapolates** a
series forward. A proposed forecast layer would need: a persisted historical
series (only partially available via `/metrics` scrapes and the `audit_log`),
a fitted model, and a measured error metric — all three are absent today.

## Trend analysis

**Status: L1 (descriptive, modeled) for what exists · L0 for predictive
extrapolation.**

What genuinely exists is **descriptive**, not predictive. In
`packages/shared/src/types/executiveCenter.ts`:

- `ExecutiveKpi.trend?: 'up' | 'down' | 'flat'` — a qualitative **direction
  indicator**, not a fitted slope.
- `ExecutiveTrend` — a weekly **delta** (`current`, `previous`, `delta`,
  `direction`) between two observed snapshots.
- `MonthlyTrend` — a richer 30-day descriptive summary: `movingAverage`,
  `highest`, `lowest`, spread-based `stability: 'stable' | 'volatile'`, a
  `sparkline` of ordered values, and a datapoint-count `confidence:
  'low' | 'medium' | 'high'`.

Every field above is **backward-looking arithmetic over already-observed
values**. `movingAverage` smooths history; it does not project the next point.
`direction` compares two known values; it does not fit a trend line or estimate
where the series goes next.

> **PROPOSED — not implemented (L0).** *Predictive* trend analysis — regression /
> extrapolation that estimates a **future** value with an interval — does not
> exist. It would be built by fitting over the descriptive series above, and must
> report a measured error before rising above L0.

## Scenario analysis

**Status: L2 — real and runnable.**

The genuinely implemented what-if surface. `SandboxScenarioStore`
(`apps/desktop/src/main/sandbox/scenarioStore.ts`) is the registry: scenarios are
unique per workspace, each `createVersion` appends an **immutable, checksummed**
version (identical specs dedupe to the current head), and history is never
overwritten. `scenarioTemplates.ts` provides deterministic, pure spec builders
across CRM, procurement, manufacturing, inventory, planning, finance, security
(RBAC), and developer-channel flows; the agent **generates a spec — it never
performs the operation** (the sandbox executors do, behind the `QaExecutor`
port).

Why this is L2 and not prediction: scenario analysis produces the **deterministic
outcome of a defined procedure under controlled inputs** — reproducible what-if
modeling. It is the honest, real substrate that a proposed predictive layer would
consume, but it makes **no probabilistic statement about the future**. Related
retrospective surface: **process mining**
(`enterprise/processMiningProvider.ts`) runs `assessProcessMining` **once** over
the modules' real record stores and caches the assessment (graph, metrics,
insights, narrative) keyed by a cheap record-count signature. It is explicitly
**read-only and discovers the past** — process *discovery*, not process
*prediction*.

## Capacity prediction

**Status: L2 (Implemented) — deterministic projection, wired at runtime; *not*
statistical forecasting.**

`packages/shared/src/types/capacityScheduler.ts` is a **deterministic
finite-capacity scheduling model** whose `computeCapacitySchedule` is invoked at
runtime (`enterprise/executiveCenterSubsystem.ts:220`, `runtimeCore.ts:1792`), so
it is Implemented (L2), not merely type-only. From planning
inputs it loads production planned orders onto real machines and computes a
forward schedule over a **fixed 30-day horizon** (`SCHEDULE_HORIZON_DAYS = 30`)
using **explainable constants** (`MACHINE_HOURS_PER_DAY`, `MACHINE_RATE_PER_HOUR`,
`SETUP_HOURS`, `UTILIZATION_BOTTLENECK_THRESHOLD = 85`, …). It emits typed outputs
— `ScheduledOperation`, per-machine `MachineLoad` with bottleneck flags,
`CapacitySchedule`, `CapacityInsights`, and capacity KPIs/recommendations via
`computeCapacitySchedule` / `deriveCapacityInsights` / `capacityRecommendations`.

Why it is **L2 but not forecasting**: the projection function runs, but the
schedule is a **deterministic projection over modeled planning inputs**, dispatched
by a fixed policy (late → critical-path → earliest-due → largest → sku) with greedy
earliest-finish assignment. It carries the arithmetic that produced each number,
and the platform never *executes* the plan on real equipment (the AI explains
schedules, it does not run production). It is a **capacity plan**, not a statistical
**forecast**: no uncertainty, no learned parameters, no measured
realized-vs-projected error. Matrix rows **C15/C16** hold this (and the sibling
`enterpriseDecisionEngine.ts`, whose `assessDecisionEngine` / `buildRecoveryPlans`
project deterministic `RecoveryPlan`s with `recoveryDays` / `improvement`) at
**L2** — wired deterministic projection surfaces, **not** validated statistical
predictors. Predictive/forecasting capability over these surfaces remains **L0**.

## Risk prediction

**Status: L0 (Proposed).**

> **PROPOSED — not implemented.** No engine scores, ranks, or predicts risk
> likelihood. There is no probabilistic risk model.

What is real is a **human-authored risk register**, not a predictor. The
NeuroPause assurance record (`ENTERPRISE-GA-REPORT.md`) contains a **§5 Production
Risk Matrix** (`PR-1`…`PR-5`) and a **Technical-Debt table** (`TD-1`…`TD-4`) in
which *Likelihood* and *Impact* are **qualitative labels assigned by reviewers**
(e.g. TD-2 "Marketplace app install skips signature check when unsigned" — High;
TD-3 "Rate limiter fails open when Redis unavailable" — Medium, deliberate). These
are curated engineering judgements, honestly recorded — **not outputs of a
prediction engine**.

A proposed risk-prediction layer (L0) would learn from the append-only
`audit_log` and reliability history to *estimate* likelihoods, then feed the
existing register rather than replace it. It would remain L0 until it produced a
prediction whose realized outcome was measured. **Today, every risk figure in the
platform is authored, not predicted.**

## Failure prediction

**Status: L0 (Proposed).**

> **PROPOSED — not implemented.** Nothing predicts a failure **before** it
> happens. There is no anomaly detector, no pre-failure alerting model, no
> remaining-useful-life estimator.

The real, related surface is **post-hoc failure *classification***, not
prediction. After a scenario runs, `reflect(...)` in
`apps/desktop/src/main/sandbox/agent/reflection.ts` compares expected vs actual
and `classify(...)` sorts an **already-observed** failure into a
`QaFailureClass` (`permission` / `timeout` / `environment` / `crash` /
`assertion` / …) from the recorded error text; a **new** failure not in recalled
known issues is flagged as a regression. `hypothesize(...)` and `recommend(...)`
attach deterministic root-cause hypotheses and fixes.

This is reactive diagnosis of a failure that **has already occurred** — the honest
opposite of *prediction*. A proposed failure-prediction layer would consume these
classifications plus telemetry to estimate failure probability ahead of time; it
does not exist and is L0.

## Confidence estimation

**Status: L0 (Proposed) for calibrated confidence — the real confidence values
are deterministic heuristics / data-sufficiency bands.**

This section describes **how one *would* estimate confidence**, anchored on the
real (non-predictive) confidence surfaces already in code:

- **Failure-class heuristic** — `confidenceFor(cls, observation)` in
  `reflection.ts` returns **fixed** confidences per class (e.g. `permission`
  0.95, `assertion` 0.8, `timeout`/`environment` 0.6, `crash` 0.7, `flaky` 0.4;
  otherwise `0.5 + ratio*0.2`). Deterministic, hand-set — **not** a calibrated
  probability.
- **Reasoner output** — `QaReasonerResult.confidence`
  (`sandbox/agent/ports.ts`) is a number carried alongside a narrative;
  `LlmReasoner` takes `Math.max(base, llm)` of the two. Combinatoric, not
  probabilistic.
- **Data-sufficiency band** — `MonthlyTrend.confidence: 'low'|'medium'|'high'`
  (`executiveCenter.ts`) "grows with the number of datapoints." It signals *how
  much history backs the summary*, **not** a prediction interval.

> **PROPOSED — not implemented (L0).** A principled confidence-estimation method
> (calibrated intervals, reliability diagrams, Brier/log-loss scoring against
> realized outcomes) does not exist. The proposed approach would (a) keep the
> deterministic heuristics as priors, (b) record predicted-vs-realized outcomes,
> and (c) **calibrate** the numbers against that record. Until (b)/(c) run, every
> confidence value in the platform is a **heuristic label**, and must be presented
> as such — never as a statistical guarantee.

---

## Prediction assumptions

Any prediction claim in the NSSP is made **only** under these stated assumptions;
where an assumption is unmet, the concept stays L0.

1. **Determinism over inference.** All *runnable* "forward-looking" behavior
   (scenario execution, capacity schedule, recovery plans) is **deterministic**:
   same inputs → same outputs, `nowMs`/clock injected. No randomness, no learned
   weights. This is an assumption *and* a limitation (see below).
2. **Modeled, controlled inputs.** Projections consume planning inputs and
   sandbox specs that are often **seeded/synthetic** (per the deterministic bench
   over a seeded 5,000-entity workspace), not a live production forecast feed.
3. **Bounded, honest history.** Real historical signal is limited to `/metrics`
   scrapes, the append-only `audit_log`, and the timeline event stream — none of
   which is currently assembled into a training series.
4. **Read-only projection.** The capacity/decision/process surfaces **create and
   mutate nothing**; a projection is an explanation, never an action.
5. **Evidence discipline.** A projection may be *described* (L1) but may not be
   *claimed as a validated forecast* (L3/L4) without recorded
   predicted-vs-realized measurement, which does not exist.

## Prediction limitations

The most honesty-sensitive section. State these plainly wherever prediction is
discussed.

- **No forecasting engine exists.** There is no statistical, time-series, or ML
  prediction engine anywhere in NeuroPause. Full stop. (Matrix **C17 = L0**.)
- **No measured predictive accuracy.** No accuracy, precision/recall, MAPE, RMSE,
  hit rate, or calibration figure has ever been produced — so **none is stated**,
  here or anywhere. Any such number would be fabricated and is prohibited.
- **Deterministic ≠ predictive.** The capacity scheduler and decision engine are
  deterministic projections over modeled inputs (L1). They do not estimate
  uncertainty and are not validated against realized outcomes; calling them
  "predictions" without that caveat would overclaim.
- **Descriptive trends are not forecasts.** `ExecutiveTrend` / `MonthlyTrend` /
  `ExecutiveKpi.trend` summarize the **past** (deltas, moving averages,
  direction). They perform **no extrapolation** and imply nothing about future
  values.
- **Confidence numbers are heuristics.** Every confidence value in code is
  hand-set or datapoint-counted, **not** calibrated. They must never be read as
  probabilities or statistical guarantees.
- **Risk figures are authored, not predicted.** Likelihood/impact in the GA risk
  matrix are reviewer judgements; there is no risk-scoring model.
- **Failure handling is retrospective.** The agent **classifies** failures after
  they occur; it does not foresee them.
- **AI reasoning is narrative, not statistics.** The LLM reasoner only **enriches
  a deterministic narrative** and "never breaks a run"; it degrades to the
  deterministic path when offline. It produces explanations, not forecasts, and
  can be ungrounded (its own fallback returns empty/ungrounded text).
- **Inputs are largely modeled.** Because projection inputs are frequently seeded
  or demo data, even the deterministic outputs describe a **modeled** world, not
  a measured production trajectory.
- **No persisted training history.** The signals that a future predictor would
  need are not currently assembled, retained as a series, or feature-engineered.

---

## Cross-references

- Evidence ladder & Prediction grounding: [`../_grounding.md`](../_grounding.md) §Prediction.
- Matrix rows: [`../SCIENTIFIC-MATRICES.md`](../SCIENTIFIC-MATRICES.md) — **C13** (scenario simulation, L2), **C14** (process mining, L2), **C15** (capacity scheduling, L2 — deterministic, not forecasting), **C16** (decision engine, L2 — deterministic, not forecasting), **C17** (forecasting/prediction, **L0**).
- Risk register (human-authored): `ENTERPRISE-GA-REPORT.md` §5 Production Risk Matrix + Technical-Debt table.

_Composite honesty rule for this framework: **propose freely (L0), claim only what
a cited artifact supports (L2+), and never imply a forecasting engine, a trained
model, or a measured predictive accuracy — because none exists.**_
