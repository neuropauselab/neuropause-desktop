# CDEP — Customer Feedback & Evidence Instruments

> **What this is.** The **blank instrument set** a real customer pilot uses to
> capture qualitative and adoption evidence: interview guides, an issue taxonomy, a
> feature-request workflow, a satisfaction methodology, and an adoption measurement
> plan. **Execution, not engineering** — it adds **no runtime and no platform**, and
> is a methodology + forms, never a record of feedback that happened.
>
> **Honesty banner (non-negotiable, `_grounding.md`).** **No pilot has run.** This
> file contains **no customer response, quote, NPS/CSAT/satisfaction score, or
> adoption number** — none exist. Every table and form ships **blank**; every value
> is a `<placeholder>` the pilot fills from a **real respondent** or the **real
> substrate**. Worked rows are labelled **"illustrative — not a real respondent."**
> Roles throughout; **no individuals named**. It **reuses** the EOSP severity model
> and ticket workflow and the GEAP success method — reference, do not restate. Where
> each concern lives (ticket states/severity → EOSP §2/§4; personas/health/maturity →
> GEAP §3/§5/§6; real intake → `.github/ISSUE_TEMPLATE/*` + `COMMUNITY-GOVERNANCE.md`
> §2) is mapped in Provenance; feedback-loop routing is `PILOT-MATRICES.md` §4.

---

## 1. Structured interviews

### 1.1 Objectives

Convert pilot experience into **coded qualitative evidence** routed to the Product
Evolution intake (§3). This is **not** a satisfaction score (that is §4) — it
captures **expectations, friction, and outcomes in the respondent's own words**:
surface expectations **before** deploy (testable at exit), capture friction
**mid-pilot** while fresh (paired with the §2 issue log), and confirm **at exit**
which expectations held against the honest maturity envelope (Validated RC; GEAP §9).

### 1.2 Roles (not people)

Respondent roles reuse the GEAP §3.1 personas — **Sponsor / Buyer**, **Operator /
SRE**, **Enterprise Administrator**, **End User**, **Developer / Integrator**. The
**Interviewer** (Customer Success or Deployment Lead) and **Scribe** are pilot
roles. No respondent is named; capture is keyed by **role + participant code**.

### 1.3 Question bank by phase

Ask only rows matching a respondent's role. Prompts are **open-ended**, never
leading. `<...>` marks what the respondent supplies.

**Phase A — Pre-deploy expectations** (before Phase 1 provision, GEAP §1.2)

| #   | Prompt                                                                   | Primary role   |
| --- | ------------------------------------------------------------------------ | -------------- |
| A1  | What problem are you hoping this pilot proves or disproves?              | Sponsor        |
| A2  | What would make this pilot a clear success for you? A clear failure?     | Sponsor        |
| A3  | Which of the §9 known limitations concern you most, and why?             | Sponsor, Admin |
| A4  | What does "healthy day-2" look like for the backend in your environment? | Operator/SRE   |
| A5  | Which governance / identity controls must work on day one?               | Admin          |
| A6  | Walk me through the one task you most need to succeed.                   | End User       |
| A7  | What would you integrate first via connector / SDK?                      | Developer      |

**Phase B — Mid-pilot** (during Adopt, GEAP §5; pair with the §2 issue log)

| #   | Prompt                                                                  | Primary role        |
| --- | ----------------------------------------------------------------------- | ------------------- |
| B1  | Since kickoff, what has been easier than expected? Harder?              | all                 |
| B2  | Describe the last time something did not work. What did you do?         | all                 |
| B3  | Which expectation from Phase A is holding? Which is at risk?            | Sponsor             |
| B4  | How are you checking backend health today (`/health`, `/metrics`)?      | Operator/SRE        |
| B5  | Has any known gap (fail-open rate limit, advisory rollback) bitten you? | Operator/SRE, Admin |
| B6  | What are you doing manually that you expected the product to do?        | End User            |

**Phase C — Exit** (at pilot close, before the acceptance decision)

| #   | Prompt                                                              | Primary role      |
| --- | ------------------------------------------------------------------- | ----------------- |
| C1  | Against A2, did the pilot succeed on your own terms? Say how.       | Sponsor           |
| C2  | What is the single biggest change that would raise your confidence? | all               |
| C3  | Which friction points would block a production decision?            | Sponsor, Operator |
| C4  | What should we build, fix, or document next? (→ feeds §3)           | all               |
| C5  | Would you continue? What would need to be true first?               | Sponsor           |

### 1.4 Blank response-capture template

One per respondent per phase. Ships empty; the Scribe fills `<...>` from the real
interview. **No answer is pre-filled.**

```
INTERVIEW CAPTURE — blank instrument (fill at pilot time)
Pilot code:        <pilot-id>            Phase:      < A | B | C >
Participant code:  <role-code, e.g. OPER-1 — NOT a name>
Respondent role:   < Sponsor | Operator/SRE | Admin | End User | Developer >
Interviewer role:  <CS | Deployment Lead>     Date: <YYYY-MM-DD>

Per question asked:
  Q-ref:     < A1 … C5 >
  Verbatim:  "<respondent's own words — quote exactly, do NOT paraphrase into a claim>"
  Observed:  <friction / workaround / signal the interviewer saw>
  Links:     < issue ID (§2) | feature-request ID (§3) | none >
  Theme tag: < left blank here; assigned during coding, §4.3 >

Consent:     [ ] respondent agreed to quote use (role-attributed, anonymized)
```

> _Illustrative — not a real respondent (shape only):_ `Q-ref: A2 · Verbatim: "<what
the sponsor said>" · Theme tag: <assigned later>`. The quotes are empty
> placeholders, **not** captured statements.

---

## 2. Issue categorization

Pilot-logged issues are classified on **four orthogonal axes** so they route
correctly and aggregate honestly. Classification **feeds** the EOSP ticket workflow
(`CUSTOMER-SUPPORT.md` §2) and the `.github/ISSUE_TEMPLATE/bug_report.md` intake —
it does **not** replace them. Severity is **owned by EOSP §4.1 / GEAP §8**;
reproduced here only as the pilot-logging anchor.

### 2.1 Axis 1 — Severity (tied to the real `/health` components)

| Sev     | Real signal (verbatim from EOSP §4.1)                                                                                   | EOSP route                                                |
| ------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **S1**  | `/health` sustained **503**; `neuropause_backend_up==0` (unscrapable); failed restore                                   | L3 + incident                                             |
| **S2**  | `components.redis:"down"` (fail-open) or `components.database:"down"` → `status:"degraded"`; pool `waiting>0` sustained | L2 → L3                                                   |
| **S3**  | Desktop renderer/plugin crash; `diagnostics:get` worst-of degraded; localized                                           | L2                                                        |
| **S4**  | No platform signal; how-to / cosmetic / doc gap                                                                         | L1                                                        |
| **Sec** | Suspected vulnerability                                                                                                 | **Out-of-band, root `SECURITY.md`** — never the pilot log |

### 2.2 Axis 2 — Type · Axis 3 — Component · Axis 4 — Disposition

| Axis            | Allowed values (closed enumerations)                                                                                                                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Type**        | defect · deployment/config · performance · reliability/availability · usability · documentation · data/migration · feature-gap · question                                                                                                                             |
| **Component**   | desktop · backend · connector · identity · deploy · docs · sdk · cli · _(platform sub-signal:_ `database` \| `redis` _from `/health`)_                                                                                                                                |
| **Disposition** | resolved-in-pilot · workaround-documented · defect-filed _(→ EOSP ticket + `bug_report.md`)_ · doc-gap _(→ KB/RFC)_ · feature-request _(→ §3)_ · known-gap _(maps to `_grounding.md` risk register)_ · not-reproducible · out-of-scope · security _(→ `SECURITY.md`)_ |

> **Known-gap disposition** attaches an issue to an already-documented risk (Apple
> `id_token` not JWKS-verified; unsigned marketplace install; rate-limit fail-open on
> Redis loss; advisory app-rollback). It records reality — **not** a new defect, and
> must **not** be counted as a pilot-discovered failure.

### 2.3 Blank issue log

Ships empty. Every issue also carries an EOSP ticket ID once routed; this log is the
**pilot-side index**, not a second ticket system.

```
ISSUE LOG — blank instrument (one row per issue; fill at pilot time)
| Issue ID | Reporter role | Severity | Type | Component | /health signal at report | Disposition | EOSP ticket | Feature-req (§3) |
| PILOT-#  | <role>        | <S1-S4>  | <..> | <..>      | <status / components / none> | <..>     | <ID | n/a>  | <ID | n/a>        |
```

> _Illustrative — not a real pilot (format only, not a logged event):_ `PILOT-1 ·
Operator/SRE · S2 · redis · components.redis:"down" · workaround-documented`.

---

## 3. Feature-request workflow

Pilot feature requests are captured, triaged, and **linked into the Product
Evolution intake** — the existing `.github/ISSUE_TEMPLATE/feature_request.md` and,
when triggered, the RFC process (`COMMUNITY-GOVERNANCE.md` §2). CDEP adds the
**pilot capture + triage front door**, then hands off; it defines **no new roadmap
system**.

### 3.1 Intake form (blank — extends `feature_request.md`, does not fork it)

```
FEATURE REQUEST — blank instrument (fill at pilot time)
Request ID:      FR-#              Pilot code: <pilot-id>
Requester role:  < persona, GEAP §3.1 — NOT a name >
Problem/motivation: <what problem; who (persona/segment); why now — NO named customer>
Proposed change:    <concrete behaviour change>
Component(s):    < desktop | backend | sdk | cli | shared | deploy | docs >
Evidence link:   < interview Q-ref (§1) | issue ID (§2) | pilot observation >
Breaking?        < yes/no — if yes, migration impact >
Honesty check:   [ ] real buildable behaviour, no fabricated metric/benchmark
                 [ ] fits Validated-RC maturity (no GA/at-scale claim)
```

### 3.2 Triage

| Step                | Action                                                                                                                                                   | Owner (role)         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **1 · Deduplicate** | Search existing issues/RFCs; link if a duplicate                                                                                                         | CS / Product liaison |
| **2 · Ground**      | Confirm an evidence link (§1 or §2) exists — no evidence, no promotion                                                                                   | Product liaison      |
| **3 · Classify**    | Effort (S/M/L) × pilot-value (must-have / nice-to-have) × persona reach                                                                                  | Product liaison      |
| **4 · Route**       | Small/self-contained → `feature_request.md` issue; cross-cutting / new surface / schema / public API → **promote to RFC** (`COMMUNITY-GOVERNANCE.md` §2) | Product liaison      |

### 3.3 States (mirror the real RFC lifecycle — reference, do not restate)

The downstream state **is** the RFC state machine (`COMMUNITY-GOVERNANCE.md` §2), so
a pilot request and its roadmap item never diverge:

```
Captured (FR-#)  →  Triaged  →  [ Issue-only ]              → tracked as an issue
                             →  [ Promoted to RFC ]  →  Draft → Review
                                                          → Accepted / Rejected
                                                          → Implemented → Superseded
```

> Only **Captured** and **Triaged** are CDEP-owned; every state from **Draft** on is
> owned by the RFC process. CDEP records the link (`FR-# ↔ RFC/issue`) and nothing
> more — the roadmap is **evidence-based** (the evidence is the §1/§2 link); no
> priority, ETA, or commitment is asserted here.

---

## 4. Satisfaction methodology

Defines **instruments and how to administer them**; publishes **no value**.
Consistent with EOSP (`CUSTOMER-SUPPORT.md` — "no CSAT") and GEAP §6 ("no invented
scores"), a single vanity number is **discouraged** — task-success, effort, and
coded themes are primary.

### 4.1 Instruments

| Instrument                  | What it measures                               | Scale                                                        | When (phase)             | Administered by        |
| --------------------------- | ---------------------------------------------- | ------------------------------------------------------------ | ------------------------ | ---------------------- |
| **Task-success rate**       | Did the persona complete a pilot task unaided? | success / assisted / fail per attempt                        | during tasks (mid-pilot) | Interviewer observes   |
| **Effort — SEQ**            | Perceived difficulty right after a task        | Single Ease Question, **1 (very difficult) – 7 (very easy)** | immediately post-task    | Respondent self-report |
| **Thematic coding**         | Recurring themes across interviews (§1)        | qualitative codebook (blank)                                 | after each phase         | Analyst                |
| **Relationship (optional)** | Willingness to continue / recommend            | CSAT or NPS **only if the agreement asks for it**            | exit                     | Respondent self-report |

### 4.2 Measurement method

- **Task-success rate** = successes ÷ attempts, **per persona, per task** (tasks =
  GEAP §3.1 first-value milestones and §1.2 checkpoints). The rate is a **fraction
  the pilot computes**, never seeded here.
- **Effort (SEQ)**: captured once per task on the 1–7 scale; report the
  **distribution**, not a lone mean presented as a benchmark.
- **Thematic coding**: open-code every §1.4 verbatim → axial themes → **how many
  respondents (by role) raised each** — a count of mentions, not a score.
- **Relationship metrics**: optional; if run, reported with **n** and method — a raw
  score with no denominator is prohibited.

### 4.3 Blank capture + no-fabrication banner

```
SATISFACTION CAPTURE — blank instrument (fill at pilot time)
Task-success:  | Persona | Task ref | Attempts | Success | Assisted | Fail | Rate |
               | <role>  | <§3.1>   | < >      | < >     | < >      | < >  | <—>  |
Effort (SEQ):  | Task ref | Participant code | SEQ 1–7 |
               | <ref>    | <code>           | < >     |
Codebook:      | Theme | Definition | Respondents raising (by role) |
               | <open> | <open>     | < >                          |
```

> **NO VALUE IS SEEDED HERE.** Every `< >` above is empty. This document contains no
> task-success rate, no SEQ value, no CSAT, no NPS, and no "n" — those are produced
> **only** by real respondents at pilot time. Publishing any number in this file
> would violate `_grounding.md` rule 5.

---

## 5. Adoption tracking

Adoption is measured from the **real substrate the customer's own instance emits** —
never a fabricated count. A **measurement plan** (signal → real source → how to
collect); every output is the **customer's own number**, computed at pilot time.

### 5.1 Signals (real sources only)

| Signal                          | Real source                                                | What it yields                                      | Honest limit                                                   |
| ------------------------------- | ---------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------- |
| **Active participants**         | `audit_log` (`0001_init.sql`)                              | distinct `user_id` with ≥1 entry in a period        | append-only by convention (GEAP §6.1)                          |
| **Feature/action usage**        | `audit_log.action`                                         | breakdown of which privileged/feature actions fired | only actions that write an audit entry                         |
| **Time-to-first-value**         | `audit_log.created_at`                                     | first-action timestamp per `user_id`                | per user, from their first entry                               |
| **Activity trend**              | `audit_log.created_at`                                     | entries over the pilot window (day/week buckets)    | volume, not intent                                             |
| **Request volume & status mix** | `/metrics` `neuropause_http_requests_total{method,status}` | aggregate request count; success vs 4xx/5xx share   | **aggregate only** — not per-user, not per-feature, no latency |
| **Availability context**        | `/health`, `/metrics` gauges                               | uptime/pool context for the window                  | explains low usage vs downtime                                 |
| **Milestone attainment**        | GEAP §5 stage · §3.1 persona milestones                    | Crawl/Walk/Run stage; personas active               | observed checkbox, not telemetry                               |
| **Desktop engagement**          | NeuroCore `neurocore:systemHealth`, `diagnostics:get`      | health level present/degraded                       | **health, not usage** — no client analytics ships              |

> **Deliberately absent (do not fabricate):** **no product-analytics / event-tracking
> pipeline** and **no per-feature client telemetry**. `/metrics` is aggregate counts
> by method+status only; backend attribution comes **solely** from `audit_log`;
> desktop adoption is **milestone-observed**, not event-tracked. Do not synthesize a
> funnel the platform cannot emit.

### 5.2 Collection method (shape only — no result)

Read-only queries against the customer's own `audit_log` and scrapes of their own
`/metrics`. The shapes below define **what to compute**; they return the
**customer's** numbers at pilot time — **none appear here**.

```
Active participants:  COUNT(DISTINCT user_id) FROM audit_log WHERE created_at BETWEEN <s> AND <e>;
Action usage:         SELECT action, COUNT(*) FROM audit_log WHERE created_at BETWEEN <s> AND <e> GROUP BY action;
Time-to-first-value:  MIN(created_at) per user_id  vs  pilot start.
Request mix:          diff neuropause_http_requests_total{status=~"2.."} vs {~"[45].."} across two scrapes.
```

### 5.3 Blank adoption capture + no-fabrication banner

```
ADOPTION CAPTURE — blank instrument (fill at pilot time)
| Period | Active user_ids | Top actions (audit_log) | Req total (2xx/4xx/5xx) | Stage (GEAP §5) | Personas active |
| <week> | < >             | < >                     | < / / >                 | <Crawl/Walk/Run>| < >             |
```

> **NO ADOPTION NUMBER IS SEEDED HERE.** Every `< >` is empty. This file asserts no
> active-user count, no usage rate, no request total, and no stage attainment. Each
> value is produced by querying the **customer's own** `audit_log` / `/metrics` at
> pilot time. Presenting any of these as measured would violate `_grounding.md`
> rules 2 and 5.

---

## Provenance & scope

- **Builds on (reference, never restated):** EOSP `CUSTOMER-SUPPORT.md` (severity
  §4.1, ticket states/routing §2, incident §5, KB §6); GEAP `CUSTOMER-SUCCESS.md`
  (personas §3.1, health method §6, maturity §5, escalation §8).
- **Reuses real intake:** `.github/ISSUE_TEMPLATE/{bug_report,feature_request}.md`;
  RFC states in `COMMUNITY-GOVERNANCE.md` §2; security path in root `SECURITY.md`.
- **Real substrate cited:** `/health` (`app.ts` — `status`, `components.database`/
  `redis`), `/metrics` (`neuropause_backend_up|_http_requests_total{method,status}|
_pg_pool_connections{state}`), `audit_log` (`0001_init.sql` — `user_id`, `action`,
  `created_at`), NeuroCore `neurocore:systemHealth`, `diagnostics:get`.
- **Fills** `PILOT-MATRICES.md` §4 (interviews, issues/defects, feature requests,
  satisfaction/adoption — all **Template**).
- **Status honesty:** every form **blank**; worked rows labelled _illustrative — not
  a real respondent_; **no customer response, quote, NPS/CSAT, satisfaction score, or
  adoption number appears anywhere — none exist.** No individuals named.
