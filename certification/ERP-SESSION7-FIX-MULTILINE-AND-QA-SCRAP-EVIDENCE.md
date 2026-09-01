# ERP — SESSION 7-FIX: MULTI-LINE DOCUMENTS + COMPENSATING ATOMICITY + QA SCRAP

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `02da969`
**Label:** TEST-VERIFIED · **Closes:** #104 (multi-line atomicity Option A + multi-line receipt/dispatch
documents) and #99 (QA disposition Option 1a). Reuses the Session 5-Fix standard-cost seam and the Session 6
reversal; no second costing or GL path; no frozen surface (module ids are local; nothing added to `packages/shared`).

---

## ARCHITECTURE IMPLEMENTED

```
Document (header) ─► Lines[N] ─► postMovementLinesAtomic ─► N × postStockMovement (Session 5-Fix std cost)
                                          │                        └─► seam #1 GL per line
                                          └─(any line fails)─► compensate: void every posted line (Session 6 -REV)
```

Two new first-class documents plus the shared seam, production hardening, and the QA scrap action — all funnel
through the ONE `postStockMovement` seam, so every line inherits standard-cost valuation and seam #1 GL.

## DOCUMENT / HEADER / LINE MODEL

- **Multi-Line Goods Receipt** (`procurement-multiline-receipts`): header (receiptNumber, warehouse) + a `lines`
  JSON field `[{ sku, quantity, warehouse? }]`; action `receiveLines`. NOT a copy of the single-line goods receipt.
- **Multi-Line Sales Dispatch** (`sales-multiline-dispatches`): header (dispatchNumber, warehouse) + `lines`;
  action `dispatchLines`.
- Both parse lines → normalized movement lines (document warehouse fallback), status `draft → received/dispatched
  → failed`, and record `movementRefs` (document → movement traceability).

## MOVEMENT MODEL

`postMovementLinesAtomic(ctx, doc, lines)` posts one movement per line with a deterministic number
`MV-<docNumber>-L<n>`, `referenceModule`/`referenceRecord` = the document (traceable + Session 1 correlation), and
the document's movement type (`receive` / `issue` / `production_consumption`). Movements are immutable; compensation
marks them `void`, never mutating or deleting a posted movement.

## ACCOUNTING MODEL (standard cost throughout — never sales price)

- Receipt line → **Dr Inventory 1300 / Cr GRNI 2150** at qty × standard cost. Example R1: RM-1 10@5 + RM-2 4@7 →
  **Inventory +78, GRNI +78** (verified).
- Dispatch line → **Dr COGS 5000 / Cr Inventory 1300** at qty × standard cost (e.g. 3@12 + 2@8 → COGS +52). The
  sales price is never used for inventory valuation.
- Production consumption line → **Dr WIP 1350 / Cr Inventory 1300** at standard cost (Session 5-Fix).
- QA scrap → **Dr 5010 Inventory Adjustment / Cr Inventory 1300** at standard cost (negative adjustment).

## COMPENSATION STRATEGY + FAILURE SEMANTICS

**Business-level all-or-nothing (Option A), NOT a single database transaction** — the enterprise stores commit
independently, so atomicity is achieved by COMPENSATION: on the first line that fails to post, every
previously-posted line is voided via the Session 6 `MOV-<id>-REV` reversal, leaving the document with **no net
inventory or GL effect** and status `failed`. This is stated explicitly in the seam's contract. Verified at the
first, middle, and final line position (receipt, dispatch, and production consumption).

## IDEMPOTENCY STRATEGY

- **Document level**: a received/dispatched document cannot re-post (status guard) → replay produces no duplicate
  movement or GL.
- **Line/movement level**: deterministic `MV-<docNumber>-L<n>`; each line posts once per attempt; movement GL keyed
  `MOV-<movementId>` (seam #1 skips an existing entry).
- **Compensation/reversal**: keyed `MOV-<id>-REV`; a duplicate/replayed void posts exactly one reversal.
- **QA scrap**: deterministic `MV-QA-<inspectionNumber>-SCRAP`, guarded by the inspection's `scrapMovement` field →
  a second disposition never double-scraps.

## REVERSAL STRATEGY

Compensation and post-hoc void both use the Session 6 append-only reversal: the original movement/entry is immutable,
the reversal is a new `-REV` entry, and it is idempotent. A dispatched/received line reverses to net zero on void
(verified).

## QA DISPOSITION (#99 Option 1a)

`postDisposition` action on the Quality module: a **FINAL-stage** result of `fail`/`reject` scraps the
`failedQuantity` as a negative `adjustment` (Dr 5010 / Cr 1300 at standard cost), resolving product + warehouse from
the linked production order (`orderNumber`), traceable to the inspection. Intermediate stages do NOT scrap
(unchanged). Idempotent (guarded). Passes/rework do nothing.

## FILES CHANGED

```
NEW  modules/inventory/multiLineMovements.ts              compensating multi-line poster + voidPostedMovement
NEW  modules/procurement/multiLineReceiptModule.ts        multi-line goods receipt document
NEW  modules/sales/multiLineDispatchModule.ts             multi-line sales dispatch document
MOD  modules/manufacturing/productionOrderModule.ts       START consumes N components atomically (compensating)
MOD  modules/manufacturing/qualityModule.ts               postDisposition → final-stage fail = scrap (#99 Option 1a)
MOD  modules/procurement/procurementInstances.ts          multiLineReceiptModule singleton
MOD  modules/sales/orderModuleInstance.ts                 multiLineDispatchModule singleton
MOD  enterprise/index.ts                                  register both new modules at boot
NEW  modules/inventory/session7FixMultiLine.test.ts       the 30-point matrix (18 pins)
MOD  modules/manufacturing/qualityDispositionGap.test.ts  Session 4 boundary updated to the CLOSED state
NEW  certification/ERP-SESSION7-FIX-MULTILINE-AND-QA-SCRAP-EVIDENCE.md  this document
```

## TESTS ADDED / RESULTS

`session7FixMultiLine.test.ts` (18 pins) covers the required 30-point matrix: receipt 1-8, dispatch 9-15,
production 16-21, QA 22-25, security/integrity 26-30. Plus `multiLineTransactionIntegrity.test.ts` (Session 7) still
green.

| Check | Result |
|---|---|
| Session 7-Fix matrix | **18/18** (all 30 required points) |
| Negative control (disable the compensation path → **3 failed**; restore byte-identical → 18/18) | **load-bearing** |
| Blast radius — all `src/main/enterprise` | **1310 passed** |
| `src/main/medicalDevice` + `src/main/erp` | **208 passed** |
| `tsc` node + web · ESLint · `electron-vite build` | clean |
| Session 5-Fix / Session 6 | not regressed |

One expected regression: the Session 4 gap reproduction asserted the Quality module had **no** action; #99 adds
`postDisposition`, so that assertion was DELIBERATELY flipped (the Session 4 file's own comment anticipated this) —
the retained pins now protect the boundary that *creating* an inspection never auto-moves stock (scrap is the
explicit action). No test was weakened to obtain GREEN.

## GATE CRITERION — MET

Purchase Receipts, Sales Dispatches, and Production Orders process multiple lines with complete inventory/GL
traceability, standard-cost valuation, deterministic idempotency, business-level all-or-nothing compensation on
failure, and immutable/idempotent reversal; and a final-stage QA failure correctly produces scrap. **Session 7-Fix
GREEN.**

## REMAINING LIMITATIONS

- Atomicity is **business-level (compensating)**, explicitly NOT a single DB transaction — a mid-compensation crash
  is bounded by the same at-most-once movement/`-REV` idempotency but is not a rollback; a crash-recovery reconciler
  is a future durability seam.
- The new multi-line documents carry lines as a JSON field (no per-line child records); a typed line sub-entity is a
  later enhancement, not required by the gate.
- Session 7-Fix leaves the single-line goods receipt / order paths intact (both models coexist); consolidation is a
  product decision, not a defect.
