# NeuroPause — Research Roadmap

> Part of the NSSP. This document holds the program's **honest open questions**:
> the L0 (Proposed) and Future-Research items — everything the platform does **not**
> yet do. Nothing here is a commitment, a schedule, or a result. There are **no
> timelines and no projected numbers**, by charter. Each item is framed as a
> *research question*, paired with **what exists today** (cited, with evidence
> level) and **what would need to be built or measured** to answer it.
>
> Evidence ladder ([`../_grounding.md`](../_grounding.md)): **L4** Validated ·
> **L3** Measured · **L2** Implemented · **L1** Modeled · **L0** Proposed.

**Reading rule.** An item's presence here is itself the honest claim: it is *not*
implemented. Where a real, adjacent surface exists, it is cited so the opportunity is
grounded rather than speculative — but the gap between that surface and the research
question is stated plainly.

---

## 1. A statistical forecasting engine

**Research question.** Can NeuroPause forecast future workload, capacity, or
enterprise KPIs from its own recorded history with quantified, validated accuracy?

**What exists today.**
- Scenario simulation — `sandbox/scenarioStore.ts`, `sandbox/agent/scenarioTemplates.ts` (**L2**).
- Process mining — `enterprise/processMiningProvider.ts` (**L2**).
- AI-agent reasoning — `sandbox/agent/reasoner.ts`, `reflection.ts` (**L2**).
- KPI computation over present inputs — `enterprise/intelligence/enterpriseKpi.ts`,
  `workforce/intelligence/workforcePerformanceKpi.ts` (**L2**).

**What does not exist.** There is **no** statistical forecasting, time-series, or
ML-prediction engine. Occurrences of "forecast/predict/trend" in the codebase are
AI-agent *reasoning*, not statistical prediction. Prediction science is therefore
**predominantly L0** ([Prediction framework](../frameworks/PREDICTION.md)).

**What would need to be built or measured.** A forecasting component consuming the
existing measured series (`bench/results/*.json`, `/metrics`, KPI outputs); a defined
target variable and horizon; a hold-out evaluation protocol producing accuracy
metrics (e.g. MAPE/MAE) recorded as artifacts before any accuracy is *claimed*. Until
those artifacts exist, any forecast output remains **L0**, and no accuracy figure may
be stated.

---

## 2. Predictive capacity planning

**Research question.** Can the modeled capacity and decision layers be driven by live
signals to produce validated capacity recommendations?

**What exists today.**
- `capacityScheduler.ts` — a **deterministic** capacity-planning model whose
  `computeCapacitySchedule` **is wired at runtime** (`executiveCenterSubsystem.ts:220`,
  `runtimeCore.ts:1792`) — **L2**, but rule-based, not a statistical predictor.
- `enterpriseDecisionEngine.ts` — a **deterministic** decision/recovery projection
  (`assessDecisionEngine`, wired at `executiveCenterSubsystem.ts:238`) — **L2**, not a
  learned predictor.

**What would need to be built or measured (still L0).** A *statistical/learned*
prediction layer over these deterministic projections; a real input feed
(utilization, throughput, backlog) sourced from existing telemetry; and a validation
protocol comparing recommendations against realized outcomes. The
models are a genuine **L1** foundation — the research is the engine and its
measurement, which would move individual capabilities L1 → L2 → L3, never skipping a
rung.

---

## 3. Desktop-hardware performance benchmarking

**Research question.** How does the desktop (Electron/renderer) tier perform across
real end-user hardware — frame time, IPC round-trip, memory — under representative
load?

**What exists today.**
- Renderer perf telemetry samples **real** values (rAF frame rate,
  `performance.memory`): `perfMetrics.ts` (`DurationSummary`, `IpcChannelStat`,
  `RenderComponentStat`), `lib/perf/perfRecorder.ts`, `state/PerfSampler.tsx`,
  `shell/PerformanceOverlay.tsx` (**L2**, harness-ready).
- The engine hot-path benchmark runs deterministically over a seeded 5,000-entity
  workspace: `apps/desktop/src/main/__bench__/performance.test.ts` →
  `bench/results/intelligence-engines.json` (**L3**).

**What does not exist.** The renderer telemetry is **harness-ready but not yet
captured as recorded artifacts** across a hardware matrix. The
[Measurement Matrix](../SCIENTIFIC-MATRICES.md#3-measurement-matrix) marks render
frame time and IPC round-trip as **L2** ("harness-ready"), not L3.

**What would need to be built or measured.** A capture harness that records the
existing telemetry to `bench/results/` on a defined set of machines, a fixed
interaction script, and reported percentiles per device class. This moves renderer
metrics **L2 → L3** the moment the artifacts exist. Backend measurement is already
**L3** on a single 2-vCPU container (`environment.json`); a multi-machine matrix would
strengthen it similarly.

---

## 4. Alerting, distributed tracing, and capacity signals (Day-2 observability)

**Research question.** Can operational incidents be detected and diagnosed
automatically from the signals the platform already emits?

**What exists today.**
- Aggregate Prometheus metrics — `/metrics` (**L3**), structured `pino` logs, honest
  `/health` degradation (**L2**), append-only `audit_log`
  (`0001_init.sql:50`, **L2**).
- **Provenance** traces — `main/trace/traceBuilders.ts` builds Context, Governance,
  and Relationship traces (**L2**). Note: this is *evidence-trail* provenance over the
  domain graph, **not** distributed request tracing.

**What does not exist.** No alert routing, **no distributed (request) tracing**, and
no capacity-forecasting baseline. This is a documented Day-2 absence (TD-6 in
[`ENTERPRISE-GA-REPORT.md`](../../../ENTERPRISE-GA-REPORT.md); PR-6 "slow incident
response").

**What would need to be built or measured.** Alert rules over the existing `/metrics`
series (the signals to alert on already exist); a distributed-tracing layer
(e.g. OpenTelemetry spans) threaded through the backend request path and the IPC
pipeline; and the capacity baseline of §1. Each is additive over real signals — the
research is in defining thresholds and evaluating detection quality (precision/recall
on real incidents), not in inventing new telemetry.

---

## 5. Formal verification opportunities

**Research question.** Which platform invariants are strong enough to state formally,
and could be *proven* rather than only tested?

**What exists today (as testable invariants, not proofs).**
- **Fail-closed channel classification** — `assertAllChannelsClassified(...)` in
  `runtimeAuthz.ts` is a startup invariant: a privileged channel with no
  classification cannot ship ungated (**L2/L4** by test).
- **Contract totality** — every IPC channel has a Zod schema (`contracts.ts`); the
  secure-bridge pipeline validates all inbound payloads (**L2**).
- **Migration idempotency** — forward-only migrations, re-run applies zero new
  (`bench/results/reliability.json`, **L4** by executed run).
- **RBAC coverage** — every privileged runtime channel maps to an existing scope
  (`RUNTIME_CHANNEL_PERMISSIONS`).

**What does not exist.** No machine-checked proofs of any kind. The honesty rule is
absolute: the NSSP **never claims a proof**. These are strong *tested* invariants, not
*proven* theorems.

**What would need to be built or measured.** A formal statement of a chosen invariant
(e.g. "no privileged channel is reachable without its scope"), a model or type-level
encoding, and a checker producing a verifiable artifact. Only a recorded checker
output could raise such a claim above "tested" — and even then it would be reported as
*verified against model X*, never as an unqualified proof.

---

## 6. Closing the known security open-items

**Research question.** What is required to close the two HIGH open items and harden
the deliberate fail-open behaviors, with evidence?

**What exists today.** Strong controls (**L2/L4**): RBAC fail-closed IPC gate,
backend-brokered PKCE/RFC 8252, refresh rotation + reuse detection (SHA-256), Argon2id
(memoryCost 19456, timeCost 2, parallelism 1), Keychain `safeStorage`, tested SSRF
guard, Ed25519 manifest signing, append-only audit, **0 production vulnerabilities**.

**Open items (stated honestly, from the GA report).**

| ID | Item | Where | Severity |
|---|---|---|---|
| TD-1 | Apple `id_token` decoded but **not** JWKS-verified | `apps/backend/src/auth/providers/apple.ts` | High |
| TD-2 | Marketplace app install skips signature check when artifact is unsigned + trust store empty | `apps/desktop/src/main/nps/packageService.ts:184` | High |
| TD-3 | Rate limiter fails open on Redis loss (deliberate availability choice) | `apps/backend/src/middleware/rateLimit.ts:37` | Medium |

**What would need to be built or measured.**
- **TD-1** — verify the Apple `id_token` signature against Apple's JWKS before
  trusting claims; the seam and an explicit `HARDENING TODO` already exist in
  `apple.ts`. Other providers use authenticated userinfo/Graph and are unaffected.
- **TD-2** — require a valid signature (or a non-empty publisher trust store) to
  install; the integrity hash is *always* checked already, and the worker-package
  path is already fail-closed.
- **TD-3** — keep the deliberate fail-open, but make it **alertable** (ties to §4);
  auth is still required during a Redis outage.

None of these is a design flaw; they are finishing items. Each closes with a code
change **plus** a test that becomes the L4 evidence — not with a claim.

---

## 7. Validation-surface gaps (not yet covered)

**Research question.** Can the coverage of the validation program be extended to the
surfaces it does not yet reach?

**What exists today.** 3,856 automated tests / 442 files; static gates; reliability
runs (5 PASS, 1 PARTIAL); deployment validation (`kubernetes-validate`, `shellcheck`)
— all **L4** ([Validation Matrix](../SCIENTIFIC-MATRICES.md#4-validation-matrix)).

**What does not exist (honest, per matrix + GA report).**
- Per-PR desktop CI and macOS release automation (**TD-4**).
- Renderer component / E2E / accessibility tests; coverage instrumentation
  (**TD-7**).
- Update rollback is advisory-only; federation DR is modeled (**TD-5** / **L1**).

**What would need to be built or measured.** A desktop CI job running
typecheck + lint + the 3,548 desktop tests per PR; a renderer interaction/E2E/a11y
suite with recorded coverage; and promotion of rollback from advisory to an automated,
tested path. Each converts a currently-uncovered surface into new **L4** evidence.

---

## 8. How items graduate off this roadmap

An item leaves this document only by climbing the ladder with evidence — never by
assertion:

1. **L0 → L1** — a tested type/model exists (cite the type file).
2. **L1 → L2** — it is wired and runs (cite the source; a lens is the cheapest path,
   per the [Engineering Handbook](./ENGINEERING-HANDBOOK.md)).
3. **L2 → L3** — it emits recorded measurements (cite `bench/results/` or a metric
   series).
4. **L3 → L4** — an executed test/gate/reliability run verifies it (cite the run).

When an item reaches the level its research question demanded, it moves into the
relevant framework at that evidence level, and this roadmap is updated to drop it.
Until then, it stays here — unbuilt, and honestly labelled.
