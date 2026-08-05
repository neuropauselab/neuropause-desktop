# Enterprise Operations Platform (Phase 6 · Stage 9)

The Operations Platform is **one additive composition subsystem**
(`apps/desktop/src/main/operationsPlatform/`) over engines that already exist.
It owns **no runtime, no store, no scheduler, no executor, and no mutation
surface**. Execution continues to flow exclusively through the existing spine:

```
Assistant → Approval → ExecuteEngine → Workforce → Connector Executors
```

This document is **test-locked** to the code registries
(`operationsRegistry.stage9.test.ts` fails if the two drift): every domain,
service, SLA target, objective, process, IPC channel, and assistant question
listed here exists in `operationsRegistry.ts` / `index.ts`, and vice versa.

---

## 1. The Operations Registry (code-shipped, versioned data)

**Domains** reuse the Stage 6 eight-domain vocabulary verbatim — no second
domain model. Each maps to a REAL seeded org-unit name for ownership
resolution; a unit without a lead is an honest ownership gap:

| domain | owning unit |
| --- | --- |
| `organization` | Operations |
| `departments` | Business |
| `projects` | Product & Engineering |
| `workflows` | Operations |
| `automations` | IT |
| `ai` | AI Team |
| `connectors` | IT |
| `approvals` | Operations |

**Services** — each names the REAL aggregate that measures it (`signal`); the
two `none-measured` services exercise the declared-unmeasurable SLA path:

| id | signal | SLA targets |
| --- | --- | --- |
| `execution-runtime` | execution-stats | `exec-success-rate`, `exec-avg-runtime` |
| `workforce-jobs` | workforce | `jobs-queue-depth`, `approval-age` |
| `automation-rules` | automation-monitor | `automation-failure-ratio` |
| `connector-fleet` | connectors | `connector-healthy-ratio` |
| `ai-runtime` | ai-engine | `ai-engine-ready` |
| `assistant-experience` | none-measured | `assistant-response-latency` (declared unmeasurable) |
| `notification-delivery` | none-measured | `notification-latency` (declared unmeasurable) |

**Objectives** bind KPIs/SLAs to owners and a review cadence:
`reliable-execution` (weekly) · `dependable-integrations` (weekly) ·
`trustworthy-automation` (monthly) · `organizational-health` (quarterly).

**Processes** join registry names to the MINED reality (the real
process-mining `ProcessType` union): `order-to-cash` (`order_to_cash`),
`procure-to-pay` (`procure_to_pay`), `make-to-complete` (`make_to_complete`),
and `employee-onboarding` (`minedType: null` — an honest not-mined gap).

## 2. The Service Catalog (computed; D-1)

`eops:catalog` joins the registry against the LIVE signals on every read
(3 s TTL): execution stats, job pages, the automation monitor, the connector
list, the engine state, the live executive KPI keys, and the live org units.
`none-measured` services are honestly `unknown`; unmatched owners, missing
KPI keys, unmeasured signals, and unmined processes all surface as **gaps**.
When the Stage 8 automation platform is live, its catalog size rides the
`automation-rules` row's evidence trail (the D-2 seam — composition only).

## 3. The SLA framework (D-3)

Targets are registry data; measurement comes ONLY from aggregates the platform
already records (`executeEngine.stats()`, the job store, the automation
monitor, the connector list, the engine state). A target whose registry row
carries `measuredBy: null` is **`unmeasurable` — declared, never estimated** —
because no per-request tracing exists anywhere in the platform. Breaches become
evidence-cited findings and Principle-C recommendations.

## 4. Incident lifecycle (D-4)

Incidents remain the Stage 6 COMPUTED views — **`transient: true` is a literal
on every row** because no incident store exists and Stage 9 adds none. The
lifecycle composes what exists: detected (correlation) → investigating (root
cause + the existing timeline replay) → recovering (recommended actions through
the existing gated flow) → verified-closed (the window ended — the Stage 6
outcome loop). Ownership resolves registry-domain → live org-unit lead. The
honest persistence path is **converting a recommendation into a governed
DECISION** (the existing decision store) — stated on every incident row.

## 5. Readiness (D-5)

Seven dimensions — `deployment`, `organization`, `connectors`, `automation`,
`workforce`, `ai`, `governance` — each `ready` / `degraded` / `not-ready` /
`unknown` with evidence ids and what's missing. Signals: continuous-validation
runs + certification, the existing compliance checks, connector fleet health,
the automation monitor + error rules, worker health + queue depth, the engine
manager's own state, and enabled approval chains. **Unknown stays unknown**
(zero finished automation runs is `unknown`, not assumed ready).

## 6. Continuity (D-6)

Composes the federation DR store (posture, replicas, **recorded** recovery
validations), the local backup manager (sha256-manifest backups via a
read-only release-ops accessor), and the recovery mechanisms that already exist
(runtime supervisor, execution interruption recovery, workflow replay).
**Honest zero everywhere**: unconfigured is zero, observed RPO comes only from
the last recorded validation, and nothing fabricates resilience.

## 7. Principle-C recommendations (D-7)

Every operational recommendation structurally carries seven fields —
**evidence, reasoning, confidence, affected systems, operational impact,
expected business outcome, rollback implications** — enforced by
`recommendationIssues` and a composer that **throws** on incompleteness.
Recommendations never execute; every suggested action points at an existing
governed surface.

## 8. The read-only IPC surface (D-9)

Six channels, all `requireAuth` + RBAC **`autonomousops:read`** (the existing
P19 read scope — no new permission), registered in the completeness lock via
the `eops:` prefix:

| channel | payload |
| --- | --- |
| `eops:catalog` | the computed Service Catalog |
| `eops:health` | the Stage 6 framework verbatim + system/workforce/connector adjuncts + the 90-day trend |
| `eops:readiness` | readiness assessment + SLA report + business processes |
| `eops:incidents` | the incident lifecycle report |
| `eops:continuity` | the continuity view (the one async composition) |
| `eops:dashboard` | the composed dashboard (KPIs, objectives, recommendations, disclosures) |

**Zero mutation channels. Zero execution channels.**

## 9. The assistant's ten operations questions (D-8)

`resolveOperationsQuestion` routes exactly ten keys — `ops-status`,
`service-health`, `bottlenecks`, `readiness`, `continuity`, `incidents`,
`sla`, `business-impact`, `capacity`, `ops-planning` — disjoint from the
Stage 5/6/7/8 resolvers in BOTH directions (test-locked). Answers ride the
existing `'intelligence'` structured-report kind through one `operationsAnswer`
port. Business impact is qualitative composition — never invented currency.

## 10. Monitoring

One governed delivery source — **`operations-watch`** (daily, via the existing
delivery engine) — turns critical/high Principle-C recommendations (SLA
breaches, readiness regressions, critical incidents) into recommendation
**items**, never actions, honoring every existing notification gate.

## 11. The Operations Center · Platform tab

One additive tab (`platform`, the 15th) inside the existing Operations Center
renders the catalog, SLA report, readiness, incidents, continuity, processes,
KPIs, and recommendations. It loads its own `eops:*` reads (isolated from the
P7 report), mutates nothing, and the capability registry entry is
`operations.platform`.

## 12. Performance budgets (bench-locked)

At the Stage 9 load model (500 sessions · 500 jobs · 100 rules · 5 k entities ·
90-day history):

- service catalog ≤ 100 ms
- operational health compose ≤ 100 ms
- readiness ≤ 100 ms
- continuity ≤ 50 ms
- dashboard composition ≤ 500 ms

`operationsBench.stage9.test.ts` enforces these against synthetic fixtures of
exactly that shape (after a discarded warm-up pass).

## 13. Structural disclosures (ship on every dashboard)

- Incidents are transient computed views — no incident/ticket store exists; the
  persistent operational record is a governed decision.
- SLA measurement is bounded by aggregates the platform already records;
  targets without a recording aggregate are declared unmeasurable.
- Organizational maturity is computed in the renderer capability registry (the
  declared Stage 7 boundary) and is not recomputed here.
