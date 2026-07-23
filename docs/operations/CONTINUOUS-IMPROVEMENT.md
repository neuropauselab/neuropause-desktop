# NeuroPause EOSP — Continuous Improvement & Operational Maturity

> **What this is.** The **improvement-loop** manual for the Enterprise Operations & Scale
> Program (EOSP): how NeuroPause's operating maturity is _honestly_ self-assessed, how the
> **real** open items become a prioritized backlog, the cadences that work them, the blameless
> postmortem that feeds them, and how measured coefficients + SLO burn drive optimization. It
> adds **no runtime and no platform** — it is roles, cadences, a maturity rubric, and decision
> rules over the assets and reports in `_grounding.md`.
>
> **Honesty banner (non-negotiable).** There is **no production fleet.** The platform is a
> **Validated Release Candidate** (`ENTERPRISE-VALIDATION-REPORT.md §10`), not GA and not
> "Proven." Consequently **no operating domain is at "Measured" or "Optimizing"** — those
> levels consume production telemetry that does not exist. Ops maturity is **Initial→Defined**,
> never "optimized." The backlog below is the **real** open item set from
> `ENTERPRISE-GA-REPORT.md §8` and `ENTERPRISE-VALIDATION-REPORT.md §9` — **no invented
> initiatives, no completion dates, no velocity.** Sequence encodes dependency, not schedule.
> This document **extends**, and does not restate, `SRE.md`, `OPERATIONS-GUIDE.md`,
> `OPERATIONAL-RUNBOOKS.md`, `RELEASE-CHECKLIST.md`, `DISASTER-RECOVERY-GUIDE.md`, and
> `CUSTOMER-SUCCESS.md`. Roles, never people.

## 1. Operational maturity model

A five-level model (CMMI-flavored) applied to the five EOSP domains — **ops/day-2, SRE,
security, release, support**. A domain claims a level only on cited evidence; it rises only
when the named blocker below actually closes.

### The five levels

| Lvl   | Name           | Definition                                                                                                             | Entry evidence                                                              | Requires                       |
| ----- | -------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------ |
| **1** | **Initial**    | Reactive/ad hoc; process improvised; outcome depends on individual effort.                                             | Work happens, but not repeatably.                                           | —                              |
| **2** | **Managed**    | Repeatable on known cases; documented but reactive; not standardized across the domain.                                | A proven procedure for the common path.                                     | Documented, drilled procedure. |
| **3** | **Defined**    | Standardized, role- and cadence-owned, proactive; applied uniformly — but not yet controlled by quantitative feedback. | Cadence + roles + gates, applied uniformly.                                 | Org-wide standardization.      |
| **4** | **Measured**   | Controlled by real metrics; performance tracked against objectives on production telemetry; decisions data-driven.     | SLOs **ratified against production data**; budgets burning on real traffic. | **A production fleet.**        |
| **5** | **Optimizing** | Closed feedback loop drives deliberate, often automated, optimization; the process improves itself.                    | Measured baselines + continuous/automated improvement acting on them.       | **Level 4 first.**             |

### The production-data ceiling (why nothing is above Defined)

Levels **4 and 5 both consume production telemetry that does not exist** — there is no fleet,
so no achieved uptime, MTTR, burn, or forecast exists (`_grounding.md` rule 2). Therefore **no
EOSP domain can honestly sit above Level 3 today.** The ceiling lifts only when a production
fleet comes online and its first-90-days data **ratifies** the proposed SLOs (`SRE.md §3`).
Placing any domain at "Measured" or "Optimizing" now would be fabrication, not maturity.

### Maturity self-assessment (honest, evidence-cited)

| Domain          | Current                   | Next target           | Why here (real evidence)                                                                                                                                                                                                 | Blocker to next level                                                                                                                                                                     |
| --------------- | ------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SRE**         | **Defined (3)**           | Measured (4)          | Full SLI/SLO/error-budget/capacity discipline defined over the **real** substrate (`SRE.md §2–6`); every SLI resolves to a real `/metrics`/`/health` series or a reproducible bench. Most-developed domain **on paper**. | SLOs are **proposed/unratified**; no burn data; alert routing absent. Measured needs production telemetry — **no fleet**.                                                                 |
| **Ops / day-2** | **Managed→Defined (2→3)** | Defined (3)           | Proven runbooks (`OPERATIONAL-RUNBOOKS.md` — restart, PG/Redis, backup drill) + EOSP cadence now standardizes their invocation.                                                                                          | Execution is **manual** — no alert routing, a standing toil watch (`SRE.md §1`). No telemetry-driven control; Measured needs a running fleet.                                             |
| **Security**    | **Managed→Defined (2→3)** | Defined (3)           | 0 production npm-audit vulns; documented SDLC gates (`CODEOWNERS`, `RELEASE-CHECKLIST.md`, `backend-ci.yml` npm-audit); threat model + EVP vertical **readiness** mappings.                                              | **Two open HIGH findings** (Apple JWKS, unsigned install); compliance is **readiness-mapping only — not certified, no audit has occurred**; no runtime security alerting.                 |
| **Release**     | **Managed→Defined (2→3)** | Defined (3)           | Strong per-release gate (`RELEASE-CHECKLIST.md`); backend CI + **Windows** release automation (`windows-release.yml`); contributor scaffolding (`CONTRIBUTING.md`).                                                      | **No per-PR desktop CI**, **no macOS release automation**, rollback **advisory** — the desktop/macOS path is still Managed. Measured needs change-fail/lead-time data from real releases. |
| **Support**     | **Initial→Managed (1→2)** | Managed→Defined (2→3) | Adoption lifecycle defined (`CUSTOMER-SUCCESS.md`/GEAP); EOSP support-org framework (tiers, SLA definitions) drafted.                                                                                                    | **No ticketing operation runs**; no ticket telemetry; SLA framework is **proposed, not measured.** Least-developed domain — furthest from a live operation.                               |

### Reading the self-assessment

SRE is the most-developed domain because its discipline is fully specified (`SRE.md`), yet it
is still only **Defined** — being blocked at Measured is not a design gap, it is the honest
consequence of having **no fleet to measure**. Support is the least-developed because it is
furthest from a running operation. Ops, security, and release cluster at the **Managed→Defined
boundary**: their _documentation_ is Defined-grade, but their _automation/execution coverage_
still has Managed-grade holes — manual alert watch, two open HIGH findings, partial desktop CI.
The single fact behind every placement: **you cannot quantitatively manage a system with zero
production telemetry**, so the whole program is capped at Defined until production data exists.

## 2. Improvement backlog

### How the backlog is built

Entries are drawn **only** from the real reports — no initiative is invented. Each carries a
**severity**, a **source report**, a **proposed sequence (wave)**, and an **owning role**. No
entry carries a date or an assumed velocity; sequence encodes **dependency**, not schedule.

**Severity taxonomy** (aligned to the `_grounding.md` risk register):

- **HIGH** — security blocker; strictly gates GA (`ENTERPRISE-GA-REPORT.md §8`, "Security (blockers)").
- **MEDIUM** — real day-2 / release-engineering gap; hardening, not a GA blocker.
- **GA-gating validation gap** — not a defect, but blocks the Validated-RC→Proven / RC→GA transition.

### Primary backlog — the real open items (GA-gating set)

| #     | Open item                                                                                                                                                                             | Severity                                                 | Source report(s)                             | Proposed sequence                  | Owning role  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------- | ---------------------------------- | ------------ |
| **1** | **Apple `id_token` JWKS verification** — verify against Apple's JWKS before trusting claims (seam/TODO exists in `apple.ts`).                                                         | **HIGH**                                                 | GA §8 TD-1; Val §9(1); risk register HIGH    | **Wave 1** (security blocker)      | Security eng |
| **2** | **Signed / trusted marketplace app install** — require a valid signature or explicit non-empty publisher trust store; align with the fail-closed worker path.                         | **HIGH**                                                 | GA §8 TD-2; Val §9(2); risk register HIGH    | **Wave 1** (security blocker)      | Security eng |
| **3** | **Target-hardware desktop benchmarks** — run the existing harness (§2.5) on macOS Apple-Silicon against live infra (startup/render/IPC/renderer-memory).                              | **GA-gating validation gap** (highest-leverage, Val §10) | GA §8(6); Val §9(4), §10                     | **Wave 1** (parallel, independent) | Perf / QA    |
| **4** | **Per-PR desktop CI** — typecheck + lint + the 3,548 desktop tests on every PR.                                                                                                       | **MEDIUM**                                               | GA §8 TD-4; Val §9(9); risk register MEDIUM  | **Wave 2** (release eng)           | Release eng  |
| **5** | **macOS release automation** — packaging/signing/notarization in release CI; mirror `windows-release.yml`.                                                                            | **MEDIUM**                                               | GA §8 TD-4; Val §9(9)                        | **Wave 2** (after #4)              | Release eng  |
| **6** | **Automated, tested update rollback** — promote from advisory to an automated path (data-side restore remains the real recovery).                                                     | **MEDIUM**                                               | GA §8 TD-5; Val §9(10)                       | **Wave 2** (after #4)              | Release eng  |
| **7** | **Alerting + tracing + capacity forecasting** — wire alert routing off `/metrics`, add distributed tracing and a forecasting baseline; make the rate-limit fail-open (TD-3) an alert. | **MEDIUM**                                               | GA §8 TD-6; Val §9(11); risk register MEDIUM | **Wave 3** (day-2 ops)             | SRE / Ops    |

### Proposed sequence (waves — dependency, not dates)

- **Wave 1 — GA blockers, run in parallel.** The two HIGH security finishes (#1, #2) and the
  target-hardware benchmarks (#3) touch independent subsystems (backend auth vs desktop runtime)
  and are the highest-leverage steps per `Val §10` ("close 1–2 and 4 first"). They proceed
  concurrently; **#1 and #2 are the only strict GA blockers** — closing them plus #3 clears the
  §8 exit bar for the security/validation gates.
- **Wave 2 — release engineering.** Per-PR desktop CI (#4) comes **first**: both macOS
  automation (#5) and automated rollback (#6) need a green desktop test gate to be trustworthy.
  Order: **#4 → {#5, #6}**.
- **Wave 3 — day-2 observability.** Alerting/tracing/forecasting (#7) wires over the **real**
  `/metrics` substrate (the rule set is already drafted in `SRE.md §4`). It removes the largest
  standing toil item (manual alert watch, `SRE.md §1`) and lifts **Ops** from manual toward
  telemetry-driven — but it is **not** a GA blocker, so it trails the blocking waves.

> The wave numbers are an ordering constraint only. No item is assigned a completion date, a
> sprint count, or a throughput figure — none exists to cite (`_grounding.md` rules 1–2).

### Secondary / also-tracked (real, cited, lower priority)

| Item                                                                                   | Severity            | Source                   | Note                                                                                |
| -------------------------------------------------------------------------------------- | ------------------- | ------------------------ | ----------------------------------------------------------------------------------- |
| Rate-limit **fail-open alert** (TD-3)                                                  | MEDIUM              | Val §9(3); risk register | Fail-open is **deliberate** — surface as an **alert**, not a "fix"; folded into #7. |
| Renderer component/E2E smoke + a11y tests + coverage (TD-7)                            | MEDIUM (validation) | GA §8(7)                 | Complements #4; raises desktop test confidence.                                     |
| Real AI-model/connector execution + cross-device sync validation                       | Validation gap      | Val §9(5)                | Needs live credentials/services.                                                    |
| Full offline bundle build/transfer                                                     | Validation gap      | Val §9(6)                | Run `scripts/build-offline-bundle.sh` on a Docker host.                             |
| Long-run chaos / network-partition injection                                           | Validation gap      | Val §9(7)                | Needs a multi-node target.                                                          |
| Vertical **pilots** (convert reference packs → proven)                                 | Validation gap      | Val §9(8)                | A real pilot per vertical converts "reference" to "proven."                         |
| Nice-to-have: bundle trim (TD-8), remaining admin-scope UI (TD-9), hash review (TD-10) | Low                 | GA §8 "Nice-to-have"     | Non-gating; work opportunistically.                                                 |

### Backlog → maturity lift

Closing a backlog item is only credited as a maturity gain when it removes a **named §1
blocker** — this is what the quarterly reassessment audits:

- **#1, #2** closed and green in CI → clears Security's open-HIGH blocker → **Security → Defined (3)**.
- **#4, #5, #6** shipped → closes the desktop/macOS CI + rollback blocker → **Release → Defined (3)**.
- **#7** wired → removes the manual-alert-watch toil → **Ops → Defined (3)** (execution stops being manual).
- **A production fleet + ratified SLOs** (`SRE.md §3`) → the _only_ lever that lifts any domain to **Measured (4)**; nothing in the backlog can do it alone.

## 3. Review cadence

Three nested loops feed one backlog. Each is executable — a fixed agenda, an owning role,
defined inputs and outputs.

| Cadence                             | Owner role                            | Primary inputs                                                             | Primary outputs                                                           |
| ----------------------------------- | ------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Weekly ops retro**                | Primary on-call / SRE lead (rotating) | On-call handoff, incidents + runbooks invoked, budget-burn state, toil log | New/updated backlog items, runbook edits, toil-reduction candidates       |
| **Monthly improvement review**      | Eng/Ops lead                          | Month's postmortem actions, backlog state, recurring themes                | Re-prioritized backlog, sequence adjustments, staffing/automation signals |
| **Quarterly maturity reassessment** | Eng leadership + domain leads         | The §1 self-assessment, quarter's shipped items, any new production data   | Updated maturity placements, revised targets, GA-readiness read           |

### Weekly ops retro — agenda

1. **On-call handoff review** — open incidents, error-budget **burn state**, any dependency
   running degraded (Redis fail-open / PG reconnecting), pending DR drill (`SRE.md §1` checklist).
2. **Incidents since last retro** — each has a blameless postmortem started? (§4).
3. **Budget burn** — did any fast/medium/slow burn tier fire (`SRE.md §4`)? Ticket vs page audit.
4. **Toil log** — did any manual watch approach the **≤50% on-call cap** signal (`SRE.md §1`)?
5. **Backlog triage** — file new items, re-rank, close verified; confirm severities.
6. **Actions → owning roles** (never individuals).

### Monthly improvement review — agenda

1. **Backlog health** — primary items by wave: status only (no invented % or date); blocked items + why.
2. **Postmortem closure** — which lessons became backlog items; which shipped.
3. **Recurring-theme scan** — systemic vs one-off across the month's incidents and toil.
4. **Sequence sanity** — do wave dependencies still hold (e.g., desktop CI **before** rollback automation)?
5. **Maturity check-in** — is any domain's §1 blocker now removable?
6. **Decide** — promote/demote items; open new toil-reduction wiring.

### Quarterly maturity reassessment — agenda

1. **Re-score each domain** against the §1 model — evidence-cited; a level rises **only** when its named blocker closes.
2. **Ceiling check** — has a production fleet come online? If **no**, reaffirm the **Level-3 cap**; if **yes**, begin SLO ratification (`SRE.md §3`) — the only path to Measured (4).
3. **GA-readiness** — are blockers **#1, #2** closed and **green in CI** (GA §8 exit rule)? Update RC→GA posture.
4. **Compliance posture** — reaffirm "**readiness-mapping, not certified**"; note any audit-prep evidence advanced (EVP packs).
5. **Reset next-quarter targets** per domain — as roles and outcomes, never dates.

## 4. Lessons learned

### Principles

Blameless: analysis targets **systems and process, never individuals** (`_grounding.md` rule 5).
Assume everyone acted with good intent on the information they had. A postmortem is **required**
for every SEV1 and any SEV2 that burned budget or invoked a runbook twice (`SRE.md §1`).

### Blameless postmortem template

| Field                               | Content                                                                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID / window / severity**          | Incident ID, the recorded time window (real, not fabricated), SEV level (`SRE.md §1`).                                                         |
| **Summary**                         | 1–2 lines, no blame.                                                                                                                           |
| **Impact**                          | Which SLI/path; against which **proposed** SLO; budget consumed **if a fleet exists** — else "n/a — no production fleet."                      |
| **Timeline**                        | From the `audit_log` narrative + Scribe notes: detection → runbook invoked → recovery. **Reference** the runbook by number; do not restate it. |
| **Real failure mode**               | Map to a **proven** mode (PG-down/no-recover, restart loop, Redis fail-open, pool saturation — `SRE.md §1`).                                   |
| **Root cause(s)**                   | Technical **and** process; 5-whys to a systemic cause.                                                                                         |
| **Went well / was toil / was luck** | Especially: was there a signal, and was it **watched** given no alert routing?                                                                 |
| **Detection gap**                   | Would item **#7** (alerting) have caught this automatically?                                                                                   |
| **Action items**                    | Each → a backlog entry (§2) with **severity + owning role**.                                                                                   |
| **Lessons**                         | Generalizable; map to a maturity **blocker** where relevant.                                                                                   |

### How lessons feed the backlog (the loop)

Every action item is filed into the improvement backlog (§2) under the **same severity
taxonomy** with an **owning role** — not a due date. **Recurring** action items across
postmortems are the signal that a **maturity blocker**, not just a bug, needs work: repeated
"we had no alert; someone happened to notice" entries are the concrete case for closing item
**#7**. The **monthly** review audits closure; the **quarterly** reassessment credits a maturity
gain **only when the blocker actually closes** — never on intent.

## 5. Continuous optimization

### The two feedstocks

Optimization is fed by exactly two inputs — and today **one is real, one is proposed**:

1. **Measured coefficients (REAL, live now).** Per-replica read floor **400–600 rps**, RSS
   **≈230 MB**, pg pool **1→10**, Argon2id **~50 verifies/s/core**, restart **0.46 s**
   (`SRE.md §6`; `_grounding.md`). Any change — a new bench run, a tuned Argon2 cost, a schema
   change — **re-runs the §6 capacity sizing.** This is the perf/capacity optimization path, and
   it works **today** without a fleet.
2. **SLO burn (PROPOSED until a fleet exists).** Once `/metrics` is scraped in production,
   burn-rate signals (`SRE.md §4`), pool-saturation, and memory-headroom SLIs become the
   **triggers** for scale/perf action. Absent a fleet, these triggers are **wired but not firing.**

### Optimization triggers

| Signal (source)                                                             | Meaning                            | Optimization action                                            | Live today?                 |
| --------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------- | --------------------------- |
| Off-box bench beats the 500 rps floor (new `PERFORMANCE-BENCHMARKS.md` run) | Conservative floor was pessimistic | **Trim** replica count from the §6 projection                  | **YES** — re-run bench      |
| Argon2 cost raised for security                                             | verifies/s/core drops              | Re-run **auth sizing** (`SRE.md §6`) — capacity/security trade | **YES**                     |
| `pg_pool_connections{state="waiting"} > 0` sustained (real `/metrics`)      | Queuing before pool max            | Scale out or raise pool (Runbook 4)                            | Needs scrape (proposed)     |
| `resident_memory_bytes` trending to limit                                   | RSS headroom shrinking             | Raise limit or scale out (Runbook 4)                           | Needs scrape (proposed)     |
| Fast/medium budget burn (`SRE.md §4`)                                       | Budget spending too fast           | Freeze risky deploys; prioritize reliability backlog           | Needs fleet (proposed)      |
| Capacity forecast over the `/metrics` series (item **#7**)                  | Demand trend                       | Pre-scale ahead of known events                                | Needs #7 + fleet (proposed) |

### The honest limit

**Optimizing (Level 5) is structurally unreachable now** — it consumes production burn and
forecast data that does not exist. What **is** live is the **measured-coefficient half** of the
loop: perf/capacity re-sizing off new bench runs (`SRE.md §6`). The **SLO-burn half** activates
only after a fleet exists and the SLOs are **ratified** (`SRE.md §3`). This section is therefore
a **wired-and-waiting loop**, not a running optimizer; describing it as anything more would
violate the no-fabricated-metrics rule.

## Provenance & scope

- **Real (measured / shipped):** capacity coefficients and reliability outcomes (`SRE.md §6`,
  `PERFORMANCE-BENCHMARKS.md`, `RELIABILITY-RESULTS.md`, `_grounding.md`); the open-item set and
  severities (`ENTERPRISE-GA-REPORT.md §8`, `ENTERPRISE-VALIDATION-REPORT.md §9`); the quality
  baseline (0 typecheck / 0 lint / 3,856 tests / 0 prod-vuln build).
- **Defined (this document):** the maturity rubric, self-placements, cadences, postmortem
  template, and optimization triggers — process over the real substrate; **no runtime added.**
- **Proposed / absent (honest):** all SLOs and burn signals, alert routing, tracing, capacity
  forecasting, and every maturity level above **Defined (3)** — all await a production fleet.
  **No achieved uptime, MTTR, availability, velocity, or completion date appears anywhere in
  this document.** The platform is a **Validated Release Candidate**; ops maturity is
  **Initial→Defined**, never "optimized."
