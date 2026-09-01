# ERP — SESSION 4: QA DISPOSITION → INVENTORY (RED GAP) · ACCOUNTING DECISION (ESCALATED)

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `a31fad9`
**RED gate status:** REPRODUCED (executable) · **STILL RED — STOPPED before semantic code per the directive**
(a genuine business/accounting decision is required; §Session-4 rule #2/#4). No production code changed. Two
independent read-only subagent traces + first-hand source reading agree on every fact below.

---

## RED GATE STATUS

RED, and now reproduced as an executable pin: `qualityDispositionGap.test.ts` (3/3) proves that a Quality
Inspection with `result: 'reject'` (and `fail` / `rework`) posts **zero** stock movements and **zero** GL entries,
and that the inspection descriptor has **no `product` and no `warehouse` field** and **no actions**. The disposition
is inventory- and GL-inert today.

## ROOT CAUSE (exact)

`modules/manufacturing/qualityModule.ts` is a scoring/record module by construction — header line 5: *"No stock
effect."* It has only `validate` (stamps `qualityScore`) and `summarize` (risk band); **no `onChange`, no
`runAction`, no actions**. `result` (`pass|fail|rework|reject`) is read only by the summary risk band
(`qualityModule.ts:124`). The record has quantities (`inspectedQuantity/passedQuantity/failedQuantity/
reworkQuantity`) but **no product, no warehouse, and only a free-text `productionOrder` number that nothing
resolves**. So there is no data path — and no action — by which a disposition could move or hold stock.

## WHY THIS IS A BUSINESS/ACCOUNTING DECISION, NOT A MECHANICAL FIX

The substrate offers materially different, mutually-exclusive treatments, and the product models **none** of them
for quality — so any implementation must *choose accounting meaning*, which the directive forbids doing silently:

- **No `quarantine` and no `scrap` movement type exists.** `MovementType` = `receive | issue | transfer | adjustment
  | production_consumption | production_output | reservation | reservation_release | return`
  (`packages/shared/src/types/inventory.ts:36-45`). Scrap is only ever expressed as a **negative `adjustment`**.
- **A negative `adjustment` AUTO-POSTS to the GL as a write-off** — via ERP seam #1 (`stockMovementModule.ts:177` →
  `inventoryGlBridge.ts` → `deriveInventoryAdjustmentPosting`, `erp/postingRules.ts:211-227`): **Dr 5010 Inventory
  Adjustments (expense) / Cr 1300 Inventory (asset)** at qty×unitCost. It **removes** units from on-hand (a
  destroy/write-off), does **not** hold them, and does **not** touch variance (5900/5910).
- **There is NO quarantine-warehouse / blocked-stock concept.** A warehouse is free-text master data
  (`warehouseModule.ts:18-50`) with only `active|inactive` status — no type, no zone semantics. A `transfer` to a
  warehouse *named* "QUARANTINE" is GL-neutral but leaves the stock **still counted as available** — so it does not
  actually hold/block anything. A true quarantine state would be a **new inventory data-model concept**, which under
  CLAUDE §2 #18 (a data-model change that alters what the system may do is a governance change) needs its own gate.
- **The `stage` (`incoming|in_process|final`) changes the correct treatment** and is unmodeled: at `incoming` the
  goods may be **pre-receipt** (nothing on-hand to move → reject the receipt, not the ledger); at `final` they are
  finished goods (1360) vs raw (1300). Nothing ties stage to a location or account.
- **The four dispositions plausibly need four different treatments:** `reject` (scrap write-off? return-to-vendor?),
  `fail` (same as reject, or quarantine-pending?), `rework` (stays in stock/WIP — no write-off), `pass` (release —
  no movement). Reusing the single negative-adjustment→5010 path for all of them would be **wrong** for rework,
  quarantine, and return-to-vendor (the RTV posting is a different entry entirely — credit inventory against a
  supplier debit / reverse GRNI — which `deriveInventoryAdjustmentPosting` would mis-book as an adjustment expense).

The MES precedent is instructive but not transferable: `executionModule.ts:338-351` writes off **production scrap**
as a negative `adjustment` (Dr 5010 / Cr 1300) at final-op completion, resolving product+warehouse from the
production order (`executionModule.ts:357`). medicalDevice models quarantine as a **status gate** (`canDraw` refuses
consumption of a `quarantined` lot — `medicalDeviceLot.ts:275-292`), posting **no** movement. Two proven patterns,
two different meanings — which one QA `reject`/`fail`/`quarantine` should use is exactly the decision.

## THE EXACT DECISION REQUESTED (operator)

1. **What does `reject` do to inventory + GL?** (a) **Scrap write-off** — negative `adjustment`, Dr 5010 / Cr 1300
   (reuses seam #1, smallest, unambiguous once chosen); (b) **Quarantine/hold** — hold on-hand, GL-neutral, pending
   a later disposition (needs a NEW blocked-stock state — bigger, its own §2 #18 gate); (c) **Return-to-vendor** — a
   different GL posting (needs a new rule).
2. **Does `fail` differ from `reject`?** (e.g. `fail` → quarantine-pending, `reject` → scrap) or are they the same?
3. **How does `stage` bind?** e.g. only `final` writes off finished goods; `incoming` is pre-receipt (no on-hand
   effect — handled at goods-receipt instead); `in_process` → WIP.
4. **Is a true quarantine/blocked-stock state wanted now** (Option 1b, a new inventory concept + gate), or is the
   first slice **scrap-only** (Option 1a)?

## RECOMMENDATION (for the first slice, pending your confirmation)

**Option 1a — scrap-only, explicit, minimal.** On a governed `postDisposition` action added to the Quality module:
`reject` (and `fail` **iff** you confirm fail == scrap) writes off `failedQuantity` via a negative `adjustment`
through the single `postStockMovement` seam, resolving product+warehouse from the referenced production order (the
`executionModule.ts:357` pattern), correlated to the inspection (Session 1 spine), idempotent (deterministic
movement reference per inspection), tenant-scoped, audited. `pass`/`rework` do nothing to inventory. Quarantine
(blocked stock) and return-to-vendor are explicitly **out of scope** until modeled. This reuses only proven paths
and invents no accounting meaning beyond the one you confirm (`reject`/`fail` = scrap write-off to 5010).

This is the smallest coherent, testable, end-to-end slice — but it still requires you to confirm that mapping, which
is why it is presented rather than implemented.

## WHAT WAS DONE THIS SESSION

Reproduced the RED gap from source (two independent subagent traces + first-hand reading, line-cited above) and as
an executable pin (`qualityDispositionGap.test.ts`, 3/3). **No production code changed** (correctly — the fix is a
semantic decision). On your ruling of Q1–Q4, Session 4-fix implements the confirmed mapping end-to-end
(action → movement → seam #1 GL → readback) with regression + e2e tests and the full verification loop.

## FILES CHANGED

```
NEW  src/main/enterprise/modules/manufacturing/qualityDispositionGap.test.ts  executable RED-gap reproduction (3 pins)
NEW  certification/ERP-SESSION4-QA-DISPOSITION-DECISION.md                    this decision memo
```
