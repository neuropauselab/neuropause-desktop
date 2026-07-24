# NeuroPause PERG — Executive Governance: Portfolio, Roadmap, Investment & Decisions

> **What this is.** The executive-facing **product-governance** layer of the Product
> Evolution & Release Governance Program (PERG): a **portfolio dashboard** across the real
> programs, a **roadmap dashboard** over the governed dependency waves, an **investment
> framework** (a decision _method_ for allocating effort), and **executive decision
> records**. It defines _what a program owner sees across the whole portfolio, where each
> value comes from, and in what state it ships_. It adds **no runtime and no platform** —
> it is governance over the real backlog.
>
> **Build-on, not restate.** This document **extends** EOSP
> [`../operations/EXECUTIVE-OPERATIONS.md`](../operations/EXECUTIVE-OPERATIONS.md) — its exec
> dashboard tiles (§1), the **real GA risk register** (§4), and the decision-log / QBR cadence
> (§5) — and **reuses the blank-dashboard discipline** of CDEP
> [`../pilots/EXECUTIVE-EVIDENCE.md`](../pilots/EXECUTIVE-EVIDENCE.md). Those are the **internal
> fleet** view and the **per-pilot** view; PERG is the **whole-portfolio + roadmap + investment**
> view — a different altitude, a different job. The prioritization rubric `P=(E×I×R)÷Effort`
> is **owned by** CDEP [`../pilots/PRODUCT-EVOLUTION.md §2`](../pilots/PRODUCT-EVOLUTION.md); the
> dependency waves by [`GOVERNANCE-MATRICES.md §4`](GOVERNANCE-MATRICES.md); SLO/capacity math by
> `../operations/SRE.md`. All **referenced and applied, never re-derived**.
>
> **Anti-fabrication banner (non-negotiable).** Every dashboard here is a **SPECIFICATION** —
> widget = **definition + real source + BLANK current value + _proposed_ target**. **No widget is
> populated with a business number.** There is **no GA, no production fleet, no customer, and no
> pilot** ([`_grounding.md`](_grounding.md)): **no revenue, ARR, seat count, adoption, usage,
> velocity, story-point, or customer figure is asserted.** The **investment framework carries no
> budget, headcount, or monetary figure** — it is a sequencing method; "effort" is the ordinal
> Effort divisor and "priority" is the ordinal `P` ranking device, nothing else. The **portfolio
> is the real programs + the real backlog** — no initiative is invented. The **only real content
> admitted** is (a) the **portfolio inventory** (doc-suites that exist as files — audit fact), (b)
> the **real GA risk register** (EOSP §4), and (c) the **real rubric ranks** (CDEP §2.3) — all
> referenced, not fabricated. Platform maturity is a **Validated Release Candidate**
> (`1.0.0-rc.1`). **Roles, never people.**

**Legend.** `▢ blank` = to be filled by real closed work · `— (none yet)` = the empty set today
(honest) · `[ … ]` = fill-in placeholder · `_proposed_` = objective to ratify, never a claimed
result · evidence labels per [`_grounding.md`](_grounding.md): **Implemented · Validated ·
Proposed · Future Vision**.

---

## 1. Portfolio dashboard (specification)

**What a program owner opens across the whole portfolio.** A **new** board with no EOSP or CDEP
equivalent (EOSP tracks the internal fleet; CDEP tracks one pilot; this tracks the **whole program
portfolio + the governed backlog**). §1.1 is **real** (the doc-suites exist — audit fact, like the
EOSP §4 register); §1.2's **progress widgets ship blank**, and its real-fact widgets **reference**
the registers rather than inventing numbers.

### 1.1 Portfolio inventory (real — Validated RC platform + the seven program manuals)

Each row is a **delivered governance/evidence manual-suite** (a real file set, cited) or the
**product it governs**. **"Delivered" means the manual is authored and exists — not that the
product capabilities it describes are all shipped.** The platform remains a Validated RC; GA is
gated on the open registers (§4). Manuals govern; they add no runtime.

| Portfolio item                             | Delivered artifact (real, cited)                                                                            | Honest state                               | Governs / next step                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------- |
| **Platform core** (product)                | `1.0.0-rc.1`; **3,856 tests** green, build 0, `npm audit --omit=dev` **0** (`ENTERPRISE-GA-REPORT.md §2.1`) | **Validated RC**                           | RC→GA gate (§4 PERG-ADR-001)           |
| **GA** — GA Readiness                      | `ENTERPRISE-GA-REPORT.md` (RC assessment + TD-1…10 / PR-1…8 registers)                                      | **Delivered** (manual)                     | owns the debt/risk registers           |
| **EVP** — Enterprise Validation            | `ENTERPRISE-VALIDATION-REPORT.md` + `docs/validation/`                                                      | **Delivered** — Validated RC ~76/100       | perf/reliability/deploy evidence       |
| **NSSP** — Scientific Standards            | `docs/science/` manuals (measurement, validation, roadmap)                                                  | **Delivered** (manuals)                    | research + measurement standards       |
| **GEAP** — Ecosystem / Adoption            | `GOVERNANCE.md` + `docs/adoption/`                                                                          | **Delivered** (manuals)                    | RFC + community governance             |
| **EOSP** — Operations & Scale              | `docs/operations/` (SRE, exec dashboards §1/§4/§5)                                                          | **Delivered** (manuals)                    | fleet ops + risk register + QBR        |
| **CDEP** — Deployment & Evidence           | `docs/pilots/` (pilot framework, evidence dashboards)                                                       | **Delivered** (manuals) — **0 pilots run** | per-pilot evidence loop                |
| **PERG** — Product Evolution & Release Gov | `docs/governance/` (`GOVERNANCE-MATRICES.md` done; **this report**)                                         | **In progress**                            | portfolio/roadmap/investment/decisions |

> **Honest read.** Six program manual-suites are authored plus PERG in progress — atop **one
> Validated RC platform**. Nothing here claims a product feature shipped that is not Implemented,
> nor a customer, pilot, or GA that does not exist.

### 1.2 Portfolio health widgets (specification — progress blank)

| Widget                       | Definition (what the exec sees)                | Real source                            | Current value                                        | _Proposed_ target                             |
| ---------------------------- | ---------------------------------------------- | -------------------------------------- | ---------------------------------------------------- | --------------------------------------------- |
| **Program delivery posture** | Programs by state (Delivered / In-progress)    | §1.1 inventory (real doc-suites)       | **6 Delivered + PERG in progress** (real, from §1.1) | — (state fact, not a target)                  |
| **Platform maturity**        | Classification on the RC→Validated-RC→GA chain | GA report + EVP (`_grounding.md`)      | **Validated RC `1.0.0-rc.1`** (real)                 | _Proposed:_ Enterprise GA once §4 gate clears |
| **GA-gate readiness**        | Open **HIGH** GA-blocker count + gate status   | **EOSP §4** register roll-up           | **2 open HIGH (R-1, R-2)** — reference EOSP §4       | _Proposed:_ 0 HIGH blockers to declare GA     |
| **Open-item progress**       | The **7 governed open items** closed, by wave  | Matrices §4 + EOSP §4                  | **`▢ blank` — 0 of 7 closed (all Proposed)**         | _Proposed:_ Wave 1 first (GA blockers)        |
| **Portfolio risk posture**   | Open HIGH / MED / LOW register counts          | EOSP §4 roll-up (real)                 | **2 / 5 / 3; 0 prod-vuln** — reference EOSP §4       | _Proposed:_ HIGH→0, MEDIUM burn-down          |
| **Capability evolution mix** | Capability areas by evidence label             | Matrices §1 (Product Evolution Matrix) | Reference Matrices §1 (real labels)                  | _Proposed:_ Proposed→Validated on close       |

**Wiring status (honest).** No portfolio PMO/BI surface ships (EOSP §1 "Wiring status";
`_grounding.md`). This board is watched **manually** from the doc-suites and the registers; a
progress widget advances **only** when a real open item closes green-in-CI or a program changes
delivered-state. Until then the progress cells stay blank.

---

## 2. Roadmap dashboard (specification, over the governed waves)

**What an exec opens to see roadmap progress.** Blank progress over the **real** Roadmap Dependency
Matrix waves ([`GOVERNANCE-MATRICES.md §4`](GOVERNANCE-MATRICES.md)). **No dates — dependency waves
only** (matrices rule). Every item is **Proposed** and backlog-grounded; **none is claimed done.**

### 2.1 Wave progress widgets (blank)

| Wave   | Governed items (Proposed)                                    | Depends on | Real source                           | Progress              | _Proposed_ exit-gate                                |
| ------ | ------------------------------------------------------------ | ---------- | ------------------------------------- | --------------------- | --------------------------------------------------- |
| **W1** | TD-1 Apple JWKS · TD-2 signed-install · TD-4a desktop CI     | —          | Matrices §4; EOSP §4 R-1/R-2/R-4      | **`▢` 0 of 3 closed** | both HIGH blockers closed + desktop gate green      |
| **W2** | TD-4b mac automation · TD-6 alerting/tracing · TD-5 rollback | W1 CI      | Matrices §4; EOSP §4 R-4/R-5/R-6      | **`▢` 0 of 3 closed** | signed mac build + burn-rate alert + rollback drill |
| **W3** | target-hardware benchmarks · first CDEP pilot                | W2 build   | Matrices §4; CDEP `PILOT-MATRICES.md` | **`▢` 0 of 2 closed** | field bench artifact + filled CDEP templates        |

### 2.2 Roadmap item detail (status blank; `P` is a ranking device, not a metric)

Ordered by the **real rubric rank** `P` (CDEP `PRODUCT-EVOLUTION.md §2.3`). `P` is an **ordinal
ranking device, never a measurement** (CDEP §2.2). Every **status cell ships blank**.

| Item (Proposed)                          | Wave | `P` (rank) | Status | Done bar (green-in-CI)        |
| ---------------------------------------- | :--: | :--------: | :----: | ----------------------------- |
| **#1** Apple JWKS verification (TD-1)    |  W1  |    50.0    |  `▢`   | signature-verify test green   |
| **#2** Signed marketplace install (TD-2) |  W1  |    33.3    |  `▢`   | unsigned-refused test green   |
| **#3** Target-hardware benchmarks        |  W3  |    12.0    |  `▢`   | field bench artifact archived |
| **#4** Per-PR desktop CI (TD-4a)         |  W1  |    9.0     |  `▢`   | desktop suite gated per PR    |
| **#6** Automated update rollback (TD-5)  |  W2  |    5.3     |  `▢`   | rollback drill passes, green  |
| **#5** macOS release automation (TD-4b)  |  W2  |    4.5     |  `▢`   | signed mac artifact in CI     |
| **#7** Alerting + tracing (TD-6)         |  W2  |    4.5     |  `▢`   | burn-rate alert fires         |

> **Wave overrides rank.** #3 has the third-highest `P` (12.0) yet sits in **W3** because its
> _field run_ depends on the W2 macOS build — a lower-ranked **prerequisite is always sequenced
> first** (CDEP §2.4). The dashboard therefore reads **by wave first, `P` within a wave.**

### 2.3 Horizon roll-up (Now / Next / Later — blank progress)

Referenced from CDEP `PRODUCT-EVOLUTION.md §3`; horizons map to the waves. Customer-driven rows are
**deliberately blank** — unlocked one at a time by a real pilot evidence artifact (CDEP §2.2).

| Horizon   | Wave | Populated items (real)    | Customer-driven slot | Progress |
| --------- | :--: | ------------------------- | -------------------- | :------: |
| **Now**   |  W1  | #1, #2, #4                | `— (none yet)`       |   `▢`    |
| **Next**  |  W2  | #6, #5, #7                | `— (none yet)`       |   `▢`    |
| **Later** |  W3  | #3 field run, first pilot | `— (none yet)`       |   `▢`    |

**Critical path (real, from Matrices §4).** W1 (TD-1, TD-2, TD-4a) → W2 (mac automation, alerting,
rollback) → **GA candidate** → W3 (benchmarks + first pilot). Progress blank throughout; nothing
marked delivered that is not Implemented.

---

## 3. Investment framework (a decision method — no monetary figures)

**How the portfolio decides where effort goes** across three classes — **debt retirement** vs
**new capability** vs **research/innovation**. This **elevates** the CDEP rubric
(`PRODUCT-EVOLUTION.md §2`) and the CDEP §4.4 investment-ask pattern into a **cross-class
allocation method**. It is a **decision method, not a budget**: **no dollar, headcount, cost, or
spend figure appears anywhere.** Allocation is a **sequencing** decision (what before what), scored
by the real rubric and constrained by the real risk register — effort/priority only.

### 3.1 The three effort classes

| Class                     | Definition                                        | Real backlog it draws from                                                                         | Evidence label bound              |
| ------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------- |
| **Debt retirement**       | Close a named register item (TD/PR)               | The 7 open items; EOSP §4; Matrices §3                                                             | Proposed → **Validated** on close |
| **New capability**        | A Proposed capability advance **beyond** debt     | Matrices §1 "next governed step"; CDEP customer-driven slots (blank)                               | **Proposed** (needs evidence)     |
| **Research / innovation** | A Future-Vision item needing validation **first** | NSSP `RESEARCH-ROADMAP.md`; Matrices §1 Future-Vision rows (federation, multi-region, forecasting) | **Future Vision** (uncommitted)   |

### 3.2 The allocation method (ordered decision steps)

1. **Admissibility gate.** An item enters scoring **only** with a real evidence link (CDEP §1.3);
   no link ⇒ `needs-evidence`, returned, not scored. This is the mechanism that keeps invented
   initiatives out of the portfolio.
2. **Score by the real rubric.** Apply `P=(E×I×R)÷Effort` (CDEP §2, referenced — **not
   re-derived**); `E` caps at **4** for internal items (5 reserved for a pilot evidence artifact
   that does not exist yet).
3. **Weight by the risk register.** An open **HIGH GA-blocker** (EOSP §4 R-1, R-2) is a
   **mandatory-first allocation regardless of `P`** — it _is_ the gate (§4).
4. **Respect dependency waves.** A prerequisite is funded **before** its dependents even at lower
   `P` (Matrices §4; "wave wins", CDEP §2.4).
5. **Balance across classes (guardrail).** Research (Future Vision) is **not** sequenced ahead of an
   open HIGH debt item; new capability **beyond the 7** waits on the customer-driven evidence slot
   (blank today).
6. **Record the call** as an executive ADR (§4) and a decision-log entry (EOSP §5) — inputs cited.

### 3.3 Allocation-decision worksheet (blank — no cost column exists)

The method's instrument. Ships **blank** in the decision column; filled per QBR (§4 / EOSP §5).
**There is deliberately no budget, headcount, or spend column.**

| Candidate (admissible)                  | Class                 | `P` (rank)  | Register / wave constraint                                  | Allocation call         |
| --------------------------------------- | --------------------- | :---------: | ----------------------------------------------------------- | ----------------------- |
| **#1** TD-1 · **#2** TD-2               | Debt retirement       | 50.0 / 33.3 | **HIGH GA-blocker — mandatory-first** (EOSP §4 R-1/R-2; W1) | `▢` (sequence per §3.2) |
| **#4** TD-4a → **#5/#6/#7**             | Debt retirement       |  9.0 … 4.5  | W1→W2 dependency (#4 gates #5/#6)                           | `▢`                     |
| **#3** target-hardware benchmarks       | Debt / validation     |    12.0     | W3 (gated on W2 mac build)                                  | `▢`                     |
| _customer-driven capability_            | New capability        |      —      | **blank — awaiting first pilot evidence** (CDEP §1.3)       | `— (none yet)`          |
| federation · multi-region · forecasting | Research / innovation |      —      | **Future Vision — uncommitted; NSSP validation gate first** | `— (not sequenced)`     |

### 3.4 Allocation guardrails (honest)

- **No monetary anything.** "Effort" is the ordinal **Effort divisor** (1–5; CDEP §2.1); "priority"
  is the ordinal **`P`** ranking device. The framework decides **sequence**, never spend — budget
  and headcount are set by finance against a real plan, **not asserted here**.
- **Research stays uncommitted.** Future-Vision rows are **not roadmap**; a validation gate (NSSP)
  must promote a research item to Proposed before it can be sequenced.
- **New capability needs evidence.** Any capability beyond the 7 open items requires a **real pilot
  evidence artifact** (CDEP §2.2) — blank today, so the new-capability lane is honestly empty.

---

## 4. Decision records (executive ADR)

Portfolio-level decisions (gate GA, allocate effort, promote/deprecate a direction) are recorded as
**executive ADRs** — **elevating** the CDEP ADR template (`PRODUCT-EVOLUTION.md §4`, Michael-Nygard
form) with the EOSP §5 decision-log exec fields. ADRs are **immutable once Accepted**; change is a
**new** ADR that supersedes the old one. An ADR with **no cited evidence is not accepted** (the same
admissibility discipline as intake).

### 4.1 Executive ADR template (copy per decision)

```
# PERG-ADR-NNN: <short noun-phrase decision title>
Status:    [ Proposed | Accepted | Superseded by PERG-ADR-NNN | Deprecated ]
Date:      ____-__-__
Context:   Forces at play; the real constraints and cited evidence.
Decision:  The position taken, in one active-voice sentence + specifics.
Consequences:
  Positive:  what improves.
  Negative:  the accepted cost / trade-off (never a dollar figure).
  Neutral:   follow-on / when this ADR would be revisited.
Evidence:      real artifacts cited (report §, register ID, script, test).   [required]
Related:       backlog item # / risk-register entry / wave this touches.
Inputs cited:  dashboard widgets / KPI / risk IDs that drove it (EOSP §5).
Owner role:    accountable role (never a person).
Review-by:     date/condition to revisit.
```

### 4.2 Worked example — PERG-ADR-001 (grounded in the real HIGH items)

```
# PERG-ADR-001: Gate GA on closing TD-1 and TD-2
Status:  Accepted (gate policy — asserts no closure, no date, no outcome)
Date:    2026-__-__

Context:
  The platform is a Validated RC (1.0.0-rc.1; EVP ~76/100), short of Enterprise
  Proven. Two HIGH items are OPEN in the real risk register and are named GA
  blockers (ENTERPRISE-GA-REPORT.md §8; EOSP §4):
   - R-1 / TD-1 / PR-1: Apple `id_token` decoded but NOT JWKS-verified
     (apps/backend/src/auth/providers/apple.ts) — auth-bypass exposure.
   - R-2 / TD-2 / PR-2: marketplace unsigned-install bypass when the trust store
     is empty (apps/desktop/src/main/nps/packageService.ts:184).
  The Release Readiness Matrix marks "HIGH security items closed" as
  Blocking = Yes — GA blocker (GOVERNANCE-MATRICES.md §2). Both top the rubric
  (P = 50.0, 33.3) and sit in Wave 1 (Matrices §4; CDEP §2.3).

Decision:
  GA is NOT declared until R-1 (Apple JWKS verification) and R-2 (signed-install
  enforcement) are closed with evidence — a signature-verify test and an
  unsigned-install-refused test, both green in CI — and both are therefore the
  mandatory-first allocation (§3.2 step 3), sequenced ahead of every MEDIUM/LOW
  item regardless of P.

Consequences:
  Positive:  GA rests on closed HIGH security exposure, not on a schedule; the
             auth-bypass and unsigned-package classes are retired with tests.
  Negative:  GA is blocked on two security items irrespective of other progress;
             W2/W3 sequence strictly behind W1.
  Neutral:   Revisit when both close; a superseding PERG-ADR would then move the
             gate to the W2 release-engineering items (mac automation, rollback,
             alerting) that Matrices §2 marks "recommended pre-GA".

Evidence:      EOSP §4 R-1/R-2; ENTERPRISE-GA-REPORT.md §8 (HIGH = GA blocker),
               §4-5 (TD-1/TD-2, PR-1/PR-2); GOVERNANCE-MATRICES.md §2 (Release
               Readiness), §4 (Wave 1); CDEP PRODUCT-EVOLUTION.md §2.3 (rank);
               apple.ts, packageService.ts:184 (the real seams).
Related:       backlog #1 (TD-1), #2 (TD-2); risk R-1/R-2; Roadmap Wave 1.
Inputs cited:  §1 GA-gate-readiness widget; §2.1 W1 progress; EOSP §4 register.
Owner role:    Program owner (accountable); Security / Backend + Desktop eng
               (remediation).
Review-by:     next QBR (EOSP §5) and every release gate (RELEASE-CHECKLIST.md).
```

> PERG-ADR-001 records an **existing, real gate policy** grounded entirely in the real registers.
> It **invents nothing, closes nothing, and dates nothing** — R-1 and R-2 remain **open**; the ADR
> states the _policy_ that GA is gated on them, which is already an audit fact (`GA §8`).

---

## Provenance & scope

- **Specifications, not populated dashboards.** §1.2 and §2 progress cells ship **blank**; the
  real-fact cells **reference** the registers (EOSP §4 roll-up; Matrices §1/§3/§4) — they do not
  reprint or fabricate them. §1.1 inventory is **real audit fact** (the doc-suites exist as files).
- **No fabricated business metrics.** No revenue, ARR, seat, customer, adoption, usage, velocity,
  or story-point figure is asserted — there is no GA, no fleet, no pilot. Portfolio "progress" is
  **0 of 7 closed** (honest) plus the real EOSP §4 register roll-up, cited.
- **Investment framework is a decision method — no monetary figures.** No budget, headcount, cost,
  or spend appears; "effort" is the ordinal Effort divisor and "priority" the ordinal `P` ranking
  device (CDEP §2). Allocation is **sequencing**, constrained by the real risk register and waves.
- **Portfolio = real programs + real backlog.** The eight rows are the Validated RC platform and
  the seven programs (GA/EVP/NSSP/GEAP/EOSP/CDEP/PERG); the roadmap is the seven governed open
  items across the real waves. **No initiative is invented;** Future-Vision rows (federation,
  multi-region, forecasting) are uncommitted, not roadmap.
- **Elevate, do not duplicate.** The rubric is owned by CDEP `PRODUCT-EVOLUTION.md §2`; the waves by
  `GOVERNANCE-MATRICES.md §4`; the risk register and decision-log/QBR by EOSP §4/§5; SLO/capacity by
  `SRE.md` — all referenced, not restated. **Roles, never people; personas, never named customers.**
