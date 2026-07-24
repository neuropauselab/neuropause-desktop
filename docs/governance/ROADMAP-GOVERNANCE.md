# NeuroPause PERG — Roadmap Governance

> **What this is.** The **governance layer over the roadmap**: the rules by which the
> NeuroPause roadmap is operated as a governed artifact — how horizons are ordered, how an
> item enters/moves/exits, the repeatable quarterly planning ritual, backlog refinement and
> its role ownership, the feature-acceptance gate, and the deprecation policy for published
> contracts. It adds **no runtime and no platform** — policy, cadence, and label discipline
> over the **real** backlog.
>
> **Elevate, do not restate.** The roadmap's _content_ already exists: CDEP
> [`PRODUCT-EVOLUTION.md`](../pilots/PRODUCT-EVOLUTION.md) supplies the intake, the
> `P=(E×I×R)÷Effort` rubric, and the Now/Next/Later mapping; EOSP
> [`CONTINUOUS-IMPROVEMENT.md`](../operations/CONTINUOUS-IMPROVEMENT.md) owns the real backlog,
> severities, and dependency waves; [`GOVERNANCE-MATRICES.md`](GOVERNANCE-MATRICES.md) §4 gives
> the dependency sequence; [`RELEASE-OPERATIONS.md`](../operations/RELEASE-OPERATIONS.md) owns
> the SemVer scheme. This document does **not** re-derive them — it governs how they are
> **operated as a roadmap**.
>
> **Honesty banner (non-negotiable).** The platform is a **Validated Release Candidate**
> (`1.0.0-rc.1`) — **no GA, no post-GA release, no customer, no production fleet, no completed
> deployment exists** (`_grounding.md`). The roadmap is seeded with **exactly the seven real
> open items** plus the **real Implemented/Validated capabilities**; every customer-driven slot
> is **blank, awaiting a real pilot evidence artifact.** **No invented feature, no fabricated
> progress, no date** — sequencing is **waves and relative quarters only.** Every item carries
> one honest evidence label. Roles, never people.

---

## 1. Roadmap methodology

### 1.1 The three horizons (governed by evidence + dependency waves)

The roadmap is a **Now / Next / Later** board. A horizon is **not a time box** — it is a
**confidence-and-dependency band**, ordered by the CDEP evidence rank (`PRODUCT-EVOLUTION.md
§2.3`) and constrained by the dependency waves (`GOVERNANCE-MATRICES.md §4`). Where rank and
wave disagree, **the wave wins** — a prerequisite always precedes its dependents.

| Horizon    | Meaning                                                      | Admission bar                                     | Maps to   |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------- | --------- |
| **Now**    | Committed, in flight this planning quarter; GA-gating band   | Real backlog item, **DoR met** (§3.1), wave-ready | Matrix W1 |
| **Next**   | Committed intent, next planning quarter; blocked only by Now | Real backlog item; prerequisite in Now/done       | Matrix W2 |
| **Later**  | Accepted direction, not yet scheduled; non-GA-gating         | Real backlog item; no near-term prerequisite      | Matrix W3 |
| **Parked** | Aspirational; **uncommitted**, no wave, no horizon           | Named in the evolution matrix as Future Vision    | Matrix §1 |

### 1.2 Label discipline (the four-way evidence split)

Every roadmap row carries **exactly one** label; the label is the item's honesty contract.

| Label             | Bar to claim it                                            | Who assigns it                     |
| ----------------- | ---------------------------------------------------------- | ---------------------------------- |
| **Implemented**   | Runs in the codebase today; **file cited**                 | Owning role, at merge              |
| **Validated**     | Implemented **and** verified by executed gates/tests/bench | QA/owning role, at acceptance (§4) |
| **Proposed**      | Committed, near-term, grounded in a **real backlog item**  | Roadmap owner, at planning (§2)    |
| **Future Vision** | Aspirational, long-term, **uncommitted**, no timeline      | Architecture stewardship (ARB)     |

**1.x** items may be Implemented/Validated/Proposed; **2.x** items are **Future Vision** unless
explicitly grounded. A label is only **promoted** with the evidence its next tier demands
(§4.3) — never by intent, demo, or deadline. Downgrade is expected: if cited evidence lapses
(a gate removed, a test deleted), the label drops and the item re-enters refinement.

### 1.3 Entry / move / exit (the roadmap state machine)

- **Enter** — admitted only from a governed source: the EOSP backlog
  (`CONTINUOUS-IMPROVEMENT.md §2`), a CDEP intake row with a **real evidence link**
  (`PRODUCT-EVOLUTION.md §1.3`), or an ARB-accepted Future-Vision direction. No evidence link ⇒
  inadmissible; returned as `needs-evidence`, never placed on the board.
- **Move** — advances **Later→Next→Now** only when its dependency wave is cleared
  (`GOVERNANCE-MATRICES.md §4`) **and** it meets the Definition of Ready (§3.1). Ratified at the
  quarterly ritual (§2), never ad hoc.
- **Exit** — leaves the board only by **acceptance** (§4: gate green + label promoted + the
  retirement criterion in `GOVERNANCE-MATRICES.md §3` met) or by an **ADR** that withdraws it
  (`PRODUCT-EVOLUTION.md §4`). "Exited" means _retired the named blocker_, not "declared done."

### 1.4 The governed roadmap board

Populated **only** with the seven real open items and the real Implemented/Validated
capabilities. Customer-driven rows are **blank by design** — each unlocked by one real pilot
evidence artifact (`PRODUCT-EVOLUTION.md §2.2`). No demand, count, or feature invented.

**Maintained baseline (not re-opened; the roadmap protects these).**

| Capability                                       | Label           | Evidence (cited)                                   |
| ------------------------------------------------ | --------------- | -------------------------------------------------- |
| Core platform (desktop + backend)                | **Validated**   | 3,856 tests, build 0, EVP measured                 |
| Deployment (Docker/K8s/Helm/offline)             | **Validated**   | kubeconform strict, shellcheck                     |
| Reliability — backup/restore                     | **Validated**   | row-for-row restore PASS (`RELIABILITY-RESULTS`)   |
| Authentication — OAuth **PKCE**                  | **Validated**   | PKCE validated (Apple JWKS is Proposed, #1)        |
| Marketplace / package pipeline                   | **Implemented** | pipeline runs (signed-install is Proposed, #2)     |
| Observability (`/metrics`,`/health`,`audit_log`) | **Implemented** | endpoints live (alerting is Proposed, #7)          |
| Release CI (3 workflows)                         | **Implemented** | `backend-ci`,`deploy-validation`,`windows-release` |

**Now — Wave 1 (GA-gating; run in parallel).**

| Item                                                 | Label        | Exit evidence (retirement criterion)                |
| ---------------------------------------------------- | ------------ | --------------------------------------------------- |
| #1 Apple `id_token` JWKS verification (TD-1, HIGH)   | **Proposed** | signature-verify test green in CI + security review |
| #2 Signed / trusted marketplace install (TD-2, HIGH) | **Proposed** | unsigned-install refused + test green               |
| #3 Target-hardware desktop benchmarks                | **Proposed** | field bench artifact archived                       |
| _customer-driven slot_                               | —            | **blank — awaiting first pilot evidence artifact**  |

**Next — Wave 2 (release engineering; #4 gates #5/#6).**

| Item                                        | Label        | Exit evidence                                      |
| ------------------------------------------- | ------------ | -------------------------------------------------- |
| #4 Per-PR desktop CI (TD-4a)                | **Proposed** | desktop suite gated green per PR                   |
| #6 Automated, tested update rollback (TD-5) | **Proposed** | rollback drill passes in CI (supersedes ADR-001)   |
| #5 macOS release automation (TD-4b)         | **Proposed** | signed mac artifact produced in CI                 |
| _customer-driven slot_                      | —            | **blank — awaiting first pilot evidence artifact** |

**Later — Wave 3 (day-2 observability; non-GA-gating).**

| Item                                       | Label        | Exit evidence                                      |
| ------------------------------------------ | ------------ | -------------------------------------------------- |
| #7 Alerting + tracing + forecasting (TD-6) | **Proposed** | burn-rate alert fires; folds in the TD-3 alert     |
| _customer-driven slot_                     | —            | **blank — awaiting first pilot evidence artifact** |

**Parked — Future Vision (uncommitted; no wave, no date).**

| Direction                            | Label             | Note                               |
| ------------------------------------ | ----------------- | ---------------------------------- |
| Federation                           | **Future Vision** | modeled only; design when demanded |
| Multi-region / i18n                  | **Future Vision** | proposed in EOSP; not built (2.x)  |
| Statistical prediction / forecasting | **Future Vision** | no engine (NSSP L0); 2.x research  |

> **Roadmap invariant.** Every populated row is a real capability or one of the seven real open
> items; every customer slot is blank until a pilot admits it; no date appears anywhere.

---

## 2. Quarterly planning ritual

A repeatable ceremony that **re-cuts the board** once per relative quarter — the product-roadmap
counterpart to the EOSP quarterly maturity reassessment (`CONTINUOUS-IMPROVEMENT.md §3`), run at
the same cadence with a distinct output.

- **Owner role:** Roadmap owner (Product lead), with domain leads (Security, Release eng,
  SRE/Ops, QA) and Architecture stewardship (ARB).
- **Cadence:** once per relative planning quarter (`Q`, `Q+1`, `Q+2` …) — a **label**, never a
  calendar promise. **Output:** a re-ordered board, ratified moves (§1.3), and the commit set.

### 2.1 Inputs (all real; none invented)

1. **Debt register** — `GOVERNANCE-MATRICES.md §3` (TD-1…TD-10, severities verbatim, owning roles).
2. **Risk register** — `GOVERNANCE-MATRICES.md §2` / `_grounding.md` (PR-1…PR-8).
3. **Pilot evidence — when it exists** — filled CDEP intake rows (`PRODUCT-EVOLUTION.md §1`).
   **Today this input is empty**; until a pilot runs, no customer-driven item is scheduled.
4. **Evidence rank** — the current `P=(E×I×R)÷Effort` ranking (`PRODUCT-EVOLUTION.md §2.3`).
5. **Dependency waves** — `GOVERNANCE-MATRICES.md §4` (the hard ordering constraint).

### 2.2 Capacity — relative, never fabricated

Capacity is expressed as **relative wave-slots**, not story points, velocity, or headcount —
none of which exists to cite (`_grounding.md` rules 1–2). The planning question is _"which wave
can advance,"_ not _"how many points fit."_ A quarter commits **one wave's worth** of Now-band
work; a lower wave is never committed before its prerequisite wave is accepted.

### 2.3 The commit rule

An item is **committed to Now** only if **all** hold, else it stays in Next/Later:

- [ ] a **real** backlog item with a cited source (no invented row);
- [ ] its **dependency wave** is cleared, or its prerequisite is already in Now (§4 matrix);
- [ ] it meets the **Definition of Ready** (§3.1);
- [ ] its **exit evidence** (retirement criterion, `GOVERNANCE-MATRICES.md §3`) is stated;
- [ ] committing it implies **no date** — only a wave position.

### 2.4 Blank planning template (copy per quarter)

```
Planning quarter:   Q____   (relative label — NEVER a calendar date)
Owner / attending:  Roadmap owner (Product lead) · Security · Release eng · SRE/Ops · QA · ARB

Inputs reviewed
  Debt register (§3 matrix):   reviewed [ ]   changed severities: ____
  Risk register (§2 matrix):   reviewed [ ]   new/retired risks:  ____
  Pilot evidence (CDEP §1):    present? [ ]   (blank today — no pilot has run)
  Evidence rank (CDEP §2.3):   re-run  [ ]    ranking delta:      ____

Board decisions (waves, not dates)
  Committed to NOW  (wave ____): __________________________________
  Held in NEXT      (wave ____): __________________________________
  Held in LATER     (wave ____): __________________________________
  Parked (Future Vision):        __________________________________
  Customer slot admitted?  [ ] no  [ ] yes → evidence artifact: ____

Per NOW item: commit-rule (§2.3) passed [ ] · exit evidence recorded [ ] · no date asserted [ ]
```

---

## 3. Backlog refinement

### 3.1 Definition of Ready (DoR)

An item may not enter **Now** until every box is true — the gate that keeps half-formed or
evidence-free items off the committed board.

- [ ] **Sourced** — traces to a real backlog item, debt/risk-register entry, or a CDEP intake
      row with a **real evidence link** (`PRODUCT-EVOLUTION.md §1.3`).
- [ ] **Labeled** — carries one evidence label (§1.2), honestly assigned.
- [ ] **Owned** — has an owning role (§3.3), never a person.
- [ ] **Sequenced** — its dependency wave is identified (`GOVERNANCE-MATRICES.md §4`).
- [ ] **Testable exit** — its retirement criterion / done-bar is written and
      **green-in-CI-checkable** (`GOVERNANCE-MATRICES.md §3`).
- [ ] **Scoped honestly** — no fabricated metric, customer, or completion date in the row.

### 3.2 How the real backlog is refined

Refinement **re-uses** the EOSP loops (`CONTINUOUS-IMPROVEMENT.md §3`); this document adds only
the roadmap-facing discipline, not a second backlog:

1. **Weekly** — triage new intake, confirm severities, re-check each item still cites a real
   source; strip any row that has drifted toward speculation.
2. **Monthly** — re-run the evidence rank (`PRODUCT-EVOLUTION.md §2.3`); re-verify wave
   dependencies still hold (desktop CI **before** rollback automation); advance DoR-ready items
   Later→Next.
3. **Quarterly** — the planning ritual (§2) ratifies Next→Now moves and the commit set.
4. **Standing rule** — the secondary/also-tracked items (`CONTINUOUS-IMPROVEMENT.md §2`: TD-7
   renderer E2E/a11y, TD-8 bundle trim, TD-9 admin-scope UI, TD-10 hash review) stay in
   refinement, worked opportunistically; they enter a horizon only on DoR.

### 3.3 Ownership (roles, never people)

| Backlog domain                                 | Refines / owns readiness           | Source                      |
| ---------------------------------------------- | ---------------------------------- | --------------------------- |
| Security items (TD-1, TD-2, TD-10)             | **Security eng**                   | `GOVERNANCE-MATRICES.md §3` |
| Release engineering (TD-4a/b, TD-5)            | **Release eng / DevEx**            | `GOVERNANCE-MATRICES.md §3` |
| Observability / day-2 (TD-3, TD-6)             | **SRE / Ops**                      | `GOVERNANCE-MATRICES.md §3` |
| Client-tier perf + renderer tests (TD-7, TD-8) | **QA / Frontend**                  | `GOVERNANCE-MATRICES.md §3` |
| Product surface / admin scope (TD-9)           | **Product**                        | `GOVERNANCE-MATRICES.md §3` |
| Board ordering + commit set                    | **Roadmap owner**                  | this document §2            |
| Future-Vision direction                        | **Architecture stewardship (ARB)** | `_grounding.md` elevate-map |

---

## 4. Feature acceptance

Acceptance is the **exit** transition (§1.3): where an item leaves the board and a label is
promoted. No item is accepted on intent, demo, or deadline.

### 4.1 The acceptance gate (tied to the real quality gates)

Accepted only when the **real** gate wall is green — the same gates every release enforces
(`RELEASE-CHECKLIST`, `backend-ci.yml`; `_grounding.md`), not a new bar:

- [ ] **typecheck 0** · **lint 0** (`eslint --max-warnings 0`) · **build 0**;
- [ ] **tests green** — the full suite (**3,856** at `1.0.0-rc.1`; the count only grows);
- [ ] **`npm audit --omit=dev` = 0** production vulnerabilities;
- [ ] **retirement criterion met** — the item's done-bar in `GOVERNANCE-MATRICES.md §3` (e.g. #1
      → signature verified + test; #2 → unsigned install refused + test);
- [ ] **Conventional-Commit + Changelog** entry present (`Keep a Changelog`).

### 4.2 The honesty mandate at acceptance

Acceptance is the anti-fabrication checkpoint. Before an item exits, the reviewing role confirms:

- no row claims **shipped/delivered** unless truly **Implemented** with a **cited file**;
- no **metric, customer, or adoption figure** was introduced (`_grounding.md` rules 1–2);
- closing an item is credited as a **maturity lift** only when it **retires a named blocker**
  (`CONTINUOUS-IMPROVEMENT.md §2`), never on completion alone;
- the status line is unchanged unless GA is truly declared: **Validated RC**, not GA.

### 4.3 Label promotion: Proposed → Implemented → Validated

Promotion is **one hop per satisfied evidence tier** — the literal mechanism that keeps the
four-way split honest.

| Hop                         | Evidence required to promote                                      | Recorded by        |
| --------------------------- | ----------------------------------------------------------------- | ------------------ |
| **Proposed → Implemented**  | Code merged and **running**; the **file is cited** in the row     | Owning role, merge |
| **Implemented → Validated** | Executed **gates/tests/bench/reliability** verify it (§4.1 green) | QA / owning role   |
| **(any) → Future Vision**   | Only _down_ from Proposed when withdrawn by an **ADR**            | ARB                |

A hop that lacks its evidence **does not happen** — the item keeps its lower label. `E = 5`
(pilot-confirmed) remains **reserved** for a real pilot artifact that does not exist yet
(`PRODUCT-EVOLUTION.md §2.1`); no internal item may claim it.

---

## 5. Deprecation policy

How a **published contract** is retired without breaking consumers. It governs the two real
contract surfaces and ties every removal to SemVer — it does **not** restate the version scheme
(`RELEASE-OPERATIONS.md §1`), it elevates it into a consumer-safety policy.

### 5.1 The governed contract surfaces (real, cited)

- **IPC contract** — the canonical `IpcChannel` map and its allowlists (`INVOKABLE_CHANNELS`,
  `RUNTIME_INVOKABLE_CHANNELS`, `SUBSCRIBABLE_CHANNELS`) in `packages/shared/src/ipc/channels.ts`,
  on which the preload bridge, main router, and renderer client all agree. Renaming/removing a
  channel, or dropping it from an allowlist, is a **breaking change** to the desktop contract.
- **SDK / REST contract** — `@neuropause/sdk` (`packages/sdk/src/{index,client}.ts`): the
  `NeuroPauseClient` resources (`marketplace`, `workers`, `connectors`, `usage`, `billing`,
  `oauth`, `enterprise`) and the `ApiVersion` carried in the request path (`/${version}${path}`,
  default `'v1'`) with the echoed `x-api-version` header (`transport.ts`). The generated Enterprise
  resource and the OpenAPI 3.1 document (`api:openapi`, from routes + Zod) are its machine-readable
  snapshot.

### 5.2 Deprecation lifecycle (tied to SemVer major)

A contract element moves **Active → Deprecated → Removed**, and **Removed happens only in a
SemVer major** (`X.0.0`; `feat!` / `BREAKING CHANGE:`, `RELEASE-OPERATIONS.md §1`).

| State          | What is true                                                    | SemVer effect        |
| -------------- | --------------------------------------------------------------- | -------------------- |
| **Active**     | Supported; safe to depend on                                    | any tier             |
| **Deprecated** | Announced end-of-life; still functional; replacement documented | **Minor** (additive) |
| **Removed**    | Element deleted from the contract surface                       | **Major** only       |

No silent deprecation: the element is marked `@deprecated` in source (the channel entry / SDK
method), flagged in the OpenAPI document, and given a **Deprecated** changelog line
(`Keep a Changelog`).

### 5.3 Notice period + compatibility window

- **Notice period** — announced **≥ 1 major cycle ahead** of removal, aligning with "Major
  announced ≥ 1 train ahead" (`RELEASE-OPERATIONS.md §1`). Announcement = changelog Deprecated
  entry + `@deprecated` marker + migration guide (§5.4) available.
- **Compatibility window** — the deprecated element stays **functional and parallel-served**
  across the whole notice period, removed no earlier than the next major. For REST, an
  incompatible shape ships under a **new version prefix** (`v2`) while `'v1'` keeps serving — the
  `ApiVersion` negotiation exists precisely so old and new coexist.
- Windows are expressed in **cycles/waves, never dates** (`_grounding.md`).

### 5.4 Migration-guide requirement (a hard gate)

**No removal merges without a migration guide** — binding to the real changelog rule that a major
carries "a new top section + **migration notes**" (`RELEASE-OPERATIONS.md §1`). The acceptance
gate (§4.1) **blocks** any PR removing a channel, an allowlist entry, or an SDK resource method if
a guide is absent. The guide states, per removed element: the **old** element (channel / method /
route + version); the **replacement** (new channel / method / `v2` route) or the reason none
exists; a **before/after** call example; and the **compat window** + **deprecation ADR** reference.

### 5.5 Contract-specific rules

- **IPC channels** — removing a `IpcChannel.*` key or an allowlist membership requires major +
  guide; adding a channel is additive (**minor**). Because the preload allows only the union of
  the allowlists, a channel silently dropped from an allowlist is **breaking** even if the key
  remains — allowlist membership is part of the contract.
- **SDK / REST** — changing a `NeuroPauseClient` resource method signature, or the meaning of a
  `v1` route, is breaking → major + guide + (for routes) a **new `ApiVersion`**. Additive fields,
  new resources, and new routes are **minor**. Webhook payload shape and its signature
  (`signWebhook`/`verifyWebhook`) are contract; a breaking change follows the same major + guide path.
- **Deprecation as an ADR** — every deprecation decision is an ADR (`PRODUCT-EVOLUTION.md §4`),
  immutable once Accepted, superseded only by a later ADR. No ADR ⇒ no deprecation.

---

## Provenance & scope

- **Real (cited):** the seven open items, severities, owning roles, and waves
  (`GOVERNANCE-MATRICES.md §2–4`; `CONTINUOUS-IMPROVEMENT.md §2`); the rubric and Now/Next/Later
  mapping (`PRODUCT-EVOLUTION.md §2–3`); the quality gates (typecheck/lint/**3,856** tests/build/
  `npm audit --omit=dev`) and CI (`backend-ci`, `deploy-validation`, `windows-release`); the SemVer
  scheme (`RELEASE-OPERATIONS.md §1`); the IPC contract (`packages/shared/src/ipc/channels.ts`) and
  SDK/REST contract (`packages/sdk/src/{index,client,transport}.ts`, OpenAPI 3.1 `api:openapi`).
- **Defined (this document):** the horizon admission / label / entry-move-exit discipline, the
  planning ritual + template, the Definition of Ready, the acceptance gate + label promotion, and
  the deprecation policy — governance over the real substrate; **no runtime added.**
- **Blank / absent (honest):** every customer-driven slot (no pilot has run); capacity as relative
  wave-slots (no velocity/headcount); every date (waves and relative quarters only). **No customer,
  demand, metric, or completion date appears anywhere.** The roadmap is seeded **only** with the
  real open items and real capabilities; the platform is a **Validated Release Candidate**
  (`1.0.0-rc.1`). Roles, never people.
