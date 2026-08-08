# NeuroPause Desktop — ERP Completion Report (Gap Analysis)

**Date:** 2026-08-05
**Repo HEAD at time of writing:** `9d6d271` on `phase6-stage13-enterprise-digital-twin-platform`
**Author:** continuation-engineer session (evidence-based; nothing in this report is assumed)
**Rule:** no module is implemented until this report is approved. No fake modules, no placeholder screens, no mock data — every future module ships on the existing `defineEnterpriseModule` framework or it does not ship.

> **Historical snapshot (2026-08-05).** This is a point-in-time gap analysis, preserved as written. Some surface names predate the Phase-2 navigation rename — notably the enterprise-knowledge explorer, then described with the older "fabric" terminology, is now labelled **Enterprise Knowledge**. For current terminology and status, see `docs/product/PRODUCT-CATALOG.md` and `docs/product/PRODUCT-MATURITY-MATRIX.md`.

---

## 1. Method and evidence

Every classification below is grounded in the repository, not in prior chat sessions:

- `certification-matrix.csv` — 46 certified record types with per-dimension scores (L2 Business Ready → L5 Reference)
- `apps/desktop/src/main/enterprise/modules/` — the 45 registered module sources, enumerated per family
- `apps/desktop/src/main/enterprise/framework/` — module registry, record store, model
- `EBS-BUSINESS-WORKSPACE-REPORT.md` — Business Workspace presentation layer over the module registry
- `apps/backend/src/db/migrations/*.sql` — all 36 cloud tables enumerated (none are ERP tables)
- Keyword sweeps across `apps/desktop/src` and `packages/` for every claimed-missing capability (payroll, ledger, journal, helpdesk, campaign, gantt, batch/lot, opportunity, approval chains, …), with each hit inspected for whether it is a real module, a connector manifest, or incidental text
- `docs/PROJECT-STATE-2026-08-05.md` — the A8–A17 loss record ("no table, module, or code path exists for GL, journal entries, chart of accounts, periods, HR, or projects" — re-verified and refined below)

## 2. Verdict

**The "assume ~70% exists" briefing figure is wrong as a global number.** The honest picture is bimodal:

- **Operations/SCM side (Procurement, Inventory, Warehouse, Manufacturing, Maintenance/Assets, CRM/Sales core): 55–75% real.** 45 modules are registered on a production framework with real local records, RBAC, audit, timeline, AI hooks, and a descriptor-driven UI, certified L2–L5.
- **Money, people, and projects side (Finance accounting core, HR, Payroll, Recruitment, Projects, Helpdesk, Marketing): 0–30%.** No modules exist. One important nuance the incident record missed: a **real, tested double-entry posting engine** (chart of accounts, journal with debits==credits enforcement, trial balance, cost centers, budgets, fiscal years) exists at `packages/business/src/erp.ts` — but it is a standalone package kernel, **not imported by the desktop app**, with no persistence, module, IPC, or UI.

**Evidence-weighted overall: ≈45% of the full target list, not 70%.**

## 3. The foundation everything builds on (do not rebuild)

- **Framework:** `defineEnterpriseModule` + `moduleRegistry` + `enterpriseRecordStore` (atomic JSON per module under Electron `userData` — **local-first already**, satisfying the A09 policy for ERP data with zero new architecture).
- **Generic services every module inherits:** CRUD IPC (`enterprise:module.*`), per-module RBAC scopes, governance audit on every mutation, unified timeline, per-record AI summaries (`*Ai.ts` hooks → `aiEngine.run`), search, notifications, personalization, and the Business Workspace UI (family rail → landing → `EnterpriseModuleScreen`).
- **Certification harness:** `moduleCertification.test.ts` + `certification-matrix.csv` — every new module must enter the matrix, not bypass it.
- **A09 scale caveat (the one honest architecture risk):** the JSON record store is proven for current volumes; high-volume tables (GL journal lines, stock movements at pilot scale) are the first place a local SQLite backend may become necessary. Decision point, not blocker: measure at pilot volumes; the store interface is narrow enough to swap per-module later.

## 4. Module-by-module classification

Levels from `certification-matrix.csv`. "% " = share of a production-ERP module (per the target spec) that exists and is usable end-to-end today. Effort unit: **1 increment = one atomic, tested, pushed commit-set** (existing P-increment convention).

| # | Module | Status | % | Evidence today | Biggest missing pieces | Effort | Depends on | Risk |
|---|--------|--------|---|----------------|------------------------|--------|-----------|------|
| 1 | Finance | **PARTIAL** | 30 | invoice L5, payment L3; unwired GL kernel in `packages/business` | GL wiring+persistence+UI, CoA, journals, periods/close, GST/tax engine, credit/debit notes, AR/AP ledgers+aging, bank reconciliation, budgeting UI, multi-currency, fixed assets+depreciation | 8–12 | none (kernel ready) | **High** (accounting correctness, GST jurisdiction) |
| 2 | CRM | **PARTIAL** | 55 | lead L5, contact L4, customer L4, AI hooks | opportunity/pipeline module, activities/tasks/meetings, customer health score (wire existing trust engine) | 3–4 | none | Low |
| 3 | Sales | **PARTIAL** | 45 | order L5, quote L5 | contracts, pricing rules/discount engine, commissions, revenue forecast wiring | 3–5 | CRM opportunities | Medium |
| 4 | Procurement | **PARTIAL** | 65 | PO L4, goods receipt L4, PR L3, supplier L3 | RFQ, vendor comparison, configurable approval thresholds | 2–3 | Approvals config | Low |
| 5 | Inventory | **PARTIAL** | 55 | product L4, stockMovement L3, warehouse L2; partial batch/lot refs | batches/lots first-class, barcode/QR, reservations, valuation link to Finance | 3–4 | Finance (valuation) | Medium (stock correctness, volume) |
| 6 | Warehouse | **PARTIAL** | 70 | 8 modules: cycleCount/adjustment/transfer L4; pick/ship/pack L3; bin/zone L2 | bin/zone depth to L4, putaway/wave logic | 2–3 | none | Low |
| 7 | Manufacturing | **PARTIAL** | 65 | 11 modules incl. productionOrder L4, scheduleProposal L5, execution L4; BOM/routing/workCenter L2 | multi-level BOM + versioning, routing/work-center depth, capacity planning UI, quality inspection depth | 3–5 | Inventory batches | Medium |
| 8 | Supply Chain | **PARTIAL** | 35 | transfers/shipping/packing modules | carriers/logistics, fleet, delivery tracking, route planning | 4–6 | Warehouse | Medium (external data) |
| 9 | Projects | **MISSING** | 0 | framework only; "Projects" named as roadmap family in EBS report | portfolio, projects, milestones, tasks, resources, timesheets, billing; Gantt/Kanban need custom renderer beyond descriptor UI | 5–7 | none | Medium (custom UI) |
| 10 | HR | **MISSING** | 0 | only Workday connector sync + workforce archetypes (not local HR) | employees, departments, org chart, attendance, leave, performance, training | 5–7 | Organization | Medium |
| 11 | Payroll | **MISSING** | 0 | references are connector manifests only | salary structures, payslips, runs; statutory India (PF/ESI/TDS) is a compliance program of its own | 4–6 (lite) | HR, Finance GL | **High** (statutory) — recommend payslip-lite for pilot, statutory post-pilot |
| 12 | Recruitment | **MISSING** | 0 | nothing | openings, candidates, stages, interviews (reuse CRM pipeline pattern) | 2–3 | HR | Low |
| 13 | Asset Management | **PARTIAL** | 70 | asset L3, assetCategory L2, sparePart L3 (maintenance family) | depreciation link to Finance fixed assets, asset lifecycle reports | 1–2 | Finance | Low |
| 14 | Maintenance | **PARTIAL** | 70 | 10 modules: workOrder L4, downtime L4, preventive/corrective L3, plans/history L2 | preventive auto-scheduling, technician dispatch, plans to L4 | 2 | none | Low |
| 15 | Helpdesk | **MISSING** | 10 | eops incident lifecycle is transient **by design** ("no ticket store") | persistent tickets, SLA clocks, assignment, KB (reuse knowledge fabric) | 3–4 | none | Low |
| 16 | Marketing | **MISSING** | 0 | "campaign" hits are connector manifests | campaigns, segments, email sends (via existing gated M365/Google write ops), automation journeys, analytics | 4–6 | Automation, connectors | Medium (consent/deliverability) |
| 17 | Documents | **PARTIAL** | 30 | knowledge fabric (P16): links, topic clusters, health, search | document records + versioning, e-signature, OCR (native dep) | 4–6 | none | Medium-High (OCR native, e-sign legal validity) |
| 18 | Analytics | **PARTIAL** | 75 | Stage 12 Enterprise Analytics & Decision Intelligence, KPIs | custom dashboard builder, per-new-module KPI wiring | 2–3 | modules above | Low |
| 19 | Reporting | **PARTIAL** | 55 | board report, per-module reporting (scores mixed 3–8) | report builder, scheduled exports (PDF), NL reports across all modules | 3–4 | Analytics | Low |
| 20 | Business Intelligence | **PARTIAL** | 60 | P7 intelligence engines, P14 projections, Stage 12 | cash-flow forecasting (needs GL), capacity forecasting (documented absent) | 3–4 | Finance | Medium |
| 21 | Approvals | **PARTIAL** | 70 | executive decisions L5, per-side-effect approval checkpoints (S8), confirmation-gated actions | configurable per-module approval chains (thresholds, roles, escalation) | 2 | none | Low |
| 22 | Compliance | **PARTIAL** | 40 | governance chains, trust platform, certification program | compliance register, control mapping, evidence exports | 2–3 | Audit | Low |
| 23 | Audit | **PARTIAL** | 85 | lifecycle audit on every mutation + governance audit + backend audit log | audit report exports, retention policy UI | 1 | none | Low |
| 24 | Risk | **PARTIAL** | 55 | P7 risk engine (computed risk) | risk register module, mitigation workflows, ties to Compliance | 2 | Compliance | Low |
| 25 | Organization | **PARTIAL** | 60 | orgs/memberships (cloud), org-unit owner resolution (eops) | local departments/teams admin, org chart UI, position mgmt | 2–3 | none | Low |
| 26 | Workflow | **PARTIAL** | 75 | versioned playbooks → WorkflowSpec, schedules, governance-wins policy resolution | per-ERP-entity workflow templates, visual designer (defer) | 2–3 | none | Low |
| 27 | Automation | **PARTIAL** | 80 | S8 automation platform: triggers, runs, honest rollback, run history | ERP-entity trigger/action catalog for new modules | 1–2 | each new module | Low |

**Totals: 2 near-complete (Audit, Automation), 18 PARTIAL, 7 MISSING. Full-list completion effort: ≈70–95 increments. Pilot-critical subset (see §6): ≈20–28 increments.**

## 5. AI-ERP status (horizontal)

Already real: per-record AI summaries/hooks on most L3+ modules (`ai=runner` in the matrix), assistant question ports (Stages 4–9), universal search, recommendations (P7), advisory strategy (P14). Gaps: 12 L2/L3 modules with `ai=none`; NL query→structured filter over ERP records; NL report generation per module; forecasting depends on Finance data existing. Treat as 2–3 horizontal increments plus a required AI hook in the definition-of-done for every new module.

## 6. Recommended implementation order

Rationale: pilot customers see money and follow-through first; the framework makes breadth cheap but correctness is the scarce good.

1. **W1 — Finance accounting core (8–12):** wire the existing `packages/business` posting kernel into a `finance-gl` module family: CoA, journal entries, posting from existing invoices/payments, periods, trial balance/P&L/balance sheet; GST report *generation* (filing stays manual). Unblocks BI forecasting, fixed assets, payroll posting.
2. **W2 — CRM/Sales completion (6–8):** opportunities+pipeline, activities, contracts, pricing/discount rules, commissions.
3. **W3 — Projects (5–7):** records first (portfolio/project/milestone/task/timesheet), Gantt/Kanban renderer second.
4. **W4 — HR core (5–7), then Recruitment (2–3).**
5. **W5 — Helpdesk (3–4).**
6. **W6 — Inventory/Manufacturing depth (5–7):** batches/lots, barcode, multi-level BOM, reservations.
7. **W7 — Payroll-lite (4–6):** payslips + GL posting; statutory payroll explicitly deferred with a written caveat.
8. **W8 — Marketing (4–6).**
9. **W9 — Documents depth (4–6).**
10. **W10 — Horizontal polish (6–8):** approval-chain config, risk/compliance registers, report builder, org chart, AI hooks for the `ai=none` modules.

**Minimum pilot bar = W1 + W2 (+W5 for service-business pilots).**

## 7. Definition of done (every increment, no exceptions)

Registered via `defineEnterpriseModule` with RBAC scope, audit lifecycle, timeline, AI hook, and Business Workspace family wiring · typecheck + lint + vitest green including new module tests · certification matrix row added/updated honestly · no mock data, no TODO stubs, no unreachable screens · atomic commit, **verified push the same session** (standing rule from `docs/PROJECT-STATE-2026-08-05.md`).

## 8. Explicitly out of scope until separately approved

Statutory payroll compliance (PF/ESI/TDS filings) · OCR native dependency choice · legally-binding e-signatures · SQLite migration of the record store (measure first at pilot volume) · bank API integrations (regulated) · Linux packaging.
