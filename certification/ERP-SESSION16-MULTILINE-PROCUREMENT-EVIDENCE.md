# ERP — SESSION 16: MULTI-SKU PROCUREMENT FOUNDATION (PO LINES → MULTI-LINE GR → INVENTORY → GRNI)

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base:** Session 15 GREEN (`7f125d3`)
**Label:** TEST-VERIFIED. No frozen surface touched; no accounting mapping changed; standard costing preserved;
no parallel PO model. Inspect → reproduce → implement → negative control → multi-line E2E → full regression.

Upgrades the live procurement/inventory transaction model from single-product documents to proper multi-line ERP
transactions, reusing the existing line + movement conventions.

---

## A · CURRENT SINGLE-SKU LIMITATION (reproduced)

The Purchase Order and Goods Receipt modules each carried a single-product **header** (`product`, `quantity`,
`unitCost`), and those types are frozen in `@neuropause/shared`. The three-way match therefore built exactly ONE
order line from the PO header, so a multi-SKU vendor bill could never fully match: the extra SKUs had no order line
and no receipt to match against. Reproduced in `S16 · reproduction`: a single-product PO (SKU-A) + a 3-SKU bill
(A/B/C) → the bill is **held** (B and C unmatched). The limitation is in the data model, not the UI.

Prior work already in place (reused, not rebuilt): the per-line movement seam `postMovementLinesAtomic`
(`MV-<doc>-L<n>`, all-or-nothing compensation, per-movement Dr Inventory/Cr GRNI, `voidPostedMovement` reversal —
Session 7); the vendor-bill line model + `threeWayMatch` keyed by product + cumulative billing (Sessions 11–12).

---

## B · NEW CANONICAL MULTI-LINE MODEL

Additive `lines` JSON on the EXISTING PO and GR modules (the vendor-bill `lines` convention) — one PO model, one GR
model, no parallel document, no frozen-type change. A document with no `lines` is unchanged (backward compatible).

```
Purchase Order (procurement-orders)        Goods Receipt (procurement-receipts)
  fields.lines = [{sku,quantity,unitPrice}]  fields.lines = [{sku,quantity,poLine?}]
        │  subtotal = Σ qty×price                     │  post → per PO-line validation
        ▼                                             ▼
  three-way match order lines           postMovementLinesAtomic (Session 7 seam)
                                             → one `receive` movement per line
                                             → Dr Inventory 1300 / Cr GRNI 2150 per line (existing bridge)
```

One pure module — `erp/procurementLines.ts` — parses both line shapes, derives the PO subtotal, resolves a receipt
line to its PO line, and sums per SKU. There is no second procurement line parser.

---

## C · PO-LINE ARCHITECTURE

`purchaseOrderModule` gains a `lines` field. `validate`: when lines are present, `subtotal = Σ ordered qty × unit
price` and the deterministic `total` derives from it (`calculatePurchaseTotal`, unchanged). Each line independently
represents item, ordered quantity, unit price and line amount; remaining quantity and line status are **derived**
from the receipts (single source of truth — never a stored, drifting copy). UoM is not carried by these modules, so
no UoM field or conversion is invented (§3 "if already supported"). A single-product PO (no lines) is untouched.

---

## D · RECEIPT-LINE ARCHITECTURE

`goodsReceiptModule` gains `lines` + `receiptMovements`. `post`, when lines are present:

1. Resolve the referenced PO (tenant-scoped — a foreign PO is invisible).
2. **Every receipt line must resolve to a PO line** (`resolvePoLine`: by 1-based `poLine` with SKU agreement, else
   the unique PO line with that SKU) — a line with no PO-line identity is refused (deny by default).
3. **Cumulative received ≤ ordered per SKU** across this receipt + all prior received receipts of the PO — the
   default no-over-receipt invariant (the repository defines no over-receipt acceptance policy, so none is invented).
4. `postMovementLinesAtomic` posts one valued `receive` movement per line — inheriting standard-cost valuation, the
   per-movement GRNI bridge, all-or-nothing compensation and reversal identity. No second movement/costing/GL path.

Document idempotency: the `status === 'received'` guard prevents a re-post. The single-product receipt path is
unchanged.

---

## E · INVENTORY / GRNI PROOF

Each receipt line posts a SKU-specific `receive` movement; the existing bridge posts **Dr Inventory 1300 / Cr GRNI
2150** per movement at standard cost. Proven for PO A=10@5 / B=20@3 / C=5@8, receipt A=6/B=10/C=5:

- one movement per line, SKUs {A,B,C}; A 6×5=30, B 10×3=30, C 5×8=40.
- **Σ Inventory debits = Σ GRNI credits = 100**, and **Σ Debits = Σ Credits** for the receipt.

Standard cost only (no weighted-average / actual); canonical accounts unchanged (1300/2150/2000/5920/…).

---

## F · THREE-WAY-MATCH COMPATIBILITY

`goodsBillMatch` now reads the order side from the PO lines (one order line per SKU) and aggregates received value
from the ACTUAL `receive` movements that reference the PO's receipts (reading each movement's own SKU) — which
unifies single-product receipts (one movement) and multi-line receipts (N movements) with no second path and is
byte-identical to the prior single-movement read for a legacy receipt. The existing per-SKU `threeWayMatch` +
cumulative billing are reused unchanged. Proven: `billed > received` per SKU is refused; one SKU's receipt cannot
satisfy another SKU's bill (refused).

---

## G · PARTIAL RECEIPT PROOF

PO A=10/B=20/C=5. Receipt 1 A=6/B=10/C=5 → Receipt 2 A=4/B=10 → final received A=10/B=20/C=5 (Σ value 150). A third
receipt of A=1 is refused (A already at ordered 10). GRNI credit reconciles to 150; no line received twice.

---

## H · IDEMPOTENCY / REVERSAL PROOF

- **Idempotency:** re-posting a received multi-line receipt is refused; the movement count stays at the number of
  lines (no double post).
- **Reversal:** `voidPostedMovement` reverses the correct individual lines. Partial reversal (void the SKU-C
  movement only) → GRNI 100 → 60; full reversal (void the rest) → GRNI 0. The existing per-movement void policy
  supports partial reversal, so no new policy was invented (§11 STOP not triggered).

---

## I · TENANT-ISOLATION PROOF

A receipt in tenant B referencing tenant A's PO is refused — A's PO is invisible in B's scope (`was not found`).
Cross-tenant PO-line / receipt-line / inventory / bill-line references are all enforced by the tenant-scoped record
store; the Session 14/15 tenant-scoped initialization and concurrency guarantees are untouched.

---

## J · NEGATIVE-CONTROL RESULTS

Each mutation fails the appropriate test; each restore is byte-identical (sha256 verified).

| # (directive §14) | Mutation | Failing test |
|---|---|---|
| 1 allow received > ordered | relax the over-receipt guard | over-receipt refused |
| 2 remove PO-line identity | skip `resolvePoLine` check | SKU-not-on-PO refused |
| 3 SKU-A satisfies SKU-B | drop SKU-agreement in `resolvePoLine` | receipt line SKU-vs-PO-line refused |
| 4 bypass line-level movement | post zero movement lines | one movement per line |
| 5 bypass GRNI posting | receive case posts no entry | Σ Inventory=Σ GRNI |
| 6 billed > received | force match `postable=true` | billed>received refused |
| 7 remove tenant validation | (structural — scoped store) | tenant-isolation test (see note) |
| 8 remove idempotency | disable the `received` guard | re-post double-posts |
| 9 duplicate receipt approval | (same `received` guard as #8) | re-post double-posts |
| 10 change canonical accounts | Inventory 1300→9999 | inventory/GRNI + session10 |

Note (#7): tenant isolation has no single mutable line — it is enforced structurally by the tenant-scoped
`EnterpriseRecordStore` (a foreign PO is invisible), proven by the S16 tenant-isolation test + the Session 14
cross-tenant PO test + the storeScope suites. Consistent with Sessions 11/12/14; mutating the framework boundary is
out of scope.

---

## K · REGRESSION COUNTS

| Suite | Result |
|---|---|
| `session16MultiLineProcurement.test.ts` | **14/14** |
| Session 15 / 14 / 12 / 11 (concurrency, tenant, P2P) | unchanged |
| `src/main/enterprise` (procurement + finance + inventory blast radius) | **1389** (Session 15 1375 + 14) |
| `src/main/erp` + `src/main/medicalDevice` | **220** (unchanged) |

---

## L · TYPECHECK / LINT / BUILD

`typecheck:node` + `typecheck:web` clean · `electron-vite build` clean · ESLint clean on all changed/new files.
Repo-wide `npm run lint` carries the same pre-existing test-file backlog noted since Session 10 (sandbox-vs-Mac
config); no regression from this change — confirm on the Mac.

---

## M · FILES CHANGED

```
NEW  erp/procurementLines.ts                          pure PO-line + receipt-line parsing, subtotal, PO-line resolution, per-SKU sums
MOD  .../procurement/purchaseOrderModule.ts           + lines field; validate derives subtotal from lines
MOD  .../procurement/goodsReceiptModule.ts            + lines/receiptMovements fields; multi-line post branch (PO-line validation, received≤ordered, shared movement seam)
MOD  .../finance/goodsBillMatch.ts                    order lines from PO lines; received value from movements-by-referenceRecord (unifies single + multi-line)
NEW  .../procurement/session16MultiLineProcurement.test.ts   14 pins
NEW  certification/ERP-SESSION16-MULTILINE-PROCUREMENT-EVIDENCE.md
```

Frozen surfaces untouched (packages/shared incl. PO/GR/PurchaseOrder types + calculatePurchaseTotal; cst/; contracts;
channels; runtimeCore; executionGate). `certification/baseline.json` not staged.

---

## N · COMMIT SHA

`<filled at commit>` — one commit, `erp(s16): …`. The user pushes from the Mac.

---

## O · REMAINING RISKS / BOUNDS

- **Multi-line GR header fields** (`product`/`quantityReceived`) are required by the descriptor, so a multi-line
  receipt carries a header summary (`product` sentinel + total received); the lines are authoritative and the match
  reads SKUs from the movements, so the header is never used for accounting. Honest and documented, not load-bearing.
- **Remaining quantity / line status are derived** (from receipts), not stored on the PO line — the single-source
  choice; a stored copy would be a second truth that can drift.
- **UoM / backorder** intentionally out of scope (not supported by these modules; no policy invented).
- **Over-receipt** is refused per SKU (the default); if a future explicit over-receipt acceptance policy is desired
  it is its own gated decision. The `threeWayMatch` 5% over-receipt tolerance is a MATCH tolerance, unchanged.
- Session 11/12 foreign-currency + standard-cost-change bounds carry forward.

---

## P · STATUS: 🟢 GREEN

1. PO supports multiple independent lines. ✓
2. Goods Receipt supports multiple independent lines. ✓
3. Receipt lines reference PO lines deterministically. ✓
4. Partial receipts work independently per SKU. ✓
5. Inventory movements are line/product-specific. ✓
6. GRNI is generated correctly per received line. ✓
7. Existing vendor-bill line matching remains compatible. ✓
8. Cumulative billed cannot exceed cumulative received per SKU. ✓
9. Standard-cost accounting unchanged. ✓
10. Idempotency preserved. ✓
11. Reversal preserved (full + partial via the existing void policy). ✓
12. Tenant isolation preserved. ✓
13. Negative controls prove the line-level boundaries (9 concrete + 1 structural). ✓
14. Existing regression suites remain GREEN. ✓
15. Typecheck/lint/build clean. ✓
16. No frozen surface modified. ✓

GREEN with the §O bounds. MRP and advanced ERP modules deliberately not started.
