# DECISION MEMO — S77 · Cycle-count / Stock-adjustment variance approval + write-off accounting (D10)

**Status:** STOPPED — awaiting operator policy. Nothing invented. Blocks ONLY the variance-approval gate and the write-off GL treatment; the operational cycle-count/adjustment ledger movements are GREEN and unaffected.

## CORRECTION (S78, §20 source-wins)

An earlier draft of this memo said the write-off GL leg "stays unposted." **That was wrong.** Source: `erp/postingRules.ts` defines `STOCK_ACCOUNTS.inventoryAdjustment = '5010'` (Expense — inventory adjustments / write-offs) and `erp/documentAdapter`/`deriveInventoryAdjustmentPosting` **already books it** — a shrinkage (value-down) debits 5010, a count-up credits 5010 — tested in `erp/erp.test.ts:411/440/446`. Per S58's register, stock-adjustment `post` and cycle-count `reconcile` **already book real GL** under `operations:manage`/`inventory:manage` (RBAC only). So the **accounting treatment and account are DEFINED and wired**; what is genuinely undefined is only the **approval gate**.

## What is defined and working (NOT blocked)

- Cycle-count `reconcile` and stock-adjustment `post` post **signed Inventory Ledger movements** (real on-hand change, immutable, idempotent, tenant-scoped) AND **book real GL to account 5010** (inventory adjustment / write-off), RBAC-governed. Stock is never overwritten by a generic edit. Proven in `warehouse.test.ts`, `erp/erp.test.ts`, + the S73-G4 journey pin.

## What is UNDEFINED (the STOP) — the APPROVAL GATE ONLY

1. **Variance materiality threshold** — the amount (or % variance) above which a cycle-count/adjustment requires approval *before* it posts. Undefined. (Today, RBAC alone permits it — S58: "do not silently allow material stock adjustments merely because RBAC permits them.")
2. **Approver authority + SoD** — which role approves a material variance, and executor≠approver SoD. Undefined. The `approvalEngine`/`DEFAULT_SPEND_POLICY` infrastructure exists and would be reused (no new engine), but no approval spec is attached to `warehouse-cycle-counts` / `warehouse-adjustments` in `DOCUMENT_SPECS`.

## Exact operator inputs required

- Variance threshold(s) (absolute and/or %) that trigger approval, per cycle-count and per stock-adjustment.
- Approver role(s) + confirmation of executor≠approver SoD.
- (Accounting is already defined — account 5010; no new account input needed unless the operator wants shrinkage split from count-correction into distinct accounts.)

## Recommendation

When supplied, attach an approval spec to the two module ids in `DOCUMENT_SPECS` (reusing `approvalEngine`/the document-adapter gate — the exact mechanism that already gates PO/bill) and wire the write-off leg through the existing GL seam (`applyGlDerivedEntries`). Until then the variance-approval gate stays absent and the write-off GL leg stays unposted — fail-closed, stated honestly, never invented.
