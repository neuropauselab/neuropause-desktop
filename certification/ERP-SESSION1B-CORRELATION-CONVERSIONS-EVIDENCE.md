# ERP — SESSION 1b: CORRELATION ACROSS THE DOCUMENT CONVERSIONS

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `d3ac7c7` (Session 1)
**Label:** TEST-VERIFIED · **Nature:** completes the transaction-graph *document* legs. Additive; reuses the
Session 1 helper (`childCorrelationMeta` / `rootMetaIfUnset`); no frozen surface; no new IPC.

---

## WHAT THIS ADDS

Session 1 wired the sales chain + the two shared funnels (`postStockMovement`, `applyGlDerivedEntries`), so every
movement/GL entry already joined its source's transaction. Session 1b stamps the remaining **hand-written
cross-module document conversions**, so the *document* chains (PR→PO→GR, order→schedule→execution, pick→pack→ship)
share one correlationId too — the same 2-line pattern at each seam (child on the created record, root on the source
update it already performs):

- **Procurement** `modules/procurement/conversion.ts` — PR→PO and PO→GR.
- **Warehouse** `modules/warehouse/conversion.ts` — pick→packing and packing→shipment.
- **Manufacturing** `modules/manufacturing/scheduleCommit.ts` (order→schedules, fan-out) and `mesDispatch.ts`
  (order→executions, fan-out) — each child in the loop shares the production order's correlationId.

Fan-out is handled correctly: one production order → N schedules / N executions, every child carrying the same
correlationId with `causationId` = the order.

## PROVEN (real chains through the real action handlers)

`framework/transactionGraphChains.test.ts` (2) drives the REAL module action handlers end to end:
- **Procurement** — `PR --approve--> --createPurchaseOrder--> PO --approve/send/receiveGoods--> GR`: the PO and GR
  inherit the PR as root (`correlationId = purchase-requests:<prId>`), with causation PO→PR and GR→PO;
  `traceTransactionGraph` returns PR (root) → PO → GR.
- **Warehouse** — `pick --createPacking--> packing --pack--> --createShipment--> shipment`: packing and shipment
  inherit the pick as root; trace returns pick → packing → shipment root-first with the right parent edges.

Manufacturing (scheduleCommit / mesDispatch) uses the identical helper calls and is covered by the enterprise
blast-radius suite (its conversion paths run green with the new metadata); an explicit manufacturing e2e correlation
pin is deferred to when that chain gets its own end-to-end harness (recorded, not claimed).

| Check | Result |
|---|---|
| New chain pins (procurement + warehouse, real actions) | **2/2** |
| Negative control (neuter procurement PO stamp → run → **1 failed**; re-applied; chains 2/2) | **load-bearing, proven** |
| Blast radius — all `src/main/enterprise` | **158 files / 1255 passed** |
| `tsc` node + web | **exit 0** |
| ESLint (all 1b files) | **clean** |
| `electron-vite build` | **exit 0** |

Note on the negative control: procurement/conversion.ts is a git-tracked file whose Session 1b edits were still
uncommitted, so `git checkout` restored it to the pre-1b commit (over-reverting my edits). Caught immediately and
the wiring was re-applied by hand + re-verified (5 helper references present, chains 2/2, typecheck clean) — the
lesson (git-restore reverts to last commit, not to uncommitted working state) is recorded so future negative
controls on uncommitted-but-tracked files restore by re-applying, not by checkout.

## FILES CHANGED

```
MOD  src/main/enterprise/modules/procurement/conversion.ts          PR→PO, PO→GR stamp child + root
MOD  src/main/enterprise/modules/warehouse/conversion.ts            pick→packing, packing→shipment stamp child + root
MOD  src/main/enterprise/modules/manufacturing/scheduleCommit.ts    order→schedules (fan-out) stamp child + root
MOD  src/main/enterprise/modules/manufacturing/mesDispatch.ts       order→executions (fan-out) stamp child + root
NEW  src/main/enterprise/framework/transactionGraphChains.test.ts   procurement + warehouse chain pins
NEW  certification/ERP-SESSION1B-CORRELATION-CONVERSIONS-EVIDENCE.md this document
```

## REMAINING (recorded, per the master plan)

CRM (lead→contact/customer), maintenance (PM/CM→work-order), and projects (billing-run→invoice + time-entry
stamps) conversions are not yet stamped — same mechanical 2-line pattern, each its own small slice. Their
movement/GL legs already carry correlation via the funnels; what remains is their document legs. This does not block
Session 2 (posting parity), which is next in the master plan.
