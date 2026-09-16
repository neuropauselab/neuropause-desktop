# DECISION MEMO — S99: Maintenance & Projects economic accounting boundaries (POLICY-OPEN; not invented)

**Purpose.** Record, from source, which Maintenance and Projects economic boundaries are DEFINED (and therefore certifiable as-is) versus UNDEFINED (policy-open, deliberately not implemented). S99 invents no accounting policy. No production code changed this session.

## A · MAINTENANCE

**A1. Spare-part consumption → inventory ledger: DEFINED (certified).** `sparePartModule.ts` `consume` → `postSparePartConsumption` (`maintenanceMovements.ts:80`) → `postStockMovement` posts a real `production_consumption` movement into the canonical `inventory-movements` ledger. Idempotent (status-guarded: a consumed/cancelled part refuses). Requires `inventory:manage` at the movement seam (advisory principals refused). This is the ONLY maintenance path that touches Inventory. Certified: one movement, on-hand −q once, replay deduped, tenant/RBAC enforced, posted movement immutable (S97 delete guard), survives restart.

**A2. Maintenance cost → GL: POLICY-OPEN (NOT invented).** Two facts, recorded truthfully:
- **Labor cost is non-posting.** Work Order `laborCost`/`partsCost` and Maintenance History `totalCost` are display/report fields with NO journal seam anywhere. Maintenance labor never reaches the GL. (Asserted: creating a work order with cost fields posts zero journal lines.)
- **Spare material posts INCIDENTALLY to WIP.** Because the seam reuses Manufacturing's `production_consumption` movement type, the shared `inventoryGlBridge.ts` posts `Dr WIP (1350) / Cr Inventory (1300)` for the part's standard-cost value. The **Cr Inventory is correct** — stock really left the warehouse. The **WIP debit is a policy-open mis-attribution**: maintenance parts are not work-in-process, and the correct treatment (a Repairs & Maintenance expense account? repair-vs-capital-expenditure? capitalize to the asset?) is UNDEFINED in source.

**A2 is deliberately NOT fixed.** Choosing the debit account, the repair-vs-capex rule, or a materiality threshold would be inventing business policy, which this program forbids. Changing the movement type or the bridge mapping would also alter existing certified inventory behavior. The honest position: the inventory side is governed and correct; the expense classification is an operator policy decision. **Operator decisions required:** (1) which account maintenance spare-part consumption should debit (repairs expense vs WIP vs asset capitalization); (2) whether/how maintenance labor should post; (3) repair-vs-capex rule and any materiality threshold; (4) whether a maintenance approval/authorization step is required for high-value work orders (today: coarse `maintenance:manage` only, no approval workflow).

**A3. Work-order status is an ordinary editable field — NOT an economic defect.** Unlike the S98 production-order case (where a forged status produced phantom finished goods), a forged maintenance work-order status gates NO economic effect: spare-part consumption is an independent module action, and the machine-status/history writes on `verify` carry no inventory or GL. So a hand-set work-order status cannot forge an inventory movement or a journal entry. It is a non-economic operational-record observation, out of scope for this economic-control-plane certification, and is not changed here (fencing a non-economic field would be a behavior change without an economic justification).

## B · PROJECTS

**B1. Billing → draft invoice → issue → AR/revenue: DEFINED (certified, inherited).** `billingRunModule.ts` `issueInvoice` re-derives unbilled billable time and creates a DRAFT invoice in the canonical `finance` module (same store/kind as O2C), freezes the gathered time entries (immutable) and freezes the run (idempotent — one invoice per run). Issuing that draft is **governed-command-only** (the raw `issue` action is fenced, S46) and must go through the canonical `IssueCustomerInvoice` command, which fires the DEFINED `Dr Accounts Receivable (1100) / Cr Sales Revenue (4000)` (+ tax) posting exactly once — the same chain O2C S28/S95 certified. Certified: draft posts no GL; issue posts AR/revenue once; replay books no second entry; entries/run frozen; lineage + GL survive restart; tenant/RBAC enforced; advisory principals refused.

**B2. Project cost → GL & revenue recognition beyond invoice: POLICY-OPEN (NOT invented).** Confirmed by source (no `postingRules`/journal imports in `projects/`) and by the prior formal decision memo **DECISION-MEMO-S75-PROJECT-COST-REVENUE-ACCOUNTING.md** (still open per SESSION78). There is no project-cost entity; creating projects/tasks/time entries posts NO journal (safe/non-posting until an invoice is issued). Undefined and not implemented: project cost → GL, revenue recognition (fixed-price % complete, milestone, deferred), cost capitalization / WIP, labor-cost methodology (the time-entry `hourlyRate` is a BILLING rate, not a cost rate), budget-variance / write-off. **Operator decisions required:** all of the above — unchanged from S75.

## C · Classification

| Boundary | Status | Action |
|---|---|---|
| Maintenance spare-part → inventory ledger | DEFINED | Certified as-is |
| Maintenance spare material → GL (WIP incidental) | POLICY-OPEN | Documented, not changed |
| Maintenance labor → GL | POLICY-OPEN (non-posting) | Documented, not invented |
| Maintenance work-order status editability | NON-ECONOMIC observation | Out of scope; not changed |
| Maintenance approval/materiality | POLICY-OPEN | Not invented |
| Projects billing → draft invoice → issue → AR/revenue | DEFINED (inherited O2C) | Certified as-is |
| Project cost → GL / revenue recognition | POLICY-OPEN | Deferred to S75 memo, still open |

**No RED. No new economic-forge defect. No production change. Both domains are SAFE, governed participants in the existing Inventory + Finance control plane; the undefined accounting treatments remain fail-closed / non-posting / incidental-and-documented, never invented.**
