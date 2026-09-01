# ERP — SESSION 5-FIX: STANDARD-COST LEDGER + PRODUCTION VARIANCE SETTLEMENT

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `453d5a1`
**Label:** TEST-VERIFIED · **Decisions implemented (operator, authoritative):** standard cost at the
`postStockMovement` seam · production variance 5910-only · variance-only per-order completion settlement · movement
ledger owns GRNI accrual (single owner). No moving-average/actual costing; no second costing mechanism inside
production; no bypass of the central seam; no new accounting semantics beyond these.

---

## ACCOUNTING FLOW IMPLEMENTED

```
Domain transaction (receipt / issue / production consume / output / adjustment)
      ↓
postStockMovement()  ──►  resolveStandardUnitCost()  ──►  product.standardCost   [ONE costing point]
      ↓
Stock movement (valued at standard cost)
      ↓
onChange → inventoryGlBridge (ERP seam #1)  ──►  GL posting
      ↓
Production order reaches 'completed'  →  onChange  →  settleProductionVariance()  →  residual WIP → 5910 (variance-only)
```

## STANDARD-COST RESOLUTION PATH (the ONE point)

`modules/inventory/postMovement.ts` → `resolveStandardUnitCost(ctx, input)`: a caller-supplied positive `unitCost`
is authoritative; otherwise the cost is the product's `standardCost`, read from the Products module by SKU or id; a
product with no standard cost resolves to **0** (an honest uncosted movement that posts no GL — never a guess). This
single seam serves **every** flow — goods receipt, sales issue, production consumption/output, adjustments — so the
ledger is valued on one basis and the GL bridge is never starved. No production caller hard-codes cost; nothing
bypasses the seam.

## EXACT GL ENTRIES — REPRESENTATIVE PRODUCTION SCENARIO

Consume 6 × RM-1 @ std 5; output 2 × FG-1 @ std 12 (all values proven in tests):

| Entry (idempotency key) | Debit | Credit |
|---|---|---|
| `MOV-<consumption>` — material to WIP | WIP **1350** 30 | Inventory **1300** 30 |
| `MOV-<output>` — finished goods | Finished Goods **1360** 24 | WIP **1350** 24 |
| `VAR-<orderId>` — completion settlement (variance-only) | Production Variance **5910** 6 | WIP **1350** 6 |

Net: Inventory −30, Finished Goods +24, Production Variance (expense) +6, **WIP nets to 0** (30 − 24 − 6). Finished
goods posted **once** (by the output movement); the settlement never re-posts FG/WIP. Goods receipt of 10 × RM-1 @
std 5 → Dr Inventory 50 / Cr GRNI 50. Sales issue of 3 × FG-1 @ std 12 → Dr COGS 36 / Cr Inventory 36.

## 5910 VARIANCE CALCULATION + SETTLEMENT

`modules/manufacturing/productionVarianceSettlement.ts` → `settleProductionVariance(order, ctx)`: gathers the
order's own production movements (classic path `referenceRecord == order.id`; MES path `referenceRecord ∈` the
order's execution ids), then

```
variance = Σ(consumption value)  −  Σ(output value)   [both at standard cost, from the movements themselves]
```

`variance > 0` (unfavourable) → Dr 5910 / Cr WIP; `variance < 0` (favourable) → Dr WIP / Cr 5910; `variance == 0` →
no entry. **Variance-only** — it clears exactly the residual WIP and never touches Finished Goods/Inventory (the
per-movement bridge owns the FG↔WIP move), so it can never double-post. Cost comes only from the order's own
movements; no independent costing here.

## GRNI OWNERSHIP (single owner)

The **movement ledger** owns GRNI accrual: a goods-receipt `receive` movement (now standard-costed) posts
Dr Inventory 1300 / Cr GRNI 2150 through seam #1. The document-adapter's `procurement-receipts.postOn.received`
(which would also accrue GRNI) remains **dormant** (it fires only on `status_changed`/`created`, while the GR post
emits `updated` — the Session 2 finding, #96), so there is exactly **one** GRNI accrual per receipt. Proven: a
receipt yields exactly one 2150 credit line. Formally retiring the dormant adapter spec stays in #96's scope; there
is no duplicate GRNI recognition today.

## IDEMPOTENCY + ACCOUNTING SAFETY

- **Movement GL**: keyed `MOV-<movementId>`; `applyGlDerivedEntries` skips an existing entry number → re-firing a
  movement's `onChange` never double-posts (tested: receipt Dr Inventory stays 50, not 100).
- **Variance settlement**: keyed `VAR-<orderId>` → replaying the settlement, or re-updating a completed order,
  never posts a second variance (tested at the seam AND end-to-end through the order `onChange`).
- **Tenant isolation**: the settlement reads scope-bound stores; under another tenant it sees no movements and posts
  nothing (tested). **Best-effort/contained**: the completion settlement is wrapped so a GL failure never unwinds
  the physical completion. **Authorization**: unchanged — the seam still asserts `inventory:manage`; the receipt
  path still asserts its own scope. No security/tenancy/governance control weakened.

## NEW / UPDATED TESTS

`modules/manufacturing/productionCostingAndVariance.test.ts` (renamed from the Session 5 reproduction; **13/13**):
- A — seam costing: goods receipt @ std + **one GRNI owner**; production consumption → WIP @ std; production output
  → FG @ std; sales issue → COGS @ std; **zero-value** (no standard cost → movement records, no GL); movement
  **idempotency** (re-fire → no double-post).
- B — settlement: unfavourable (Dr 5910 6, WIP nets 0, FG posted once), favourable (Cr 5910 4), zero-variance no-op,
  settlement **idempotency** (replay → one VAR entry), **tenant isolation**.
- C — end-to-end: completing an order via the real `onChange` posts the 5910 variance once; re-updating does not
  duplicate it.
- Control: an internal reservation posts no GL even though costing now runs (internal moves stay GL-neutral).

## RESULTS

| Check | Result |
|---|---|
| Session 5-Fix tests | **13/13** |
| Negative control (neuter seam costing + settlement math → **9 failed**; restore → 13/13) | **load-bearing, proven** |
| Blast radius — all `src/main/enterprise` | **161 files / 1277 passed** |
| Blast radius — `src/main/medicalDevice` + `src/main/erp` (other seam importers) | **10 files / 208 passed** |
| `tsc` node + web | **exit 0** |
| ESLint (all touched files) | **clean** |
| `electron-vite build` | **exit 0** |

No existing manufacturing/inventory/finance/medicalDevice/erp test regressed — confirming the central costing
change is internally consistent (domain tests that don't wire the journal keep their no-op GL; the seam #1 test uses
an explicit cost, still respected).

## FILES CHANGED

```
MOD  src/main/enterprise/modules/inventory/postMovement.ts                     central standard-cost resolution
NEW  src/main/enterprise/modules/manufacturing/productionVarianceSettlement.ts variance-only per-order settlement (5910)
MOD  src/main/enterprise/modules/manufacturing/productionOrderModule.ts        onChange settles variance on completion
REN  …/productionVarianceGap.test.ts → productionCostingAndVariance.test.ts    reproduction → fixed-behavior suite (13)
NEW  certification/ERP-SESSION5-FIX-STANDARD-COST-VARIANCE-EVIDENCE.md          this document
```

## SUCCESS CRITERION

Inventory, production costing, WIP, finished-goods valuation, GRNI, sales issue, GL posting, and production-variance
are now internally consistent under the standard-cost model, with executable evidence and **no duplicate posting
paths** (movement GL keyed `MOV-<id>`; variance keyed `VAR-<orderId>`; GRNI single-owner). **Session 5-Fix GREEN.**

## REMAINING (recorded, not blocking)

- The dormant document-adapter completion spec (`documentSpecs.ts:157-162`) and `procurement-receipts.postOn` are
  formally retired under #96 (Session 2 posting-ownership) — they are inert today, so no duplicate posting exists.
- The MES execution path is covered by the same `onChange` settlement (it emits an order update on completion); the
  end-to-end pin drives the classic completion. A dedicated MES end-to-end variance pin is a follow-up.
