# SESSION 81 — INVENTORY AGING + ATP INTELLIGENCE CERTIFICATION

**Class:** S79 Tier-1 governed ERP read/intelligence capability (Inventory Aging + Available-to-Promise). Baseline S80b GREEN (`52f1838`). Release track PAUSED.

## What shipped

Two governed, immutable, point-in-time **snapshot modules** modelled exactly on Finance → Payables Aging (`apAgingModule`), reading the authoritative inventory ledger + open POs and mutating nothing:

- **Inventory Aging** (`inventory-aging`) — on-hand bucketed by physical age (FIFO layers) per SKU + warehouse: 0–30 / 31–60 / 61–90 / 90+.
- **ATP** (`inventory-atp`) — on-hand / reserved / available / incoming / ATP per SKU + warehouse (available = on-hand − reserved; ATP = available + incoming; incoming = open POs).

Reached through the **existing** `enterprise:module.*` governed channels + existing UI (no new channel, no redesign). RBAC `inventory:read`/`inventory:manage`; tenant-scoped by `EnterpriseRecordStore`.

## Canonical sources reused (no duplicates)

`productComputedStock`/`calculate*` (on-hand/reserved/available), the `inventory-movements` immutable ledger, `reservationModule`, open `procurement-orders` + `parsePurchaseOrderLines`, the `apAgingModule` snapshot pattern, `EnterpriseRecordStore` tenancy, module RBAC. **No** second inventory ledger / reservation engine / ATP engine / event bus / tenant resolver / notification engine.

## Policy discipline

No invented thresholds/valuation/allocation/priority/safety-stock rules. Buckets = the repo's AP 30-day cadence adapted; incoming-status set = {approved, sent} (the complement of the unambiguous draft/received/cancelled exclusions). Aging method = FIFO physical layers (universal convention). Lot/serial aging is an honest ledger-granularity boundary (movements carry no lot field) — Tier-2, not faked. Full rationale: `DECISION-MEMO-S81-INVENTORY-AGING-ATP.md`.

## Frozen footprint & gate

Exactly **4 additive lines** in frozen `enterprise/index.ts` (2 imports + 2 `registerModule`), applied under the literal token `AUTHORIZED: FG-S81 — …` (`FG-S81-INVENTORY-INTELLIGENCE-REGISTRATION.md`). gate-detector: `enterprise/index.ts` the only frozen file in the changeset. Isolated frozen commit `c8d3d98`. `certification/baseline.json` custody-protected — NOT re-recorded/staged (operator's call). Everything else non-frozen.

## Focused tests (18/18 green — `inventoryIntelligence.test.ts`)

Pure model: bucket boundaries (30/31/60/61/90/91), single-receipt aging, FIFO oldest-consumed-first, transfer aging between warehouses, empty state, **reconciliation invariant** (Σ per-warehouse on-hand == `calculateCurrentStock`), ATP identity, incoming status set, no-double-count, multi-line PO, cross-warehouse, shortfall, zero-net FIFO. Governed modules (through `buildModuleHandlers`): RBAC (`inventory:manage`/`inventory:read`), empty snapshot honesty, aging bucketing + **ledger-unchanged read-only proof**, ATP derivation, draft-PO-not-incoming, snapshot immutability, **tenant isolation** (one bound store, scope switched — B sees nothing of A).

## Verified in the Linux sandbox

gate-detector (only `enterprise/index.ts` frozen) · typecheck node+web **0** · eslint clean · S81 **18/18** · registry/backup/coverage/S81 **75/75** · inventory+procurement+apAging regression **156/156**.

## PENDING the operator's Mac (not claimed GREEN)

Full main suite · full UI suite · build · real-Electron acceptance journey `e2e/s81InventoryIntelligenceJourney.e2e.cjs`:
create product → receive → reserve (governed) → ATP (on-hand/reserved/available/ATP) → open PO (incoming) → ATP changes (incoming added) → goods receipt (receiveGoods → post) → ATP changes correctly (no double count) → aging future/today as-of → ledger read-only → governed tenant-scoped reads. Run:

```
cd apps/desktop
env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s81"
NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s81InventoryIntelligenceJourney.e2e.cjs
npx vitest run --exclude '**/releaseDiscipline.test.ts'   # main, minus the paused-release guards (class D)
npx vitest run --config vitest.ui.config.ts               # UI
```

## Mac validation (operator, 2026-09-03) — GREEN

- Full UI suite: **455/455**.
- Full main suite (excluding the two class-D `releaseDiscipline` paused-release guards): **all passed** — clean of S81 failures.
- Real-Electron acceptance journey `e2e/s81InventoryIntelligenceJourney.e2e.cjs`: **passed** on the alternate release build (`out-seam-s81`), fresh isolated profile, every step through the governed `enterprise:module.*` bridge — create → receive → governed reservation → ATP 70 → open PO → ATP 120 (incoming added) → canonical goods receipt (`receiveGoods`→`post`) → ATP 120 with on-hand 150 / incoming 0 (no double count) → aging future(90+)/today(fresh) → ledger read-only → tenant-scoped reads.

The two `releaseDiscipline` failures remain the standing paused-release-track state (class D, not S81).

## Status

**S81 = GREEN — Inventory Aging + ATP VERIFIED end-to-end in the real Electron runtime.** Non-frozen core + FG-S81 registration (4 additive lines, one frozen file) + real-Electron journey all proven. `certification/baseline.json` untouched. Release track PAUSED. S82 not started.
