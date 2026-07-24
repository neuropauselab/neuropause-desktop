# NeuroPause — Risk Governance (PERG)

> **What this is.** The **risk-governance layer** of the Product Evolution & Release
> Governance Program (PERG): how NeuroPause **identifies, classifies, owns, tracks, and
> retires** risk as the platform evolves from Release Candidate toward GA and beyond. It
> adds **no runtime and no architecture** — it defines a **lifecycle and an accountability
> model** over the **already-real** registers. The **product and operational risk register
> IS the real GA Production Risk Matrix** (`ENTERPRISE-GA-REPORT.md §5`, PR-1…PR-8) with
> **verbatim likelihood and impact**, elevated — not restated — from the EOSP risk
> dashboard (`docs/operations/EXECUTIVE-OPERATIONS.md §4`, R-1…R-11). **Strategic** and
> **dependency** risks are new governance content: they are **derived from real facts**
> (RC-not-GA maturity, no production fleet, single-region, dependency posture) and carried
> as **qualitative** judgments. **Roles, never people.**

> **Anti-fabrication banner (non-negotiable).** No risk in this document carries a
> **fabricated probability** and no risk cites a **fabricated incident**. The PR entries use
> the GA report's own qualitative likelihood/impact bands **verbatim**; the strategic and
> dependency entries use **qualitative bands only** (Low / Medium / High / _present
> constraint_) with **no numeric probability asserted**. There is **no GA, no production
> fleet, no customer deployment, and no incident history** — so none is invented. The one
> **eliminated** risk (PR-8) is closed with **real evidence**, and is used below as the
> worked example of the mitigation lifecycle.

---

## 0. How risk is governed (categories, sources of truth, evidence labels)

Every governed risk is placed in exactly one **category**, drawn from exactly one
**register of record**, and each remediation carries one **evidence label** (per
`_grounding.md`): **Implemented** (runs today) · **Validated** (verified by a
gate/test/drill) · **Proposed** (committed, backlog-grounded) · **Future Vision**
(uncommitted, 2.x).

| Category             | What it covers                             | Register of record                            | Probabilities?                            |
| -------------------- | ------------------------------------------ | --------------------------------------------- | ----------------------------------------- |
| **Strategic** (§1)   | Maturity, market, portfolio exposure       | New — **derived from real facts**             | **Qualitative only** — none asserted      |
| **Operational** (§2) | Day-2 / release-engineering gaps           | **Real GA PR-3, PR-4, PR-6** (verbatim)       | Verbatim GA bands                         |
| **Product** (§3)     | Security/integrity of the shipped artifact | **Real GA PR-1, PR-2, PR-5, PR-7** (verbatim) | Verbatim GA bands                         |
| **Dependency** (§4)  | Supply chain + managed services            | New — **derived from real facts**             | Qualitative + verbatim where a PR applies |
| **Closed** (§5)      | Eliminated with evidence                   | **Real GA PR-8**                              | — (closed)                                |

**Governed severity vs. likelihood/impact.** The GA PR matrix gives each product/operational
risk a separate **Likelihood** and **Impact** (reproduced verbatim). The EOSP register folds
those into one **governed severity** (HIGH / MEDIUM / LOW) that drives **GA-blocker** status.
Both are shown so nothing is re-derived: _e.g._ PR-2 and PR-7 are each **Low × High**, yet PR-2
is **HIGH** (security-integrity GA-blocker) while PR-7 is **MEDIUM** (a proven data-side restore
compensates). That reconciliation is a **governance judgment on real inputs**, not a new number.

**Qualitative-band legend (the only vocabulary allowed — no percentages).** To keep every
assessment honest, likelihood and impact are expressed **solely** in the bands below. A
_present constraint_ is a **certainty of a limitation** (e.g. i18n absent), not a probabilistic
event, and is labelled as such rather than dressed up as a number.

| Band                     | Likelihood reading                                           | Impact reading                                     |
| ------------------------ | ------------------------------------------------------------ | -------------------------------------------------- |
| **Low**                  | Requires a crafted precondition or an already-mitigated path | Bounded/local; a compensating control exists       |
| **Med**                  | Plausible under normal operation of the current gaps         | Material to a release, an SLO, or a market         |
| **High**                 | — (reserved; no PR entry is rated High-likelihood today)     | Security/identity/data-integrity or revenue-gating |
| **Low–Med / Med–High**   | The GA report's own hedged bands — reproduced verbatim       | Same                                               |
| _**Present constraint**_ | Certainty of a limitation, not an event                      | The strategic ceiling that limitation imposes      |

> The **governed-severity** roll-up (HIGH/MED/LOW) is **not** a formula over these bands — it is
> the EOSP register's real rating, which weights **security-criticality and GA-blocker status**
> above arithmetic. This document **never computes** a severity; it **cites** one.

---

## 1. Strategic risks (qualitative — derived from real facts, no probability asserted)

These are **not** in the GA PR register. They are the **strategic exposures implied by the
platform's real maturity and footprint**, carried as **qualitative** governance judgments.
No probability is asserted and no incident is cited; the "likelihood" column is a **band or a
present-constraint statement**, not a measured value. Each has a single accountable
**owner-role** and a **governed response** carrying its honest evidence label.

| ID       | Strategic risk (real fact it derives from)                                                                             | Likelihood (qual.)                                | Impact (qual.) | Owner-role                                     | Governed response (label)                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **SR-1** | **RC-not-GA maturity** — platform is `1.0.0-rc.1`; GA gated on 2 open HIGH items + release-eng debt (TD-1, TD-2, TD-4) | Medium                                            | **High**       | Program owner (Security + Release eng deliver) | Close the GA gate: W1 TD-1/TD-2, W1–W2 TD-4 (**Proposed**)                                                                |
| **SR-2** | **No proven customer deployment** — no customer, no production fleet, no executed pilot                                | Medium                                            | Medium–High    | Program owner / Product                        | Run first CDEP pilot on a GA-candidate build (**Proposed**, W3)                                                           |
| **SR-3** | **Single-region only** — multi-region not built; regional outage = full outage; residency-bound markets unaddressable  | _Present constraint_ (market); Low (outage event) | Medium–High    | ARB / SRE                                      | Multi-region is **Future Vision** (2.x) — design when demanded, do not fold modeled federation into an availability claim |
| **SR-4** | **i18n absent** — no internationalization; TAM bounded to English-first segments                                       | _Present constraint_                              | Medium         | Product / ARB                                  | i18n is **Future Vision** (2.x) — scope on demand-signal                                                                  |
| **SR-5** | **Proprietary-license / OSS-undecided** — distribution & community-contribution strategy not ratified                  | _Decision pending_                                | Medium         | Program owner (ARB + licensing advisory)       | Ratify direction via an ADR before GA commitments harden (**Proposed**)                                                   |

**Notes.** (a) SR-1 is the **master strategic risk**: it is discharged only when the real
GA gate closes, so it is reviewed at **every release gate** and each QBR risk-walk
(`EXECUTIVE-OPERATIONS.md §5`). (b) SR-3 and SR-4 are **present architectural constraints**,
not probabilistic events — the honest "likelihood" is _certainty of the limitation_, and the
governed response is a **2.x Future-Vision** decision under **architecture stewardship (ARB)**,
never a claim that the capability exists. (c) SR-5's exposure grows the longer the licensing
question stays open; the governed response is a **decision**, owned by the Program owner, not an
engineering task. **No revenue, market-size, or adoption number is asserted for any SR entry.**

---

## 2. Operational risks (real GA PR-3 / PR-4 / PR-6 — verbatim likelihood × impact)

The **real** operational slice of the GA Production Risk Matrix, **elevated** with governance
fields the GA report does not carry (owner-role, TD tie, mitigation evidence-state, retirement
criterion). **Likelihood and Impact are reproduced verbatim** from `ENTERPRISE-GA-REPORT.md §5`;
**governed severity** is the EOSP register rating. These are **day-2 / release-engineering
gaps**, not core-correctness failures.

| ID       | Risk (verbatim)                                         | Likelihood | Impact | Gov. sev               | Owner-role          | TD tie                       | In-place mitigation (real → state)                                         | Retirement criterion                 |
| -------- | ------------------------------------------------------- | ---------- | ------ | ---------------------- | ------------------- | ---------------------------- | -------------------------------------------------------------------------- | ------------------------------------ |
| **PR-3** | Rate-limit bypass during Redis outage                   | Low        | Med    | MED (accepted)         | SRE / Backend eng   | **TD-3** (`rateLimit.ts:37`) | Documented fail-open; auth still required → **Implemented** (deliberate)   | Alert wired on fail-open; documented |
| **PR-4** | Regression ships because desktop tests not gated per PR | **Med**    | Med    | MED                    | Release eng / DevEx | **TD-4**                     | Full suite runs locally + this RC gate → **Validated (local)**             | Per-PR desktop CI green in pipeline  |
| **PR-6** | Slow incident response (no alerting/tracing)            | **Med**    | Med    | MED (highest-leverage) | SRE                 | **TD-6**                     | `/metrics` + structured logs exist to scrape → **Implemented (substrate)** | Burn-rate alert fires; tracing wired |

**Governance notes.** (1) **PR-3 is an _accepted_ risk**, not an unmanaged one: the fail-open is
a deliberate availability-over-strictness trade-off (auth is still required), so its retirement
criterion is **observability, not code** — make it _alertable_ via TD-6, then it moves from
_Open — accepted_ to _closed with a compensating control_. (2) **PR-4 and PR-6 are the two
Med × Med items** and the **highest-leverage operational toil**: PR-4 is discharged by the W1
desktop-CI item and PR-6 by the W2 alerting item (`GOVERNANCE-MATRICES.md §4`). (3) None of these
is a GA-blocker on security grounds, but PR-4 gates **release quality** and PR-6 gates
**measurable SLOs** — both are _recommended pre-GA_ on the Release Readiness Matrix.

---

## 3. Product risks (real GA PR-1 / PR-2 / PR-5 / PR-7 — verbatim; tied to the TD register)

The **security/integrity** slice of the GA Production Risk Matrix — risks in the **shipped
artifact itself** (auth token trust, package/build signing, update safety). **Likelihood and
Impact verbatim**; each is **tied to its real technical-debt entry** so risk burn-down and debt
retirement are the same closure event. **PR-1 and PR-2 are the two HIGH GA-blockers.**

| ID       | Risk (verbatim)                                   | Likelihood | Impact   | Gov. sev              | Owner-role             | TD tie                             | In-place mitigation (real → state)                                                                                  | Retirement criterion                          |
| -------- | ------------------------------------------------- | ---------- | -------- | --------------------- | ---------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **PR-1** | Forged Apple `id_token` accepted (identity spoof) | Low–Med    | **High** | **HIGH — GA blocker** | Security / Backend eng | **TD-1** (`apple.ts:14-16,77`)     | Backend-brokered Apple flow; requires a crafted token → **Implemented (partial)**                                   | Signature verified vs Apple JWKS + test       |
| **PR-2** | Malicious unsigned marketplace package installed  | Low        | **High** | **HIGH — GA blocker** | Security / Desktop eng | **TD-2** (`packageService.ts:184`) | Integrity hash always checked; signature enforced when present; worker path fail-closed → **Implemented (partial)** | Unsigned install refused + test               |
| **PR-5** | Unsigned desktop build shipped                    | Low        | Med      | MED                   | Release eng            | **TD-4** (mac release CI)          | Signing configured; env-gated → **Implemented (config)**                                                            | Signing enforced in mac release CI            |
| **PR-7** | Botched update with no clean rollback             | Low        | **High** | MED                   | SRE / Release eng      | **TD-5**                           | Data-side restore documented + proven (DR Guide) → **Validated (data-side)**                                        | Automated rollback path tested (drill passes) |

**Governance notes.** (1) **PR-1 and PR-2 are the standing RC → GA blockers**
(`ENTERPRISE-GA-REPORT.md §8`); both have a **real remediation seam in source** (an explicit
`HARDENING TODO` and a signature-gate branch), so their residual actions are **Proposed W1**, not
speculative. (2) **PR-5** is bounded to a **configuration/CI gap**: signing exists and is
env-gated; the risk is that a build ships _without the gate enforced_, retired by TD-4's mac
release automation — the **same** TD entry as PR-4, so one CI investment discharges two PR risks.
(3) **PR-7's Impact is High but its governed severity is MEDIUM**, because the **proven data-side
restore** (`DISASTER-RECOVERY-GUIDE.md`) is a real compensating control; the residual action
**promotes** rollback from _advisory_ to _automated_, and the modeled federation DR **must not** be
folded into an availability claim. (4) Every product risk **retires when its TD entry retires** —
risk closure requires the TD's **test/evidence criterion**, never a self-attestation.

---

## 4. Dependency risks (supply chain + managed services — derived from real facts)

Governs NeuroPause's exposure to **third-party code** and **external managed services**. The
supply-chain posture is **real and strong** — **0 production vulnerabilities**
(`npm audit --omit=dev`); the **11 advisories are entirely in build/test tooling**
(`ENTERPRISE-GA-REPORT.md §7`). Entries are **qualitative** unless a real PR already applies
(DEP-3 inherits PR-3 verbatim). No probability is invented.

| ID        | Dependency risk (real fact)                                                                                        | Likelihood (qual.) | Impact (qual.) | Owner-role       | Control in place (real → state)                                                                                                                                                                                                        | Governed action                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------ | ------------------ | -------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **DEP-1** | **Production npm supply chain** — a future advisory becomes reachable in the shipped surface                       | Low (0 prod today) | Medium–High    | Security         | `npm audit --omit=dev` **= 0** as a release gate; **Ed25519** manifest signing; artifact **integrity hash always checked** → **Validated**                                                                                             | Keep the audit gate green every release; treat any new prod-reachable advisory as a fresh §5 intake |
| **DEP-2** | **Dev/build-tooling advisories (11, dev-only)** — a dev advisory silently becomes production-reachable             | Low                | Low–Medium     | Security / DevEx | All 11 confined to build/test; do **not** reach the runtime artifact → **Validated (bounded)**                                                                                                                                         | Re-scan each release; if reachability changes, reclassify into DEP-1                                |
| **DEP-3** | **Managed-service dependencies (Postgres / Redis / Qdrant)** — availability/behavior coupling to external services | Low–Med            | Med–High       | SRE              | **Postgres**: backup/restore proven (DR) → **Validated**. **Redis**: loss ⇒ documented fail-open (**inherits PR-3**, Low × Med) → **Implemented**. **Qdrant**: config + health/search tested, **live-perf unvalidated** → **Proposed** | Wire Redis fail-open alert (TD-3/TD-6); validate Qdrant on live infra; keep DR restore drilled      |

**Governance notes.** (1) The **strength** here is deliberate and must be **maintained, not
assumed**: the `--omit=dev` gate is what makes "0 production vulns" a _governed_ fact rather than a
point-in-time reading — it is re-checked at **every release gate**. (2) **DEP-3 is where dependency
risk meets operational risk**: the Redis row **is PR-3** viewed from the dependency side, so it is
governed **once** (retire TD-3's alert and both views close). (3) **Qdrant** is honestly
**Modeled→Ready** (`ENTERPRISE-GA-REPORT.md §3`) — its live-perf validation is **Proposed**, not
claimed. (4) Supply-chain **integrity** (Ed25519 signing + always-on integrity hash) is the same
control family as PR-2; hardening PR-2 strengthens DEP-1's install-time trust boundary.

---

## 5. Mitigation workflow (identify → assess → assign owner-role → track to the debt register → verify)

The **actionable lifecycle** every risk follows. It is deliberately the **same discipline** across
all four categories, and it is what makes a risk _governed_ rather than merely _listed_. Closure is
**evidence-gated**: a risk is retired only when its tracked debt entry meets its **retirement
criterion**, and the decision is logged append-only on the QBR decision log
(`EXECUTIVE-OPERATIONS.md §5`).

| Stage                              | Action                                                                                                                            | Governance artifact                       | Rule                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **1 · Identify**                   | Surface a risk from a release gate, QBR risk-walk, security review, dependency scan, or an _actual_ signal                        | New ID (PR-/SR-/DEP-) + one category (§0) | **No speculative incidents** — a risk is logged from a real fact or a real signal, never an imagined event |
| **2 · Assess (qualitative)**       | Rate **Likelihood × Impact** using the qualitative bands; reconcile to a **governed severity**; flag GA-blocker                   | §1–§4 register row                        | **No fabricated probability** — verbatim GA bands for PR entries; qualitative bands elsewhere              |
| **3 · Assign owner-role**          | Bind one **accountable role** (Security, SRE, Release eng, DevEx, Product, ARB, Program owner)                                    | "Owner-role" column                       | **Roles, never people**; HIGH items escalate to Program owner at the gate                                  |
| **4 · Track to the debt register** | Link every risk with a residual action to its **real TD entry** (`GOVERNANCE-MATRICES.md §3`) with a **retirement criterion**     | TD tie + Roadmap Dependency wave (W1–W3)  | Risk burn-down **is** debt burn-down — one closure event, one piece of evidence                            |
| **5 · Verify**                     | Close only on the TD's evidence (test passes / alert fires / drill passes / audit gate green); re-check at **every release gate** | Decision-log entry (`EOSP-YYYYQn-NN`)     | **No self-attestation** — closure requires the named artifact; append-only, superseded never rewritten     |

### Worked example — PR-8, a _closed / eliminated_ risk (the model for every closure)

PR-8 is the **only eliminated entry** in the real register and is the template the workflow aims
every open risk toward:

| Stage                   | PR-8 in practice (all real)                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 · Identify**        | Risk that **fabricated demo/seed data** could be mistaken for real metrics in production — a data-authenticity failure against the no-fabrication mandate. |
| **2 · Assess**          | Material to trust and to the authenticity mandate; assessed as a **product-data** risk requiring a hard runtime guarantee, not a policy.                   |
| **3 · Assign**          | Owner-role: **Backend / Data**.                                                                                                                            |
| **4 · Track / control** | Control shipped: **`SEED_STORE_ON_BOOT=false`** in **all** production configs — the seed path cannot populate a production store.                          |
| **5 · Verify**          | **Ecosystem/exchange seed tests assert the store is empty**; the guarantee is enforced by a test, not a promise. Status: **Eliminated — closed this RC.**  |

**Why PR-8 is the model.** It moved from _identified_ to _eliminated_ because closure was
**gated on executable evidence** (config default + asserting tests), owned by a **role**, and is
**re-verified at every release gate** — exactly the path prescribed for the open items. The
standing goal is to walk **PR-1 and PR-2 (both HIGH GA-blockers)** through the identical five
stages until each reaches a PR-8-style _closed-with-evidence_ state (JWKS-verified + test;
unsigned-install-refused + test), at which point the **RC → GA** gate opens.

### Review cadence (where each stage is exercised)

The workflow is not a one-time pass; each risk is **re-walked on a cadence** that mirrors the
EOSP strategic-review nesting (`EXECUTIVE-OPERATIONS.md §5`), scoped here to the register.

| Cadence         | Forum                  | Risk-governance focus                                                                                               | Owner-role    |
| --------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------- |
| **Per release** | Release gate           | Re-verify every open risk; **no HIGH GA-blocker may ship open**; confirm closed items stayed closed                 | Release eng   |
| **Monthly**     | Operations review      | MEDIUM burn-down (PR-3…PR-7); dependency re-scan (DEP-1/DEP-2); toil trend                                          | SRE lead      |
| **Quarterly**   | Strategic review (QBR) | Full register walk — **HIGH first (PR-1, PR-2)**, then strategic (SR-1…SR-5) and dependency posture; new/aged risks | Program owner |

### Acceptance & escalation policy

- **Accepting a risk is a governed act, not a default.** A risk may be marked _Open — accepted_
  (as PR-3 is) **only** when it has (1) a real **compensating control**, (2) a named **owner-role**,
  and (3) a **review-by** condition. Acceptance is recorded on the decision log and **revisited
  every QBR** — it is never permanent and never silent.
- **Escalation is severity-driven.** Any **HIGH** item is a **GA-blocker** and escalates to the
  **Program owner** at the release gate; a MEDIUM item that **ages across two QBRs without
  movement** escalates to the QBR agenda as a prioritization decision. A **new prod-reachable
  dependency advisory** (DEP-1) is treated as a fresh §5 intake at the **next release gate**, not
  deferred.
- **Reopening is allowed and expected.** A _closed_ risk that loses its evidence (e.g. a test that
  guarded it is removed, or a dependency's reachability changes) is **reopened** at Stage 1 with a
  new decision-log entry — closure is a **live** state backed by a **live** artifact, never a
  historical checkbox.

---

## 6. Register roll-up & provenance

**Roll-up (real counts from the register above — not fabricated business metrics).**

| Metric (real, from §1–§5)                         | Value                                     |
| ------------------------------------------------- | ----------------------------------------- |
| Open **HIGH** product risks (GA blockers)         | **2** — PR-1, PR-2                        |
| Open **MEDIUM** product/operational risks         | **5** — PR-3, PR-4, PR-5, PR-6, PR-7      |
| **Closed / eliminated** (this RC)                 | **1** — PR-8 (`SEED_STORE_ON_BOOT=false`) |
| Production `npm audit --omit=dev` vulnerabilities | **0** (11 advisories, all dev-only)       |
| Strategic risks (qualitative, no probability)     | 5 — SR-1…SR-5                             |
| Dependency risks (qualitative / PR-inheriting)    | 3 — DEP-1…DEP-3                           |

**Provenance & scope.**

- **The product/operational register is the real GA register.** PR-1…PR-8 reproduce
  `ENTERPRISE-GA-REPORT.md §5` **likelihood and impact verbatim**, reconciled with the EOSP
  governed severities and owner-roles (`EXECUTIVE-OPERATIONS.md §4`, R-1…R-11). PERG **elevates**
  them with lifecycle, ownership, TD ties, and retirement criteria — it **does not restate or
  re-severity** them.
- **Strategic and dependency risks are derived from real facts**, carried **qualitatively**:
  RC-not-GA maturity, no production fleet / no executed pilot, single-region, i18n absent,
  proprietary-license/OSS-undecided, and the **0-prod / 11-dev-only** dependency posture with
  **Ed25519** signing and **Postgres/Redis/Qdrant** managed-service coupling. **No numeric
  probability and no incident is invented for any of them.**
- **Closure is evidence-gated and re-checked at every release gate** (`RELEASE-CHECKLIST.md`),
  logged append-only on the QBR decision log. Closing PR-1…PR-6 (and TD-4/TD-5/TD-6) is the
  standing **RC → Enterprise GA** path; nothing here is claimed done that is not.
- **No architecture change, no runtime added; roles, never people.** This document governs the
  real registers' **retirement** — it does not reinvent them.
