# NeuroPause PERG — Innovation Management: Research Intake, Experiment & Prototype Governance

> **Governance, not engineering; a lifecycle, not a result.** This is the PERG
> **innovation-management** layer: how a research idea or hypothesis becomes
> committed evidence — an intake gate, an experiment workflow, a prototype
> lifecycle, and the validation gates a prototype must clear to earn a roadmap
> slot. It **adds no runtime and no architecture**; it drives only surfaces and
> harnesses that already exist.
>
> **BANNER — no research has been performed.** No paper, DOI, venue, peer review,
> experiment, or result exists or is claimed anywhere in this document. Every seed
> below is an **honest open question** carried, unbuilt, from the NSSP research
> roadmap; every form is a **blank instrument**, never a filled record. Nothing
> here is marked done, measured, or proven that is not truly so.
>
> **Elevates, does not restate.** It builds on the NSSP
> [`RESEARCH-ROADMAP.md`](../science/manuals/RESEARCH-ROADMAP.md) (the L0 open
> questions), [`REPLICATION.md`](../science/frameworks/REPLICATION.md) (the harness
> contract + artifact discipline), and CDEP
> [`RESEARCH-VALIDATION.md`](../pilots/RESEARCH-VALIDATION.md) (field-evidence
> honesty gates). Grounding: [`_grounding.md`](./_grounding.md).

Every item carries one evidence label — **Implemented** (runs today, cite file) ·
**Validated** (verified by tests/gates/benchmarks) · **Proposed** (committed,
near-term) · **Future Vision** (aspirational, uncommitted) — mapped to the NSSP
ladder **L4 Validated · L3 Measured · L2 Implemented · L1 Modeled · L0 Proposed**.

---

## 0. What this governs, and where the boundary is

Innovation management is the **front door to the roadmap for ideas that are not yet
evidence.** It owns the pipeline _before_ a capability is real, and hands off to
other PERG frameworks the moment a prototype graduates.

| Layer                                      | Owner                                              | Innovation management adds                                                |
| ------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------- |
| The open research questions (L0)           | NSSP `RESEARCH-ROADMAP.md`                         | the **intake gate** that admits/rejects them as governed work             |
| The measurement harnesses + artifact rules | NSSP `REPLICATION.md`                              | the **experiment workflow** that runs them time-boxed with kill criteria  |
| Field re-measurement + honesty gates       | CDEP `RESEARCH-VALIDATION.md`                      | the **prototype→graduation gates** that reuse those honesty rules         |
| Ranking a graduated candidate              | PERG prioritization framework (`P=(E×I×R)÷Effort`) | the **hand-off**: a graduate enters as **Proposed**, then is scored there |
| Architecture fit of any new seam           | Architecture Review Board (ARB)                    | the **reuse-only gate** that routes new-architecture ideas to the ARB     |

**Distinct from product-evolution intake.** CDEP `PRODUCT-EVOLUTION.md` intakes
_enhancements_ driven by pilot evidence and ranks them. This document intakes
_research hypotheses_ — the "does this work, and what evidence would prove it?"
questions — and never ranks or ships them; it only moves them up the evidence ladder
or kills them. A graduate is _handed_ to prioritization, not prioritized here.

**Governance roles (roles, never people).** **Research Steward** — owns the intake
queue and seed register. **Experiment Owner** — a rotating role running one time-boxed
experiment. **ARB** — guards the reuse-only gate. **Evidence Reviewer** (QA) — guards
the honesty gate. No idea is admitted, run, or graduated by assertion; each step
produces a recorded artifact or a recorded kill.

---

## 1. Research intake

An idea enters here or nowhere. Intake is **blank by design** and **admissible only
with a cited real surface** — a hypothesis with no existing seam to test it against
is returned, not queued.

### 1.1 The four admissibility fields

Every intake row must answer four questions; a missing answer is inadmissible.

| Field                         | Question it answers                                 | Admissibility rule                                                                                                                                    |
| ----------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Problem**                   | What real gap or open question is this?             | Must trace to a roadmap §, a debt ID (`TD-n`), or a risk ID (`PR-n`) — not an invented demand.                                                        |
| **Hypothesis**                | What do we believe is true, testably?               | Must be falsifiable by a harness/test, stated as a claim, not a feature wish.                                                                         |
| **Evidence-it-would-produce** | Which committed artifact/test proves or refutes it? | Must name a target under `bench/results/*.json` or a test file, and the **ladder rung** it would reach (e.g. L2→L3). No artifact path ⇒ inadmissible. |
| **Reuse-check**               | Which existing surface does it reuse?               | Must cite a real engine/harness/signal it drives. **Must not duplicate architecture** (§1.2).                                                         |

### 1.2 The reuse-check (the load-bearing gate)

PERG **adds no architecture.** The reuse-check has exactly three outcomes:

1. **Reuses an existing seam** → admissible. The idea drives a real deterministic
   engine, harness, or telemetry series already in-tree (cite it).
2. **Requires net-new architecture** → **not prototyped here.** Admitted only as a
   **Future Vision** research question and routed to the **ARB / RFC** process, with
   an explicit justification of why no existing seam suffices. It may not enter the
   product as a prototype until architecture stewardship clears it.
3. **Duplicates an existing capability** → **rejected.** The capability already
   exists; cite it and close the row. (Example: "add request-scoped provenance" —
   `main/trace/traceBuilders.ts` already builds Context/Governance/Relationship
   traces at **L2**; that is evidence-trail provenance, not the proposed item.)

### 1.3 Blank intake form

Copy one block per idea. Fill from real surfaces; leave truly-unknown fields blank
rather than estimating. **Never pre-fill an outcome.**

```
Research Intake ID:   RI-____                 (assigned by the Research Steward)
Date logged:          ____-__-__
Problem:              ________________________________________________
                      (the open question; cite roadmap § / TD-n / PR-n)
Hypothesis:           ________________________________________________
                      (a falsifiable claim, not a feature)
Current surface:      ________________________________________________
                      (the REAL seam this drives — cite file — and its L-level)
Evidence it would     artifact: bench/results/____.json  |  test: ____
  produce:            target ladder move:  L_ → L_        (never skip a rung)
Reuse-check:          reuses: ____  | new-architecture? [ Y → ARB/RFC | N ]
                      duplicates existing? [ Y → REJECT, cite: ____ | N ]
Label:                [ Proposed | Future Vision ]        (2.x ⇒ Future Vision)
Steward decision:     [ admit → experiment | ARB/RFC | reject ]   date: ____
```

### 1.4 Seeded intake — the real NSSP open questions (honestly labelled)

The queue is seeded **only** with real research opportunities carried from the NSSP
roadmap. Each is unbuilt; the label is the honest claim. Where an item's
_engineering_ half is a governed debt ID, innovation management owns only the open
**question** and hands the build to the debt-remediation workflow — it does not
re-govern the TD.

| ID    | Research question (roadmap ref)                                                                                                       | Current surface (real, cited)                                                                                                                             | Level     | Evidence it would produce                                                                | Label             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------- | ----------------- |
| RI-S1 | Can workload/capacity/KPIs be **statistically forecast** from recorded history with validated accuracy? (§1)                          | measured series `bench/results/*.json`, `/metrics`; KPI compute `enterprise/intelligence/enterpriseKpi.ts` (**L2**) — **no forecasting engine exists**    | **L0**    | a hold-out accuracy artifact (MAPE/MAE) before any accuracy is stated                    | **Future Vision** |
| RI-S2 | Can a **learned** layer over the _deterministic_ capacity/decision models produce validated recommendations? (§2)                     | `capacityScheduler.ts` (wired `executiveCenterSubsystem.ts:220`), `enterpriseDecisionEngine.ts` (`:238`) — deterministic (**L1/L2**), not predictors      | **L0**    | recommendations vs. realized outcomes, recorded                                          | **Future Vision** |
| RI-S3 | How does the **desktop tier** perform across real end-user **hardware** (frame time, IPC, memory)? (§3)                               | renderer telemetry `perfMetrics.ts`, `lib/perf/perfRecorder.ts`, `state/PerfSampler.tsx` — **harness-ready, not captured** (**L2**)                       | **L2→L3** | percentiles per device class → `bench/results/` (moves L2→L3)                            | **Proposed**      |
| RI-S4 | Can incidents be **detected/diagnosed** automatically from signals already emitted? (§4)                                              | `/metrics` (**L3**), `pino`, `/health` (**L2**), `audit_log` (`0001_init.sql:50`) — **no alert routing / no request tracing** (TD-6)                      | **L2**    | alert-rule wiring + burn-rate firing (engineering half = TD-6)                           | **Proposed**      |
| RI-S5 | What **detection quality** (precision/recall on real incidents) do those thresholds achieve, and does OTel request tracing help? (§4) | same signals; distributed request tracing does **not** exist (provenance traces are not request traces)                                                   | **L0**    | a precision/recall evaluation over real incidents                                        | **Future Vision** |
| RI-S6 | Which IPC/RBAC invariant is strong enough to be **formally verified**, not only tested? (§5)                                          | `assertAllChannelsClassified(...)` in `runtimeAuthz.ts`, Zod `contracts.ts`, `RUNTIME_CHANNEL_PERMISSIONS` — **tested, never proven** (**L2/L4 by test**) | **L0**    | a machine-checked checker artifact — reported "verified vs. model X", **never** "proven" | **Future Vision** |
| RI-S7 | Can the reference floor be **replicated off the single reference topology**? (REPLICATION §11)                                        | one 2-vCPU reference container `environment.json`; CDEP `RESEARCH-VALIDATION.md` re-runs harnesses on customer hardware                                   | **L0**    | first committed `field/*.json` deltas (field-L3, one site ≠ independent)                 | **Future Vision** |
| RI-S8 | Can the **validation surface** reach renderer E2E/a11y + coverage it does not yet cover? (§7)                                         | 3,856 tests / 442 files; no renderer E2E/a11y, no coverage instrument (TD-7)                                                                              | **L2**    | executed E2E/a11y suites + recorded coverage (engineering half = TD-7)                   | **Proposed**      |

**RI-S3/S4/S8** are **Proposed** (near-term; build half governed as a real TD);
**RI-S1/S2/S5/S6/S7** are **Future Vision** (genuine L0 — no engine, no proof, no
timeline). None is claimed done.

---

## 2. Experiment workflow

Design → run → measure → decide. An experiment is **time-boxed** and carries **kill
criteria** from the start, so it ends in evidence or a recorded kill — never open-ended.

### 2.1 The four phases

| Phase       | Gate to proceed                                                                         | Produces                                                                         |
| ----------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Design**  | admitted intake row (§1); harness + artifact path named; time-box + kill criteria fixed | an experiment record (§2.4), result fields blank                                 |
| **Run**     | drives a **real** harness only (§2.2); parameters locked                                | an executed run against the existing surface                                     |
| **Measure** | records a committed artifact under `bench/results/` (or `field/`)                       | a self-describing JSON artifact + its caveats                                    |
| **Decide**  | compare artifact to hypothesis                                                          | **advance** (→ prototype §3), **iterate** (once, within box), or **kill** (§2.3) |

### 2.2 Measure with the real harnesses (invent none)

An experiment **reuses the NSSP harness contract** — _warm up → fixed sample →
report percentiles_ (`REPLICATION.md` §3) — and the artifact discipline (committed,
self-describing JSON with params + `note`/caveats; `REPLICATION.md` §7) — inventing
no apparatus the platform does not already ship.

| Surface under test        | Real harness (reuse, do not rebuild)                                            | Recorded to                    |
| ------------------------- | ------------------------------------------------------------------------------- | ------------------------------ |
| Backend HTTP behavior     | `bench/http-load.mjs` (conc 32 / 3,000 reqs / 300 warmup)                       | `bench/results/http-load.json` |
| DB query shapes           | `bench/db-latency.mjs` (2,000 iters/shape)                                      | `db-latency.json`              |
| Cold/warm start           | `bench/startup.sh`                                                              | `startup.json`                 |
| Desktop engine hot paths  | `apps/desktop/src/main/__bench__/performance.test.ts` (N=5000, 2,000 ms budget) | `intelligence-engines.json`    |
| Off-reference replication | the same harnesses, unmodified, on customer hardware (CDEP §1.2)                | committed `field/*.json`       |

If a hypothesis needs a harness that does **not** exist (a renderer hardware-matrix
capture for RI-S3, a formal checker for RI-S6), **building that harness is itself the
experiment's deliverable** — subject to the reuse-only gate: extend the existing
telemetry, never replace it.

### 2.3 Time-box and kill criteria

| Control                     | Rule                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| Time-box                    | fixed at Design; a spike is short, a prototype experiment longer; **no open-ended runs**    |
| Iterate-once                | one design revision inside the box is allowed; a second miss is a kill, not a third attempt |
| **Kill — no movement**      | the time-box elapsed with **no measurable ladder movement** (no artifact, no rung climbed)  |
| **Kill — new architecture** | it cannot be tested without net-new architecture → route to ARB/RFC, close the experiment   |
| **Kill — duplication**      | it duplicates an existing capability discovered mid-run (cite it)                           |
| **Kill — no artifact**      | it cannot produce a committed artifact → it can prove nothing → kill                        |
| **Kill — honesty**          | any result would have to be stated above its evidence level → kill, do not soften           |

A kill is a **success of the process**: the learning is recorded (§4.2) and the
intake row is closed with its reason. No killed experiment leaves a lingering claim.

### 2.4 Blank experiment record

Mirrors the REPLICATION artifact shape and the CDEP delta record. **Result fields
are blank until a real run fills them** — never pre-populated.

```
Experiment ID:     EXP-____   (from Intake RI-____)     Owner role: Experiment Owner
Hypothesis:        ________________________________________________
Harness (real):    [ http-load | db-latency | startup | engines | field | new→ARB ]
Artifact target:   bench/results/____.json   |   field/____.json
Locked params:     ________________________  (per REPLICATION §3 / CDEP §3.1 — do not vary)
Time-box:          start ____-__-__   end ____-__-__     Kill criteria: §2.3 [list]
--- filled only at run time ---
Result artifact:   ____   (committed path; errors=____; caveats carried Y/N)
Ladder move:       L_ → L_   (evidence reached)   or   none
Decision:          [ advance→prototype | iterate(once) | KILL: reason ____ ]
```

---

## 3. Prototype lifecycle

A surviving experiment becomes a prototype and moves through three honest stages —
**spike → prototype → productionize-or-retire**. Stage is a function of evidence
level, never of intent.

### 3.1 The stages

| Stage             | Meaning                                                          | Evidence label                       | May be described as                            |
| ----------------- | ---------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------- |
| **Spike**         | throwaway probe to learn feasibility; not wired into the product | **Future Vision / Proposed** (L0/L1) | "explored"; **never** "built"                  |
| **Prototype**     | wired and runnable behind a flag/seam; not verified              | **Implemented** (L2), cite file      | "implemented, unverified"; **never** "shipped" |
| **Productionize** | tests/gates/artifacts make it real                               | **Validated** (L3/L4), cite run      | "validated", with its anchor                   |
| **Retire**        | killed at any stage; learning recorded                           | —                                    | "retired; here is what we learned"             |

### 3.2 How a prototype earns a roadmap slot

A prototype does **not** get a roadmap slot by existing. It earns one by **passing
the graduation gates (§4)**, after which:

1. It enters the roadmap as a **Proposed** candidate (never as a delivered feature).
2. It is ranked by the **PERG prioritization framework** — the `P=(E×I×R)÷Effort`
   rubric elevated from CDEP `PRODUCT-EVOLUTION.md` — **there, not here** (no
   restatement of the rubric).
3. It is sequenced into the **roadmap dependency waves** (`GOVERNANCE-MATRICES.md`
   §4), respecting real dependencies. Until it passes the gates it stays here —
   flagged, honestly labelled, **off** the roadmap.

### 3.3 A prototype must not ship fabricated capability

| Rule                       | Enforcement                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| No stage-inflation         | a flagged prototype is **Implemented, not Validated**; it is never announced as GA, shipped, or delivered                           |
| No claim above evidence    | a capability is described only at its cited ladder rung; a spike with no artifact yields **no** claim                               |
| No fabricated proof/metric | no "proven" for a tested invariant (RI-S6); no accuracy number without a hold-out artifact (RI-S1); no customer, no adoption figure |
| Flag ≠ feature             | a capability behind a flag is not on the feature list, the changelog "Added" section, or any readiness matrix as done               |

---

## 4. Validation gates

The gate wall a prototype clears to **graduate** (leave this document as a Proposed
roadmap candidate). All gates are blocking; a failed gate returns the prototype to
intake or to a kill.

### 4.1 Graduation gate table

| Gate                               | Requirement                                                                                                                                                                                                      | Passes when                                                                      | Owner role        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------- |
| **G1 — Evidence label**            | must reach **at least Implemented with executed tests** — wired (L2, cite file) **and** guarded by a passing test (toward L4), climbing the ladder one rung at a time (roadmap §8)                               | a cited source file **and** a green test/gate exist                              | Evidence Reviewer |
| **G2 — Honesty / no-fabrication**  | no result stated above its evidence level; caveats carried intact (co-located-client note; `offline-bundle` PARTIAL; "tested" not "proven"); no fabricated metric, customer, or claim (elevates CDEP §4.3 G1–G5) | reviewer confirms every claim traces to a committed artifact at its stated level | Evidence Reviewer |
| **G3 — Reuse-only**                | reuses an existing surface/harness/signal; **adds no architecture**; any new seam is ARB-approved via RFC                                                                                                        | ARB confirms no un-reviewed architecture was introduced                          | ARB               |
| **G4 — Artifact committed**        | evidence lives **in-tree with the code it measures** (`REPLICATION.md` §9); artifact is self-describing (params + caveats)                                                                                       | the `bench/results/` (or `field/`) artifact is committed, not described in prose | Research Steward  |
| **G5 — Kill-or-graduate recorded** | either graduation is recorded with its evidence, **or** a kill is recorded with its learning                                                                                                                     | the intake/experiment record is closed with an outcome                           | Research Steward  |

**Graduation rule:** all five PASS ⇒ the prototype exits as **Proposed**, handed to
prioritization (§3.2). Any FAIL ⇒ **not graduated** — iterate once, route to ARB, or
kill. No partial graduation, no waiver.

### 4.2 Blank graduation record

```
Graduation record for:  RI-____ / EXP-____            Date: ____-__-__
G1 Evidence label:      [ PASS | FAIL ]  reached L_  source: ____  test: ____
G2 Honesty gate:        [ PASS | FAIL ]  claims ≤ evidence level? __  caveats carried? __
G3 Reuse-only gate:     [ PASS | FAIL ]  reuses: ____   new arch? [ N | Y→ARB ref ____ ]
G4 Artifact committed:  [ PASS | FAIL ]  path: bench/results/____.json  self-describing? __
G5 Outcome recorded:    [ GRADUATE→Proposed | KILL: learning ____ ]
Result:                 [ graduated → prioritization (§3.2) | returned | killed ]
```

### 4.3 Seeded graduation status (honest: nothing has graduated)

Applying the gates today — all seeds are pre-experiment; **none has graduated, none
is claimed done.**

| Seeds                                                              | At which gate     | Why not yet through                                                                          |
| ------------------------------------------------------------------ | ----------------- | -------------------------------------------------------------------------------------------- |
| RI-S1, RI-S2, RI-S5 (statistical prediction, detection science)    | **before G1**     | L0 — no engine/evaluation exists; no artifact to review — **Future Vision**                  |
| RI-S6 (formal verification)                                        | **blocked at G2** | a proof claim fails the honesty gate; only a checker artifact could pass — **Future Vision** |
| RI-S3, RI-S4, RI-S8 (hardware bench, alerting, validation surface) | **before G1**     | harness/signals exist (L2/L3) but no captured artifact or suite yet — **Proposed**           |
| RI-S7 (cross-env replication)                                      | **before G4**     | no committed `field/*.json` until a real pilot runs (CDEP) — **Future Vision**               |

---

## Reading note

Innovation management is the governed **front door to the roadmap** for work that is
not yet evidence: an idea proves itself by climbing the NSSP ladder through a
time-boxed experiment on a **real** harness, or it is killed and the learning kept. It
produces **no results of its own** and never describes a capability above the rung its
artifact supports. The seeds are the real NSSP open questions — **Future Vision** for
statistical prediction and formal verification, **Proposed** for hardware benchmarks
and alerting — each unbuilt, honestly labelled, and none graduated. A prototype earns
a roadmap slot only through the gate wall; until then it stays here, off the roadmap.
