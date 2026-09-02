# ERP SESSION 27 — ORDER-TO-CASH (ShipSalesOrder) ON THE CANONICAL PATH

**Baseline:** Session 26 (`7cc44cb`).
**Status:** 🟢 **GREEN** — governed sales-order shipment on the live path, reusing the existing sales-order + inventory engine; no invented policy; concurrency reproduced-first (no unprovable guard). 🟡 packaged-macOS GUI acceptance carried forward. **No frozen surface touched.**

## A · BASELINE VERIFICATION

HEAD `7cc44cb`, branch `cert/data-import-cst-integration`, in sync with origin (0/0 at start). Import graph: one canonical `dispatchCommand` / durable journal / adapter / application boundary. `sales-orders` module live-registered (`enterprise/index.ts:1261`).

## B · POLICY DISCOVERY / POLICY GATE

Inspected `sales/orderModule.ts`, `orders.ts` (`orderActionPatch`, `OrderAction`, `OrderStatus`), and `sales/inventoryLink.ts`. **The full-shipment behavior is DEFINED + LIVE — nothing invented:**
- **Status machine** — DEFINED: `orderActionPatch('ship', order)` returns a patch only from a shippable status; a cancelled / already-shipped / closed order returns `null` → refused. This is the ship-once + no-ship-cancelled invariant, enforced by the existing state machine (`ACTION_TARGET`).
- **Inventory effect** — DEFINED: `shipOrderStock` issues `orderedQty` on-hand (an `issue` movement via the shared `postStockMovement` seam) and releases any active reservation. The stock ledger stays DERIVED from the immutable movement journal — no shadow balance, no `stock -= X`.
- **Oversell** — DEFINED as ALLOWED: the ledger may go negative when oversold (the repo posts the issue regardless of on-hand). Therefore **no available-stock block was invented** — the "cannot use unavailable inventory" invariant is only asserted where the repo actually enforces it, and here it does not.
- **Authority** — DEFINED: the sales-order module's write permission `sales:manage` governs shipment.

**UNDEFINED → deliberately OUT OF SCOPE, not invented (no memo required — the slice does not need them):** partial shipment (the `ship` action ships the whole `orderedQty`, all-or-nothing), backorders, split shipments, carrier/tracking, shipping cost, and any separate shipment-approval threshold (the module defines none for `ship`). None were implemented. Downstream O2C (invoice / AR / cash receipt) is explicitly out of scope for this slice.

## C · ERP SLICE IMPLEMENTED

`ShipSalesOrder` — ships an EXISTING pending sales order through `platform:command.dispatch`, routing the existing `ship` action: status-machine guard → `issue` movement + reservation release. Deny-by-default: an unshippable order is refused by the state machine, never forced.

## D · EXISTING INFRASTRUCTURE REUSED

Sales-order engine (`orderActionPatch` guard + `shipOrderStock`), the stock-movement journal + `deriveStockLedger`, the Session-18 durable journal, `governanceStore` audit, and the S22 live IPC channel + `ElectronClientAdapter` + application boundary + command bus. No new shipment/fulfillment/inventory store, no new engine.

## E · CANONICAL IPC PATH

renderer → preload → `platform:command.dispatch` → `runSecureHandler` → `ElectronClientAdapter` → Application Boundary → command bus → authorization (`sales:manage`) → route → `EnterpriseModuleAction(sales-orders, 'ship')` → `orderActionPatch` guard → `shipOrderStock` (issue + reservation release) → durable journal (`SalesOrderShipped` event + outbox) → audit → response. No parallel shipment path.

## F · AUTHORIZATION · G · APPROVAL/WORKFLOW

Two-layer: `requireAuth` at the channel + fine `ctx.authorize('sales:manage')` in the command bus. The advanced approval engine is unchanged; no shipment-specific approval threshold was invented (the repo defines none for `ship`). The order status machine is the gate that a non-shippable order cannot ship.

## H · INVENTORY EFFECT

Proven through the live bridge: shipping a pending order for `orderedQty=40` against on-hand 100 posts exactly one `issue` movement and the derived on-hand becomes 60. The ledger stays the single source of truth (no mutable balance). Reused verbatim; no chart/costing/valuation rule invented (COGS/valuation posting, if any, is the existing movement bridge's, untouched).

## I · IDEMPOTENCY

100 concurrent SAME-key ships → exactly ONE `issue` movement + one journal record (durable single-flight); a subsequent same-key call replays (no second shipment).

## J · CONCURRENCY (reproduce-first; no unprovable guard)

Two DIFFERENT-key ships of the same order → **exactly one succeeds** (the second is refused by the status machine — the order is already `shipped`). Reproduced-first with a **12× loop → 0/12 double-ships**: the status read (`orderActionPatch`) and the status write (`store.update` to `shipped`) are synchronous, completing before the `await shipOrderStock` yield, so the event loop serializes concurrent same-order ships and the invariant holds **without** a lock. Per "no unprovable guard / incidental protection is not a control," **no serialization latch was added**; the safety is recorded as incidental (a future change introducing an `await` between the status read and the status update must add a per-(tenant, order) latch — the S24 pattern).

## K · TENANT ISOLATION

`claimedTenantId` ≠ resolved principal → TENANT_SCOPE_VIOLATION, no shipment. A foreign-tenant order is invisible through the tenant-scoped order store → NOT_FOUND, refused. Renderer-supplied tenant never authoritative.

## L · SECURITY NEGATIVE CONTROLS (load-bearing; byte-identical restore, verified)

- **NC-A**: weaken `ShipSalesOrder` permission → `sales:read` → the UNAUTHORIZED test fails (shipment succeeds without `sales:manage`).
- **NC-B**: defeat the order status guard (`if (!patch)` → never) → the RE-SHIP test AND the CANCELLED test both fail (a shipped/cancelled order ships, second issue movement appears).
- **NC-D**: defeat the command idempotency key (`+ Math.random()`) → the 100-concurrent-same-key test fails (>1 shipment).

(NC-C tenant scope is the same `applicationService` check proven load-bearing in S22/S24 and re-exercised by the S27 tenant tests.) All three mutated files restored byte-identical (`orderModule.ts` shows no diff vs HEAD; `domainCommand.ts` / `commandBus.ts` diffs are the S27 additions only; no `.bak` files; S27 suite re-confirmed 9/9 after NC cycling).

## M · RESTART RECOVERY

`journal.reload()` preserves the outbox and replays the key to the original shipment result — no second economic effect. The order status + stock movements are durable (atomic tmp+rename stores).

## N · EVENT / OUTBOX / AUDIT

`SalesOrderShipped` event + pending outbox in the durable journal; audit via `governanceStore`. **No auto-rollback**: shipping issues a real inventory movement; reversing it is a governed operation, never a silent soft-delete. At-most-once is guaranteed by the status machine — a commit-failure retry finds the order already `shipped` and is refused, not re-executed.

## O · UI / LIVE BRIDGE

Proven through the real `runSecureHandler` (renderer-equivalent). A dedicated on-screen "Ship" control + the packaged-macOS GUI click remain the operator step (harness `e2e/platformCommandLive.e2e.cjs` pattern) — honestly pending, not claimed GREEN.

## P · ARCHITECTURE / IMPORT AUDIT

`platform/command` stays Electron-free. No `domain→Electron/React/renderer`, no `AI→database`, no `renderer→database`. One canonical of each engine; the legacy `enterprise:module.action('sales-orders','ship')` path remains as compatibility. ORDERS_MODULE_ID reused (no new id); no second command bus / journal / inventory store introduced.

## Q · TESTS

`session27SalesShipment.test.ts` (9, live via `runSecureHandler`): ships a pending order (status shipped + one issue movement + on-hand 100→60 + event/outbox/audit); cannot ship a CANCELLED order; cannot RE-SHIP (no second issue); UNAUTHORIZED without `sales:manage`; TENANT_SCOPE_VIOLATION on a foreign claim; foreign-tenant order NOT_FOUND; 100-concurrent same-key single-effect + replay; two-different-key concurrency invariant (one ships); restart replay.

## R · TYPECHECK · S · LINT · T · BUILD

typecheck node+web clean; eslint clean (changed files); `npm run build` (electron-vite) ✓.

## U · REGRESSION TOTALS

Full main (sharded 4×): **946 files · 9906 passed · 7 skipped · 0 failed** (S26 baseline 945/9897; delta +1 file/+9 tests = `session27SalesShipment.test.ts`). UI: **70 files · 405 passed**.

## V · FROZEN SURFACES

None touched. Only non-frozen `platform/command/{domainCommand,commandBus}.ts` + the new test changed. `certification/baseline.json` not staged (custody).

## W · REMAINING YELLOW

Packaged-macOS GUI acceptance (operator step); an on-screen Ship control (transport is proven; the button is the last renderer step). Downstream O2C (invoice → AR → cash receipt) is the next candidate slice, not this one.

## X · POLICY DECISIONS REQUIRED

None blocking this slice. Recorded as out-of-model (not invented, available for a future session if the operator wants them): partial/split shipment, backorders, carrier/tracking, shipping cost, shipment-approval threshold. The Order-to-Cash chain now covers CreateSalesOrder → **ShipSalesOrder** (order → shipment / inventory issue) on the governed path.

## Status: 🟢 GREEN (governed shipment slice) / 🟡 packaged-GUI pending macOS

`ShipSalesOrder` is a real governed end-to-end capability: authorization → status-machine guard (no ship of a cancelled/shipped order) → inventory issue + reservation release → durable event/outbox/audit, with idempotency, tenant isolation, and a proven-holding concurrency invariant. No platform rebuild, no duplicate engine, no invented policy, no frozen change.
