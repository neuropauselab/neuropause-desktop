# ERP SESSION 24 — INVENTORY POSTING + STOCK-LEDGER HARDENING (concurrent over-receipt closed)

**Baseline:** Session 23 (`963c73c`).
**Status:** 🟢 **GREEN** — a real concurrency defect was reproduced and hardened on the canonical governed path, reusing the existing inventory ledger. **No frozen surface touched; no duplicate store/engine; no invented policy.** 🟡 packaged-macOS GUI acceptance carried forward as an operator step.

## A · SESSION 23 VERIFICATION (independent)

`PostGoodsReceipt` route present (`commandBus.ts:186`), the command/event/permission maps carry it, and the tree had no uncommitted source drift. One canonical of each canonical piece (re-confirmed in S23). S23 live path intact.

## B · INVENTORY SOURCE OF TRUTH (inspected)

The inventory balance is **derived**, not stored: `deriveStockLedger(movements)` (packages/shared/types/inventory.ts) reduces the immutable stock-movement journal into per-`(product, warehouse)` `{ onHand, reserved, available }`. There is **no mutable balance store** and no `stock.quantity += X` anywhere in `enterprise/modules/inventory` (grep-verified). `reservationModule` computes `available = on-hand − reservations` from the same ledger. Valuation = product `standardCost` (defined). Kept exactly this way — the movement journal remains the single source of truth.

## C · GOODS RECEIPT → STOCK (provenance)

`PostGoodsReceipt` (S23) → the existing `postMultiLineReceipt` posts one valued `receive` movement per line via `postMovementLinesAtomic` (all-or-nothing). Each movement carries `referenceModule='procurement-receipts'` + `referenceRecord=<GR id>`; the GR carries `purchaseOrder` + `lines`, so the trace Tenant → Warehouse → SKU → PO → PO Line → Goods Receipt → Receipt Line → Movement is reconstructable. No anonymous stock changes.

## D · THE DEFECT — REPRODUCED FIRST (Part 6, "critical")

The cumulative no-over-receipt check is a **read-then-write**: read the PO's prior `received` receipts → check cumulative ≤ ordered → post. Under **concurrent, DIFFERENT-key** receipts of the same PO (which the durable idempotency journal cannot dedupe), each reads prior=0 and all post. Reproduced: PO qty 100, three concurrent different-key receipts of 100 each → **on-hand 300** (all accepted). Idempotency alone is provably insufficient for the business invariant.

## E · THE FIX — per-(tenant, PO) serialization latch (reuse, non-frozen)

`goodsReceiptModule.ts` now serializes receipt posting per `(tenant, PO)` with an in-memory single-flight chain — the **Session-15 canonical-chart-latch pattern**, not a new mechanism. The cumulative check + post run atomically with respect to other receipts of the SAME PO, so a second receipt runs only after the first's `received` state is committed and is therefore counted. It enforces the **already-defined** invariant under concurrency — **no new policy, no valuation/tolerance invented**. Different POs never contend (the key includes the PO), so throughput off the hot PO is unchanged. `postMultiLineReceipt` is now a thin serialized wrapper over the unchanged body (`postMultiLineReceiptSerial`).

## F · INVENTORY INVARIANTS PROVEN (Part 5 A–G, through the live bridge)

`session24InventoryLedger.test.ts` + `session23GoodsReceipt.test.ts` (both live via `runSecureHandler`):
- **A–D**: PO 100, receive 40 → on-hand 40; receive 60 → on-hand 100; receive 1 more → REFUSED, on-hand unchanged.
- **E (duplicate)**: re-posting a `received` receipt refused (module status guard), no second movement.
- **F (tenant)**: foreign-tenant claim → TENANT_SCOPE_VIOLATION, no effect.
- **G (authorization)**: without `procurement:manage` → UNAUTHORIZED, no effect, GR stays `pending`.
- Over-receipt (defined invariant) → refused (CONFLICT).

## G · CONCURRENCY (the hardened case)

After the fix: 3 concurrent different-key receipts of 100 against PO-100 → **exactly one accepted, on-hand 100** (was 300). Same-key 100-concurrent → one economic effect (single-flight) + durable replay. Both idempotency AND the business invariant now hold under concurrency.

## H · ATOMICITY (Part 7)

Movements post all-or-nothing (`postMovementLinesAtomic`); the receipt reaches `received` only when the movements posted. **No auto-rollback** (unchanged from S23): a posted receipt is a real inventory movement whose reversal is a governed decision, never a silent soft-delete — the `received` status guard makes a commit-failure retry a refusal, not a double effect. The Session-18 durable journal still records the command event/outbox.

## I · INVENTORY BALANCE + RESTART (Part 8)

Balance is derived (`deriveStockLedger`) — proven: after a receipt, on-hand tracks the movements; after reloading the movement store from disk (restart), the recomputed ledger is **identical** (movements are durable via atomic tmp+rename; nothing mutable to desync).

## J · INVENTORY UI (Part 9)

Not built this session (no fake dashboard). The derived balance is reachable through the existing inventory module read surface; the exact next UI integration is: a renderer view calling the read path to display SKU / warehouse / on-hand / movement history, each traceable to persisted movements. Recorded as the next UI requirement, not shipped disconnected.

## K · IPC STANDARD · L · AI GOVERNANCE · M · APPROVAL

Unchanged and reused. `PostGoodsReceipt` rides the live `platform:command.dispatch` (no module bypass). AI would use the identical `AIAdapter` → command bus → `procurement:manage` gate; no direct inventory mutation, no DB handle. The advanced approval engine (subsystem B) is untouched and remains canonical; delegation/escalation/expiration not invented.

## N · THREE-WAY MATCH — POLICY DECISION REQUIRED (Part 13 STOP, honored)

Not implemented. The PO + Goods Receipt + Supplier Invoice primitives exist and the exact ≤-received invariant + GRNI are defined (S11/S12), but any invoice **tolerance** (quantity/price/date %) is **UNDEFINED**. **THREE-WAY MATCH TOLERANCE POLICY DECISION REQUIRED** — no tolerance logic was invented; the next procurement slice is blocked on this ruling.

## O · ACCOUNTING (Part 14)

Reused the existing GRNI implementation (Dr Inventory / Cr GRNI at standard cost) via the movement GL bridge. No new chart/tax/valuation/currency/fiscal rules.

## P · TENANT ISOLATION (Part 15)

Server-resolved tenant; the GR/PO/movement are all tenant-scoped through the bound registry. Foreign-tenant claim refused (TENANT_SCOPE_VIOLATION). Renderer-supplied tenant never authoritative. (The latch key is tenant-scoped, so tenant A's receipts never serialize against tenant B's.)

## Q · NEGATIVE CONTROLS (each load-bearing; byte-identical restore, sha-verified)

- **Latch NC**: replace the serialization chain with parallel execution → the concurrency invariant fails again (on-hand > 100) → the latch is load-bearing.
- (Carried from S23, re-affirmed via the S24/S23 suites): permission weakening → UNAUTHORIZED test fails; idempotency defeat → single-effect test fails; module double-post guard removal → no-duplicate-receipt test fails.
All restored byte-identical.

## R · RESTART / RECOVERY (Part 17)

Balance derives from the durable movement journal; reloading the store reproduces identical on-hand (§I). The command journal's durable idempotency + event + outbox persist across restart (S18/S23). No invalid partial state.

## S · PERFORMANCE (Part 18)

The latch adds a per-PO await-chain only when multiple receipts hit the SAME PO concurrently; different POs are unaffected. No measurable regression (full-suite runtimes unchanged from S23).

## T · ARCHITECTURE / IMPORT AUDIT (Part 19/22)

`goodsReceiptModule` stays in the enterprise domain layer (no Electron/React/renderer import; the latch is plain in-memory Promises). `platform/*` unchanged and still Electron-free. No `AI→database`, no `renderer→database`. One canonical of each engine — no second inventory/balance/approval/transaction/event/outbox/audit system.

## U · LEGACY PATH (Part 20)

The legacy `enterprise:module.action('post')` path still reaches the same (now-serialized) `postMultiLineReceipt` — it benefits from the same concurrency fix and is left intact as compatibility (not removed).

## V · FULL E2E (Part 21)

`session23GoodsReceipt.test.ts` proves PR→approve→convert→PO→PostGoodsReceipt→inventory movement + GRNI through the canonical governed path with durable-storage verification; `session24InventoryLedger.test.ts` adds the derived-balance + restart + concurrency invariants. No mocks.

## W · PACKAGED ELECTRON (Part 22)

Unchanged: `e2e/platformCommandLive.e2e.cjs` + runbook remain the macOS operator step. Not run here (Linux sandbox / darwin binary). **Honestly marked pending — not GREEN.**

## X · FULL REGRESSION (Part 23)

Full main (sharded 4×): **943 files · 9880 passed · 7 skipped · 0 failed** (S23 baseline 942/9877; delta +1 file/+3 tests = `session24InventoryLedger.test.ts`). UI: **70 files · 405 passed**. Focused S24 suite: 3 passed; S23 suite: 6 passed (through the wrapped function). typecheck node+web clean; eslint clean; `electron-vite build` ✓.

## Y · FILES CHANGED

Non-frozen only: `apps/desktop/src/main/enterprise/modules/procurement/goodsReceiptModule.ts` (per-PO serialization latch + function split), NEW `apps/desktop/src/main/ipc/handlers/session24InventoryLedger.test.ts`, this evidence doc. **No frozen surface touched; `baseline.json` not staged.**

## Z · COMMIT SHA

One commit (see git log); the user pushes from the Mac.

## AC · REMAINING RISKS / DECISIONS

1. **THREE-WAY MATCH TOLERANCE POLICY DECISION REQUIRED** (§N) — blocks the next procurement slice (supplier invoice matching).
2. **Packaged-macOS GUI acceptance** — operator step, carried forward.
3. **Inventory UI integration** (§J) — recorded next requirement, not built.
4. Inventory valuation beyond standard cost, reversal policy, delegation/escalation/expiration — all undefined; not invented.
5. The latch is single-process/event-loop scoped (matches the app's single-process model, consistent with the constitution's concurrency scope); a multi-process deployment would need a durable per-PO lock — recorded, not needed today.

## AD · STATUS: 🟢 GREEN (governed inventory slice hardened) / 🟡 packaged-GUI pending macOS · 1 POLICY DECISION REQUIRED

Goods Receipt → inventory movement → derived balance is a real governed end-to-end capability on the canonical path, and the concurrent-over-receipt business invariant now holds (reproduced → hardened → load-bearing NC). No platform rebuild, no duplicate store/engine, no invented policy, no frozen change. What requires a business decision is stated plainly: three-way-match invoice tolerance.
