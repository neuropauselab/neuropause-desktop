# NeuroPause CDEP — Product Evolution: Evidence-Based Intake, Prioritization & Roadmap

> **What this is.** The CDEP **product-evolution loop**: how a signal from a real
> pilot becomes a ranked, evidence-backed proposal and a recorded decision. It is
> **execution, not engineering** — an intake form, a scoring rubric, a Now/Next/Later
> mapping, and an ADR template, layered over the **real** open-item backlog. It
> **adds no runtime and no platform.**
>
> **Extends, does not restate.** The improvement **backlog is owned by** EOSP
> [`CONTINUOUS-IMPROVEMENT.md §2`](../operations/CONTINUOUS-IMPROVEMENT.md) — the
> **real** open items, their severities, and their dependency waves. This document
> does **not** re-derive them; it adds the CDEP **evidence-scoring lens**, the
> horizon mapping, and the **pilot-evidence intake** that will grow the backlog.
> The "done" bar for any item is the **green-in-CI gate wall** owned by
> [`DEVELOPER-OPERATIONS.md §4`](../operations/DEVELOPER-OPERATIONS.md) — referenced,
> not repeated.
>
> **Honesty banner (non-negotiable).** **No pilot has run.** Therefore the only
> populated backlog is the **seven real internal open items**; every customer-driven
> slot in this document is a **blank awaiting a real pilot evidence artifact.** There
> is **no fabricated demand, no invented feature, no customer request count, and no
> usage data.** Rubric scores are **ordinal judgments from cited evidence, not
> measurements.** Roles, never people.

---

## 1. Enhancement intake

Every proposal enters here. Intake is **blank by design** — it is filled during a
real pilot, never pre-populated with invented demand. An entry is **inadmissible
without a real evidence link** (see admissibility rule) and is returned to the
submitter rather than scored.

### 1.1 Intake sources (where a row comes from)

Intake **feeds from** the CDEP feedback instruments (Matrix 4,
[`PILOT-MATRICES.md`](PILOT-MATRICES.md)) and the EOSP engineering intake — three
channels, no others:

| Source tag           | Instrument (real)                                               | Produces                                                                       |
| -------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **pilot interview**  | `CUSTOMER-FEEDBACK.md` structured guides                        | qualitative signal from a real pilot participant (persona, not a named person) |
| **issue / defect**   | `.github/ISSUE_TEMPLATE/` → EOSP `DEVELOPER-OPERATIONS.md §1`   | a filed `bug_report` / `feature_request`, triaged                              |
| **RCA / postmortem** | `OPERATIONAL-LEARNING.md` + EOSP `CONTINUOUS-IMPROVEMENT.md §4` | a blameless-postmortem action item                                             |

### 1.2 Blank intake form

Copy one block per enhancement. Every field is filled from a real artifact at pilot
time; leave truly-unknown fields blank rather than estimating.

```
Intake ID:            EVO-____              (assigned at triage)
Date logged:          ____-__-__
Source:               [ pilot interview | issue/defect | RCA/postmortem ]
Problem statement:    ________________________________________________
                      (the observed problem, not a proposed solution)
Evidence link:        ________________________________________________
                      (REQUIRED — a real artifact: bench JSON, reliability
                       pass/fail, audit_log export, interview record, or a
                       risk-register entry. No link ⇒ inadmissible.)
Affected segment:     ________________________________________________
                      (persona / vertical segment only — never a named customer)
Observed frequency N: ____   (count from real pilot records ONLY; blank if none —
                             never estimated, never projected)
Requested-by role:    ____   (role, not person)
Proposed by:          ____   (deployment lead | SRE | sponsor — role)
Routed to backlog:    [ EOSP CONTINUOUS-IMPROVEMENT §2  |  new customer-driven slot ]
Rubric pre-score:     E:__  I:__  R:__  Effort:__   (filled in §2 at prioritization)
```

### 1.3 Admissibility rule (the anti-fabrication gate)

- **No evidence link ⇒ not admissible.** A proposal with no artifact is a hunch; it
  is logged as `needs-evidence` and returned, not scored. This is the mechanism that
  keeps invented demand out of the roadmap.
- **Frequency N is a count, never an estimate.** Until a pilot supplies a real count,
  `N` stays blank. A blank `N` caps the evidence score (§2) — it does not fabricate one.
- **Segment, not customer.** Affected-segment is a persona; a named customer, logo, or
  site is never recorded (`_grounding.md` rule 1).

### 1.4 Illustrative fill — _illustrative only, not a real pilot_

To show the mechanics **without inventing customer demand**, the one example below is
sourced from the **real risk register** (an internal item), not a customer request:

```
Intake ID:            EVO-0001  (illustrative)
Source:               RCA/postmortem
Problem statement:    Rate limiter fails open on Redis loss with no operator signal.
Evidence link:        risk register TD-3 / Val §9(3)  (real, cited)
Affected segment:     all deployments running the backend rate limiter
Observed frequency N: (blank — no pilot has observed it; the behaviour is deliberate)
Routed to backlog:    EOSP CONTINUOUS-IMPROVEMENT §2 — folds into item #7 (alerting)
```

> This is a **real** open item (fail-open is deliberate — surface as an _alert_, not a
> "fix"; `CONTINUOUS-IMPROVEMENT.md §2` secondary table). It demonstrates intake with
> **zero invented demand**.

---

## 2. Prioritization

The rubric ranks admitted proposals by **real evidence** — not by loudest request.
It re-scores the **same** open items EOSP already owns; it does not invent a parallel
backlog.

### 2.1 The four factors (defined anchors)

Each factor is scored on a defined ordinal anchor set. **Evidence tier 5 is reserved
for a pilot evidence artifact that does not exist yet** — so an internal risk-register
item tops out at **E = 4**. That single rule makes "evidence-based" literal: only a
real pilot can earn the top evidence score.

| Factor                          | Question                                                     | Anchors (cite the evidence for each score)                                                                                                                                                                                                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E — Evidence strength** (1–5) | How real / strong is the evidence this is a genuine problem? | **5** = a **pilot evidence artifact** confirms it (none today). **4** = named **HIGH** in the real risk register (`GA §8`, `_grounding.md`). **3** = a **GA-gating validation gap** ranked highest-leverage (`Val §10`). **2** = named **MEDIUM** / disclosed gap. **1** = secondary/also-tracked real item. **0** = no cited artifact → inadmissible (§1.3). |
| **I — Impact** (1–5)            | Blast radius if left unaddressed.                            | **5** = every deployment, security-exposure / data-loss class. **4** = every deployment, trust/quality or botched-recovery class. **3** = a broad path (desktop/macOS releases; observability). **2** = a narrow path. **1** = cosmetic.                                                                                                                      |
| **R — Risk-reduction** (1–5)    | How much a **named** risk / maturity blocker is retired.     | **5** = closes a strict **GA blocker** (`CONTINUOUS-IMPROVEMENT §1` Security open-HIGH). **4** = clears a GA-gating validation gap (`Val §10` exit bar). **3** = removes a §1 domain blocker (Release/Ops → Defined). **2** = partial — a real mitigation already exists. **1** = marginal.                                                                   |
| **Effort** (1–5, **divisor**)   | Relative implementation cost.                                | **1** = localized (config / one seam). **2** = one subsystem, established pattern. **3** = one subsystem, new capability. **4** = new infra or scarce resource (mac runner, tracing stack). **5** = large / multi-part.                                                                                                                                       |

### 2.2 The formula

```
Priority  P  =  (E × I × R) ÷ Effort
```

Higher `P` = do sooner. `P` is a **ranking device**, not a metric — ties break by the
**EOSP dependency wave** (`CONTINUOUS-IMPROVEMENT §2`), never by preference. A
customer-driven proposal enters this table **only** once a pilot gives it `E ≥ 1`
from a real artifact; until then it is not scored.

### 2.3 Worked ranking — the REAL seeded backlog (no invented items)

The seven rows below are the **actual** open items from `CONTINUOUS-IMPROVEMENT.md §2`,
re-scored by this rubric. Nothing is added or invented.

| #     | Open item (real)                         |  E  |  I  |  R  | Eff |  **P**   | Evidence cited                                                             |
| ----- | ---------------------------------------- | :-: | :-: | :-: | :-: | :------: | -------------------------------------------------------------------------- |
| **1** | Apple `id_token` **JWKS verification**   |  4  |  5  |  5  |  2  | **50.0** | HIGH — `GA §8 TD-1`, `Val §9(1)`, risk register                            |
| **2** | **Signed / trusted** marketplace install |  4  |  5  |  5  |  3  | **33.3** | HIGH — `GA §8 TD-2`, `Val §9(2)`, risk register                            |
| **3** | **Target-hardware** desktop benchmarks   |  3  |  3  |  4  |  3  | **12.0** | GA-gating gap, highest-leverage — `Val §10`, `GA §8(6)`                    |
| **4** | **Per-PR desktop CI**                    |  2  |  3  |  3  |  2  | **9.0**  | MEDIUM — `GA §8 TD-4`, `Val §9(9)`                                         |
| **6** | Automated, tested **update rollback**    |  2  |  4  |  2  |  3  | **5.3**  | MEDIUM — `GA §8 TD-5`; `R=2` (data-side restore already the real recovery) |
| **5** | **macOS release automation**             |  2  |  3  |  3  |  4  | **4.5**  | MEDIUM — `GA §8 TD-4`, `Val §9(9)`                                         |
| **7** | **Alerting + tracing + forecasting**     |  2  |  3  |  3  |  4  | **4.5**  | MEDIUM — `GA §8 TD-6`, `Val §9(11)`                                        |

**Ranking:** #1 → #2 → #3 → #4 → #6 → #5 ≈ #7. The #5/#7 tie (both 4.5) breaks by
wave: #5 is Wave 2, #7 is Wave 3, so **#5 precedes #7**.

### 2.4 Cross-check against the EOSP waves (reference, not restated)

The evidence-weighted ranking **independently reproduces** the EOSP dependency waves
(`CONTINUOUS-IMPROVEMENT.md §2`): Wave 1 `{#1,#2,#3}` are the top three; `#4` outranks
its dependents `{#5,#6}` (so the `#4 → {#5,#6}` constraint holds for free); Wave 3
`#7` lands last. Two independent methods agreeing is the cross-check. **Where they
would conflict, the EOSP dependency wave wins** — a lower-scored _prerequisite_ is
always sequenced before its dependents, regardless of `P`.

### 2.5 Re-scoring cadence

Scores are re-run on the EOSP review cadence (`CONTINUOUS-IMPROVEMENT.md §3`): the
**monthly** review re-ranks on new evidence; the **quarterly** reassessment audits
whether a closed item actually retired its named blocker. A **new pilot evidence
artifact** is the event that can raise an item's `E` toward 5 or admit a
customer-driven proposal for the first time.

---

## 3. Evidence-based roadmap (Now / Next / Later)

Horizons are populated **only** with the real open items, placed by their EOSP wave
and ordered within a horizon by `P` (§2.3). **Customer-driven rows are deliberately
blank** — they are unlocked one at a time by a real pilot evidence artifact. There is
no speculative or demand-driven entry anywhere below.

### Now — Wave 1 (GA blockers + highest-leverage validation)

| Item                              | `P`  | Why now (real)                                                           | Done bar                                                             |
| --------------------------------- | :--: | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| **#1 Apple JWKS verification**    | 50.0 | Strict GA blocker; HIGH auth-bypass exposure (`GA §8 TD-1`)              | Green in CI (`DEVELOPER-OPERATIONS §4`) + security-owner review      |
| **#2 Signed marketplace install** | 33.3 | Strict GA blocker; unsigned-package exposure (`GA §8 TD-2`)              | Green in CI + security-owner review                                  |
| **#3 Target-hardware benchmarks** | 12.0 | Highest-leverage validation gap (`Val §10`); every pilot's perf baseline | Harness (`§2.5`) run on Apple-Silicon vs live infra; result archived |
| _customer-driven slot_            |  —   | **blank — awaiting first pilot evidence artifact**                       | —                                                                    |

### Next — Wave 2 (release engineering; `#4` gates `#5`/`#6`)

| Item                             | `P` | Why next (real)                                                                             | Done bar                                          |
| -------------------------------- | :-: | ------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **#4 Per-PR desktop CI**         | 9.0 | Prerequisite: a green desktop gate makes #5/#6 trustworthy (`CONTINUOUS-IMPROVEMENT §2`)    | Desktop typecheck+lint+test workflow green per PR |
| **#6 Automated update rollback** | 5.3 | Promote advisory → automated; **data-side restore already the real recovery** (see ADR-001) | Automated rollback tested + green in CI           |
| **#5 macOS release automation**  | 4.5 | Packaging/signing/notarization in CI; mirror `windows-release.yml`                          | mac release job green; signing env-gated          |
| _customer-driven slot_           |  —  | **blank — awaiting first pilot evidence artifact**                                          | —                                                 |

### Later — Wave 3 (day-2 observability; not GA-gating)

| Item                                    | `P` | Why later (real)                                                                                                                           | Done bar                                         |
| --------------------------------------- | :-: | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| **#7 Alerting + tracing + forecasting** | 4.5 | Wires over the real `/metrics` substrate; removes manual-alert-watch toil (`CONTINUOUS-IMPROVEMENT §1`); folds in the TD-3 fail-open alert | Alert routing + tracing + forecast baseline live |
| _customer-driven slot_                  |  —  | **blank — awaiting first pilot evidence artifact**                                                                                         | —                                                |

> **Roadmap invariant.** Every populated row above is one of the seven real open
> items. Every customer-driven row is blank until a pilot produces the evidence
> artifact that admits it (§2.2). No demand, count, or feature has been invented.

---

## 4. Decision records (ADR)

Non-trivial evolution decisions are recorded as **ADRs** (Michael-Nygard format) so a
future reader knows _why_, on _what evidence_. ADRs are immutable once Accepted;
change is expressed by a **new** ADR that supersedes the old one.

### 4.1 ADR template (copy per decision)

```
# ADR-NNN: <short noun-phrase decision title>
Status:    [ Proposed | Accepted | Superseded by ADR-NNN | Deprecated ]
Date:      ____-__-__
Context:   Forces at play; the problem; the real constraints and evidence.
Decision:  The position taken, in one active-voice sentence + specifics.
Consequences:
  Positive:  what improves.
  Negative:  the accepted cost / trade-off.
  Neutral:   follow-on / when this ADR would be revisited.
Evidence:  real artifacts cited (report §, script, test, metric).      [CDEP field]
Related:   backlog item # / risk-register entry this decision touches.  [CDEP field]
```

The two trailing fields are the CDEP additions: an ADR with **no cited evidence** is
not accepted — the same admissibility discipline as intake (§1.3).

### 4.2 Worked example — ADR-001

```
# ADR-001: Adopt data-side restore as the sanctioned pilot rollback path
Status:  Accepted
Date:    2026-__-__

Context:
  Every pilot's entry/exit criteria (PILOT-FRAMEWORK.md) need a defined rollback
  path. Two mechanisms exist, at very different maturity:
   (a) Application-binary rollback after a bad update — ADVISORY ONLY / MODELED,
       not proven (DISASTER-RECOVERY-GUIDE.md §1 "MODELED"; RELIABILITY-RESULTS.md
       §2 note; GA §8 TD-5). Automating it is real backlog item #6 — not yet shipped.
   (b) Data-side restore — backend Postgres via scripts/backup-db.sh +
       restore-db.sh (pg_dump/pg_restore), and desktop BackupManager sha256
       snapshot/validate/restore with an automatic safety backup before every
       restore and auto-restore on failed migration (backupManager.ts). This path
       is PROVEN END-TO-END, row-for-row identical (RELIABILITY-RESULTS.md §2, PASS).

Decision:
  For all pilots, the sanctioned rollback path is DATA-SIDE RESTORE (backend pg
  restore + desktop BackupManager restore), executed per DISASTER-RECOVERY-GUIDE.md.
  Application-binary rollback is NOT relied upon in pilot rollback criteria until
  backlog item #6 (automated, tested rollback) ships and is green in CI. Pilot entry
  criteria MUST verify a fresh backup exists and a restore has been rehearsed before
  go-live.

Consequences:
  Positive:  Rollback rests on a proven, reproducible, row-for-row-verified
             mechanism; RTO/RPO can be quoted from real reliability evidence; the
             pilot aligns with the real DR guide instead of a modeled path.
  Negative:  Rollback is data-scoped, not binary-scoped — a bad app binary is
             replaced by redeploying a known-good version, not "rolled back"; every
             pilot runbook must carry a rehearsed backup/restore step; co-located
             backups do not cover host/disk loss (DR-guide caveat) — pilots must
             arrange an off-host backup copy.
  Neutral:   Revisit when item #6 ships; a future ADR-00N would then supersede this
             one and adopt the automated app-rollback path.

Evidence:  RELIABILITY-RESULTS.md §2 (backup/restore PASS, exact row-count);
           DISASTER-RECOVERY-GUIDE.md §1–2 (REAL data-side vs MODELED app-rollback);
           scripts/backup-db.sh, scripts/restore-db.sh; backupManager.ts
           (sha256 snapshot/restore, pre-restore safety backup, auto-restore-on-
           failed-migration).
Related:   backlog item #6 (automated rollback — GA §8 TD-5); risk PR-7 (botched
           update, no clean rollback — mitigated, not closed, by this decision).
```

> ADR-001 is grounded entirely in **real, proven** assets and one **real** open
> backlog item. It invents nothing; it records a decision _between two mechanisms
> that already exist_ at their honest maturity levels.

---

## Provenance & scope

- **Real (cited):** the seven open items, severities, and dependency waves
  (`CONTINUOUS-IMPROVEMENT.md §2`; `GA §8 TD-1…TD-6`, `PR-7`; `Val §9`, `§10`); the
  green-in-CI done bar (`DEVELOPER-OPERATIONS.md §4`); the proven backup/restore
  (`RELIABILITY-RESULTS.md §2`) and the REAL-vs-MODELED DR reality
  (`DISASTER-RECOVERY-GUIDE.md §1–2`); intake sources (`PILOT-MATRICES.md` Matrix 4;
  `CUSTOMER-FEEDBACK.md`, `OPERATIONAL-LEARNING.md`, `.github/ISSUE_TEMPLATE/`).
- **Defined (this document):** the intake form + admissibility rule, the
  E×I×R÷Effort rubric and its anchors, the Now/Next/Later horizon mapping, and the
  ADR template — **process over the real substrate; no runtime added.**
- **Blank / absent (honest):** every customer-driven roadmap slot (no pilot has run);
  every score above **E = 4** (reserved for a pilot evidence artifact); all frequency
  counts (`N`) until a real pilot supplies them. **No customer, demand, request count,
  usage figure, benchmark result, or invented feature appears anywhere.** The roadmap
  is seeded **only** with the real open items. Roles, never people.
