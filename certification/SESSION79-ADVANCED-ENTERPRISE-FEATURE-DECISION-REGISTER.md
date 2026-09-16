# SESSION 79 — ADVANCED ENTERPRISE FEATURE DECISION REGISTER

**Class:** discovery + architecture only. Baseline S78 `1a21a24`. **No production source changed, no migration, no new infrastructure, no release work.** Grounded in a repository-wide read-only census (two independent Explore sweeps + direct probes); nothing is inferred from a placeholder — every verdict cites a file. This register answers *"what should NeuroPause become?"*, not *"build everything."*

## Maturity key

T0 production+proven · T1 implemented, needs hardening · T2 existing infra can support · T3 needs new domain architecture · T4 needs significant AI/ML/R&D · T5 future/not currently justified.
State key: **PROD** (registered/governed, real logic + tests) · **FW** (framework-only: real derivation, surfaced read-only or unregistered, governs no mutation) · **MISSING**.

---

## PART A — EXISTING ADVANCED CAPABILITIES (T0 — already production, governed)

These terminate in a governed store mutation or GL posting through the canonical spine — not merely a read-model.

| Capability | Domain | Evidence |
|---|---|---|
| Reorder-point + safety-stock → governed PR draft | Inventory/SC | `inventory/autoReorderSeam.ts:46` `runReorderCheck`; `autoReorder.ts:108/137`; tested |
| Inventory reservation / allocation | Inventory | `inventory/reservationModule.ts` (registered); posts reservation/release ledger moves, availability-gated |
| RFQ/RFP + quotation comparison → award → PO | Procurement | `procurement/rfqModule.ts` `compareRfqQuotes`/`award`; immutable after award; tested |
| Supplier performance scorecard (from GR evidence) | Procurement | `procurement/supplierPerformanceModule.ts` (registered); immutable register |
| Vendor contracts gate PO approval | Procurement | `procurement/vendorContractModule.ts` (registered) |
| PPV three-way-match posting (acct 5920) | Finance/P2P | `finance/goodsBillMatch.ts:300` + `glPosting.ts:421` |
| Multi-level BOM explosion (cycle-detected) | Manufacturing | `manufacturing/bomModule.ts` + `bomExplosionModule.ts`; `explodeBom` recurses |
| MRP → governed planned-order/PR seam (idempotent) | Manufacturing | `manufacturing/plannedOrdersSeam.ts:84`; tested |
| Routing, Quality (postDisposition), Scrap/Yield, Production variance settlement | Manufacturing | `routingModule`, `qualityModule`, `executionModule.ts:51` SCRAP→GL, `costingModule` + `productionVarianceSettlement.ts` |
| Serial + lot/batch traceability | Inventory | `inventory/serialModule.ts`, `lotModule.ts` (registered) |
| KPI engine, metrics, cross-module analytics, executive command center, real-time dashboards, exception cards, alert engine, enterprise search, decision analytics | Analytics | `analyticsPlatform/kpiCatalog.ts` + `analyticsModel.ts`; `enterprise/executiveCenter.ts` (init `runtimeCore.ts:768`); `unified/search.ts`; `notifications/*` |
| Knowledge graph + entity-relationship graph + cross-module reasoning | AI/Data | `graph/graphStore.ts` + `projector.ts`; `enterprise/graph/orgGraph.ts` |
| Agent/tool registry + confirmation-gated orchestration | AI | `workforce/registry/registryInstance.ts`; `workforce/execution/workforceActionExecutor.ts:44` (Boundary-B + confirmed) |
| **Governed AI propose→approve→execute→verify→audit (mail.send)** | AI | `capabilities/capabilityProposeIpc.ts` (data-only) → `liveBrain/executionGate.ts:89` ASK-only → `connectors/index.ts:606` FG-10 → `governedSend` → `actionRecord.observeGovernance` |
| Context retrieval + semantic/hybrid memory search | AI | `liveBrain/brainContext.ts`; `memory/semanticRetriever.ts` + `memoryHybridSearch.ts` |
| Human approval, AI policy enforcement (deny-by-default re-derivation), AI audit trail | AI/Gov | `liveBrain/executionGate.ts:33/122`; `proposalExecutionBoundary.ts` |
| Master data: validation, lifecycle, tenant-ownership, versioning (`rev`), cross-module reference-guards | Master Data | `enterprise/framework/EnterpriseRecordStore`; `sales/orderModule.ts:76` customerRef guard; `tenancy/tenantOwnedStore.ts` |
| Durable compensation/recovery + workflow audit history | Workflow | `platform/command/durableCommandJournal` (S40); `reconcileStaleProcessing` (S38); `domainEventLog.ts` |
| Founder copilot: NL ERP queries + AI recommendations (rule-based, read-only) | AI | `founder/index.ts:44` `FounderAsk`; `recommendations/recommendationEngine.ts` |

---

## PART B — FRAMEWORK-ONLY (real derivations; govern/persist nothing; T1–T2 to productionize)

Real deterministic functions in `packages/shared/src`, tested, surfaced **read-only** through the one live-wired `executiveCenterSubsystem.ts` snapshot. Turning any into a governed capability = wiring, not new math (mostly T2).

| Capability | Domain | State | To productionize |
|---|---|---|---|
| Demand forecasting (naive: firm + historical sum) | SC | FW `planning.ts:96` | persist a forecast entity + governed refresh; real model = T4 |
| Supplier risk scoring | Procurement | FW `planning.ts:217` | governed supplier-risk register (T2) |
| Procurement spend analytics | Procurement | FW (Exec Center read) | governed spend-analytics read module (T2) |
| Capacity planning / finite scheduling / work-center planning | Manufacturing | FW `computeCapacitySchedule`, `scheduleModule` (records only) | enforce capacity-constrained sequencing (T3) |
| OEE | Manufacturing | FW `executionModule.ts:212` (display metric) | persist + trend (T2) |
| Transfer optimization / multi-warehouse planning | Warehouse | FW `enterpriseCapacity.ts` transferSuggestion (unwired) | governed transfer-suggestion → transfer-order draft (T2) |
| Forecasting engine (inventory) | Analytics | FW `analyticsPlatform/forecastInventory.ts` ("no ML anywhere") | statistical/ML engine = T4 |
| Business-rules engine | Workflow | FW `automationPlatform/policyResolver.ts` (catalog) | generalize beyond the one PR policy (T3) |
| Predictive alerts / AI confidence surfacing | AI | FW `insight/predictions.ts`; `liveBrain/staleCertainty.ts` | surface as governed alerts (T2) |
| **Generic workflow engine** (event/scheduled/conditional/cross-module) | Workflow | FW `platform/workflow/workflowRuntime.ts` (no live caller; only PR policy runs live via command bus) | promote the runtime to the live approval path + add trigger types (T3) |
| SLA timers / exception routing | Workflow | FW `operationsPlatform/slaFramework.ts`, `incidentModel.ts` (models) | wire to the event bus + notifications (T2–T3) |

---

## PART C — MISSING (T3–T5; several intentionally absent)

| Capability | Domain | Why / note | Maturity |
|---|---|---|---|
| ATP / CTP (available/capable-to-promise) | SC/Mfg | no symbol anywhere; needs reservation+capacity+lead-time composition | T3 |
| Inventory aging / dead-stock prediction | Inventory | no stock-aging logic (AR/AP aging exists) | T2 (aging) / T4 (prediction) |
| Price / should-cost intelligence | Procurement | no symbol | T4 |
| ERP anomaly detection (financial/attendance/payroll) | Finance/HR | no engine (all "anomaly" hits are governance guards) | T4 |
| Statistical/ML forecasting (demand/cash/revenue/workforce) | All | self-declared absent | T4 |
| Scenario / what-if engine | Finance/Planning | no business what-if | T3 |
| Escalation / delegation | Workflow | `workflowRuntime.ts:19` declares them undefined policy | T3 + operator policy |
| Master-data dedup (customer/supplier/product) | Master Data | no dedup (tenant/marketplace dedup only) | T2 |
| Churn / lead-scoring / win-probability / customer-health ML | CRM | rule-based only | T4 |
| Predictive maintenance / failure prediction / asset-health ML | Maintenance | MTBF/MTTR analytics exist; prediction does not | T4 |
| Multi-company / intercompany / consolidation / multi-currency close | Finance | single-entity today; FX realized posting exists | T3 |
| Autonomous AI execution | AI | **absent by design** — no ALLOW branch (`proposalExecutionBoundary.ts:41`) | T5 (not recommended) |

---

## PART D — HIGH-VALUE CANDIDATE DEEP DIVES (the ones worth building)

Each: domain · current state · missing · purpose · enterprise/competitive value · deps · required entities/commands/workflows/UI/AI/integrations · security/governance/accounting · complexity · maturity · **build?**

### D1 · Productionize the Intelligence read-layer as governed KPIs + exception alerts
- **State:** FW — derivations live, surfaced read-only via Exec Center. **Missing:** persisted KPI snapshots + governed exception→notification wiring. **Purpose:** turn the existing analytics into a durable, alerting operational cockpit. **Value:** HIGH / competitive MEDIUM. **Deps:** none new (KPI engine, notifications, event bus all PROD). **Entities:** KPI-snapshot, exception record. **Commands:** none (read + notification emit). **UI:** existing dashboard. **AI:** none. **Security/Gov:** tenant-scoped reads only; no mutation. **Accounting:** none. **Complexity:** LOW. **Maturity:** T2. **BUILD: YES (Tier 1).**

### D2 · Governed Demand-Forecast + Reorder intelligence (persist + refresh)
- **State:** reorder/safety-stock PROD; demand forecast FW (naive). **Missing:** persisted forecast entity + scheduled governed refresh feeding reorder targets. **Purpose:** proactive replenishment. **Value:** HIGH / competitive MEDIUM. **Deps:** autoReorderSeam (PROD), planning derivation (FW), scheduler. **Entities:** demand-forecast. **Commands:** reuse PR-draft path. **Workflows:** scheduled refresh. **AI:** heuristic now; ML = T4 later. **Security/Gov:** governed PR drafts already gated. **Accounting:** none until PR→PO. **Complexity:** MEDIUM. **Maturity:** T2 (heuristic) / T4 (ML). **BUILD: YES heuristic (Tier 2); ML deferred (Tier 4).**

### D3 · Promote the canonical workflow runtime to the live path + trigger types
- **State:** `workflowRuntime.ts` FW (no live caller); live approvals run through the command bus for PR only. **Missing:** make the runtime the single live engine; add event/scheduled/conditional triggers, SLA, escalation (escalation needs operator policy). **Purpose:** cross-module automation without a second engine. **Value:** TRANSFORMATIONAL / competitive HIGH. **Deps:** command bus, event bus, approvalInstanceStore, notifications (all PROD). **Entities:** workflow-definition (versioned), workflow-instance. **Commands:** governed step-execution via existing bus. **AI:** optional AI-recommendation step type (propose-only). **Security/Gov:** every side-effect step routes through a governed command; no bypass. **Accounting:** inherited from the commands it triggers. **Complexity:** HIGH. **Maturity:** T3. **BUILD: YES (Tier 2)** — escalation/delegation gated on operator policy (S78 blockers).

### D4 · AI Enterprise Copilot: NL cross-module Q&A → governed proposals (extend beyond mail.send)
- **State:** governed propose→execute PROD but only `mail.send` is a certified consequential capability; founder copilot answers NL queries read-only. **Missing:** more certified consequential capabilities behind the SAME gate (e.g. create-PR, create-transfer) — each needs its own read-back oracle + certification. **Purpose:** AI-native operation of the ERP within governance. **Value:** TRANSFORMATIONAL / competitive UNIQUE. **Deps:** liveBrain propose lane, executionGate, capabilityGraph, actionRecord (all PROD). **Entities:** none new. **Commands:** existing governed commands. **Workflows:** ASK-only human confirm. **AI:** reasoning + proposal (propose-only, zero execution authority — §13 constitution). **Security/Gov:** deny-by-default, re-derived authority, AI audit — the hardest-won invariant; **must not** gain an ALLOW branch. **Accounting:** per underlying command. **Complexity:** HIGH (per-capability certification). **Maturity:** T2 per capability (infra exists). **BUILD: YES, incrementally (Tier 3)** — one certified consequential capability at a time, each with its oracle.

### D5 · Inventory aging + dead-stock + ATP (composition of existing signals)
- **State:** MISSING; but on-hand ledger, reservations, movement history all PROD. **Missing:** aging buckets, dead-stock rule, ATP = on-hand − reserved + inbound. **Purpose:** working-capital + order-promising. **Value:** HIGH / competitive MEDIUM. **Deps:** stock ledger, reservationModule (PROD). **Entities:** none (derivations). **Commands:** none (read). **AI:** none (aging) / T4 (dead-stock prediction). **Security/Gov:** read-only. **Accounting:** none unless a write-off is proposed (→ D10/5010, operator-gated). **Complexity:** MEDIUM. **Maturity:** T2. **BUILD: YES aging+ATP (Tier 2); dead-stock ML deferred (Tier 4).**

### D6 · Master-data dedup + governance (customer/supplier/product)
- **State:** validation/lifecycle/versioning/reference-guards PROD; dedup MISSING. **Missing:** fuzzy dedup + merge-with-audit. **Purpose:** master-data quality. **Value:** MEDIUM / competitive LOW. **Deps:** EnterpriseRecordStore, audit. **Entities:** merge-record. **Commands:** governed merge (irreversible → confirm). **AI:** optional fuzzy-match (propose-only). **Security/Gov:** merge is economically consequential (re-points references) → governed command + confirm. **Complexity:** MEDIUM. **Maturity:** T2. **BUILD: MAYBE (Tier 2, lower priority).**

### Explicitly NOT recommended now
- **Autonomous AI execution** (T5) — violates the constitutional propose-only boundary; the ALLOW branch is intentionally absent. **Do not build.**
- **ML forecasting / churn / predictive maintenance / anomaly ML** (T4) — real R&D; no training data pipeline yet; heuristic versions deliver most value first. Defer to Tier 4.
- **Multi-company/consolidation** (T3) — large finance-architecture change; no current commercial driver. Defer.
- **Price/should-cost intelligence** (T4) — needs external market data integration. Defer.

---

## PART E — FIVE STRATEGIC TIERS

**TIER 0 — already production:** everything in Part A (governed ERP across CRM/O2C/P2P/Inventory/Warehouse/Manufacturing/Maintenance/Finance/HR/Projects + governed propose-only AI for mail.send + KPI/dashboard/search/graph read-layer + master-data governance + durable recovery).

**TIER 1 — mandatory enterprise capability (build first, LOW–MEDIUM complexity, pure reuse):**
1. D1 governed KPI snapshots + exception→notification alerting.
2. Inventory aging + ATP (D5, the non-ML half).
3. Persisted procurement spend-analytics + supplier-risk register (FW→PROD wiring).

**TIER 2 — advanced ERP competitiveness:**
4. D3 promote the canonical workflow runtime to the live path + event/scheduled/conditional triggers (escalation/delegation gated on operator policy).
5. D2 governed demand-forecast (heuristic) feeding reorder.
6. Capacity/finite-scheduling enforcement (FW→governed).
7. D6 master-data dedup/merge (lower priority).

**TIER 3 — AI-native NeuroPause differentiation:**
8. D4 extend governed AI copilot to additional **certified** consequential capabilities (one at a time, each with a read-back oracle), strictly propose-only + human-confirm.
9. AI-recommendation step type inside the promoted workflow engine (propose-only).

**TIER 4 — future / R&D:** statistical/ML forecasting (demand/cash/revenue/workforce), churn/lead ML, predictive maintenance, financial/attendance anomaly ML, price intelligence, dead-stock prediction.

**TIER 5 — not currently justified:** autonomous AI execution (constitutionally excluded), multi-company/consolidation.

---

## PART F — AI-NATIVE (TIER 3) STRATEGY

The moat is that NeuroPause's AI is **already governed end-to-end** (propose→policy→approve→governed command→transaction→event→independent verification→audit) with zero AI execution authority. The strategy is **not** to make AI autonomous; it is to **widen the set of certified consequential capabilities** the existing gate can propose against, each earning its own independent read-back oracle (the mail.send pattern), so the copilot can safely propose PRs, transfers, and drafts across modules while a human confirms. This is defensible precisely because competitors bolt ungoverned LLM actions on; NeuroPause's constraint is the product.

## PART G — ARCHITECTURAL PREREQUISITES (the true dependency chain)

Master Data (PROD) → Governed Command/Transaction spine (PROD) → Event/Outbox/Audit (PROD) → Operational data (PROD) → **KPI/analytics read-layer (PROD, under-surfaced)** → Persisted metrics/exceptions (Tier 1, D1) → Heuristic prediction (Tier 2) → AI recommendation (propose-only, PROD path) → Policy/approval engine (PROD for PR/PO/bill; generalize in Tier 2) → Governed command → Execution → Independent verification → Audit → Feedback. **The foundational layers are already built**, which is why the recommended sequence is *wiring + persistence*, not new domain architecture — Tier 1/2 unlock Tier 3, and Tier 4 ML must not precede the persisted-metrics + feedback layers it needs.

## PART H — FEATURES EXPLICITLY NOT RECOMMENDED
Autonomous execution (T5, constitutional) · ML forecasting/churn/predictive-maintenance/anomaly-ML now (T4, premature) · multi-company/consolidation (T3, no driver) · price/should-cost intelligence (T4, needs external data) · a second/duplicate workflow, command, approval, event, audit, or inventory engine (architectural rule §12).

## PART I — DEPENDENCIES BETWEEN RECOMMENDED FEATURES
D1 (persisted KPIs/exceptions) is the prerequisite for D2 (forecast feedback) and the Tier-4 ML layer. D3 (live workflow engine) is the prerequisite for the AI-recommendation step (Tier 3 #9) and for SLA/escalation. D5 aging/ATP depends only on PROD ledger+reservations. D4 (AI capability expansion) depends only on the existing propose/gate path + a per-capability oracle. No recommended Tier-1/2 feature depends on any Tier-4 ML.

## PART J — EXACT NEXT IMPLEMENTATION GATE
**S80 = Tier 1, item D1: governed KPI snapshot persistence + exception→notification alerting** — lowest complexity, pure reuse of PROD infra (KPI engine, notifications, event bus, tenant-scoped reads), zero accounting/policy dependency, and it is the architectural prerequisite for the forecasting/feedback and AI-recommendation tiers. It must be selected from THIS register and scoped as one controlled gate (discover→implement defined behavior→focused tests + tenant negative→regression→cert→commit), no release work.

---

## Validation (§14) & Release status
Discovery/architecture only — **zero production source changed, no migration, no new infra, no release changes.** Drift check: governed-layer journey pins re-run 18/18 green at S78 HEAD. No genuine architectural defect discovered in the census (the FW-vs-PROD split is by design — read-derivations vs governed mutations — not a defect). **Release track PAUSED** (no notarization/Authenticode/updater/publish/tag/Gate-27).

**STOP after S79.** The next gate (S80) must be chosen from this register — recommended: D1.
