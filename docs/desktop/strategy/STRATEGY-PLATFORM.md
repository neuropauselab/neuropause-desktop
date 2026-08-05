# Enterprise Strategy Platform (Phase 6 · Stage 10)

The enterprise DIRECTION layer, composed over everything Stages 1–9 built and
over the EXISTING P14 Strategy Center. One additive subsystem
(`apps/desktop/src/main/strategyPlatform/`) that owns **no runtime, no store,
no scheduler, no executor, and no mutation surface**: objectives, the
initiative portfolio, business value, executive planning, the Enterprise
Capability Map, strategy health, strategic risks, organizational alignment,
the executive dashboard, and the board report are all **computed views over
live aggregates** (3 s TTL), recomputed per read and stored nowhere.

Execution remains exactly where it was:
`Assistant → Approval → ExecuteEngine → Workforce → Connector executors`.
Every Stage 10 recommendation is the Stage 9 Principle-C
`OperationsRecommendation` — built through the same throwing guard
(`mkRecommendation`) — and **points at existing governed surfaces**. Nothing
executes from any Stage 10 surface.

## Relationship to the P14 Strategy Center (composition, not duplication)

The EXISTING P14 Strategy Center (`strategy:*` channels, platform-operational
goals, reasoning/optimization/simulation) **stays untouched**. Stage 10:

- uses the DISTINCT `estrat:*` channel namespace,
- reuses the EXISTING `strategy:read` permission (the P14 read scope),
- composes P14 as **one injected input** (`autonomousIntel.service.overview()`
  → the `p14-strategy` layer of strategy health) — the P19←P7 precedent:
  composed, never duplicated,
- renders as the **Enterprise** tab inside the existing Strategy Center view.

## The registries (typed, versioned data — nothing invented)

Every reference names something REAL in the repository, locked by
`strategyRegistryIssues()` and by the doc-lock test
(`strategyRegistry.stage10.test.ts`).

### The Enterprise Capability Map (approved enhancement)

Twelve BUSINESS capabilities — the strategic backbone. Every objective,
initiative, KPI, strategic risk, and decision category maps into them:

| Capability | Key | Owning unit | Declared live evidence |
| --- | --- | --- | --- |
| Sales | `sales` | Sales | mined `order_to_cash`, domain `departments` |
| Marketing | `marketing` | Marketing | domain `departments` |
| Customer Success | `customer-success` | Support | service `notification-delivery`, domain `departments` |
| Finance | `finance` | Finance | mined `procure_to_pay`, domain `departments` |
| Procurement | `procurement` | Finance | mined `procure_to_pay` |
| Engineering | `engineering` | Engineering | KPI `engineering-health`, domain `projects`, service `execution-runtime` |
| Manufacturing | `manufacturing` | Operations | mined `make_to_complete` |
| Compliance | `compliance` | Legal | compliance checks, readiness `organization` |
| Risk | `risk` | Legal | domain `organization`, readiness `governance` |
| Security | `security` | IT | compliance checks, service `connector-fleet` |
| Operations | `operations` | Operations | service `workforce-jobs`, readiness `workforce`, domain `workflows` |
| Support | `support` | Support | domain `connectors`, service `connector-fleet` |

Capability **condition** composes ONLY the declared evidence signals
(`on-track` / `at-risk` / `off-track` / `unknown` with `evidenceCoverage`
0..1 — thin evidence reads as low coverage + honest unknown, never an
invented score). **Investment focus is ATTENTION COUNTS** (initiatives +
governed decisions in mapped categories) — the platform records no costs and
no currency is shown. The KPI map (`org-health`→operations,
`engineering-health`/`ai-adoption`→engineering, `connector-health`→support,
`license-status`→compliance, `active-members`→operations) and the decision
category map (`engineering`, `organization`, `governance`, `operations`,
`growth`, `other`) thread the existing vocabularies into capabilities. The
Stage 7 standards join marks capabilities `lackingStandards` when no knowledge
asset matches their topics.

The map answers, from live signals: which capability is weakest, which
receives the most attention, which is unsupported by initiatives, which lacks
standards, which carries the highest operational risk.

### Themes (3)

`reliable-autonomous-operations`, `governed-ai-adoption`,
`connected-enterprise` — each mapped to capabilities; theme state is the
worst health of its bound objectives.

### Company objectives (5) — measured ONLY by existing aggregates

| Objective | Horizon | Owner | Measures (existing aggregates) |
| --- | --- | --- | --- |
| `co-reliable-execution` | current-quarter | Operations | SLA `exec-success-rate`, SLA `exec-avg-runtime`, domain `workflows` |
| `co-healthy-organization` | annual | Business | KPI `org-health`, domain `organization` |
| `co-governed-ai` | current-quarter | AI Team | KPI `ai-adoption`, SLA `ai-engine-ready`, domain `approvals` |
| `co-dependable-integrations` | current-quarter | IT | KPI `connector-health`, SLA `connector-healthy-ratio`, domain `connectors` |
| `co-trustworthy-automation` | next-quarter | IT | SLA `automation-failure-ratio`, domain `automations` |

### Department objectives (6) — rolled up into company objectives

`do-eng-delivery` (Engineering → `co-reliable-execution`), `do-ops-flow`
(Operations → `co-reliable-execution`), `do-ai-runtime` (AI Team →
`co-governed-ai`), `do-it-fleet` (IT → `co-dependable-integrations`),
`do-legal-compliance` (Legal → `co-healthy-organization`),
`do-support-signals` (Support → `co-dependable-integrations`).

Objective health is COMPUTED, never asserted: any failing measure drags to
`at-risk` (≥ half failing → `off-track`); an objective whose every measure is
unreadable is `unknown` — never assumed good. A company objective cannot
outrank its worst rolling-up department objective. Ownership resolves live
org units via the Stage 9 resolver; a unit without a lead is an honest gap.

### Initiatives (6) — composed from EXISTING records; milestones are conditions

| Initiative | Objective | Sources (existing records) | Milestone conditions |
| --- | --- | --- | --- |
| `init-operational-cadence` | `co-reliable-execution` | playbooks `daily-ops-review` + `weekly-maintenance-review`, service `workforce-jobs` | SLA `jobs-queue-depth` met, SLA `approval-age` met |
| `init-incident-response` | `co-reliable-execution` | playbook `incident-first-response`, service `execution-runtime` | SLA `exec-success-rate` met, monitor clear of `stuck-execution` |
| `init-ai-enablement` | `co-governed-ai` | service `ai-runtime`, decisions in `engineering` | SLA `ai-engine-ready` met, readiness `ai` ready |
| `init-integration-reliability` | `co-dependable-integrations` | service `connector-fleet`, decisions in `operations` | SLA `connector-healthy-ratio` met, readiness `connectors` ready |
| `init-automation-trust` | `co-trustworthy-automation` | service `automation-rules`, playbook `quarterly-ops-report` | SLA `automation-failure-ratio` met, monitor clear of `schedule-unparseable` |
| `init-project-delivery` | `co-healthy-organization` | UDM `project` entities, mined `order_to_cash` | KPI `engineering-health` healthy, ≥1 completed `growth` decision |

**The platform records no committed dates, so none are shown and none are invented.**
A milestone evaluates to satisfied / unmet / **not evaluable**
(with the reason) against live signals. Initiative state composes honestly:
all milestones satisfied → `done`; breach/failed-source blockers → `blocked`
WITH evidence; some progress → `advancing`; readable but unmoving →
`stalled`; nothing readable → `unknown`. `init-incident-response` depends on
`init-operational-cadence` (`dependsOn`).

### Strategic risks (5) — substantiated ONLY by live signals

`risk-execution-degradation` (SLA `exec-success-rate`, finding
`stuck-execution`), `risk-integration-outage` (SLA
`connector-healthy-ratio`, incident domain `connectors`),
`risk-ungoverned-ai` (readiness `governance`, incident domain `approvals`),
`risk-automation-sprawl` (SLA `automation-failure-ratio`, finding
`error-rule`), `risk-leadership-vacuum` (readiness `organization`).

A risk is **substantiated** only when at least one of its evidencing signals
is live; a quiet risk reports `unsubstantiated` — stated honestly, never
escalated, never scored by guesswork.

## Business value (computed, never estimated)

Each governed decision joins: its own declared `expectedOutcome` /
`businessImpact`, the Stage 6 outcome-loop stage of its linked recommendation
(`recommended` → `approved` → `executed` → `verified`), and measured deltas
from the EXISTING 90-day health history over the decision's window. Verdicts:
`delivered` (verified AND measurable improvement), `partial`, 
`not-yet-observed`, `unmeasurable`. **No revenue, cost, or margin figures
exist in the platform — none are shown and none are estimated** (the
disclosure states it on every surface).

## Executive planning (recommends; never executes)

Three RELATIVE horizons (`current-quarter`, `next-quarter`, `annual`)
computed from the clock at read time — no stored dates. Each horizon's focus
list composes objectives at risk, blocked/stalled initiatives, and Stage 9
capacity pressure into Principle-C recommendations
(`stratrec:objective:*`, `stratrec:initiative:*`, `stratrec:capacity:*`),
each carrying detail, priority, suggested action, evidence, reasoning,
confidence, affected systems, operational impact, expected business outcome,
and rollback implications.

## Strategy health

Themes + the five composed layers — Stage 6 `intelligence`, Stage 7
`knowledge`, Stage 8 `automation`, Stage 9 `operations`, and `p14-strategy`
(P14 composed as one input) — plus the capability map, the risk register, and
unit→company-objective **alignment** (a unit with no department objective is
an alignment gap, stated honestly). Per-layer isolation: a failing layer
degrades to `unknown` with the reason; it never poisons its siblings.

## IPC surface (read-only; fail-closed)

Six channels, each `requireAuth: true` + RBAC `strategy:read` (the EXISTING
P14 read scope — no new permission is minted):

| Channel | Payload |
| --- | --- |
| `estrat:objectives` | `ObjectivesReport` (company + departments, totals, gaps, unavailable) |
| `estrat:portfolio` | `{ portfolio: PortfolioReport; value: BusinessValueReport }` |
| `estrat:planning` | `PlanningReport` (three horizons + focus) |
| `estrat:health` | `StrategyHealthView` (themes, layers, capability map, risks, alignment) |
| `estrat:dashboard` | `StrategyDashboard` (totals, KPIs, deduped recommendations, disclosures) |
| `estrat:report` | `BoardReport` (sectioned, evidence-cited board brief) |

Zero mutation channels. The `estrat:` prefix is registered in the
runtime-authz completeness lock (`runtimeAuthz.test.ts`), and the cluster is
locked by `index.stage10.test.ts`.

## Assistant (11 questions, in-process port)

`resolveStrategyQuestion` matches (keys): `strategy-status`,
`objectives-at-risk`, `initiative-portfolio`, `business-value`, `alignment`,
`executive-focus`, `strategic-risks`, `roadmap-outlook`,
`investment-priorities`, `board-brief`, `capability-analysis` — e.g. “What is
the state of our strategy?”, “Which objectives are at risk?”, “Which decisions
delivered business value?”, “Which business capability is weakest?”, “Prepare
the board brief.” Answers ride the existing `intelligence` structured-report
kind, cite the computed views verbatim, and declare uncertainty. The matcher
is SIX-WAY disjoint from the Stage 5 productivity, Stage 6 insight, Stage 7
knowledge, Stage 8 automation, and Stage 9 operations resolvers — both
directions test-locked.

## Monitoring (one governed source)

`strategy-watch` (daily 09:00 via the EXISTING delivery engine): NEW
critical/high focus recommendations become governed intelligence ITEMS
(evidence, source systems, confidence, reasoning, recommended action —
deduped per session). Items recommend; they never act. Muteable per source in
Notification preferences like every other source.

## Renderer

The **Enterprise** tab inside the EXISTING P14 Strategy Center
(`strategyCenter/StrategyCenterView.tsx` → 
`strategyPlatform/EstratPlatformTab.tsx` + pure
`estratPlatformModel.ts`): header stats, objectives, portfolio, business
value, the capability map, risks, planning focus, alignment, the board
report, and the declared-unavailability strip. The tab mutates nothing.

## Honesty rules (structural, tested)

- Every metric traces to an existing aggregate; a failing read becomes an
  explicit `unavailable` entry — never a fabricated value, never a silent
  zero.
- Health/condition/verdict values are computed from live signals or reported
  `unknown`/`unmeasurable` — never asserted.
- No dates are invented; horizons are relative, milestones are conditions.
- No currency is invented; value is measured deltas + the outcome loop;
  investment focus is attention counts. Disclosures state both on-surface.
- Registry integrity (`strategyRegistryIssues()`) and this document are
  test-locked; the Principle-C guard throws on any incomplete
  recommendation.

## Performance (composition budgets, bench-tested)

Objectives / portfolio / planning / health builds ≤ 100 ms each; the full
dashboard and board report ≤ 500 ms — measured over the seeded composition in
`strategyBench.stage10.test.ts` (after a warmup pass; 3 s TTL amortizes
per-read cost in production).
