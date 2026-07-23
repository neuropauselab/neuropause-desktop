# NeuroPause EOSP — Customer Support Operating Manual

> **What this is.** The internal operating manual for the **support organization**
> that runs NeuroPause support: how tickets are staffed, triaged, escalated, met
> against an SLA framework, coordinated during incidents, and turned into knowledge.
> Part of the Enterprise Operations & Scale Program (EOSP). It adds **no runtime and
> no platform** — roles, states, routing rules, and executable workflows over the
> **real** support surfaces and failure modes in `_grounding.md`.
>
> **Scope seam (do not duplicate).** This is the **support org that runs support** —
> not the customer-facing adoption lifecycle (`docs/adoption/CUSTOMER-SUCCESS.md`,
> GEAP), which owns onboarding, health scoring, and renewal. It **operationalizes**
> GEAP §8 (escalation) and §9 (support model) into an executable internal practice,
> and it **invokes** — never restates — the reliability discipline in
> `docs/operations/SRE.md` (on-call roles, SLOs, error budgets) and the incident
> runbooks in `docs/validation/OPERATIONAL-RUNBOOKS.md`.
>
> **Honesty banner (non-negotiable).** There is **no live public support channel,
> help desk, forum, or ticketing SLA today** (`SUPPORT.md`); support is self-service
> docs plus the internal/partner channels named in a written agreement. This manual
> is the operating model that org runs — it presents **no ticket volumes, no CSAT,
> and no achieved response or restore times.** Every SLA target is a **proposed
> commitment, to be ratified in the enterprise agreement and against production
> data** — never a measurement. The one real, published commitment is the
> security-disclosure acknowledgment in root `SECURITY.md`. Alerting/paging is
> **absent** — incidents are detected by humans, not pages (§5).

**Where each concern lives (reference, don't duplicate).**

| Concern                                                            | Home (source of truth)                   |
| ------------------------------------------------------------------ | ---------------------------------------- |
| Support tiers, tickets, escalation, SLA framework, KB workflow     | **this manual**                          |
| Adoption lifecycle, health scoring, renewal, customer-facing tiers | GEAP `CUSTOMER-SUCCESS.md` §8–§9         |
| On-call roles, SLIs/SLOs, error budgets, capacity sizing           | `docs/operations/SRE.md`                 |
| Incident runbooks (symptom → signal → action → verify)             | `OPERATIONAL-RUNBOOKS.md` (Runbooks 1–5) |
| Canonical install / fix / admin / DR how-to                        | `docs/guides/*`, `TROUBLESHOOTING.md`    |
| Security disclosure (only real published commitment)               | root `SECURITY.md`                       |

---

## 1. Support organization

Support is delivered by **roles, not named people** — the org is the internal /
partner team defined in a customer's agreement, since **no public help desk exists**
(`SUPPORT.md`). Three internal tiers are structured by **depth of access and skill**.
Tier (L1/L2/L3) is **orthogonal** to severity (§4) and to a customer's entitlement
(coverage, §1.2): severity says _how urgent_, entitlement says _what window_, tier
says _who is deep enough to resolve it_.

### 1.1 Support tiers (L1 / L2 / L3 as roles)

| Tier                               | Role (not a person)                                                  | Resolves directly                                                             | Hands up when                                               | Primary real tools                                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **L1 — Triage / Frontline**        | Intake, classify severity, reproduce, resolve-from-KB                | First response; S4 how-to/cosmetic; known-KB fixes; support-bundle collection | Not in KB, or severity ≥ S3, or needs backend/config access | `TROUBLESHOOTING.md`, `QUICK-START.md`, KB; **Operations → Release** (Component Health + redacted **Support bundle**)                                                       |
| **L2 — Technical Support**         | Deployment, config, connector/identity, desktop faults               | S3 desktop/plugin faults; connector/OAuth; RBAC/config; deployment questions  | Reproduced platform defect, or an S1/S2 signal on `/health` | `ADMINISTRATOR-GUIDE.md`, `OPERATIONS-GUIDE.md`, `DEPLOYMENT.md`; **Operations → Recovery** (`recovery:run` Safe Mode / Disable Plugins), `diagnostics:get`, `crash:export` |
| **L3 — Engineering / SRE liaison** | Defect reproduction, runbook execution, incident bridge, hotfix path | S1/S2 platform incidents; security triage hand-off; fix ownership             | (top tier) engages SRE on-call + engineering (§5)           | `OPERATIONAL-RUNBOOKS.md` 1–5, backend `/health` `/metrics` `/live`, `x-request-id` log correlation (`requestId.ts`), `SRE.md` on-call                                      |

### 1.2 Coverage model (proposed)

Coverage maps the **entitlement tier** a customer holds (GEAP §9) to a **proposed
coverage window** and the internal tiers that respond. Windows are **proposed
commitments set in the agreement** — not a staffed-team claim, not an achieved
availability.

| Entitlement (GEAP §9)      | Audience                     | Proposed coverage window                | First responder      | Incident bridge (§5) |
| -------------------------- | ---------------------------- | --------------------------------------- | -------------------- | -------------------- |
| **Community / self-serve** | `free`/`starter`, evaluators | Self-serve docs; best-effort            | KB / docs            | none                 |
| **Standard**               | `professional`               | _Proposed_ business-hours               | L1 → L2              | L3 on S1/S2          |
| **Enterprise**             | `enterprise`, regulated      | _Proposed_ extended window + named path | L1 → L2 (named path) | L3 + SRE on-call     |
| **Security**               | all                          | Private disclosure per `SECURITY.md`    | L3 security triage   | per `SECURITY.md`    |

> Coverage windows are **roles on a rota**, not headcount. "Extended window" is a
> proposed target to negotiate; no 24/7 staffed desk is claimed to exist
> (`SUPPORT.md`). A tier is a hat any qualified operator wears.

---

## 2. Ticket workflow

### 2.1 States

| State                 | Meaning                                                | Owner               | SLA clock                 |
| --------------------- | ------------------------------------------------------ | ------------------- | ------------------------- |
| **New**               | Received, unassigned                                   | Queue               | Response clock **starts** |
| **Triage**            | L1 classifying severity + KB check + support bundle    | L1                  | Response running          |
| **In Progress**       | Assigned to a tier, being worked                       | Assigned tier       | Restore running           |
| **Awaiting Customer** | Blocked on customer info / action                      | Customer            | **Paused** (both clocks)  |
| **Escalated**         | Moved up a tier, or incident declared (§5)             | Receiving tier / IC | Restore running           |
| **Resolved**          | Fix / workaround delivered, awaiting confirmation      | Customer            | Restore **stopped**       |
| **Closed**            | Confirmed; KB-candidate assessed (§6)                  | —                   | —                         |
| **Reopened**          | Customer disputes resolution within the confirm window | Prior tier          | Restore resumes           |

### 2.2 Routing rules

Routing is deterministic on **(severity × category)**. Severity comes from the SLA
definitions in §4; category from the reported surface.

- **Platform signal** (`/health` non-200; `components.database`/`redis` down; pool
  `waiting>0`) → severity S1/S2 → **L3**; declare an incident if S1 (§5).
- **Desktop / plugin fault** (blank window, renderer/plugin crash, Safe-Mode
  recommendation) → **L2** with `recovery:run` + `crash:export` (`TROUBLESHOOTING.md`).
- **Connector / identity** (connector won't sync, OAuth, SSO/SCIM/MFA config) → **L2**
  (`ADMINISTRATOR-GUIDE.md`).
- **How-to / cosmetic / doc-gap** → **L1**, resolve from KB / guides.
- **Suspected vulnerability** → **do not triage in the queue**; route to private
  disclosure per root `SECURITY.md` (never a public issue/PR).

### 2.3 Sample ticket — worked lifecycle (illustrative, not from a real queue)

```
Ticket: EXAMPLE-A   (illustrative ID — not a volume claim)
Reporter role: Enterprise Administrator      Entitlement: Enterprise
Summary: "Sign-in intermittently fails; AI features flicker in and out"

NEW → TRIAGE (L1)
  L1 opens Operations → Release → Component Health; generates a redacted Support bundle.
  Backend probe:  GET /health → 503, components={database:"up", redis:"down"}, status:"degraded"
                  GET /store/apps → 200   (reads still served — fail-open)
  Classify: S2 (Redis dependency degraded — real failure mode, Runbook 1 fail-open).
TRIAGE → IN PROGRESS   (platform signal on S2 → routed L2, escalated to L3)
  L3 opens Runbook 1 (Redis down): confirm neuropause_backend_up == 1 (no crash);
  do NOT restart the backend (survives Redis loss by design); restore Redis behind
  REDIS_URL; watch neuropause_http_requests_total for the fail-open abuse window.
IN PROGRESS → AWAITING CUSTOMER   (need managed REDIS_URL endpoint confirmed) [clocks paused]
AWAITING CUSTOMER → IN PROGRESS   (customer confirms endpoint)
  Redis restored; GET /health → 200 / ok, redis:"up"  (Runbook 1 Verification passes).
IN PROGRESS → RESOLVED   (root cause + workaround documented; flagged KB-candidate §6)
RESOLVED → CLOSED        (customer confirms sign-in stable)
```

---

## 3. Escalation model

Two escalation axes: **tier escalation** (L1→L2→L3 — more depth) and **severity
escalation** (re-grade up — more urgency). Both are trigger-driven; every timeline is
**proposed**.

### 3.1 Triggers

- KB miss, or the tier lacks the access/skill to proceed → **tier escalation** up.
- A real platform signal appears (§4 definitions) → **severity re-grade** + route to L3.
- A proposed response/restore target is at risk of breach → escalate to the next tier
  and notify the **Support Duty Lead** (a role).
- A failure mode is **not self-recovering** within its proposed timer (e.g. Postgres
  stays `down` past Runbook 2's proven auto-reconnect) → re-grade **S2 → S1**, declare
  an incident (§5).
- Suspected security issue → out-of-band to `SECURITY.md`, never through the queue.

### 3.2 Severity → tier → runbook (proposed timelines)

| Sev     | Real trigger (from `/health` + runbooks)                                          | First tier                | Escalate to             | Declare incident? | Proposed escalation timer                   |
| ------- | --------------------------------------------------------------------------------- | ------------------------- | ----------------------- | ----------------- | ------------------------------------------- |
| **S1**  | `/health` sustained 503 + `backend_up==0`; restart loop (bad env); failed restore | **L3**                    | SRE on-call (IC)        | **Yes**           | Immediate                                   |
| **S2**  | `components.redis` or `.database` degraded; pool `waiting>0` sustained            | L2 → **L3**               | L3 / IC past timer      | If not restoring  | Re-grade if unresolved past proposed timer  |
| **S3**  | Desktop renderer/plugin crash; localized fault                                    | **L2**                    | L3 if defect reproduced | No                | Escalate if unresolved by next business day |
| **S4**  | How-to, cosmetic, doc gap                                                         | **L1**                    | L2 if technical         | No                | Best-effort                                 |
| **Sec** | Suspected vulnerability                                                           | Private per `SECURITY.md` | —                       | per `SECURITY.md` | Ack within a few business days (**real**)   |

> Severity **S1–S4** is the support/customer axis inherited from GEAP §8; it maps to
> SRE's on-call grades — **S1 ≈ SEV1, S2 ≈ SEV2** (`SRE.md` §1) — so an incident
> hand-off is unambiguous. Every timer above is **proposed**, to be set in the
> agreement; the only real, published timeline is the `SECURITY.md` acknowledgment.

### 3.3 Sample escalation (illustrative)

```
EXAMPLE-B   (illustrative) — opens S2, escalates to S1 / incident

T+0       L1 triage: store reads return clean 500s; GET /health → 503,
          components.database:"down", redis:"up".  Classify S2 (Runbook 2).
T+timer   L3 executes Runbook 2: does NOT restart the backend (auto-reconnect is
          proven); restores Postgres behind DATABASE_URL. Pool does NOT re-establish;
          /health stays database:"down" past the proposed S2 restore timer.
RE-GRADE  S2 → S1  (read path effectively down and not self-healing).
          Declare INCIDENT (§5) → hand to SRE on-call Incident Commander (SRE.md §1).
          IC runs Runbook 3 (restart/recovery) + DISASTER-RECOVERY-GUIDE §4
          (migration/restore path); Support owns customer status updates on cadence.
RESOLVE   Postgres recovered; GET /health → 200 / ok; pool "total" climbs (Runbook 2 verify).
POST      Blameless postmortem; KB article authored from this ticket (§6).
```

---

## 4. SLA framework

An **SLA** here is a **support-response contract** (time to respond / time to
restore) — distinct from an **SLO**, the reliability objective owned by `SRE.md`
(availability %, error budgets). Both are **proposed**; neither is a measurement.
Severity is tied to the platform's **real components**.

### 4.1 Severity definitions (tied to real components)

| Sev     | Definition                      | Real signal (`/health` / `/metrics`)                                                                                           | Route → runbook                 |
| ------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| **S1**  | Read path down / data-loss risk | `/health` sustained **503**; `neuropause_backend_up==0` (unscrapable); failed restore                                          | Runbook 2 / 3; DR §4            |
| **S2**  | Serving but degraded            | `components.redis:"down"` (fail-open) **or** `components.database:"down"` (clean 500s) → `status:"degraded"`; pool `waiting>0` | Runbook 1 / 2 / 4               |
| **S3**  | Localized / desktop             | Renderer/plugin crash; `diagnostics:get` worst-of check degraded; single-signal anomaly                                        | Runbook 4; `TROUBLESHOOTING.md` |
| **S4**  | Question / cosmetic             | No platform signal; how-to / doc                                                                                               | KB / guides                     |
| **Sec** | Suspected vulnerability         | any                                                                                                                            | root `SECURITY.md`              |

### 4.2 Proposed response & restore targets

> **PROPOSED COMMITMENTS — NOT MEASUREMENTS.** The table below is a set of targets to
> ratify in the enterprise agreement and against production data. **No response or
> restore time here is claimed as achieved.** "Restore" = service restored or a
> workaround in place. The proven recovery behaviours (0.46 s restart; PG
> auto-reconnect with no restart; Redis fail-open — `OPERATIONAL-RUNBOOKS.md`,
> `RELIABILITY-RESULTS.md`) **inform** these proposals but are **not** an SLA
> attainment. Targets are qualitative — mirroring GEAP §8 — to avoid presenting a
> fabricated number as a committed figure.

| Sev     | Proposed first-response                                  | Proposed restore / workaround     | Proposed update cadence  |
| ------- | -------------------------------------------------------- | --------------------------------- | ------------------------ |
| **S1**  | Fastest tier (proposed)                                  | Proposed shortest                 | Frequent, until restored |
| **S2**  | Same business day (proposed)                             | Proposed same / next business day | Daily                    |
| **S3**  | Next business day (proposed)                             | Per fix availability              | On change                |
| **S4**  | Best-effort                                              | Best-effort / next release        | On change                |
| **Sec** | **Ack within a few business days (real, `SECURITY.md`)** | Per coordinated disclosure        | Per `SECURITY.md`        |

**SLA clock rules (executable).** The **response clock** runs New → first human
response; the **restore clock** runs New → Resolved. **Both pause** in _Awaiting
Customer_ (§2.1) and count only inside the customer's coverage window (§1.2). These
become measurable once a real queue and entitlement exist; today they define the
**contract shape**, not a report. SLA (this doc) and SLO (`SRE.md`) are different
instruments — do not conflate a support-response target with an availability
objective.

---

## 5. Incident management

When a ticket (or a manual `/health` watch) surfaces a platform-wide failure, the
support org runs the incident workflow below and **coordinates with**, but does not
replace, SRE on-call (`SRE.md` §1).

> **Detection is human — alerting is absent (honest).** The platform ships **no
> native alerting or paging** (`OPERATIONS-GUIDE.md` "Known Operational Gaps";
> `SRE.md` §4). Today an incident is **declared by a person** from an S1/S2 ticket or
> manual watch of `/health` and `/metrics`. Automated detection (Prometheus +
> Alertmanager over the real series, blackbox probe on `/health`) is **proposed
> wiring over the real substrate**, not a shipped feature — do not assume a runbook is
> auto-invoked.

| Phase           | Support-org action                                                                                                                                                                          | Runbook / role                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Declare**     | L3 (or Support Duty Lead) declares on an S1 signal or an S2→S1 re-grade (§3); assign an incident ID; open the incident record                                                               | severity §4; SRE on-call engaged                                                  |
| **Coordinate**  | Hand execution to the SRE **Incident Commander** (a hat, `SRE.md` §1); support supplies ticket context + reproduces customer impact                                                         | IC + Primary run the matching **Runbook 1–5**                                     |
| **Communicate** | Support **owns customer-facing status** — updates on the proposed cadence (§4.2) as the single source of truth; internal timeline captured in the incident record and `audit_log` narrative | support-unique; SRE owns the technical timeline                                   |
| **Resolve**     | Confirm the runbook **Verification** step passes (`/health` 200/ok; pool recovered; `redis`/`database` `up`); deliver workaround/fix; move affected tickets to Resolved                     | Runbook verification blocks; `DISASTER-RECOVERY-GUIDE.md §4` if migration/restore |
| **Postmortem**  | Blameless review; support contributes the **ticket timeline, `x-request-id` traces, and redacted support bundles**; outputs a **KB article (§6)** and an improvement-backlog item           | feeds `SRE.md` toil/gap backlog                                                   |

Support does **not** redefine on-call roles — it invokes SRE's IC / Primary /
Secondary / Scribe. Its distinct ownership is **intake, impact aggregation across
tickets, and customer communication**.

**Honest gaps to carry into every incident** (`_grounding.md` risk register;
Runbook escalation notes): the rate limiter **fails open** on Redis loss — pair the
outage with the fail-open abuse watch (Runbook 1); **federation multi-region DR is
modeled, not failover**; **app-binary rollback is advisory** — real recovery is
data-side (Runbook 5 + `DISASTER-RECOVERY-GUIDE.md`).

---

## 6. Knowledge workflow

The KB is built **from resolved tickets** and **links** the canonical guides — it
never duplicates them (a KB article that restates `TROUBLESHOOTING.md` is a defect,
not content). Every article mirrors the runbook contract **Symptom → Signal → Action
→ Verification**, so it stays executable and grounded in a real check.

### 6.1 From resolved ticket to KB article

| Step                   | Action                                                                                                                                                | Owner          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **1 · Flag**           | On Resolve, assess KB-candidate criteria: recurring, non-obvious, or workaround-bearing                                                               | Resolving tier |
| **2 · Draft**          | Author in runbook shape; cite the **real** signal (`/health` field, `/metrics` series, IPC) and the canonical guide; redact per support-bundle rules  | Resolving tier |
| **3 · Review**         | Technical review by L3 — verify every signal/step is real, every link resolves, no fabricated numbers                                                 | L3             |
| **4 · Publish + link** | Publish to KB; cross-link with `TROUBLESHOOTING.md`, `QUICK-START.md`, `OPERATIONS-GUIDE.md`, and the matching Runbook                                | KB owner       |
| **5 · Close loop**     | If the root cause is a **doc gap** or product issue, file an RFC/issue against the canonical source (`CONTRIBUTING.md`, `COMMUNITY-GOVERNANCE.md §2`) | L3             |

### 6.2 KB article shape (mirrors the runbook contract)

```
Title:         <symptom in the customer's words>
Applies to:    <desktop | backend | connector | identity>   · entitlement: <tier>
Symptom:       what the reporter sees
Signal:        the REAL check that confirms it
               (e.g. GET /health components.redis:"down"; diagnostics:get worst-of; crash:export)
Action:        steps — reuse the guide, LINK don't restate
               (Operations → Recovery Safe Mode; restore Redis behind REDIS_URL; …)
Verification:  the real success check (GET /health 200/ok; pool waiting==0; clean relaunch)
Links:         TROUBLESHOOTING.md §… · Runbook N · OPERATIONS-GUIDE.md · GEAP §…
Severity seen: S1–S4 (per §4)        KB source: ticket EXAMPLE-A (redacted)
```

### 6.3 Feedback loop

- **Recurring tickets on one symptom** → doc-gap signal → RFC to fix the **canonical
  guide**, not a growing pile of KB duplicates.
- **A KB article cited repeatedly in incidents** → candidate for a new **Runbook**
  entry (propose to `OPERATIONAL-RUNBOOKS.md` via the engineering workflow) — the KB
  feeds the runbook set; the runbook set anchors the KB.
- The KB is organized by **symptom and real signal**, never by "top issues by count"
  — it asserts **no volume or frequency metric**.

---

## Provenance & scope

- **Builds on:** GEAP `CUSTOMER-SUCCESS.md` §8–§9 (escalation + support tiers),
  `SUPPORT.md` (honest status — no public channel/SLA yet).
- **Invokes, never restates:** `OPERATIONAL-RUNBOOKS.md` (Runbooks 1–5),
  `docs/operations/SRE.md` (on-call, SLOs, error budgets), `docs/guides/*` +
  `TROUBLESHOOTING.md` (canonical how-to).
- **Real surfaces:** `/health` (`components.database`/`redis`), `/metrics`, `/live`,
  `x-request-id` (`requestId.ts`); IPC `neurocore:systemHealth`, `diagnostics:get`,
  `crash:export`, `releaseDiagnostics:export`, `recovery:run`; redacted **Support
  bundle** (Operations → Release).
- **Proposed (to ratify):** every SLA response/restore target, coverage window, and
  escalation timer. **No ticket volumes, CSAT, or achieved response/restore times
  appear anywhere in this manual — none exist.** The only real published commitment
  is the `SECURITY.md` disclosure acknowledgment. Roles throughout; **no individuals
  named.**
