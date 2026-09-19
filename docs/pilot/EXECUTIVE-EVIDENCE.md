# NeuroPause CDEP — Executive Evidence Dashboards & Reporting Templates

> **What this is.** The executive-facing layer of the Customer Deployment & Evidence
> Program (CDEP): the **dashboard specifications** and **reporting templates** by which a
> **real customer pilot** is watched and reported to leadership and the board. It defines
> _what an executive sees during a pilot, where each value comes from, and in what state it
> ships_ — over the **real** deployment/evidence tooling in [`_grounding.md`](_grounding.md)
> and the readiness assessed in [`PILOT-MATRICES.md`](PILOT-MATRICES.md). It adds **no runtime
> and no platform**.
>
> **Build-on, not restate.** This document **extends** EOSP
> [`../operations/EXECUTIVE-OPERATIONS.md`](../operations/EXECUTIVE-OPERATIONS.md) — its exec
> dashboard tiles (§1), operational KPIs (§3), the **real risk register** (§4), and the
> decision-log/QBR cadence (§5). Those are **referenced, not re-derived**. EOSP is the
> **internal fleet** view; CDEP is the **per-pilot, customer-instance** view — the two are
> different jobs. SLI/SLO math, error budgets, and capacity formulas remain **owned by
> `../operations/SRE.md`**.
>
> **Anti-fabrication banner (non-negotiable).** Every dashboard here is a **SPECIFICATION** —
> tile = **definition + real source + BLANK current value + _proposed_ target**. **No tile is
> populated.** **No pilot has run** ([`_grounding.md`](_grounding.md)): there are **0 pilots,
> 0 deployments, 0 customers**, and therefore **no achieved acceptance score, uptime,
> availability, latency, error rate, satisfaction, or ROI** to report. The **only real
> numbers** admitted are (a) the **EVP reference floor** — _our_ 2-vCPU measurements, clearly
> labelled _reference, not a customer result_ — and (b) the **real GA risk register**
> (EOSP §4), which is real audit fact, referenced not restated. **Roles, never people.**

**Legend for state cells.** `▢ blank` = to be filled by a real pilot · `— (none yet)` = the
empty set today (honest) · `[ … ]` = fill-in placeholder · `_proposed_` = objective to ratify
against real pilot data, never a claimed result · **EVP ref** = _our_ reference floor (not a
customer measurement).

---

## 1. Deployment dashboard (specification)

**What a program owner opens for a pilot.** Status of the deployment-and-evidence loop for
each active pilot. This is a **new** board with no EOSP equivalent (EOSP tracks the internal
fleet; this tracks a **customer pilot**). Every tile below is a **contract for a value produced
by a real tool at pilot time** — none is populated here.

> **Honest anchor: pilots = 0 today.** No pilot has entered, deployed, been accepted, or
> exited. Every current-value cell is `— (none yet)` or `▢ blank` and will stay so until a
> real deployment fills it. Do not read any figure into this board.

| Tile                           | Definition (what the exec sees)                                                                    | Real source                                                                                                                                                                                               | Current value                                 | _Proposed_ target                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Pilot status**               | Count of pilots by lifecycle phase (Entry / Deploy / Acceptance / Exit) and RAG per phase          | Pilot log (this program) over the `PILOT-FRAMEWORK.md` phase gates; personas/segments only, never named customers                                                                                         | **`— (none yet)` — 0 pilots, 0 in any phase** | _Proposed:_ pipeline objective (no number asserted)                                             |
| **Deployment readiness**       | Share of the 10 deployment prerequisites at **Ready** for the target pilot before the Entry gate   | `PILOT-MATRICES.md §1` (Deployment Readiness Matrix) + `kubernetes-validate` (strict PASS) + `shellcheck` (clean) gates                                                                                   | `▢ blank` per pilot                           | _Proposed:_ all **Ready** prereqs green; **Gap** items (rollback R-5, HA) declared before entry |
| **Acceptance score**           | % of acceptance-scorecard criteria signed off at the Acceptance gate                               | Acceptance scorecard (`DEPLOYMENT-QUALITY.md`) + the four quality gates (`typecheck`/`lint`/`test` **3,856**/`build`), CI (`ENTERPRISE-GA-REPORT.md §2.1`)                                                | `▢ blank` — no acceptance has occurred        | _Proposed:_ 100% of mandatory criteria signed before Exit                                       |
| **Evidence completeness**      | Fraction of the 8 evidence classes captured from their **real generator** on the customer instance | `PILOT-MATRICES.md §3` (Evidence Collection Matrix): `bench/http-load.mjs`, `db-latency.mjs`, `startup.sh`, `RELIABILITY-RESULTS.md` procedures, `/metrics` captures, `npm audit --omit=dev`, `audit_log` | `▢ blank` — 0 of 8 classes captured           | _Proposed:_ all **applicable** classes captured + archived per pilot                            |
| **Migration / data integrity** | Pass/fail of forward migration + backup→restore row-count equality on the customer DB              | `npm run db:migrate` (12 forward-only, idempotency proven) + `scripts/backup-db.sh`/`restore-db.sh` (proven exact — EVP)                                                                                  | `▢ blank` — not yet run at a customer         | _Proposed:_ PASS (idempotent re-run; exact restore) before Acceptance                           |
| **Gate posture**               | Which pilot gate (Entry / Success / Rollback / Exit) is open and its blockers                      | `PILOT-FRAMEWORK.md` gate criteria tied to real SLIs/gates                                                                                                                                                | `▢ blank`                                     | _Proposed:_ no gate advanced with an open blocker                                               |

**Wiring status (honest).** This board is watched **manually** from the pilot log and the raw
artifacts; no BI surface ships (EOSP §1 "Wiring status"). It becomes populated **only** when a
real pilot runs its harnesses and records the outputs.

---

## 2. Operational dashboard (specification, over the real substrate)

**What an exec watches while the customer's instance runs.** These tiles surface the pilot
instance's live health from the **real observability substrate** the customer scrapes from
**their own** deployment. **SLI definitions and _proposed_ SLOs are owned by EOSP §3 /
`SRE.md §2–6` and are referenced, not restated here.** No value is populated — none exists.

| Metric                  | Definition (what the exec sees)                                                             | Real source                                                                                                                                                    | Current value                                  | _Proposed_ target / **EVP ref**                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Availability**        | Good-probe fraction of `/health` = 200 over the window                                      | `GET /health` (`status`, `components.database\|redis`) via a **blackbox probe the platform does not ship — _external, proposed_**                              | `▢ blank` — probe not yet stood up             | _Proposed:_ 99.9% (`SRE.md §3/§5`); requires the external probe first                                                                  |
| **Latency p95**         | External p95 per route (app exposes **request counts only — no histogram**)                 | `bench/http-load.mjs` against the customer instance + blackbox timing                                                                                          | `▢ blank` — customer number does not exist yet | _Proposed:_ ≤ 150 ms / ≤ 250 ms (`SRE.md §3`). **EVP ref (not customer):** p95 **69 ms** `/store/apps`, **104 ms** point read @ 2-vCPU |
| **Error rate**          | Non-2xx (and 5xx) share of served requests over the window                                  | `neuropause_http_requests_total{method,status}` counter — **real `/metrics` scrape** (`apps/backend/src/observability/metrics.ts`)                             | `▢ blank`                                      | _Proposed:_ success ≥ 99.9% (`SRE.md §2/§3`). **EVP ref:** 0 errors at reference load                                                  |
| **Resource / capacity** | RSS, heap, and DB-pool state over time (headroom vs limits)                                 | `/metrics` gauges: `neuropause_backend_resident_memory_bytes`, `neuropause_backend_heap_used_bytes`, `neuropause_pg_pool_connections{state}` — **real scrape** | `▢ blank`                                      | _Proposed:_ within configured limits. **EVP ref:** RSS **~213–223 MB**, pool **1→10**                                                  |
| **Restart recovery**    | Time from process-down to `/health` 200 during a pilot restart drill                        | `neuropause_backend_uptime_seconds` drop — **real scrape**; drill per `RELIABILITY-RESULTS.md`                                                                 | `▢ blank`                                      | _Proposed:_ ≤ 5 s (`SRE.md §5`). **EVP ref:** restart **0.46 s**, cold start **0.66 s**                                                |
| **Dependency health**   | Fraction of probes with `components.database\|redis == "up"`; Redis-loss fail-open observed | `GET /health` component JSON (_external probe, proposed_); `rateLimit.ts` fail-open is **R-3**                                                                 | `▢ blank`                                      | _Proposed:_ ≥ 99.9% (`SRE.md §3`); **alerting absent (R-6)** — watched manually                                                        |

> **Provenance (honest, per EOSP §3).** Error-rate, resource, and restart tiles read the
> **real scrape**; **availability and dependency** tiles need the **blackbox probe the platform
> does not ship** (_external, proposed_); **latency** comes from the **bench harness** (no
> histogram exists). **Alert routing is absent (R-6)** — until wired (`SRE.md §4`) these are
> watched manually. Every **EVP ref** value is _our_ 2-vCPU floor for target-setting, **never a
> customer result** — a pilot re-measures on the customer's hardware.

---

## 3. Executive summary template (one page, blank)

**Purpose.** A one-page pilot-cycle summary for leadership. It ships **blank**; a real pilot
fills it. It **reuses the EOSP §5 decision-log format** (referenced, not redefined). Publish
nothing until a real deployment populates the fields.

**Header.**

- **Pilot / cohort:** `[ persona or segment — never a named customer ]`
- **Period:** `[ ISO date range ]` · **Prepared by (role):** `[ Program owner ]`
- **Platform maturity:** Validated Release Candidate (`_grounding.md`) — **no production fleet**

**A. Program status** (one line + RAG)

| Field                       | Content (blank)                                      |
| --------------------------- | ---------------------------------------------------- |
| Overall status (R/A/G)      | `▢ blank`                                            |
| Pilots active / in pipeline | **`— (none yet)` — 0 active, 0 in pipeline**         |
| Current gate                | `[ Entry / Deploy / Acceptance / Exit ]` — `▢ blank` |
| One-line narrative          | `[ … ]`                                              |

**B. Evidence highlights** (placeholders — each cites the real generator that will fill it)

- Performance: `[ p50/p95/p99 + throughput ]` ← `bench/http-load.mjs`, `db-latency.mjs` — `▢ blank`
- Reliability: `[ pass/fail per scenario ]` ← `RELIABILITY-RESULTS.md` procedures — `▢ blank`
- Resource / capacity: `[ RSS / heap / pool over time ]` ← `/metrics` gauges — `▢ blank`
- Data integrity: `[ migration idempotent? restore exact? ]` ← `db:migrate` + backup/restore — `▢ blank`
- Acceptance: `[ criteria signed / total ]` ← `DEPLOYMENT-QUALITY.md` scorecard — `▢ blank`

> Do **not** enter a number here that a harness did not produce on the customer instance. **EVP
> reference floor** (2-vCPU, _ours_, not customer) is available for context only: p95 69/104 ms,
> RSS ~213–223 MB, restart 0.46 s, 0 errors — labelled reference.

**C. Risks** (seeded with the **real GA risk register** — EOSP §4 / `ENTERPRISE-GA-REPORT.md
§4–5`; referenced, not restated)

| Risk ID            | Item (real register)                                       | Sev                   | Owner role             | Residual action → GA                            |
| ------------------ | ---------------------------------------------------------- | --------------------- | ---------------------- | ----------------------------------------------- |
| **R-1**            | Apple `id_token` not JWKS-verified                         | **HIGH — GA blocker** | Security / Backend eng | Verify signature vs Apple JWKS                  |
| **R-2**            | Marketplace unsigned-install bypass when trust store empty | **HIGH — GA blocker** | Security / Desktop eng | Require valid signature / non-empty trust store |
| _(pilot-surfaced)_ | `[ risk raised by this pilot ]`                            | `▢`                   | `[ role ]`             | `[ action ]`                                    |

> Open **HIGH / MEDIUM / LOW** counts and the **0 production-vuln** fact are the **real register
> roll-up in EOSP §4** — cited, not reprinted. HIGH items (R-1, R-2) are the standing GA
> blockers (`ENTERPRISE-GA-REPORT.md §8`).

**D. Decisions** (EOSP §5 decision-log format — append-only; blank)

| Decision ID      | Decision (one line) | Inputs cited                                | Owner role | Status                           |
| ---------------- | ------------------- | ------------------------------------------- | ---------- | -------------------------------- |
| `CDEP-YYYYQn-NN` | `[ … ]`             | `[ tiles / risk IDs / evidence artifacts ]` | `[ role ]` | Proposed / Ratified / Superseded |

---

## 4. Board reporting template (quarterly, blank)

**Purpose.** The quarterly board view of the pilot program. It ships **blank** except the
**real risk posture** (referenced from EOSP §4). It feeds the **QBR** cadence (EOSP §5) — it
invents no numbers. No revenue, ARR, seat, customer, or deployment count is asserted (there
are none).

**4.1 Program status**

| Field               | Content (blank)                                                                   |
| ------------------- | --------------------------------------------------------------------------------- |
| Reporting quarter   | `[ YYYY-Qn ]`                                                                     |
| Program phase       | `[ Readiness / First pilot / Multi-pilot ]` — today: **Readiness (0 pilots run)** |
| Platform maturity   | Validated Release Candidate — **no production fleet** (`_grounding.md`)           |
| GA-gate progress    | Referenced from EOSP §4 register (HIGH blockers R-1, R-2 open)                    |
| Headline (one line) | `[ … ]`                                                                           |

**4.2 Pilot pipeline** (empty — pilots = 0 today)

| Persona / segment | Stage          | Entry-gate status | Target exit    | Evidence status |
| ----------------- | -------------- | ----------------- | -------------- | --------------- |
| `— (none yet)`    | `— (none yet)` | `— (none yet)`    | `— (none yet)` | `— (none yet)`  |

> **Honest:** the pipeline is the **empty set**. No prospective pilot is listed as a
> commitment. Rows appear only when a real pilot enters, described by **persona/segment**, never
> a named customer.

**4.3 Risk posture** (the **real GA register** — EOSP §4; referenced, not restated)

| Class                                                                                           | Source of truth                                            | This-quarter movement        |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------- |
| Open **HIGH** (GA blockers: R-1 Apple JWKS, R-2 unsigned install)                               | EOSP §4 register roll-up / `ENTERPRISE-GA-REPORT.md §5,§8` | `▢ blank` (burn-down this Q) |
| Open **MEDIUM** (R-3…R-7: fail-open, desktop CI, rollback/DR, alerting/tracing, renderer tests) | EOSP §4 register                                           | `▢ blank`                    |
| Open **LOW / LOW–MED** (R-8…R-10)                                                               | EOSP §4 register                                           | `▢ blank`                    |
| Production `npm audit --omit=dev` vulns                                                         | EOSP §4 roll-up (real)                                     | Reference EOSP §4            |
| Pilot-surfaced risks (new this Q)                                                               | This program's pilot log                                   | `— (none yet)`               |

> The register's **counts and severities are real audit facts in EOSP §4** — cited here, not
> reprinted (build-on, not restate). Movement cells are filled per quarter from the register's
> living state at the release gate (`RELEASE-CHECKLIST.md`).

**4.4 Investment asks** (placeholders — capabilities/roles to unblock, no dollar figures)

| Ask (capability)                                     | Unblocks                                                    | Owner role        | Priority | Justification (blank) |
| ---------------------------------------------------- | ----------------------------------------------------------- | ----------------- | -------- | --------------------- |
| External blackbox probe + alert routing              | Availability / dependency tiles (§2); R-3 alertability; R-6 | SRE               | `[ ]`    | `[ … ]`               |
| Automated tested rollback path                       | Deployment-readiness **Gap** (R-5); pilot rollback gate     | SRE / Release eng | `[ ]`    | `[ … ]`               |
| Per-PR desktop CI + macOS signing/notarization       | Acceptance-score confidence; R-4                            | Release eng       | `[ ]`    | `[ … ]`               |
| Apple JWKS verification / signed-package enforcement | Close GA blockers R-1, R-2                                  | Security eng      | `[ ]`    | `[ … ]`               |

> Asks are framed as **capabilities and accountable roles**, never headcount cost or budget
> figures — those are set by finance against a real plan, not asserted here. Each ask maps to a
> **real** gap in the risk register or the §1/§2 dashboard wiring.

---

## 5. Reporting cadence & how the instruments connect

**These four instruments are read on the EOSP review rhythm** (`../operations/EXECUTIVE-OPERATIONS.md
§5`), applied to a **pilot** rather than the internal fleet. The cadence and forums are
**referenced from EOSP §5, not redefined**; the table below only maps _which CDEP instrument
feeds which review, and when it stops being blank_.

| Cadence (EOSP §5)                                | CDEP instrument read                              | What advances it from blank                                                                | Owner role      |
| ------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------- |
| **Weekly** (pilot standup)                       | §1 Deployment dashboard; §2 Operational dashboard | A pilot progresses a gate; a harness runs on the customer instance and records an artifact | Deployment lead |
| **Per gate** (Entry / Success / Rollback / Exit) | §1 gate posture + §3 Executive summary            | Gate criteria (`PILOT-FRAMEWORK.md`) met with cited evidence; a decision is logged (§3.D)  | Program owner   |
| **Monthly** (ops review)                         | §2 Operational dashboard; §4.3 risk posture       | New scrape/bench windows; risk-register movement at the release gate                       | SRE lead        |
| **Quarterly** (QBR)                              | §4 Board report (all subsections)                 | The quarter's real pilot outcomes + register burn-down roll up here                        | Program owner   |
| **Per release** (release gate)                   | §4.3 risk posture                                 | Register re-checked (`RELEASE-CHECKLIST.md`); GA-blocker status (R-1, R-2) reconfirmed     | Release eng     |

**Fill order (a pilot populates these instruments in this sequence).** (1) §1 deployment-readiness
and gate posture at **Entry**; (2) §2 operational tiles + §1 evidence-completeness as harnesses
run during **Deploy**; (3) §1 acceptance-score + §3 evidence highlights at **Acceptance**; (4) §3
decisions and §4 board roll-up at **Exit / QBR**. Until step 1 begins for a first real pilot,
**all instruments remain in their shipped blank state** — which is their state today.

> **Nothing here schedules a pilot or asserts one is imminent.** The cadence describes **how a
> real pilot would be reported if run**; the pipeline (§4.2) is the empty set until one enters.

---

## Provenance & scope

- **Specifications and templates, not populated dashboards.** §1–§2 are **definition + real
  source + BLANK current value + _proposed_ target**; §3–§4 are **blank fill-in templates**. No
  tile carries a value; the BI/alert-routing layer is **absent** (EOSP §1; `_grounding.md`).
- **Pilots = 0, stated honestly.** No pilot has entered, deployed, been accepted, or exited;
  every deployment/acceptance/evidence/pipeline cell is the **empty set** until a real
  deployment fills it. No deployment count, uptime, availability, latency, error rate,
  satisfaction, revenue, or customer count is asserted.
- **Only real numbers admitted.** (a) The **EVP reference floor** (`bench/results/*.json`,
  2-vCPU) — labelled _reference, not a customer result_; a pilot re-measures on the customer's
  hardware. (b) The **real GA risk register** (EOSP §4 / `ENTERPRISE-GA-REPORT.md §4–5,§8`) —
  real severities/statuses/mitigations, **referenced not restated**.
- **Real substrate of record.** `/metrics` (`neuropause_backend_*`, `neuropause_http_requests_total`,
  `neuropause_pg_pool_connections`), `/health`, `/live`, `audit_log`, CI quality gates, and the
  `bench/` harnesses — cited inline. Customer evidence is produced by those harnesses **at pilot
  time**, never fabricated here.
- **Extends, does not duplicate.** Dashboard tiles/KPIs, the risk register, and the QBR /
  decision-log cadence are **owned by EOSP `../operations/EXECUTIVE-OPERATIONS.md`** and
  `SRE.md`; readiness by [`PILOT-MATRICES.md`](PILOT-MATRICES.md); pilot gates by
  `PILOT-FRAMEWORK.md` — referenced, not restated. **Roles, never people; personas, never named
  customers.**
