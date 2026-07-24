# NeuroPause CDEP — Operational Learning (Pilot-Side)

> **What this is.** The **learning loop** for a real customer pilot: how a
> deployment's lessons are captured, how a post-deployment review reads the
> **real** Evidence-Collection artifacts, how an incident observed _during a
> pilot_ gets a blameless root-cause review, and how every finding becomes a
> tracked change in the **real** EOSP improvement backlog. It adds **no runtime
> and no platform** — it is roles, templates, and routing over assets that
> already exist.
>
> **Honesty banner (non-negotiable).** **No pilot has run.** Every table below is
> a **blank instrument** to be filled during a real deployment — never a record of
> one that happened (`_grounding.md` rules 1, 5). There is **no production fleet**,
> so no achieved uptime, MTTR, incident, satisfaction, or ROI number appears
> anywhere here. The single worked root-cause example in §3 is **labelled
> illustrative and hypothetical**; it is a template walk-through, not operational
> history. Root causes anchor to the **real** known failure modes and open items
> (Redis-down fail-open, PG-down degrade, advisory rollback, the two HIGH security
> findings) — nothing invented.
>
> **Extends, does not restate.** This builds on EOSP
> `operations/CONTINUOUS-IMPROVEMENT.md` (the improvement backlog §2, the blameless
> postmortem §4) and the EVP `validation/OPERATIONAL-RUNBOOKS.md` (Runbooks 1–5,
> the _proven_ reliability behaviors). Incidents are **referenced by runbook
> number**, never re-described. Roles, never people.

## 0. Where this sits in CDEP

This document is the instrument behind two rows of the **Operational Feedback
Matrix** (`PILOT-MATRICES.md §4`): _Incidents / RCA → continuous improvement
(EOSP)_ and _Deployment lessons → knowledge base_. It consumes the **Evidence
Collection Matrix** (`§3`) artifacts and emits into two destinations:

| Emits to                     | Meaning (grounded)                                                                | Destination asset                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Product Evolution**        | the product-evolution intake / evidence-based roadmap for customer-sourced signal | `CUSTOMER-FEEDBACK.md` guides + the issues/feature-request workflow (`§4`)                       |
| **Knowledge Base**           | deployment lessons + repeatable operational patterns                              | playbooks, `DEPLOYMENT-AUTOMATION.md`, pattern catalog → `validation/REFERENCE-ARCHITECTURES.md` |
| **EOSP improvement backlog** | reliability/security/perf findings that need engineering                          | `operations/CONTINUOUS-IMPROVEMENT.md §2` (the **real** open-items list)                         |

Pilot roles used throughout (from `PILOT-MATRICES.md §2`; roles, not people):
**Deployment Lead** (chairs), **Pilot SRE** (on-call during the pilot),
**Security eng**, **Customer Sponsor**, **Product intake owner**.

---

## 1. Lessons-learned framework

### 1.1 Capture model — what / so-what / now-what

Every lesson is recorded in three moves, facts first, so a reader who was not
present can act on it:

- **What** — the observation, **facts only**, no interpretation. What was seen,
  which step, which signal (`/health` field, `/metrics` series, harness output).
- **So what** — why it matters: which **pilot success or rollback criterion**
  (`PILOT-FRAMEWORK.md`) it touches, which customer path, or which product area.
- **Now what** — the change it drives, with an **owning role** and a destination
  (§0). A lesson with no "now what" is not captured — it is a note.

A lesson is captured whenever a deployment step, harness run, interview, or
incident yields a generalizable signal — not only when something breaks.

### 1.2 Blank capture template

> Copy one block per lesson. Ships **empty**; fill during a real pilot.

| Field                              | Entry                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| Lesson ID                          | `LL-<pilot>-<nnn>`                                                           |
| Date captured                      | `<YYYY-MM-DD>`                                                               |
| Source                             | `<review / incident RCA / interview / harness run / deploy step>`            |
| Pilot phase                        | `<entry / deploy / operate / exit>` (`PILOT-FRAMEWORK.md`)                   |
| **What** (observation, facts only) | `<what was seen — no interpretation>`                                        |
| **So what** (impact)               | `<which success/rollback criterion, customer path, or product area>`         |
| **Now what** (action + role)       | `<the change> — <owning role>`                                               |
| Lesson type                        | `<taxonomy §1.3>`                                                            |
| Routes to                          | `<Product Evolution / Knowledge Base / EOSP backlog / Root-cause review §3>` |
| Status                             | `<open / routed / closed-verified>`                                          |

### 1.3 Taxonomy of lesson types

Type fixes the owning role and the destination — routing is not ad hoc.

| Type                          | Trigger (what generated it)                   | Owning role     | Routes to                                              |
| ----------------------------- | --------------------------------------------- | --------------- | ------------------------------------------------------ |
| **Deployment / provisioning** | install, migration, config/secrets friction   | Deployment Lead | Knowledge Base (`DEPLOYMENT-AUTOMATION.md`, playbooks) |
| **Reliability / incident**    | a runbook was invoked (Runbook 1–5)           | Pilot SRE       | Root-cause review §3 → EOSP backlog                    |
| **Performance / capacity**    | a bench result vs the reference floor         | Pilot SRE       | EOSP capacity re-size (`CONTINUOUS-IMPROVEMENT.md §5`) |
| **Security / trust**          | an auth or install-trust finding              | Security eng    | EOSP backlog **#1 / #2** (HIGH)                        |
| **Product / UX gap**          | friction, missing capability, feature request | Product intake  | Product Evolution (`CUSTOMER-FEEDBACK.md`)             |
| **Process / methodology**     | the pilot process itself needs a fix          | Deployment Lead | This program / `PILOT-FRAMEWORK.md`                    |
| **Documentation gap**         | a doc was wrong or missing at pilot time      | Deployment Lead | Knowledge Base (`DOCUMENTATION-PROGRAM.md`)            |
| **Reinforcing (what worked)** | a pattern worth repeating                     | Deployment Lead | Pattern catalog → `REFERENCE-ARCHITECTURES.md`         |

---

## 2. Post-deployment review

A **once-per-pilot** review held at the exit gate — distinct from the recurring
internal EOSP cadences (`CONTINUOUS-IMPROVEMENT.md §3`), which it **feeds** rather
than duplicates. Chaired by the Deployment Lead; attended by Pilot SRE, Security
eng, Customer Sponsor, and Product intake owner.

### 2.1 Inputs — the Evidence-Collection artifacts

The review reads the artifacts produced by the **real** harnesses at pilot time
(`PILOT-MATRICES.md §3`). Each is generated _in the customer's environment_; **no
result exists yet** — the tool is Ready, the result is a Template until the pilot
runs it.

| Evidence class (§3)        | Real generator                                           | What the review reads                       |
| -------------------------- | -------------------------------------------------------- | ------------------------------------------- |
| Performance                | `bench/http-load.mjs`, `db-latency.mjs`, `startup.sh`    | customer p50/p95/p99 vs the reference floor |
| Reliability                | reliability procedures (`RELIABILITY-RESULTS.md`)        | pass/fail per scenario, at the customer     |
| Availability / health      | `GET /health`, `/live` + external blackbox probe         | uptime series over the pilot window         |
| Resource / capacity        | `GET /metrics` gauges                                    | RSS / heap / pg-pool trend                  |
| Security                   | control inventory + `npm audit --omit=dev` + `audit_log` | posture report; open-HIGH status            |
| Migration / data integrity | `db:migrate` + backup/restore row-count                  | integrity proof                             |
| Acceptance                 | scorecards + gates (`DEPLOYMENT-QUALITY.md`)             | signed acceptance                           |
| Business                   | ROI methodology inputs (customer-sourced)                | value model (**no fabricated numbers**)     |

### 2.2 Agenda

1. **Scope + roll call** — confirm the pilot, phases, and attending roles.
2. **Evidence walkthrough** — read each §2.1 artifact against its target; a
   **missing** artifact is itself a gap to record.
3. **Success-criteria verdict** — met / not-met per criterion, against
   `PILOT-FRAMEWORK.md` entry/success/rollback criteria.
4. **Incident review** — did every runbook invoked during the pilot get a §3
   root-cause review started? (SEV1 and budget-touching SEV2 are mandatory.)
5. **Lesson harvest** — capture each finding as a §1 lesson (what/so-what/now-what).
6. **Routing** — assign every lesson a destination (§0) with an owning role.
7. **Scorecard sign-off** — fill §2.3; Customer Sponsor + Deployment Lead sign.
8. **Feed-forward** — deltas roll into `CUSTOMER-DEPLOYMENT-REPORT.md` and onto
   the EOSP **monthly improvement review** (`CONTINUOUS-IMPROVEMENT.md §3`).

### 2.3 Blank scorecard

> Ships **empty**. Every Result/Status cell is filled only from a real §2.1
> artifact. `reference floor` = the EVP 2-vCPU numbers — **our** floor, not a
> customer target (`_grounding.md`).

| Dimension          | Evidence source                               | Target / reference               | Result | Status | Lesson → route |
| ------------------ | --------------------------------------------- | -------------------------------- | ------ | ------ | -------------- |
| Deployment success | deploy checklist (`DEPLOYMENT-AUTOMATION.md`) | all steps green                  |        |        |                |
| Performance        | `bench/http-load.mjs` JSON                    | ≥ reference floor                |        |        |                |
| Reliability        | reliability scenarios                         | all PASS                         |        |        |                |
| Availability       | blackbox `/health` probe                      | pilot SLO (`PILOT-FRAMEWORK.md`) |        |        |                |
| Capacity headroom  | `/metrics` gauges                             | within container limits          |        |        |                |
| Security posture   | `npm audit` + control inventory               | 0 prod-vuln; HIGH status         |        |        |                |
| Data integrity     | backup/restore row-count                      | exact match                      |        |        |                |
| Acceptance         | signed scorecard                              | Sponsor sign-off                 |        |        |                |
| Product / UX       | interview outputs (`CUSTOMER-FEEDBACK.md`)    | —                                |        |        |                |
| Pilot process      | this program                                  | —                                |        |        |                |

### 2.4 Outputs — feeds Product Evolution + Knowledge Base

- **Product Evolution** ← Product/UX and feature-request lessons, via
  `CUSTOMER-FEEDBACK.md` intake and the evidence-based roadmap (`§4`).
- **Knowledge Base** ← Deployment, documentation, and reinforcing-pattern lessons,
  into the playbooks and the pattern catalog (`REFERENCE-ARCHITECTURES.md`).
- **EOSP backlog** ← Reliability/security/perf lessons, via §3 → §4.
- The scorecard and verdict roll up into `CUSTOMER-DEPLOYMENT-REPORT.md`.

---

## 3. Root-cause review (blameless)

Used when a runbook is invoked during a pilot. **Blameless**: analysis targets
**systems and process, never individuals** (`_grounding.md` rule 5); assume
everyone acted with good intent on the information they had. This is the
**pilot-side capture**; on hand-off to engineering it **becomes** the EOSP
blameless postmortem (`CONTINUOUS-IMPROVEMENT.md §4`) — one record, not two
divergent ones. Required for every SEV1 and any SEV2 that touched a pilot
rollback criterion (severity per `SRE.md §1`).

### 3.1 Blank RCA template

| Field                     | Entry                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RCA ID / pilot / severity | `RCA-<pilot>-<nnn>` / `<pilot>` / `<SEV1–3, SRE.md §1>`                                                                                                |
| Recorded window           | `<start–end, from audit_log — real, never fabricated>`                                                                                                 |
| Summary                   | `<1–2 lines, no blame>`                                                                                                                                |
| Pilot impact              | `<which success/rollback criterion (PILOT-FRAMEWORK); customer path>`                                                                                  |
| Budget note               | `n/a — no production fleet` (a pilot has no ratified SLO budget)                                                                                       |
| **Timeline**              | `<detection → runbook invoked (by NUMBER) → recovery; reference OPERATIONAL-RUNBOOKS, do not restate>`                                                 |
| Real failure mode         | `<map to a PROVEN mode: redis-down-fail-open / db-down-degradation-autorecover / backend-restart-recovery / pool saturation — RELIABILITY-RESULTS.md>` |
| **Contributing factors**  | `<technical AND process; multiple; blameless>`                                                                                                         |
| **5-whys**                | `<see §3.2 scaffold — converge on a systemic cause / a real open item>`                                                                                |
| Detection gap             | `<would item #7 alert routing have caught this automatically? yes/no>`                                                                                 |
| **Corrective actions**    | `<each → an EOSP backlog entry (§2): severity + owning role; or "working as designed — no action">`                                                    |
| Lessons                   | `<generalizable; map to a maturity blocker where relevant; file as a §1 lesson>`                                                                       |

### 3.2 5-whys scaffold (blank)

```
Why did <symptom> happen?           → because <...>
Why did <that> happen?              → because <...>
Why did <that> happen?              → because <...>
Why did <that> happen?              → because <...>
Why did <that> happen?              → ROOT / systemic cause: <a process gap or a real open item #1–#7>
```

### 3.3 Failure-mode → runbook → real open-item map

The **only** root causes an RCA may cite are the real, proven modes and the real
open items. This table binds each to its runbook and its anchor — **no invented
failure modes**.

| Observed failure mode        | Real runbook                                            | Proven behavior (`RELIABILITY-RESULTS.md`)                      | Real root-cause anchor / open item                                         |
| ---------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Redis unreachable            | **Runbook 1** (`redis-down-fail-open`, PASS)            | reads 200, `/health` 503 `redis:down`, no crash                 | Fail-open is **deliberate**; the gap is **no alert** → item **#7** / TD-3  |
| Postgres unreachable         | **Runbook 2** (`db-down-degradation-autorecover`, PASS) | clean 500s, pool **auto-reconnects**, no restart                | Recovery proven; watch migration overlap (`DISASTER-RECOVERY-GUIDE.md §4`) |
| Restart / recycle            | **Runbook 3** (`backend-restart-recovery`, PASS)        | healthy in ~**0.46 s**, zero-downtime rollout                   | If restarts **loop** → upstream bad env, not the app                       |
| High latency                 | **Runbook 4**                                           | infer from `pg_pool ...{state="waiting"}>0` (no latency series) | App/CPU/pool-bound on 2-vCPU → scale-out                                   |
| App-binary rollback needed   | — (advisory)                                            | advisory only; **real recovery is data-side** (Runbook 5)       | Advisory rollback → open item **#6** (automate)                            |
| Auth token trust concern     | —                                                       | —                                                               | Apple `id_token` not JWKS-verified → open item **#1** (**HIGH**)           |
| Unsigned marketplace install | —                                                       | —                                                               | Install accepts unsigned when trust store empty → item **#2** (**HIGH**)   |

### 3.4 Worked example — ILLUSTRATIVE, NOT A REAL EVENT

> **This is a hypothetical template walk-through — not a real incident.** No pilot
> has run; the customer, the window, and every value below are invented solely to
> show how §3.1 is filled. **Do not cite as operational history.**

| Field                     | Entry (illustrative)                                                                                                                                                                                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RCA ID / pilot / severity | `RCA-<illustrative>-001` / _hypothetical pilot_ / **SEV2**                                                                                                                                                                                                                                                                 |
| Recorded window           | _illustrative_ — a ~40-min degraded window                                                                                                                                                                                                                                                                                 |
| Summary                   | Managed Redis failover made the endpoint behind `REDIS_URL` unreachable; the rate limiter **failed open** and the window went unnoticed until a scheduled manual `/health` check.                                                                                                                                          |
| Pilot impact              | Availability path stayed up (reads served); touched the _"rate-limiting enforced"_ pilot check, not the read-path rollback criterion.                                                                                                                                                                                      |
| Budget note               | `n/a — no production fleet`                                                                                                                                                                                                                                                                                                |
| Timeline                  | Redis unreachable → `/store/apps` keeps serving **200** (**Runbook 1**, fail-open) → `/health` = **503 `degraded` `redis:down`**, `backend_up` stays **1** → **no page fired (no alert routing)** → Pilot SRE catches it on a manual `/health` check → executes **Runbook 1** restore → `/health` **200 `ok` `redis:up`**. |
| Real failure mode         | `redis-down-fail-open` (PASS) — the platform behaved **exactly as proven**: no crash, reads served, `backend_up=1`.                                                                                                                                                                                                        |
| Contributing factors      | (a) deliberate fail-open design — availability over strict limiting, **not a defect**; (b) **no alert routing** on `/health` degraded — the real gap (open item **#7** / TD-3); (c) manual `/health` checks are the only detection today — standing toil (`SRE.md §1`).                                                    |
| 5-whys                    | Limiting bypassed → Redis unreachable → limiter fails open **by design** → no one noticed → **no alert wired on `/health` degraded (item #7)** ⟵ systemic root.                                                                                                                                                            |
| Detection gap             | **Yes** — item **#7** alert routing (`neuropause_backend_up`/`/health` degraded) would have paged automatically instead of waiting for a manual check.                                                                                                                                                                     |
| Corrective actions        | **None against the platform** — fail-open is working as designed. File this window as **pilot evidence for backlog #7 / TD-3** (surface fail-open as an **alert**, not a "fix") — MEDIUM, owning role **SRE / Ops**.                                                                                                       |
| Lessons                   | Recurrence of "degraded but unnoticed" across pilots is the concrete case for closing item **#7** (`CONTINUOUS-IMPROVEMENT.md §4`). Capture as an `LL-` lesson, type _Reliability_.                                                                                                                                        |

---

## 4. Continuous-improvement workflow

How one lesson becomes a **verified fix**, wired into the **real** EOSP backlog
(`CONTINUOUS-IMPROVEMENT.md §2`) — the same severity taxonomy (HIGH / MEDIUM /
GA-gating), the same waves (dependency, not dates), the same "roles, never dates"
rule. This program **files into** that backlog; it does not maintain a parallel one.

| Step                  | Action                                                                  | Instrument                            | Owning role                   | Gate to advance                                  |
| --------------------- | ----------------------------------------------------------------------- | ------------------------------------- | ----------------------------- | ------------------------------------------------ |
| 1. **Capture**        | lesson recorded (what/so-what/now-what)                                 | §1 template                           | discoverer                    | complete + typed (§1.3)                          |
| 2. **Triage**         | existing open item (**#1–#7**) or new? **map, don't duplicate**         | EOSP backlog §2 taxonomy              | Deployment Lead               | severity + owning role set                       |
| 3. **File**           | create/annotate a backlog entry                                         | `CONTINUOUS-IMPROVEMENT.md §2`        | owning role                   | lands in the **real** backlog                    |
| 4. **Prioritize**     | place in a wave (dependency, not date)                                  | EOSP waves                            | Eng/Ops lead (monthly review) | wave assigned                                    |
| 5. **Change**         | build the fix                                                           | dev workflow (EOSP)                   | eng                           | passes quality gates (typecheck/lint/test/build) |
| 6. **Verify**         | prove the fix                                                           | **the same harness that surfaced it** | Pilot SRE / QA                | re-run **PASS** + green CI                       |
| 7. **Close / credit** | close the lesson; credit maturity **only** if a named §1 blocker closed | quarterly reassessment                | Eng leadership                | blocker actually closed                          |

### 4.1 "Verified fix" is a harness re-run, not a filing

A fix is **verified** only when the instrument that produced the original evidence
re-runs clean — never on intent:

- **Reliability** lesson → re-run the failing scenario procedure
  (`RELIABILITY-RESULTS.md`) → **PASS** (e.g., Redis/PG-down, restart).
- **Performance** lesson → re-run `bench/http-load.mjs` → meets/beats the floor.
- **Security** lesson (**#1 / #2**) → control present + `npm audit` clean + **green
  in CI** — the GA §8 exit rule for the two HIGH items.
- **Data-integrity** lesson → backup/restore **row-counts match exactly**
  (**Runbook 5**).

### 4.2 Two loops close here

- **Within-pilot (fast):** capture → triage → route. Keeps the pilot moving and
  keeps the customer's evidence honest; most product/UX and doc lessons close here.
- **Cross-pilot / product (slow):** backlog → prioritized change → verified fix,
  worked on the EOSP monthly/quarterly cadences. A finding that **recurs** across
  pilots is the signal that a **maturity blocker** (not a one-off bug) needs work —
  e.g. repeated "degraded but unnoticed" windows are the case for item **#7**.
  Maturity credit is granted **only when a named §1 blocker actually closes**
  (`CONTINUOUS-IMPROVEMENT.md §2`, "Backlog → maturity lift") — closing **#1 + #2**
  clears the Security open-HIGH blocker; nothing in the backlog lifts a domain to
  _Measured_ without a **production fleet**.

---

## Provenance & scope

- **Real (cited, never restated):** Runbooks 1–5 and their proven reliability
  scenarios (`OPERATIONAL-RUNBOOKS.md`, `RELIABILITY-RESULTS.md`); the open-item
  set, severities, and waves (`CONTINUOUS-IMPROVEMENT.md §2`); the SEV taxonomy and
  toil model (`SRE.md §1`); the evidence harnesses and `/health` · `/metrics`
  substrate (`PILOT-MATRICES.md §3`); the EVP 2-vCPU reference floor.
- **Defined (this document):** the what/so-what/now-what capture, the lesson
  taxonomy, the post-deployment review, the pilot-side blameless RCA, and the
  capture→backlog→verified-fix workflow — **process over the real substrate; no
  runtime added.**
- **Blank / absent (honest):** every scorecard cell, RCA field, lesson row, and
  interview output ships **empty**. **No pilot, customer, incident, uptime, MTTR,
  satisfaction, or ROI number is claimed anywhere.** The single §3.4 RCA is
  explicitly **illustrative and hypothetical**. There is **no production fleet** and
  **no ratified SLO budget**; app-binary rollback is **advisory**; the two HIGH
  security items (**#1, #2**) remain **open**. The platform is a **Validated Release
  Candidate**.
