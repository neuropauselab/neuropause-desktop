# NeuroPause EOSP — Executive Operations & Dashboard Specification

> **What this is.** The executive-facing operating layer of the Enterprise Operations &
> Scale Program (EOSP): the **dashboard specifications**, KPI/SLI **definitions**, the
> **real risk register**, and the **strategic review cadence** by which NeuroPause is run and
> reported at scale. It adds **no runtime and no platform** — it defines _what an executive
> sees, where each number comes from, and how often it refreshes_, wired over the **real**
> observability substrate and the **measured** coefficients in `_grounding.md`. Reliability
> targets, error-budget math, and capacity formulas are **owned by `SRE.md`** and are
> **referenced here, not restated**.
>
> **Data-not-fabricated banner (non-negotiable).** Every dashboard in this document is a
> **SPECIFICATION** — a set of tile/metric **definitions with real data sources and _proposed_
> targets**. **No tile is populated with a value here.** There is **no production fleet and no
> live commercial data** (billing is real but **disabled until `RAZORPAY_*` is configured**),
> so this document states **no achieved uptime, MTTR, availability, revenue, ARR, seat count,
> NPS, CSAT, ticket volume, or customer count**. KPIs/SLIs are **definitions + how-to-measure**;
> all SLO/target labels are **proposed objectives, to be ratified against production data**.
> The **BI / exec-dashboard and alert-routing layer is absent** — dashboards are **proposed
> wiring over the real substrate**, not a shipped product surface. The **one section with real
> populated content is the risk dashboard (§4)** — it is the **real GA risk register**
> (`ENTERPRISE-GA-REPORT.md`), whose severities, statuses, and mitigations are real audit
> facts, not invented business numbers. **Roles, never people.**

---

## 1. Executive dashboard (tile specification)

**What an executive opens.** A single board of **tiles**. This section defines each tile as
**name + what the exec sees (definition) + real source + refresh cadence** — it is the **spec
the board is built from**, deliberately **unpopulated**. Values appear only once the proposed
wiring (below) is stood up over the real series; until then these tiles are watched **manually**
(a standing SRE toil item, `SRE.md §1`).

> **THIS BOARD SHOWS NO NUMBERS IN THIS DOCUMENT.** Each tile is a contract for a value to be
> computed from a real source at deploy time. Do not read any figure into a tile here — none is
> asserted. Reliability tiles surface `SRE.md`'s SLIs; they do **not** redefine its SLOs.

### Panel A — Reliability & service health

| Tile                     | What the exec sees (definition)                                                               | Real source                                                                                                       | Refresh               |
| ------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------- |
| **Service health**       | Backend serving vs degraded, with DB/Redis component state                                    | `GET /health` `status:ok\|degraded`, `components.database\|redis` (blackbox probe — _external, proposed_)         | Live (probe interval) |
| **Request success rate** | Non-5xx share of served requests over window (vs proposed SLO)                                | `neuropause_http_requests_total{status}` (**real scrape**), SLI per `SRE.md §2`                                   | Live (scrape)         |
| **Error-budget burn**    | % of the _proposed_ 30-day budget consumed + burn tier (Fast/Med/Slow)                        | Derived from the real 5xx counter; policy in `SRE.md §4`                                                          | Live (scrape)         |
| **Capacity headroom**    | Replica read-rps used vs the measured 400–600 rps/replica floor; RSS vs limit; pool `waiting` | `neuropause_backend_resident_memory_bytes`, `pg_pool_connections{state}` (**real scrape**); floors in `SRE.md §6` | Live (scrape)         |

### Panel B — Delivery & quality

| Tile                   | What the exec sees (definition)                             | Real source                                                                                  | Refresh              |
| ---------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------- |
| **Release readiness**  | Pass/fail of the four quality gates on the assessed commit  | `npm run typecheck / lint / test / build` — CI gates (`ENTERPRISE-GA-REPORT.md §2.1`)        | Per commit / PR (CI) |
| **Test-suite state**   | Green test count and any gate regression                    | CI test job — **3,856 tests** baseline (`_grounding.md`)                                     | Per CI run           |
| **Rollout / recovery** | Rolling-update status and restart-recovery budget adherence | `neuropause_backend_uptime_seconds` drop (**real scrape**); `maxUnavailable:0` (`SRE.md §5`) | Per release / live   |

### Panel C — Commercial & adoption

| Tile                    | What the exec sees (definition)                                                    | Real source                                                                                           | Refresh             |
| ----------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------- |
| **Commercial posture**  | Distribution of subscription `status` (active vs pending/halted/cancelled/expired) | Razorpay subscription shape (`billing/types.ts`) — **real schema, billing disabled until configured** | Per webhook / daily |
| **Customer health mix** | Roster split by health-index band (Healthy/Watch/At-Risk)                          | Composite 0–100 index method (`CUSTOMER-SUCCESS.md §6`) over real telemetry                           | Daily               |

### Panel D — Risk & compliance

| Tile                     | What the exec sees (definition)                                                          | Real source                                                                                            | Refresh                               |
| ------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| **Open risk posture**    | Count of open HIGH / MEDIUM / LOW register entries + GA-blocker count                    | The **real risk register** (§4; `ENTERPRISE-GA-REPORT.md §4–5`)                                        | On register update / per release gate |
| **Compliance readiness** | EVP vertical self-assessment banding (pass/warn/fail) — **readiness, not certification** | EVP vertical packs (`docs/validation/verticals/*`); scorecard convention `ADMINISTRATOR-GUIDE.md §7.5` | Per evidence cadence (quarterly)      |

**Wiring status (honest).** No exec-BI tool and no alert routing ship (`OPERATIONS-GUIDE.md`
"Known Operational Gaps"; `_grounding.md`). **Proposed wiring:** Prometheus recording/alerting
rules + **Alertmanager** + a **blackbox exporter** on `/health` (per `SRE.md §4`) feeding a BI
surface (e.g. Grafana/Metabase) over the **real** `/metrics`, `/health`, `audit_log`, CI, and
`bench/results` series. Until wired, this board is a **specification**, not a live screen.

---

## 2. Business KPIs

**Definitions + real sources + _proposed_ targets — no values.** Every KPI below is a
**definition and a measurement method** over a real commercial or adoption surface. **No
revenue, ARR, MRR, seat count, renewal rate, conversion rate, NPS, CSAT, or customer count is
asserted.** Billing is real (Razorpay checkout/cancel) but **disabled until `RAZORPAY_*` is
configured**, so **no live commercial figure exists to report**. Targets are **proposed
objectives**, never a claimed result.

| Business KPI                    | Definition / how to measure                                                    | Real source                                                                                | Proposed target (label: _proposed_)                                                               |
| ------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **Active seats (value metric)** | Count of billed active seats above the included base; the primary value metric | `includedSeats` + per-seat overage (`billing.ts`; `BUSINESS-EXPANSION.md §1.2`)            | _Proposed:_ net-seat growth objective (no number)                                                 |
| **Subscription status mix**     | Share of subscriptions in each `status` state                                  | Razorpay `status` enum: `active\|pending\|halted\|cancelled\|expired` (`billing/types.ts`) | _Proposed:_ % `active` floor                                                                      |
| **Plan-tier distribution**      | Accounts per plan (`trial/starter/professional/enterprise`)                    | `BillingPlanId`, `BILLING_PLANS` (`packages/shared/src/types/billing.ts`)                  | _Proposed:_ tier-mix objective                                                                    |
| **Expansion (tier / seat)**     | Movement `pro → enterprise` and seat growth (the real capability jump)         | Feature gate `minPlan`; `evaluateFlag` (`featureFlags/`; `BUSINESS-EXPANSION.md §1.3`)     | _Proposed:_ net-expansion objective                                                               |
| **Trial → paid conversion**     | Trials reaching a first-value milestone then a paid `status`                   | 14-day trial (`trial` plan); onboarding milestones (`CUSTOMER-SUCCESS.md §3.1`)            | _Proposed:_ conversion objective                                                                  |
| **Renewal-cycle exposure**      | Subscriptions inside the T-90 window before `currentEnd`                       | `currentEnd`, `chargeAt`, `endedAt` (`billing/types.ts`; `CUSTOMER-SUCCESS.md §7`)         | _Proposed:_ % with a review completed T-90                                                        |
| **Customer health band mix**    | Roster split across Healthy / Watch / At-Risk bands                            | Composite 0–100 index (`CUSTOMER-SUCCESS.md §6`)                                           | _Proposed:_ % Healthy objective                                                                   |
| **Adoption-stage distribution** | Accounts by maturity stage (Crawl / Walk / Run)                                | Maturity model (`CUSTOMER-SUCCESS.md §5`)                                                  | _Proposed:_ stage-advance objective                                                               |
| **Usage-meter consumption**     | Requests/AI-cost meters vs included allowance (capacity/overage signal)        | `CommercialMetering.meters` (`requests30d`, `aiCostUsd`) (`BUSINESS-EXPANSION.md §1.2`)    | _Proposed:_ overage-headroom objective                                                            |
| **Support-SLA attainment**      | Tickets meeting the negotiated S1–S4 response framework                        | SLA framework (`CUSTOMER-SUCCESS.md §8–9`)                                                 | _Proposed:_ per-tier target (only **real** published SLA: security-disclosure ack, `SECURITY.md`) |

**Honest guardrails.** (1) **Seats are displayed, not enforced** — no seat-cap gate exists
(`ADMINISTRATOR-GUIDE.md §9`); treat seat KPIs as advisory. (2) **Enterprise is
sales-assisted** (`selfServe:false`); self-serve conversion applies to `starter/professional`
only. (3) `audit_log` backend coverage is **auth-events-only today** — governance-activity
KPIs are bounded to what is actually written until call-site coverage is extended.

---

## 3. Operational KPIs

**Defined from the real observability substrate + the SRE SLIs.** These surface reliability
for the executive board; the **full SLI definitions, _proposed_ SLOs, error-budget arithmetic,
burn-rate policy, and capacity formulas live in `SRE.md §2–6` and are not restated here.** No
achieved availability, MTTR, or incident count appears — none exists.

| Operational KPI                     | Definition / how to measure                                           | Real source                                                  | SRE ref & _proposed_ target                             |
| ----------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| **Request success rate**            | `1 − (Σ rate(5xx) / Σ rate(all))` over window                         | `neuropause_http_requests_total{status}` (**real scrape**)   | `SRE.md §2/§3` — _proposed_ ≥ 99.9%                     |
| **Error-budget burn**               | Multi-window burn rate vs the _proposed_ budget (Fast/Med/Slow tiers) | Derived from the real 5xx counter                            | `SRE.md §4` — page ≥ 14.4×                              |
| **Readiness availability**          | Good-probe fraction (`/health`=200) over window                       | `GET /health` (blackbox probe — _external, proposed_)        | `SRE.md §3/§5` — _proposed_ 99.9%                       |
| **Dependency health (DB/Redis)**    | Fraction of probes with `components.*=="up"`                          | `GET /health` component JSON (_external, proposed_)          | `SRE.md §3` — _proposed_ ≥ 99.9–99.95%                  |
| **Pool saturation (latency proxy)** | Fraction of scrapes with pool `waiting==0`                            | `pg_pool_connections{state="waiting"}` (**real scrape**)     | `SRE.md §2` — _proposed_ ≥ 99%                          |
| **Memory headroom**                 | `resident_memory_bytes / limits.memory`                               | `neuropause_backend_resident_memory_bytes` (**real scrape**) | `SRE.md §6` — measured ≈ 230 MB/replica                 |
| **Restart recovery**                | Time from process-down to `/health` 200                               | `neuropause_backend_uptime_seconds` drop (**real scrape**)   | `SRE.md §5` — _proposed_ ≤ 5 s (measured 0.46 s)        |
| **Read latency p95**                | External p95 per route (app ships **counts only**, no histogram)      | `bench/http-load.mjs` + blackbox probe                       | `SRE.md §3` — _proposed_ ≤ 150 ms / ≤ 250 ms            |
| **Auth-throughput headroom**        | `observed_login_rps / (cores × 50)` (Argon2-bound)                    | Argon2id verify bench (~50/s/core) + login counts            | `SRE.md §6` — size separately from reads                |
| **Delivery quality gates**          | Pass/fail of typecheck / lint / test / build                          | CI (`ENTERPRISE-GA-REPORT.md §2.1`)                          | _Proposed:_ 100% green to release                       |
| **Audit-log completeness**          | Presence of expected append-only entries for privileged actions       | `audit_log` table (append-only)                              | _Proposed:_ extend call-site coverage (auth-only today) |

> **Provenance.** Success, pool, memory, and uptime KPIs run on the **real scrape**;
> availability and dependency KPIs require the **blackbox probe the platform does not ship**
> (_external, proposed_); latency comes from the **bench harness** (no histogram exists).
> Alert routing is **absent** — these are watched manually until wired (`SRE.md §4`).

---

## 4. Risk dashboard — the real GA risk register

**This is the one populated dashboard, because it is real.** It tracks the **actual** register
from `ENTERPRISE-GA-REPORT.md §4` (Technical Debt) and **§5** (Production Risk Matrix) as living
entries: **ID + risk + severity + owner-role + status + in-place mitigation + residual action to
GA**. Severities, statuses, and mitigations are **real audit facts**, not invented numbers.
**HIGH items are GA blockers** (`ENTERPRISE-GA-REPORT.md §8`). **Roles, not people.**

| ID       | Risk                                                                                                           | Sev      | Owner role             | Status                         | In-place mitigation (real)                                                                              | Residual action → GA                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------- | -------- | ---------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **R-1**  | Apple `id_token` decoded but **not JWKS-verified** (`apple.ts:14-16,77`; TD-1/PR-1)                            | **HIGH** | Security / Backend eng | **Open — GA blocker**          | Backend-brokered Apple flow; requires a crafted token; other providers use authenticated userinfo/Graph | Verify signature vs **Apple JWKS** (`jose`/JWKS client; seam + TODO exist)                                       |
| **R-2**  | Marketplace **unsigned app install** bypasses gate when trust store empty (`packageService.ts:184`; TD-2/PR-2) | **HIGH** | Security / Desktop eng | **Open — GA blocker**          | Integrity hash **always** checked; signature enforced when present; worker path fail-closed             | Require valid signature / non-empty publisher trust store to install                                             |
| **R-3**  | Rate limiter **fails open** on Redis loss (`rateLimit.ts:37`; TD-3/PR-3)                                       | MEDIUM   | SRE / Backend eng      | Open — accepted, alert-pending | Deliberate availability-over-strictness; **auth still required**; documented in source                  | **Alert on limiter fail-open** (`redis:"down"`) via §4/`SRE.md` wiring                                           |
| **R-4**  | **No per-PR desktop CI; no macOS release automation** (`.github/workflows/`; TD-4/PR-4,5)                      | MEDIUM   | Release eng            | Open                           | Full 3,548-test suite runs locally + RC gate; signing configured, env-gated                             | Add per-PR desktop CI (typecheck+lint+tests); add mac packaging/signing/notarization                             |
| **R-5**  | Update **rollback advisory-only**; **federation DR modeled** (TD-5/PR-7)                                       | MEDIUM   | SRE / Release eng      | Open                           | **Data-side restore** documented and proven (`DISASTER-RECOVERY-GUIDE.md`)                              | Promote rollback advisory → automated tested path; do **not** fold modeled federation into an availability claim |
| **R-6**  | **No alert routing, tracing, or capacity forecasting** (TD-6/PR-6)                                             | MEDIUM   | SRE                    | Open — highest-leverage toil   | `/metrics` + structured redacted logs exist to scrape                                                   | Wire Alertmanager + tracing + external forecast (`SRE.md §4`); make R-3 alertable                                |
| **R-7**  | Renderer component/E2E/a11y tests + coverage **absent** (TD-7)                                                 | MEDIUM   | QA / Desktop eng       | Open                           | Model/logic layer well covered (3,548 desktop tests green)                                              | Add renderer smoke + a11y tests + coverage instrumentation                                                       |
| **R-8**  | Largest renderer chunk **930 KB** (TD-8)                                                                       | LOW–MED  | Desktop eng            | Open                           | Route-level code-splitting already present for views                                                    | Bundle trim / further code-splitting                                                                             |
| **R-9**  | Some admin scopes **surfaced in UI only partially** (TD-9)                                                     | LOW      | Enterprise eng         | Open                           | Backend model complete and tested                                                                       | Incremental UI exposure of remaining scopes                                                                      |
| **R-10** | **FNV-1a** used where a cryptographic hash may be expected (TD-10)                                             | LOW      | Security eng           | Open                           | Non-security-critical usage; tracked in Security Guide                                                  | Hash review per `SECURITY-GUIDE.md`                                                                              |
| **R-11** | Fabricated demo data mistaken for real metrics (PR-8)                                                          | —        | Backend / Data         | **CLOSED (this RC)**           | **`SEED_STORE_ON_BOOT=false`** in all prod configs; seed tests assert empty                             | — (closed)                                                                                                       |

**Severity legend.** HIGH = GA blocker; MEDIUM = day-2/release-engineering gap, not a
core-correctness failure; LOW = polish. **Status legend.** Open = tracked, unresolved;
Open — accepted = deliberate trade-off with a compensating control; Closed = eliminated with
evidence.

**Register roll-up (real, from the entries above — for the §1 "Open risk posture" tile).**

| Metric (real count from register)       | Value                               |
| --------------------------------------- | ----------------------------------- |
| Open **HIGH** (GA blockers)             | **2** (R-1, R-2)                    |
| Open **MEDIUM**                         | 5 (R-3…R-7)                         |
| Open **LOW / LOW–MED**                  | 3 (R-8, R-9, R-10)                  |
| Closed this RC                          | 1 (R-11)                            |
| Production `npm audit --omit=dev` vulns | **0** (11 advisories, all dev-only) |

> These counts are **real facts from the register**, not fabricated business metrics. The
> register is reviewed on the strategic cadence (§5) and re-checked at **every release gate**
> (`RELEASE-CHECKLIST.md`). Closing R-1…R-6 is the standing path from **RC → Enterprise GA**
> (`ENTERPRISE-GA-REPORT.md §8`).

---

## 5. Strategic review process

**Cadence.** Operations are reviewed on a nested cadence; the **quarterly strategic review
(QBR)** is where dashboards, KPIs, the risk register, and roadmap converge. Every review draws
its inputs from the **EOSP operating manuals and the real assets underneath them** — it invents
no new numbers.

| Cadence            | Forum                      | Focus                                                     | Primary inputs                                     | Owner role               |
| ------------------ | -------------------------- | --------------------------------------------------------- | -------------------------------------------------- | ------------------------ |
| **Daily / weekly** | On-call handoff            | Live reliability, open incidents, budget-burn state       | `SRE.md §1` handoff checklist; §3 operational KPIs | Primary on-call (IC-eng) |
| **Monthly**        | Operations review          | Operational-KPI trend; risk burn-down; toil trend         | §3 KPIs; §4 register; `SRE.md §1` toil budget      | SRE lead                 |
| **Quarterly**      | **Strategic review (QBR)** | Business + operational + risk + roadmap; GA-gate progress | **All inputs below**                               | Program owner            |
| **Per release**    | Release gate               | Ship/no-ship; risk re-check                               | `RELEASE-CHECKLIST.md`; §4 register                | Release eng              |

**Quarterly review inputs (from the EOSP doc set + real substrate).**

| Input                     | Source EOSP doc / real asset                           | Contributes                                                   |
| ------------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| Reliability posture       | `SRE.md` (SLIs/SLOs, error budgets, capacity, toil)    | Are _proposed_ SLOs still right; capacity plan vs projections |
| **Risk register**         | **§4 of this doc + `ENTERPRISE-GA-REPORT.md §4–5,§8`** | HIGH-blocker burn-down; new/aged risks; GA readiness          |
| Delivery & quality        | CI quality gates + `RELEASE-CHECKLIST.md`              | Gate stability; release-calendar/hotfix posture               |
| Capacity & scale          | `SRE.md §6` + `bench/results/*.json`                   | Replica/DB/auth sizing vs projected demand                    |
| Commercial posture        | `BUSINESS-EXPANSION.md` + billing substrate            | Tier mix, expansion motion, packaging                         |
| Customer health & support | `CUSTOMER-SUCCESS.md` (health index, renewal, SLA)     | Health-band mix; renewal exposure; SLA framework              |
| Compliance readiness      | EVP vertical packs (`docs/validation/verticals/*`)     | Audit-readiness evidence cadence — **not certification**      |
| DR & rollback posture     | `DISASTER-RECOVERY-GUIDE.md`                           | Restore drills; rollback-automation progress (R-5)            |

**Quarterly agenda (ordered).** (1) Reliability & error-budget review → reaffirm/revise
_proposed_ SLOs. (2) **Risk-register walk** — HIGH blockers first (R-1, R-2), then MEDIUM
burn-down. (3) Capacity plan vs projected demand. (4) Commercial & customer-health review.
(5) Compliance evidence cadence. (6) Roadmap & **GA-gate** decision (`§8` items). (7) Log every
decision (below).

**Decision-log format.** Append-only, mirroring the `audit_log` discipline (never rewritten;
supersede with a new entry). Recorded for every strategic decision:

| Field            | Content                                                         |
| ---------------- | --------------------------------------------------------------- |
| **Decision ID**  | `EOSP-YYYYQn-NN` (sequential, immutable)                        |
| **Date**         | ISO date of the review                                          |
| **Decision**     | The call made (one line)                                        |
| **Rationale**    | Why, in one line                                                |
| **Inputs cited** | The dashboard tiles / KPIs / risk IDs / EOSP docs that drove it |
| **Owner role**   | Accountable role (never a person)                               |
| **Review-by**    | Date/condition to revisit                                       |
| **Status**       | Proposed / Ratified / Superseded-by-`<ID>`                      |

> **Example row (template, not a real decision):** `EOSP-2026Q3-01` · _"Hold GA until R-1 and
> R-2 close"_ · rationale _"both HIGH, both GA blockers"_ · inputs _§4 R-1/R-2,
> `ENTERPRISE-GA-REPORT.md §8`_ · owner _Program owner_ · review-by _next QBR_ · status
> _Proposed_. The value fields illustrate the **format**; they assert no outcome.

---

## Provenance & scope

- **Specifications, not populated dashboards.** §1–§3 are **definitions + real sources +
  _proposed_ targets**. No tile is filled with a value here; the **exec-BI and alert-routing
  layer is absent** — dashboards are **proposed wiring over the real substrate** (Prometheus /
  Alertmanager / blackbox exporter / BI tool), not a shipped surface.
- **Real substrate of record.** `/metrics`, `/health`, `/live`, `audit_log`, CI quality gates,
  `bench/results/*.json`, the Razorpay billing schema, and the EVP vertical packs — cited
  inline. **Measured** coefficients and **defined** SLIs are real; **SLOs/targets are proposed**
  (`SRE.md`).
- **The risk dashboard (§4) is the real register** (`ENTERPRISE-GA-REPORT.md §4–5,§8`) — real
  severities/statuses/mitigations, roles not people. Its roll-up counts are real facts from that
  register, **not fabricated business metrics**.
- **No fabricated values anywhere.** No uptime, MTTR, availability, revenue, ARR, seat count,
  NPS/CSAT, ticket volume, or customer count is asserted — there is no production fleet and
  billing is disabled until configured. Compliance is **readiness/audit-prep, never certified**.
- **Extends, does not duplicate.** SLO/error-budget/capacity math is owned by `SRE.md`; incident
  execution by `OPERATIONAL-RUNBOOKS.md`; support/renewal by `CUSTOMER-SUCCESS.md`; packaging by
  `BUSINESS-EXPANSION.md` — referenced, not restated.
