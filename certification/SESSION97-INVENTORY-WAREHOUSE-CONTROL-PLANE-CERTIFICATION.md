# SESSION 97 — INVENTORY + WAREHOUSE END-TO-END CONTROL-PLANE CERTIFICATION

**Class:** control-plane certification + ONE canonical fix. **Outcome: the existing inventory/warehouse control plane is certified as the CANONICAL stock authority used by P2P, O2C, and future planning — the stock-movement ledger is authoritative; the product master materializes it; reservations, ATP, receiving, and shipping all flow through it.** One real defect was reproduced and fixed (F-S97-1, YELLOW). Reuses only existing stores/reconciler/reservation path/ATP calculator; no new engine. No frozen change; no FG-S97 token. Baseline S96 GREEN. Release track PAUSED.

## 1. Stock authority (source-wins, asserted not assumed)

The **stock-movement ledger is authoritative.** A product's `currentStock`/`reservedStock`/`availableStock` are MATERIALIZED from the full movement history by the reconciler (`stockMovementModule.reconcileProduct` → `productComputedStock`), always recomputable:
- `currentStock = Σ (+receive/production_output/return, −issue/production_consumption, ±adjustment; void/transfer/reservation = 0)`
- `reservedStock = max(0, Σ reservation − reservation_release)`
- `availableStock = currentStock − reservedStock` (may go negative when oversold — a DEFINED behavior)
- `ATP = availableStock + incoming` (incoming = outstanding qty on OPEN POs, approved/sent; `atpModule` per DECISION-MEMO-S81)

The certification asserts the invariant `product.{currentStock,reservedStock,availableStock} == ledger derivation` after every operation (via the shared `calculateCurrentStock`/`calculateReservedStock`).

## 2. The finding — F-S97-1 (YELLOW, fixed)

The ledger's declared immutability ("history never rewritten") was enforced on EDIT (validate) but NOT on DELETE: `list()` excludes `deleted`, so soft-deleting a POSTED movement silently changed on-hand stock (reproduced: receive 100 → delete → on-hand 0). **Fixed** by extending the existing S61 `ECONOMIC_DELETE_GUARD` to `inventory-movements` (a posted movement cannot be deleted — void it or post a compensating movement). Strengthens the module's own invariant; invents nothing. Full write-up: DECISION-MEMO-S97.

## 3. Control matrix (RED / YELLOW / GRAY / POLICY-OPEN)

| # | Control | Status | Evidence |
|---|---|---|---|
| 2 | Stock authority: product fields == ledger derivation after every movement; reservation not phantom on-hand | GREEN | `assertAuthority` after receive/reserve/issue/release |
| 3 | Receiving: PostGoodsReceipt = one receive movement, stock +q, GR↔PO, replay no dup, tenant | GREEN | one receive; replay deduped; forged tenant CROSS_TENANT_CLAIM |
| 4 | Issue/shipping: ShipSalesOrder = one issue, stock −q, lineage; raw-door + status-edit + 2nd-ship + replay refused | GREEN | one issue movement; all bypasses refused |
| 5 | Reservations: reserve raises reserved / lowers available, on-hand unchanged; duplicate refused; release on cancel | GREEN | reserved 25 / available −25 / on-hand unchanged; dup refused; cancel releases |
| 5-pol | Over-reservation tolerance / reservation expiry | POLICY-OPEN | undefined in source; NOT invented (over-issue → available negative is the DEFINED oversell behavior) |
| 6 | ATP = available + incoming, across on-hand-only / reserved / open-PO / after-receipt / after-ship; ATP mutates no stock; immutable snapshot | GREEN | ATP totals per stage; on-hand unchanged by report; ATP edit refused |
| 7 | Integrity sequence reconciles deterministically from persisted state | GREEN | receipt→reserve→issue→release→receipt: product == ledger at every stage |
| 8a | Immutable ledger: posted movement cannot be EDITED | GREEN | edit of posted quantity refused |
| 8b | Immutable ledger: posted movement cannot be DELETED (F-S97-1) | GREEN (fixed) | delete refused; on-hand unchanged |
| 8c | Unauthorized mutation + forged/cross tenant fail closed | GREEN | denied inventory:manage refused; tenant-B cannot see product/ledger |
| 9 | Restart durability: ledger + stock + reservations + ATP survive; replay no dup | GREEN | rebuild over the same stores (flushed); ledger + materialized product recover |
| 10 | Cross-module: P2P receipt + O2C issue drive the SAME ledger with correct signs | GREEN | 100 − 25 = 75 on the one shared ledger |
| 11 | AI/advisory cannot receive/issue/reserve/mutate | GREEN | advisory (no inventory/sales/procurement manage) refused on direct create + governed ship |

**No RED, no GRAY. One YELLOW (F-S97-1) reproduced and FIXED. Two POLICY-OPEN items** (over-reservation/expiry; and — per the directive's list — stock-adjustment thresholds, cycle-count approval, shrinkage, costing, transfer accounting, lot/serial), all deliberately not invented.

## 4. Real-Electron result — GREEN (operator Mac, 2026-09-04)

`out-seam-s97` build → fresh-profile inventory journey with a real restart. **Passed every assertion + RESULT on the first run, exit 0** (33 assertions): FRESH profile, NO seeded state → product master → on-hand materializes the ledger (reconciled to 70) → **P2P receiving: on-hand 70 → 500** (one receive movement) → **reserve 25** (reserved 25, available on-hand−25, on-hand unchanged — no phantom; **duplicate reservation refused**) → **ATP snapshot: available == ledger available, ATP == available + incoming, generating it moved NO stock** → raw-door ship refused → **O2C shipping: on-hand 500 → 460** (one issue movement) → **a posted movement cannot be EDITED** → **F-S97-1: a posted movement cannot be DELETED, on-hand UNCHANGED after the refused delete** → **REAL PROCESS RESTART: on-hand/reserved/available, receive/issue/ledger counts, and ATP all survive.** The F-S97-1 fix is proven live. **GREEN end-to-end.**

## 5. Focused + regression totals

`inventoryWarehouseControlPlane.test.ts` **12/12** (authority invariant; receiving; issue; reservations; ATP; integrity sequence; negatives incl. F-S97-1 reproduce+fix + posted-edit + unauthorized/tenant; restart; cross-module; AI). Regression: inventory + warehouse **174/174**; whole `enterprise` + `platform/command` + `ipc/handlers` **1955/1955** (validates the `moduleRegistry.ts` guard change across the surface). Typecheck node clean; eslint clean. Full main + UI + build + journey PENDING operator Mac.

## 6. Frozen-file changes

**None.** gate-detector PROCEED on all S97 files incl. `moduleRegistry.ts`. `enterprise/index.ts`, `runtimeCore.ts`, `packages/shared`, `commandBus.ts`, `cst/` untouched. No FG-S97 token. `certification/baseline.json` untouched.

## 7. Exact files changed — PRODUCTION vs TEST/DOCS

- **PRODUCTION (1):** `apps/desktop/src/main/enterprise/framework/moduleRegistry.ts` — the F-S97-1 posted-movement delete guard (extends the S61 `ECONOMIC_DELETE_GUARD`).
- **TEST (1):** `apps/desktop/src/main/platform/command/inventoryWarehouseControlPlane.test.ts` (new).
- **HARNESS (1):** `apps/desktop/e2e/s97InventoryWarehouseJourney.e2e.cjs` (new).
- **DOCS (2):** this cert + `DECISION-MEMO-S97-MOVEMENT-DELETE-GUARD.md`.

## 8. Policy gaps (documented, not implemented)

Over-reservation tolerance / reservation expiry; stock-adjustment thresholds; cycle-count approval; shrinkage; costing policy (standard-cost is the defined basis); warehouse-transfer accounting; lot/serial. Each is a future operator-gated decision; none blocks the S97 target.

## 9. Exact commit

One non-frozen commit (production guard + test + journey + memo + cert), recorded on landing.

## 10. Final S97 status — GREEN

**The inventory/warehouse control plane is CERTIFIED and VERIFIED as the canonical stock authority in the real Electron runtime (operator Mac, 2026-09-04).** The ledger is authoritative; the product master materializes it exactly; receiving/shipping each post one movement; reservations and ATP obey the canonical formulas and mutate no stock by themselves; a posted movement is immutable to edit AND delete (F-S97-1 closed and proven live); restart durability, tenant/security, cross-module linkage, and the AI boundary all hold. Proven by 12/12 focused tests + inventory/warehouse 174/174 + enterprise/command/ipc 1955/1955 (sandbox) + the fresh-profile real-Electron journey with a real process restart (33 assertions + RESULT, exit 0). One YELLOW reproduced and fixed with a canonical guard; over-reservation/expiry and the other listed policies remain POLICY-OPEN (not invented). No frozen change; no FG-S97 token; AI advisory-only. `certification/baseline.json` untouched. Release-track files left untouched (paused). Full main suite + build recorded on the operator's run when available.
