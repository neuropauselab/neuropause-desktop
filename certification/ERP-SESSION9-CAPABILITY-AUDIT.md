# ERP — SESSION 9: LEVEL-1/2/3 CAPABILITY GAP AUDIT

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `a38dfac` (post-Session-8)
**Label:** AUDIT-ONLY — no production code changed, no module added, no refactor. This is an architecture and
capability audit. It does NOT implement anything and does NOT start Session 10.
**Method:** four independent read-only domain sweeps (finance, inventory+master-data, manufacturing+HR+projects+
assets+CRM/flows, and cross-cutting platform/AI/security). Evidence standard, applied strictly: a capability is
🟢 **only** when a real business transaction + persistence + effect + tests all exist. A registered module, a
descriptor, a UI, a field, or an engine that nothing calls is **not** 🟢.

Status key: 🟢 Implemented (real + wired + persisted + tested) · 🟡 Partial (real but a layer is missing or a claim
overreaches) · 🔴 Missing (only a field/label/stub, or absent).

---

## 0 · FIVE CORRECTIONS TO THE PRIOR MENTAL MODEL (source-verified)

The sweep overturned five things the program had been loosely assuming. They matter because the roadmap and the risk
list below depend on them:

1. **CST governance is NOT "M365-only."** The frozen CST kernel governs three effect classes: M365 `mail.send`, the
   M365 write cohorts, **and the finance journal DRAFT→POSTED transition** (`journalPostTransition.ts`), with a
   restart-durable `DurableIdempotencyStore` (`journal-post-transitions.json`) + persisted ActionRecord evidence. So
   the money-moving GL write is CST-governed. But it governs **only** GL posting on the ERP side — every other ERP
   mutation uses the separate module-framework path (RBAC + approval gate + document adapter + audit).
2. **There are TWO GL posting owners with conflicting account codes.** Finance modules post via
   `finance/glPosting.ts`; the ERP document path posts via `erp/postingRules.ts`. They disagree on Accounts Payable
   (**2000** finance vs **2100** stock-path — and 2100 is *Tax Payable* in the finance chart) and collide on **5000**
   (Operating Expense vs COGS). This is the single largest integrity risk in the system (§E-1) and the basis for the
   recommended next gate (§D).
3. **The advertised inventory costing basis over-claims.** The COGS GL entry calls
   `deriveCogsPosting({method:'weighted_average'})` and stamps the memo "(weighted_average)", but the mechanism posts
   the supplied `unitCost`, which is resolved as **standard cost** — no average is computed. FIFO/weighted-average
   *are* computed, but only inside the **report-only** Inventory Valuation register, which drives nothing. Label ≠
   mechanism (§E-3).
4. **The MRP engine is real but read-only.** `runMultiLevelMrp` does true multi-level netting, and the time-phased
   variant emits `PlannedOrder[]` — but that output is **never persisted**; it feeds only Executive KPIs. The
   planned-order seam that *does* persist drafts **purchase requests only**, off the BOM-explosion snapshot, not off
   the MRP netting result. Planning does not close the loop (§E-7).
5. **`packages/business` is an orphan.** `ErpCore` (with `trialBalance()`/`statement()`) and `TaxRuntime` (a real
   in-memory tax engine) exist but are **not imported by the desktop app**. The live accounting is the enterprise
   finance modules. Do not credit these parallel implementations as capability (§E-10).

---

## 1 · CAPABILITY MATRIX

Each row: capability · maturity **Level** (L1 core spine / L2 operational depth / L3 advanced) · **Status** · where it
lives · the missing layer (for 🟡/🔴) · **Priority** (P0 correctness/integrity · P1 high-value foundational · P2
important breadth · P3 strategic breadth). Every capability is assigned to exactly one level so the denominator in §2
is transparent.

### Master data & catalog

| Capability | L | St | Exists / Missing | Pri |
|---|---|---|---|---|
| Product/item master (SKU, standardCost, UoM field) | 1 | 🟢 | `inventory/productModule.ts`; cost feeds valuation + GL | — |
| Warehouse master | 1 | 🟢 | `inventory/warehouseModule.ts` | — |
| Supplier + customer master | 1 | 🟢 | `procurement/supplierModule.ts`, `crm/customerModule.ts` | — |
| Chart of accounts | 1 | 🟢 | `finance/ledgerAccountModule.ts`, typed, seeded, balances re-derived | — |
| Employee master | 1 | 🟢 | `hr/employeeModule.ts` (org chart, cycle guard) | — |
| UoM + conversions (buy/stock/sell units) | 2 | 🔴 | `unit` is a free-text label; **no conversion factor/engine**. Missing: UoM master + per-product factors + conversion at receipt/issue | P1 |
| Bin/zone hierarchy master | 2 | 🟡 | `warehouse/zoneModule.ts`+`binModule.ts` exist; **stock is tracked only at (product,warehouse)** — not bin-level | P2 |
| Product categories / attributes / variants | 3 | 🔴 | `category` is free-text; **no attribute schema, no size/color variant matrix** | P3 |
| Price lists (customer-specific / qty-break) | 3 | 🔴 | flat `sellingPrice` only; **no price-list module, no resolution at quote/order** | P2 |

### Finance & accounting

| Capability | L | St | Exists / Missing | Pri |
|---|---|---|---|---|
| Journal entries + balance guard + posted-immutability | 1 | 🟢 | `journalEntryModule.ts`; CST-governed post; unbalanced rejected; edits refused post-posting | — |
| GL posting engine (auto-derivations) | 1 | 🟢 | `glPosting.ts`: invoice/payment/bill/movement/payroll/notes/asset/variance/FX all derive+post | — |
| AR — customer invoice + posting | 1 | 🟢 | Dr AR 1100 / Cr Revenue 4000 (+ Tax 2100) | — |
| AP — vendor bill + posting | 1 | 🟢 | Dr Expense 5000 (+ GST 1200) / Cr AP **2000** | — |
| Payments (customer + vendor) + reconcile | 1 | 🟢 | `paymentModule.ts`, `vendorPaymentModule.ts`; reconciles invoice/bill; over/dup guards | — |
| Reversal (-REV) accounting | 2 | 🟢 | invoice/bill/note/journal/movement reversal; append-only | — |
| AR / AP aging | 2 | 🟢 | `arAgingModule.ts`, `apAgingModule.ts`; immutable snapshots | — |
| Financial periods + close/lock | 2 | 🟢 | `accountingPeriodModule.ts`; post refuses closed period (policy HOLD) | — |
| Credit / debit notes | 2 | 🟢 | `creditNoteModule.ts`, `debitNoteModule.ts`; over-credit guard; cancel -REV | — |
| FX / multi-currency (functional) | 2 | 🟢 | rates module; realized 7810; unrealized 7811 w/ IAS-21 reversal; treasury/exposure | — |
| Fixed assets (cap/dep/disposal) | 2 | 🟢 | `fixedAssetModule.ts`; straight-line + declining-balance; exact gain/loss | — |
| Bank reconciliation | 2 | 🟢 | `bankStatementModule.ts`; match→finalize writes back; no **bank-account master** (small) | P2 |
| GRNI accrual + clearing | 2 | 🟡 | accrual live (Dr 1300/Cr 2150); **clearing only on the parallel path w/ AP-code mismatch — finance bills never clear GRNI** | P0 |
| Three-way match wired to finance posting | 2 | 🟡 | `threeWayMatch.ts` real+tested but **not called by `vendorBillModule.approve`** — only guards the parallel adapter path | P0 |
| Financial statements first-class (TB/P&L/BS) + export | 2 | 🟡 | `glStatement()` computes P&L/BS from posted balances but is **consumed by ratios/tax — no standalone TB/P&L/BS report or export** | P1 |
| Gapless document-numbering engine | 2 | 🟡 | numbers are user-entered or inline-derived; **no central per-type gapless sequence service** | P1 |
| Credit-limit enforcement | 2 | 🔴 | `creditLimit` field + risk score only; **nothing blocks an order/invoice over limit** | P1 |
| Multi-jurisdiction tax engine + GSTR-2B | 3 | 🔴 | flat rate + one GST report; **no tax-code/jurisdiction engine, no GSTR-2B reconciliation** (real engine sits orphaned in `packages/business`) | P1 |
| Perpetual actual costing / costing-basis truthfulness | 3 | 🟡 | standard-cost perpetual is real; actual-cost (FIFO/avg) is **report-only**; **COGS memo mislabels standard as weighted_average** | P0 |
| Landed cost (freight/duty into inventory value) | 3 | 🔴 | single `unitCost`; **no apportionment layer** | P2 |
| Inter-company / consolidation / eliminations | 3 | 🔴 | multi-tenant isolation only; **no due-to/due-from, no consolidated statements** | P3 |
| Reporting / presentation-currency translation | 3 | 🔴 | reporting currency == functional currency today | P3 |

### Inventory

| Capability | L | St | Exists / Missing | Pri |
|---|---|---|---|---|
| Stock ledger (append-only, typed movements) | 1 | 🟢 | `stockMovementModule.ts`; 9 types; void = compensating; economically immutable | — |
| On-hand / reserved / available derived | 1 | 🟢 | `productComputedStock`; reconciled from full ledger each movement | — |
| Goods receipt + issue (single + multi-line atomic) | 1 | 🟢 | `goodsReceiptModule.ts`; `multiLineMovements.ts` compensating all-or-nothing | — |
| Reservations / allocations vs orders | 2 | 🟢 | `reservationModule.ts` + sales-order reserve; availability guard | — |
| Stock transfers (2-leg out/in) | 2 | 🟢 | `transferOrderModule.ts`; IN-TRANSIT settles to 0 | — |
| Stock adjustments + GL | 2 | 🟢 | `stockAdjustmentModule.ts`; Dr/Cr Inventory↔Adjustment | — |
| Cycle counting + variance posting | 2 | 🟢 | `cycleCountModule.ts`; signed adjustment; idempotent | — |
| Reorder point → auto requisition | 2 | 🟢 | `autoReorderSeam.ts` drafts a PR; idempotent | — |
| Negative-stock prevention | 2 | 🟡 | detected + KPI'd; **no prevention gate on issue/dispatch** | P2 |
| Batch / lot lifecycle (generic) + FEFO | 2 | 🟡 | rich in `medicalDevice/lotService.ts` (quarantine/recall/expiry); **generic lot module thin, not ledger-integrated; FEFO absent everywhere** | P2 |
| Serial-number tracking (uniqueness + ledger) | 3 | 🟡 | `serialModule.ts` master + lifecycle; **uniqueness not enforced at validate; not quantity-integrated with ledger** | P2 |
| Multi-bin stock tracking | 3 | 🔴 | bin master exists; **movements carry no bin; stock is warehouse-granular** | P2 |

### Manufacturing

| Capability | L | St | Exists / Missing | Pri |
|---|---|---|---|---|
| BOM + multi-level + explosion (immutable) | 1 | 🟢 | `bomModule.ts`, `bomExplosionModule.ts`; cycle detection, cost rollup | — |
| Production order lifecycle + inventory | 1 | 🟢 | plan→allocate→start(consume)→complete(output); compensating start | — |
| Routings / work centers / machines master | 2 | 🟢 | `routingModule.ts`, `workCenterModule.ts`, `machineModule.ts` | — |
| WIP + production variance settlement | 2 | 🟢 | `productionVarianceSettlement.ts`; residual WIP → 5910; idempotent | — |
| Quality inspection → scrap disposition | 2 | 🟢 | `qualityModule.ts` `postDisposition`; final-stage fail scraps (Dr 5010/Cr 1300) | — |
| MRP netting → persisted planned orders | 2 | 🟡 | engine real but **output never persisted** (feeds KPIs only) | P1 |
| Planned orders → production orders | 2 | 🟡 | seam drafts **purchase requests only**, off the BOM snapshot, disconnected from MRP netting | P1 |
| MES / shop-floor execution | 3 | 🟢 | `executionModule.ts`; backflush, OEE, first-pass yield, immutable event log | — |
| Capacity planning / finite scheduling | 3 | 🟢 | `capacityScheduler.ts` + `scheduleCommit.ts`; versioned proposal→approve→commit | — |
| Subcontracting / outsourced operations | 3 | 🔴 | a recommendation string only; **no subcontract PO, no material-issue-to-vendor, no backflush** | P2 |

### HR / payroll · Projects · Assets · CRM/Sales/Procurement flows

| Capability | L | St | Exists / Missing | Pri |
|---|---|---|---|---|
| Payroll run → GL + salary disbursement | 2 | 🟢 | `payrollRunModule.ts` (statutory gross-to-net) + `salaryDisbursementModule.ts` (NEFT advice) | — |
| Attendance / leave / shifts | 2 | 🟢 | `attendanceModule.ts`, `leaveModule.ts`, `shiftModule.ts` (LOP proration) | — |
| Expense claims → GL | 2 | 🟢 | `expenseClaimModule.ts` (accrual; cash reimbursement out of scope) | — |
| Statutory filings (PF/ESI/PT/TDS data) | 2 | 🟢 | `statutoryFilingModule.ts`; data generation (portal submission a named non-goal) | — |
| Project + task + time entries | 2 | 🟢 | `projectModule.ts`, `projectTaskModule.ts`, `timeEntryModule.ts` | — |
| Project billing (time → invoice) | 2 | 🟢 | `billingRunModule.ts` → real draft invoice; entries frozen | — |
| Project costing / WIP / margin | 3 | 🔴 | `budget` field + billing rate only; **no cost rate, no WIP, no margin roll-up** | P2 |
| Asset maintenance / work orders | 2 | 🟢 | `maintenance/*` PM/CM→work order→history; spare-part consume posts a movement | — |
| Lead → contact → customer conversion | 2 | 🟢 | `crm/conversion.ts`; idempotent, non-destructive | — |
| Opportunity / pipeline / quote | 2 | 🟢 | `opportunityModule.ts`, `quoteModule.ts` (`convertToOrder`) | — |
| Sales order lifecycle + stock effect | 1 | 🟢 | `sales/orderModule.ts`; reserve→ship→pick list | — |
| Procurement PR→PO→GR + RFQ | 2 | 🟢 | `procurement/conversion.ts`; GR posts a real movement; RFQ→award→draft PO (no direct PR→RFQ link) | — |
| Supplier performance / contracts / budget control | 2 | 🟢 | perf register; vendor contracts; PO approve consults budget, fail-closed | — |

### AI / automation · Security / governance / platform · Reporting

| Capability | L | St | Exists / Missing | Pri |
|---|---|---|---|---|
| AI engine + model router (local→private→cloud) | 2 | 🟢 | `ai/aiEngine.ts`, `privateFirstClient.ts`; refused plan throws, never degrades to network | — |
| Per-module AI narratives (evidence-first) | 2 | 🟢 | ~30 `*Ai.ts`; model gets facts, writes narrative only; deterministic fallback | — |
| Intelligence KPIs / recommendations | 2 | 🟢 | `enterpriseInsights.ts`+`enterpriseKpi.ts`; **fed by AI/workforce signals, not GL/orders** | — |
| Live Brain propose-only boundary (pinned) | 3 | 🟢 | `capabilityProposeCore.ts`; zero effect; re-resolves AI-named id; test-pinned | — |
| Automation engine (trigger→condition→action) | 3 | 🟢 | `automationRunner.ts`; tenant-scoped; **`connector-write` HELD for confirmation** | — |
| NL → structured action intent | 3 | 🟡 | `assistantMailIntent.ts` strong but **`mail.send` only**; any other verb → UNSUPPORTED | P3 |
| RBAC per-module, deny-by-default | 1 | 🟢 | `authz.ts`; union of active roles; `ctx.authorize` on every channel | — |
| Multi-tenant isolation (bindScope) | 1 | 🟢 | `enterpriseRecordStore.ts`; unbound = DENY; per-tenant eviction | — |
| Per-record audit trail | 1 | 🟢 | `emitLifecycle` writes `ctx.audit` on every mutation | — |
| Confused-deputy / cross-tenant prevention | 2 | 🟢 | null-on-miss-or-other-tenant; scoped line-item gate; `ownsAccount` | — |
| Credential vault (Keychain) | 2 | 🟢 | `connectorVault.ts`; refuses plaintext; quarantine-not-reset; rotation | — |
| Consent / approval gates | 2 | 🟢 | `confirmed===true` required; C3 approval; governed delete needs ack | — |
| Document→posting adapter framework | 2 | 🟢 | `erp/documentAdapter.ts`; balanced lines to injected `postJournal`; per-tenant idempotency | — |
| Document lifecycle state machines | 2 | 🟢 | per-module enforced (journal, period, tax, ratios); approval-gated statuses | — |
| Approval workflows (threshold / SoD) | 2 | 🟢 | `approvalEngine.ts`; `minAmount` steps; creator-cannot-approve; refusal → HOLD | — |
| Notification center | 2 | 🟢 | `eventNotifications.ts` event bus → inbox; **user-set reminders unwired** (small) | P3 |
| Standard reports (aging/stock/tax/cashflow/ratios) + CSV | 2 | 🟢 | immutable-snapshot report modules; `dataPlane/exporters.ts` | — |
| Dashboards / executive KPIs | 2 | 🟢 | `executiveDashboard.ts`, `enterpriseKpi.ts` | — |
| Tamper-evident audit chain (SHA-256) | 3 | 🟢 | `security/auditChain.ts`; detects mutation/deletion/reorder (WORM/SIEM for full threat model) | — |
| CST governed durable posting kernel | 3 | 🟢 | journal DRAFT→POSTED across CST; durable idempotency + evidence | — |
| Crash recovery / compensation / reconciliation | 3 | 🟢 | `multiLineRecovery.ts` (Session 8); bounded, idempotent, tenant-safe | — |
| Correlation / transaction-graph spine | 3 | 🟢 | `framework/transactionGraph.ts`; every posting links to its source | — |
| i18n / localization framework | 3 | 🔴 | English-only; locale number/date formatting only; **no translation layer** | P3 |

---

## 2 · MATURITY SCORE (denominator shown)

Every capability above is assigned to exactly one level. Score per level weights 🟢 = 1.0, 🟡 = 0.5, 🔴 = 0.0, over the
count of capabilities at that level. This is a **capability-coverage** score, not a code-quality score.

| Level | Definition | 🟢 | 🟡 | 🔴 | Count | Weighted | **Score** |
|---|---|---|---|---|---|---|---|
| **L1 — Core transactional spine** | Can the core business events be recorded at all? | 19 | 0 | 0 | **19** | 19.0 | **100 %** |
| **L2 — Operational depth** | Integrated multi-step workflows across modules | 38 | 9 | 2 | **49** | 42.5 | **86.7 %** |
| **L3 — Advanced / enterprise-grade** | Sophisticated costing, tax, planning, consolidation, governance | 8 | 3 | 10 | **21** | 9.5 | **45.2 %** |
| **Overall** | — | **65** | **12** | **12** | **89** | **71.0** | **79.8 %** |

Calculation, explicit:
- **L1 = 19.0 / 19 = 100 %.** The transactional spine is complete: master data, GL, AR/AP, payments, stock ledger,
  sales-order, procurement chain, BOM/production, RBAC, tenancy, audit. *Quality caveats* (not coverage gaps, so they
  do not dock the score but are flagged): COGS is mislabeled (§E-3); immutability is by convention, not structure
  (§E-5).
- **L2 = (38×1.0 + 9×0.5 + 2×0.0) / 49 = 42.5 / 49 = 86.7 %.** Operational depth is strong and well-tested. The
  drag is concentrated in four integration seams (GRNI clearing, three-way-match wiring, first-class financial
  statements, gapless numbering), the two planning seams (MRP persistence, planned→production), and two absent
  fundamentals (UoM conversion, credit-limit enforcement).
- **L3 = (8×1.0 + 3×0.5 + 10×0.0) / 21 = 9.5 / 21 = 45.2 %.** Advanced tier is genuinely **deep where built** (MES,
  finite scheduling, CST-governed durable posting, hash-chain audit, propose-only Brain, crash recovery, correlation
  spine) and **absent at breadth** (multi-jurisdiction tax, landed cost, actual costing, consolidation, reporting
  currency, price lists, variants, multi-bin, subcontracting, project margin, i18n).

**One-line verdict:** a rock-solid core and a strong, tested operational layer, with the advanced tier roughly
half-built — deep in governance and shop-floor, shallow in costing sophistication, tax breadth, and commercial master
data. The most valuable near-term work is **correctness** (unifying the two GL posting owners and making costing
labels honest), not new features.

---

## 3 · TOP-20 GAPS, RANKED BY DEPENDENCY

Ranked so foundational/blocking gaps come first (fixing them unblocks or de-risks others), leaf gaps last. Priority in
brackets.

1. **GL posting-ownership unification + AP-account conflict (2000↔2100) + GRNI clearing on the finance path** — [P0]
   Two posting owners with different AP codes; finance-path vendor bills never clear GRNI. Blocks trustworthy AP,
   GRNI, and every statement built on them. *Foundational — everything payable/procurement sits on it.*
2. **Three-way-match gate wired into finance vendor-bill posting** — [P0] The engine exists and is tested but does not
   guard `vendorBillModule.approve`. Tied to #1 (same path, same slice candidate).
3. **Costing-basis truthfulness** — [P0] Make the COGS/valuation label match the standard-cost mechanism (or ratify
   the basis and retire/relabel the report-only actual-cost node). A green pixel with no proof beneath.
4. **UoM conversion engine** — [P1] No conversion between buy/stock/sell units. Blocks accurate procurement, landed
   cost, and price lists downstream.
5. **MRP netting → persisted planned orders → draft production orders** — [P1] Connect the real (but read-only) MRP
   engine to persistence, and draft production orders (not just PRs). Closes the planning loop.
6. **Gapless document-numbering sequence service** — [P1] No central per-type gapless sequence. Foundational for
   audit/statutory compliance; unblocks correct statutory filings.
7. **Financial statements as first-class TB/P&L/BS + export** — [P1] The aggregates exist on the GL; expose them as
   named, exportable statements. Table-stakes reporting on an existing foundation.
8. **Credit-limit enforcement on sales order/invoice** — [P1] AR balance and sales order both exist; wire a hold when
   outstanding exceeds the limit. High value, low cost, low dependency.
9. **Multi-jurisdiction tax engine + GSTR-2B reconciliation** — [P1] Replace the flat rate with a tax-code/
   jurisdiction engine; add GSTR-2B import/reconciliation. (A real engine sits orphaned in `packages/business` to
   harvest from.)
10. **Landed-cost apportionment into inventory value** — [P2] Depends on receipt costing (+ UoM #4). Accurate
    inventory and COGS.
11. **Negative-stock prevention gate on issue/dispatch** — [P2] Detection exists; add a configurable refuse/block
    gate. Small, correctness.
12. **Multi-bin stock tracking** — [P2] Add a bin dimension to movements and the ledger; the bin master already
    exists.
13. **Price lists (customer-specific / qty-break) + resolution at quote/order** — [P2] Depends on customer master
    (+ UoM #4). Quoting accuracy.
14. **Batch/lot generic lifecycle + FEFO + ledger integration** — [P2] Lift the medical-pack lifecycle into the
    generic lot module; add FEFO selection on issue/pick.
15. **Serial-number uniqueness + ledger integration** — [P2] Enforce uniqueness at validate; tie serial state changes
    to real movements.
16. **Project costing / WIP / margin** — [P2] Add employee cost rates to time entries; roll up WIP and margin.
17. **Subcontracting / outsourced operations** — [P2] Composite (PO + BOM material issue to vendor + receipt
    backflush). Currently a recommendation string only.
18. **Inter-company / consolidation / eliminations** — [P3] Depends on multi-company + GL. Large.
19. **Reporting / presentation-currency translation** — [P3] Built on existing FX; re-present statements in a
    non-functional currency.
20. **Product variants / attributes matrix** — [P3] Parent/child SKU model on the product master. Catalog breadth.

*Also open, smaller (beyond the 20):* bank-account master; user-set reminders wiring; batch depreciation run across
all assets; auto-generation of due PMs from plan frequency; direct PR→RFQ conversion; i18n/translation framework
(strategic, deprioritized for a single-regime deployment).

---

## 4 · DEPENDENCY GRAPH (corrected)

Layered, foundation upward. `═▶` = "depends on / builds on". Annotations mark the corrected edges from §0.

```
                         ┌─────────────────────────────────────────────────────┐
  L1  FOUNDATION         │ EnterpriseRecordStore · RBAC · bindScope tenancy ·    │
                         │ per-record audit · CST kernel · correlation spine     │
                         └───────────────┬─────────────────────────────────────┘
                                         │
              ┌──────────────────────────┼───────────────────────────┐
              ▼                          ▼                            ▼
        Master data              Stock ledger (append-only)      Chart of accounts
        (product/whse/            ═▶ on-hand/reserved/avail        ═▶ Journal + balance guard
         supplier/cust/emp)                                          ═▶ GL posting engine
              │                          │                            │
              │                          │           ┌── CST governs journal DRAFT→POSTED  ✱corrected: NOT M365-only
              ▼                          ▼           ▼                │
  L2  OPERATIONAL      Sales order ─▶ reservations ─▶ issue ─▶ COGS ──┤
                       Procurement PR▶PO▶GR ─▶ receive ─▶ GRNI accrual ┤
                       Production plan▶start▶complete ─▶ WIP ─▶ variance┤
                       Payroll / Expense / Fixed-asset / Notes / FX ───┤═▶ ledger
                       Approval (threshold/SoD) · Document→posting adapter · Period close
                                         │
       ┌───── ✱CONFLICT EDGE ───────────┴──────────────────────────────┐
       │  finance/glPosting.ts  ── AP 2000, no GRNI clearing            │  ← §E-1 · gate §D
       │  erp/postingRules.ts   ── AP 2100, clears GRNI, 3-way match    │
       └───────────────────────────────────────────────────────────────┘
                                         │
              ┌──────────────────────────┼───────────────────────────┐
              ▼                          ▼                            ▼
  L3  ADVANCED   DONE (deep):        DANGLING / MISLABELED:      ABSENT (breadth):
                 MES · finite sched   MRP engine ──╳──▶ (no       tax engine · landed cost ·
                 hash-chain audit     persisted planned orders)   consolidation · reporting FX ·
                 propose-only Brain   ✱corrected §E-7             price lists · variants ·
                 crash recovery       Standard cost ──▶ COGS      multi-bin · subcontracting ·
                                      (memo says "weighted_avg")  project margin · i18n
                                      ✱corrected §E-3
                                      report-only FIFO/avg node
                                      ──╳──▶ (drives nothing)

   ORPHAN (not imported by desktop app): packages/business ErpCore.trialBalance()/statement(),
   TaxRuntime  ── do not credit as capability   ✱corrected §E-10
```

Key reading: the **conflict edge** between the two posting owners sits directly on the critical path from every
operational document to the ledger — which is why it is the recommended next gate. The **╳ dangling edges** (MRP→plan,
actual-cost→COGS) are "engine exists, consumer missing" — cheap to wire, but must not be counted as working until they
are.

---

## 5 · RECOMMENDED NEXT ENGINEERING GATE (exactly one)

### Session 10 — Unify GL posting ownership: resolve the AP-account conflict, clear GRNI on the finance path, and gate vendor-bill posting through three-way match

**Why this one, above all others:**

- **It is a correctness/integrity gate, not a feature.** Today the same ledger has two posting owners with different
  AP codes (2000 vs 2100, where 2100 is *Tax Payable* in the finance chart), and finance-path vendor bills accrue
  GRNI (Cr 2150 on receipt) that is **never relieved**. That is precisely the constitution's failure mode — a claimed
  state (payables, GRNI balance, any statement built on them) not supported by evidence at the layer beneath. Two
  sources of truth for one ledger is the highest-severity finding in this audit (§E-1).
- **It is the top of the dependency order.** AP and GRNI trust underpin procurement, cash, aging, and every financial
  statement. Nothing above it is trustworthy until it is resolved.
- **It reuses existing seams — no new accounting *mechanism*.** The three-way-match engine, the reversal path, and
  the document→posting adapter already exist and are tested. The work is *unification and wiring*, consistent with
  "reuse existing seams; no second costing/GL path."
- **It will surface a genuine accounting *decision*, which is the right thing to escalate rather than guess.** Per
  standing discipline, Session 10 must **reproduce the divergence first**, then **STOP and escalate a decision memo**
  on the policy questions below rather than pick an answer.

**Decisions to escalate (do not guess):**
1. Which AP account is canonical — **2000** (finance chart) or **2100**? (2100 currently collides with Tax Payable —
   almost certainly 2000, but it is a chart decision, not mine to make.)
2. Must **every** finance-path vendor bill pass three-way match before it can post, or only bills sourced from a PO?
3. Is `erp/postingRules.ts` **retired** in favor of `finance/glPosting.ts` as the single owner, or is one designated
   authoritative and the other made a thin re-export? (This also settles pending cleanup task #96.)

**Scope (audit-defined; NOT implemented in Session 9):**
- Reproduce first: construct a receive→vendor-bill→approve flow and show, from durable state, that GRNI is not
  cleared and which AP code each path writes (reproduce-before-fix).
- After the decision memo is answered: route the finance vendor-bill approval through GRNI clearing (Dr 2150 / Cr AP)
  and the three-way-match gate; collapse to one posting owner; keep every existing posting byte-identical where it is
  already correct.
- Full negative controls (mutate → fail → restore byte-identical, sha-verified); verify UI→IPC→service→store→GL→
  readback; tsc(node+web) + lint + build; honest evidence label; one commit; **the user pushes**.

**Acceptance criteria:** one posting owner for AP/GRNI; a receive→bill→pay cycle leaves GRNI net zero; no vendor bill
posts without a three-way-match verdict (per the ruled policy); no double-post; the two chart codes reconciled; all
prior finance tests green + new regression pins for the GRNI-clearing and match-gate paths.

**Explicitly deferred (do not start in Session 10):** costing-basis truthfulness (§E-3, the natural P0 follow-on),
UoM, MRP persistence, numbering, financial statements, credit limits, tax engine. One gate at a time.

---

## 6 · ARCHITECTURE RISKS

**E-1 · Dual GL posting ownership (TOP RISK).** `finance/glPosting.ts` and `erp/postingRules.ts` both post to the
same ledger with conflicting account codes (AP 2000 vs 2100; 5000 = OpEx vs COGS) and different GRNI behavior. Two
sources of truth → unrelieved GRNI on the finance path, reconciliation drift, and statements that cannot be trusted
to a single derivation. This is the recommended gate (§D).

**E-2 · Business-level, not database, atomicity.** The stores are JSON files, not an ACID database; cross-store
"transactions" are business-level compensating sequences (Session 7-Fix/8). Recovery converges by re-running, bounded
by idempotency — robust for single-writer desktop use, but there is no multi-writer concurrency control and no DB
constraint enforcement. A scale/concurrency ceiling to acknowledge before any multi-user server deployment.

**E-3 · Costing label ≠ mechanism.** COGS posts standard cost while the memo says "weighted_average"; the real
FIFO/weighted-average calculation lives in a report-only register that drives nothing. Risk: a reader (or an auditor)
believes actual costing is in effect when it is not. Truthfulness defect; P0 follow-on to the recommended gate.

**E-4 · Non-uniform governance coverage.** CST governs GL posting + M365 writes; all other ERP mutations use the
lighter module-framework path (RBAC + approval + audit). Both are real, but they are *different* guarantees. Risk:
assuming uniform CST-grade governance across the ERP. The boundary must stay explicitly marked (constitution §11).

**E-5 · Immutability by convention, not structure.** A void updates the record in place (status → 'void') and
re-derives; economic fields are never mutated *by discipline*, not by a structurally append-only log. The hash-chain
audit is tamper-evident but forgeable by a local writer with access to both entries and head (honestly documented).
Production needs WORM/SIEM to close the threat model.

**E-6 · Single-process JSON persistence + no gapless numbering.** No DB-level uniqueness or sequence guarantees;
document numbers are user-entered or inline-counted, enforced ad hoc. Risk of duplicate/gapped numbers under
concurrency and a compliance gap for statutory sequences.

**E-7 · Read-only planning engines ("intelligence theater" risk).** MRP netting and time-phased planned orders are
computed but never persisted; the persisted planned-order seam reads a different source (BOM snapshot) and drafts
only PRs. Risk: the system *looks* like it plans while producing no durable plan. Wire the loop before claiming MRP.

**E-8 · Breadth concentrated in the industry pack.** The production-grade lot lifecycle (quarantine/hold/recall/
expiry) lives in `medicalDevice`, not generic inventory; FEFO is absent everywhere. Risk of over-crediting general
capability from a vertical module.

**E-9 · AI action surface is the future risk boundary.** Today it is safe (propose-only, `mail.send`-only, connector
writes HELD for confirmation). As NL→action and automation writes widen, they must stay behind the proposal → human
confirm → governed execution boundary. The discipline is correct; the risk is drift as scope grows.

**E-10 · Orphaned parallel implementations.** `packages/business` (`ErpCore` TB/statements, `TaxRuntime`) is real but
unimported. Risk of confusion/maintenance drift and of mistaking it for the live path — a genuine, unwired tax engine
that could be harvested for the tax gap (#9) but must not be counted as capability today.

---

## 7 · BOUNDARY STATEMENT

Session 9 is an audit. No production code, module, test, or configuration was changed; nothing was implemented; the
recommended gate (§D) was **not** started. The classifications above are grounded in the repository as of `a38dfac`
(Sessions 1–8 landed), read-only, with the evidence standard applied strictly (transaction + persistence + effect +
tests, or it is not 🟢). Everything outside that standard is marked 🟡/🔴 and is explicitly NOT governed by a green
claim.
