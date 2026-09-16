# DECISION MEMO — S103: consequential finance / inventory / manufacturing authority (economic-bypass matrix)

**Purpose.** Certify the authority around the remaining consequential economic operations, prove no door bypasses it, and document the policy-open items without inventing policy. S103 changed no production code and adopted no threshold, dual-control, or accounting mapping.

## The load-bearing structural fact (reproduce-first)

Every implemented economic posting lives **inside its RBAC-gated action**, never in an `onChange`-on-status hook:
- Payroll accrual → `payrollRunModule` `post` action (`applyGlDerivedEntries`); status `readOnly`, `postedAt` marker, run immutable once posted.
- Disbursement → `salaryDisbursementModule` `disburse` action; status `readOnly`, `disbursedAt` marker, immutable.
- Stock adjustment → `stockAdjustmentModule` `post` action (`postAdjustmentMovement` → canonical `adjustment` movement + GL).
- Cycle-count variance → `cycleCountModule` `reconcile` action (same movement seam).
- Production output → `productionOrderModule` `complete` action (`postOutput`).

Therefore a **forged status via the edit door creates no economic effect** — contrast the F-S98-1 class, which was the ONE case of an `onChange`-on-status posting (production variance settlement) and is fenced by a machine-owned status (S98). The stock-adjustment status is an editable select, but forging it to `posted` produces no movement (posting is in the action), leaves `adjustmentMovement` empty, and self-defeats the `post` action (which requires `draft`) — an economically inert display anomaly, not a mutation.

## Economic-bypass matrix (per door · per domain)

For each operation, can the door cause an UNAUTHORIZED economic mutation? Answer for every cell: **NO.**

| Door | Payroll | Stock adj / cycle count | Mfg variance / scrap | Payment reversal | Period reopen | Maintenance | Project |
|---|---|---|---|---|---|---|---|
| UPDATE (edit) | no — status readOnly, posting in action | no — posting in action; forged `posted` inert | no — F-S98-1 machine-owned | no — reversal is a create, not an edit | no — closed-period edit refused (S55) | no — spare consume in action | no — billing in action |
| SETSTATUS | no — record-status only (active/archived/deleted) | no | no | no | no | no | no |
| ACTION | RBAC (`operations:manage`) | RBAC (`warehouse:manage`) | RBAC (`manufacturing:manage`) | RBAC (`operations:manage`) | RBAC (`operations:manage`) | RBAC (`maintenance:manage` + `inventory:manage`) | RBAC (`operations:manage`) |
| DELETE | posted run immutable | posted movement undeletable (S97) | posted movement undeletable | cleared payment (cust+vend) + reversal undeletable (S61/S64) | — | posted movement undeletable | — |
| CROSS-TENANT | invisible / refused | invisible / refused | invisible / refused | tenant-scoped `get` → refused | invisible | invisible | invisible |
| REPLAY | idempotent (postedAt marker, one/period) | idempotent (movement is authoritative) | idempotent (variance once) | at-most-one reversal | — | spare consume status-guarded | one-invoice-per-run |
| TERMINAL | posted → immutable | posted → immutable | completed → immutable | reversed → immutable | closed → edit-immutable | consumed → immutable | invoiced → frozen |

**No RED. No bypass. Every economic mutation flows only through an RBAC-gated action; every refusal is fail-closed with zero economic side effect.**

## Classification (A · B · C · D)

| Operation | Economic mechanics | Authority (approval/SoD/threshold) |
|---|---|---|
| Payroll run post / disbursement | **A** — GL posting + immutability + idempotency real, action-gated | **D not-implemented** — no approval, SoD, threshold, maker-checker (RBAC-only) |
| Stock adjustment / cycle count | **A** — canonical `adjustment` movement + GL, immutable, action-gated | **D** — no approval-before-mutation, no materiality threshold |
| Manufacturing variance / scrap | **A** — auto-settles on completion; F-S98-1 fence | **D** — no variance/scrap approval; no scrap module |
| Payment reversal (customer + vendor) | **A** — S61/S62/S64: original immutable, at-most-one, compensating GL, cleared undeletable, bank-reconciled fail-closed | **C policy-open** — no reversal SoD/threshold (single scope) |
| Accounting period reopen | **A** — close/edit-immutability (S55/S102); reopen RBAC-gated | **C policy-open** — no dual-control / reopen-specific attribution |
| Maintenance accounting | **A** — spare consumption = governed canonical `production_consumption` movement (S99) | **C policy-open** — cost→GL (expense vs capitalization, cost center, depreciation, account mapping) undefined |
| Project accounting | **A** — billing run → draft invoice → governed issue → Dr AR / Cr Revenue (S99/S100) | **C policy-open** — project cost→GL & revenue recognition undefined (DECISION-MEMO-S75) |

## The safety property (proven, not policy)

For every C/D item, the **critical question is answered YES-fail-closed**: an UNAUTHORIZED actor cannot cause the economic side effect. The missing layer is a SECOND approver / threshold / dual-control / accounting mapping — undefined business policy — never a bypass. A missing policy is documented here, not implemented to make the gate green.

## Operator decisions required (none invented)

Payroll & disbursement approval + SoD + threshold + final-disbursement authority; stock-adjustment & cycle-count approval + materiality; manufacturing variance & scrap approval + materiality; payment-reversal SoD; accounting-period reopen dual-control; maintenance cost→GL treatment (expense/capitalization/cost-center/depreciation/account); project cost→GL & revenue recognition. Each would be implemented behind a presented gate reusing the existing `approvalEngine`/workflow runtime — never invented to close S103.

## Founder-level answer

For every consequential financial, inventory, manufacturing, maintenance and project operation, NeuroPause proves WHO may cause the economic mutation (the holder of the module's write scope, via the governed action, server-resolved actor, machine-owned/marker status), WHAT authority is required (that RBAC scope today; second-party approval is declared-or-undefined policy awaiting an operator ruling), and WHETHER any door bypasses it (**no** — the economic-bypass matrix above is uniformly fail-closed with zero side effect, across update/setStatus/action/delete/cross-tenant/replay/terminal).
