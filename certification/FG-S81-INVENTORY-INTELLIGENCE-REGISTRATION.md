# FG-S81 — Register the governed Inventory Aging + ATP modules

**Gate class:** additive module registration in the frozen composition root `enterprise/index.ts`.
**Exactly mirrors** how every ERP module in this repo was registered (apAgingModule, paymentReversalModule, reservationModule…). **Frozen footprint = 4 additive lines in ONE frozen file. No other frozen surface.**

## The literal token required (nothing frozen changes without this, verbatim)

```
AUTHORIZED: FG-S81 — register inventory-aging + inventory-atp modules in enterprise/index.ts (2 imports + 2 registerModule lines), per gate doc
```

Silence / enthusiasm / a descriptive "looks good" is **not** consent — only the exact token above.

## The verbatim diff (additive only)

**File:** `apps/desktop/src/main/enterprise/index.ts` (FROZEN)

**(a) Imports** — after the existing inventory instance imports (near line 217, beside `reservationModule` / `inventoryValuationModule` / `serialModule`):

```ts
import { inventoryAgingModule } from './modules/inventory/inventoryAgingModuleInstance';
import { atpModule } from './modules/inventory/atpModuleInstance';
```

**(b) Registration** — in `initEnterpriseModules`, immediately after the existing inventory `registerModule(...)` block (after `registerModule(serialModule); // Inventory → Serial Units …`):

```ts
  registerModule(inventoryAgingModule); // Inventory → Aging (immutable point-in-time on-hand-by-age snapshots; reads the ledger, mutates nothing)
  registerModule(atpModule); // Inventory → ATP (on-hand/reserved/available/incoming/ATP per SKU+warehouse; reads ledger + open POs, mutates nothing)
```

No other line changes. No type, channel, contract, or runtimeCore change.

## Threat analysis (both directions)

- **What it grants:** two READ-ONLY snapshot modules become reachable through the *existing* governed `enterprise:module.*` channels + the existing UI. Both are RBAC-gated `inventory:read` / `inventory:manage` and tenant-scoped by `EnterpriseRecordStore` (no new authority path, no new channel, no new tenant resolver).
- **Mutation surface:** none in inventory — both modules only WRITE their own snapshot records (immutable; regeneration refused). They READ the injected `stockMovementModule.store` + `purchaseOrderModule.store`. The stock ledger is provably untouched (pinned: ledger byte-identical after a snapshot).
- **AI reach:** none — no AI path writes these stores; AI may only read the resulting governed intelligence through existing read channels.
- **Removing it:** reverting the 4 lines removes the two modules from the registry; nothing else depends on them (no other file imports the instances except this registration).
- **Injection:** the modules resolve tenant only through the store's `scopeOrDeny` (server-side); the renderer supplies no tenant.

## Verification plan (after the token)

1. Change-control choreography: clean checkpoint → `freeze-baseline.sh` re-record → `verify-freeze.sh` INTACT #1 (committed) → apply the 4 lines → suites green → isolated frozen commit → re-record → INTACT #2.
2. gate-detector: `enterprise/index.ts` is the ONLY frozen file in the changeset.
3. Full main suite + full UI suite + typecheck node/web + eslint + build.
4. Real-Electron acceptance journey (`e2e/s81InventoryIntelligenceJourney.e2e.cjs`): create inventory → reserve via the governed reservation workflow → generate ATP (observe on-hand/reserved/available/ATP) → receive incoming via the canonical PO/goods-receipt workflow → generate ATP again (ATP changes correctly) → create an aged state → generate aging (aging intelligence) → tenant isolation.
5. `certification/baseline.json` never staged; no push/tag/notarize; release track PAUSED.

## Non-frozen work already landed (this commit, build-ready, gate-detector PROCEED)

- `inventory/inventoryIntelligenceModel.ts` — pure aging (FIFO layers) + ATP + incoming.
- `inventory/inventoryAgingModule.ts` + `inventoryAgingModuleInstance.ts`.
- `inventory/atpModule.ts` + `atpModuleInstance.ts`.
- `inventory/inventoryIntelligence.test.ts` — 18 focused tests (green).
- `DECISION-MEMO-S81-INVENTORY-AGING-ATP.md`.

**⛔ STOP: no frozen edit until the exact FG-S81 token arrives.**
