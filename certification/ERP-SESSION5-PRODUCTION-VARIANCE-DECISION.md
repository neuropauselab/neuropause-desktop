# ERP — SESSION 5: PRODUCTION ACTUAL-COST + VARIANCE (RED GAP) · ACCOUNTING DECISION (ESCALATED)

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `ae7c62b`
**RED gate status:** REPRODUCED (executable) · **STILL RED — STOPPED before semantic code per the directive**
(a system-wide cost-basis decision is genuinely required; implementing it in isolation breaks GL integrity). No
production code changed. Two independent read-only subagent traces + first-hand source reading agree.

---

## RED GATE STATUS

RED, reproduced as an executable pin: `productionVarianceGap.test.ts` (3/3) proves a production run (consumption +
output through the real `manufacturingMovements` seam, the way production posts it) yields **zero** WIP (1350),
finished-goods (1360), material-variance (5900) and production-variance (5910) journal lines; that the SAME
consumption WITH a `unitCost` does post WIP (so the bridge works — the movements are uncosted); and that the
variance LOGIC already exists (`deriveProductionCompletionPosting` books Dr 5910 3 / Cr WIP 23 for a WIP≠standard
case) but is never called per order with real numbers.

## ROOT CAUSE (exact — deeper than "variance not settled")

**Every production stock movement carries `unitCost = 0`.** No production caller passes a cost:
`executionModule.ts` `postConsumption`/`postOutput` and `productionOrderModule.ts` likewise omit `unitCost`; the
`postStockMovement` seam defaults `unitCost: input.unitCost ?? 0` (`postMovement.ts:49`); the Stock Movements
module has no `validate`/cost-enrichment hook. Every manufacturing GL derivation refuses at zero value
(`deriveMaterialIssuePosting`/`deriveProductionCompletionPosting`, `erp/postingRules.ts`), so **a real production
run posts nothing to the GL** — no WIP, no FG, no variance. Variance can't exist without costed movements.

And it is not only production: **goods-receipt (`goodsReceiptModule.ts:108`) and sales-issue
(`sales/inventoryLink.ts:62`) also omit `unitCost`.** So the ERP seam #1 GL bridge — correct, and proven with an
explicit cost in its own tests — is **dormant across every domain flow in production** because the movement ledger
is uncosted.

## WHY THIS IS A SYSTEM-WIDE ACCOUNTING DECISION, NOT A PRODUCTION-ONLY FIX

**Costing production consumption in isolation would BREAK GL integrity.** If consumption starts crediting Inventory
(1300) at cost while receipts remain uncosted (Inventory was never debited), Inventory 1300 is driven **negative** —
a false balance. Costing must be introduced **consistently across receipt → issue → consumption → output**, which
means choosing a ledger-wide cost basis. That choice is contested and unmodeled:

- **Standard costing** — value every movement at `product.standardCost` (the basis already used by
  `inventoryValuation.ts`, `bomExplosion.ts`, `costingModule.ts`). Uniform, single-point (enrich at the
  `postStockMovement` seam), and turns the whole GL bridge live at standard. But it **ignores the PO's actual
  purchase price** (the goods-receipt/PO carries a real `unitCost`), dumping purchase-price variance nowhere.
- **Actual / moving-average costing** — value receipts at the actual PO cost and relieve inventory at
  actual/moving-average. Truer, but the ledger has **no moving-average or lot-cost engine** — that is a new costing
  subsystem.

These produce different inventory valuations, different COGS, and different variances. Picking one is a materially-
consequential accounting decision (CLAUDE §2 #18) that changes financial statements across every flow — far beyond
"production variance."

**Then, on top of the basis, the variance model itself is a choice:**
- The residual WIP after an order completes = Σ(consumption value) − Σ(output value). `deriveProductionCompletionPosting`
  already books that residual to **5910 (production variance)** and posts nothing to **5900 (material variance)** —
  5900 is defined but **never posted by any code**. Booking the whole residual to 5910 (mirroring existing code) is
  the non-inventing choice; **splitting into a 5900 usage/quantity variance vs a 5910 yield/rate variance** (actual
  qty vs BOM standard qty × standard price) is a finer standard-costing model that must be specified.
- **Posting ownership** overlaps the already-escalated #96: the per-movement `production_output` bridge posts
  Dr FG / Cr WIP (`inventoryGlBridge.ts:112-122`), AND a dormant document-adapter spec
  (`documentSpecs.ts:157-162`) also calls `deriveProductionCompletionPosting`. A per-order settlement must be
  variance-only (clear residual WIP → 5910) under a fresh key (`WIP-VAR-<orderId>`) to avoid a third producer of
  FG/WIP lines. Which mechanism owns the FG↔WIP completion move is the same Option A/B/C ownership question as #96.

## THE EXACT DECISION REQUESTED (operator)

1. **Ledger cost basis** — standard (`product.standardCost`, enriched uniformly at the `postStockMovement` seam,
   turning the GL bridge live at standard) vs actual/moving-average (a new costing engine). This governs receipt,
   issue, consumption, and output together.
2. **Variance model** — residual WIP → **5910 only** (mirrors existing code, no invention) vs a **5900 usage /
   5910 yield split** (needs the split defined).
3. **Completion-posting ownership** — confirm the per-movement `production_output` keeps the FG↔WIP move and the
   settlement is variance-only (recommended), and that the dormant `documentSpecs.ts:157-162` completion spec is
   retired/kept per the #96 ruling (to avoid a third FG/WIP producer).
4. **Scope** — accept that this is a **ledger-costing slice** (all flows), not production-only, since production
   costing cannot be correct while the rest of the ledger is uncosted.

## RECOMMENDATION (pending your confirmation)

**Standard-cost the ledger at one point + a variance-only settlement.** (a) Enrich `unitCost` from
`product.standardCost` inside the single `postStockMovement` seam when a caller omits it — one consistent basis for
receipt/issue/consumption/output, no per-caller edits, GL integrity preserved (Inventory debited and credited on the
same basis). (b) Add an idempotent, tenant-scoped, per-order variance settlement at completion (`WIP-VAR-<orderId>`)
that derives actual cost strictly from the order's own movements and clears residual WIP to **5910** via the
existing derivation — variance-only, additive, no FG double-post. This invents no accounting (reuses
`product.standardCost` and `deriveProductionCompletionPosting`'s coded 5910 behavior) — but it changes financial
output across all flows, so it is your call, not mine. If you prefer to keep Session 5 strictly production-scoped, it
cannot be made correct without also costing receipts, so the basis decision comes first.

## WHAT WAS DONE THIS SESSION

Reproduced from source (two independent subagent traces + first-hand reading, line-cited) and as an executable pin
(`productionVarianceGap.test.ts`, 3/3). **No production code changed** (correctly — the fix rests on an unmade
cost-basis decision, and costing production alone would break GL integrity). On your ruling of Q1–Q4, Session 5-fix
implements the confirmed basis + settlement end-to-end (movement costing → WIP → per-order variance → readback) with
normal/partial/repeat/zero-edge regression + integration tests, tenancy, idempotency, audit, and the full
verification loop.

## FILES CHANGED

```
NEW  src/main/enterprise/modules/manufacturing/productionVarianceGap.test.ts  executable RED-gap reproduction (3 pins)
NEW  certification/ERP-SESSION5-PRODUCTION-VARIANCE-DECISION.md               this decision memo
```
