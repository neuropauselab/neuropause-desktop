# SESSION 98 — MANUFACTURING END-TO-END CONTROL-PLANE CERTIFICATION

**Class:** control-plane certification + ONE canonical fix. **Outcome: Manufacturing is certified as a governed CONSUMER and PRODUCER of the same canonical inventory + finance control plane — a BOM scales component consumption; the production-order lifecycle (plan → allocate → start → complete) posts real reservation / production_consumption / production_output movements against the authoritative stock ledger and the standard-cost GL (Dr WIP/Cr Inventory, Dr FG/Cr WIP); the WIP variance settles to 5910; and no phantom finished goods can be forged.** One real defect was reproduced and fixed (F-S98-1, YELLOW). Manufacturing has NO domain commands — it is driven through governed module ACTIONS (RBAC + tenant + audit), which this session exercised end to end. Reuses only existing modules/ledger/GL bridge/variance settlement; no new engine. No frozen change; no FG-S98 token. Baseline S97 GREEN. Release track PAUSED.

## 1. Architecture (source-wins, asserted not assumed)

Manufacturing sits ON TOP of the canonical control plane, adding no parallel authority:
- **BOM** (`manufacturing-bom`) is the recipe: components (SKU + qty + waste JSON), yield %, waste %. `componentConsumption(component, productionQty, waste)` scales deterministically.
- **Production order** (`manufacturing-orders`) is the engine. Lifecycle actions are the only door that moves material: `plan` (draft→planned) · `allocate` (planned→released; `postReservation` per component) · `start` (released→running; `postMovementLinesAtomic` production_consumption per component + reservation release) · `complete` (running→completed; `postOutput` finished goods) + `cancel` (releases held reservations).
- **Stock authority is the movement ledger** (S97): `production_consumption` = −on-hand, `production_output` = +on-hand, reservation/release = ±reserved; product fields materialize the ledger. Certification asserts product == ledger derivation after every step.
- **Finance** via the standard-cost bridge: consumption → Dr WIP (1350) / Cr Inventory (1300); output → Dr FG (1360) / Cr WIP; the `completed` `onChange` settles residual WIP to Production Variance (5910). WIP nets to zero after settlement.

## 2. The finding — F-S98-1 (YELLOW, fixed)

The production-order `status` was an ordinary editable field, so the generic edit door could hand-set `status` and bypass the lifecycle movements: editing `draft → running` (no material consumed) then `complete` produced finished goods from **zero** consumed material (a `production_output` / Cr WIP with no Dr WIP → phantom FG + broken WIP), and a direct edit to `completed` even fired the variance GL. **Fixed** by making `status` machine-owned (`readOnly` + a validate hook refusing status edits) — mirroring the sales-order (S45) and stock-movement (S55) guards; the lifecycle actions use raw `store.update` and are unaffected. Full write-up: DECISION-MEMO-S98.

## 3. Control matrix (RED / YELLOW / GRAY / POLICY-OPEN)

| # | Control | Status | Evidence |
|---|---------|--------|----------|
| 2 | BOM recipe governs consumption; order born draft (machine-owned) | GREEN | BOM created; order status='draft'; component qty scales by planned qty |
| 3 | Lifecycle: plan→allocate→start→complete, each status-gated; out-of-order refused | GREEN | every out-of-order transition refused; re-complete refused (one output) |
| 4 | Material: allocate reserves (no phantom on-hand); start consumes; complete yields | GREEN | reserved 10/15, on-hand unchanged; on-hand −10/−15; FG 0→5; product==ledger throughout |
| 5 | WIP/GL: consumption Dr WIP/Cr Inventory, output Dr FG/Cr WIP, variance→5910, WIP nets 0 | GREEN | WIP 110, Inventory Cr 110, FG 60, variance 50, WIP net 0; variance entry once |
| 6 | Immutable production ledger: posted production_consumption cannot be edited OR deleted | GREEN | edit refused; delete refused (S97 economic-delete guard); on-hand unchanged |
| 7 | F-S98-1: production status is machine-owned; edit-door status change refused; no phantom FG | GREEN (fixed) | running/completed edits refused; order stays draft; 0 movements, 0 GL from forged edits |
| 8 | Security: unauthorized manufacturing:manage refused; tenant isolation; advisory AI cannot | GREEN | denied create refused; advisory allocate refused (0 reservations); tenant-B sees nothing |
| 9 | Restart durability: order + movements + stock + WIP/variance GL survive | GREEN | rebuild over stores (flushed); completed stays completed; stock/GL recover |
| 5-pol | Material over-issue tolerance; scrap approval/materiality; production-variance approval; costing methodology; routing/operation approval; cycle-count/stock-adjustment authority; transfer accounting; repair-vs-capex; revenue recognition | POLICY-OPEN | undefined in source; NOT invented (deny/fail-closed unless already defined) |

**No RED, no GRAY. One YELLOW (F-S98-1) reproduced and FIXED. Multiple POLICY-OPEN items** (the directive's list), all deliberately not invented.

## 4. Real-Electron result — PENDING operator Mac

`out-seam-s98` build → fresh-profile manufacturing journey with a real restart (`apps/desktop/e2e/s98ManufacturingJourney.e2e.cjs`). To run on the operator's Mac:

```
cd apps/desktop
env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s98"
NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s98ManufacturingJourney.e2e.cjs ; echo "exit=$?"
```

The journey walks, on a FRESH profile with NO seeded state: master data + BOM → production order (born draft) → out-of-order transitions refused → plan → allocate (RM-1 reserved 10, RM-2 reserved 15, component on-hand unchanged — no phantom) → start (on-hand −10 / −15, two production_consumption movements, reservations released, Dr WIP 110 / Cr Inventory 110) → complete (FG on-hand 0→5, one production_output, Dr FG 60) → variance settlement (Dr 5910 50, WIP nets 0) → F-S98-1 (a status edit to running/completed is REFUSED, no phantom FG) → a posted production movement cannot be deleted → REAL PROCESS RESTART (order stays completed; stock + WIP/variance GL survive). **Only mark S98 GREEN once this passes on a fresh profile with RESULT + exit 0 on the operator's Mac.**

## 5. Focused + regression totals (sandbox)

`manufacturingControlPlane.test.ts` **8/8** (BOM/lifecycle/material/WIP-GL/immutability/F-S98-1/security/restart). Regression: manufacturing + platform/command **262/262**; enterprise + platform/command + ipc/handlers **1963/1963**; full main **10446 passed / 7 skipped / 1 flaky** (the one failure was `auth/loopbackServer.test.ts` — a port-binding flake, green 3/3 in isolation, Class C environmental, no S98 file touches it). Typecheck node clean; eslint clean on the changed files.

## 6. Frozen-file changes

**None.** gate-detector PROCEED on all four S98 files. `enterprise/index.ts`, `runtimeCore.ts`, `packages/shared`, `cst/` untouched. No FG-S98 token. `certification/baseline.json` untouched.

## 7. Exact files changed — PRODUCTION vs TEST/DOCS

- **PRODUCTION (1):** `apps/desktop/src/main/enterprise/modules/manufacturing/productionOrderModule.ts` — the F-S98-1 machine-owned-status guard (readOnly + validate hook).
- **TEST (2):** `apps/desktop/src/main/platform/command/manufacturingControlPlane.test.ts` (new); `apps/desktop/src/main/enterprise/modules/manufacturing/productionCostingAndVariance.test.ts` (Part C completion path updated to the lifecycle door).
- **HARNESS (1):** `apps/desktop/e2e/s98ManufacturingJourney.e2e.cjs` (new).
- **DOCS (2):** this cert + `DECISION-MEMO-S98-PRODUCTION-STATUS-GUARD.md`.

## 8. Policy gaps (documented, not implemented)

Material over-issue tolerance; scrap approval / materiality; production-variance approval threshold; costing methodology (standard-cost is the defined basis); routing / operation approval; cycle-count / stock-adjustment authority; warehouse-transfer accounting; repair-vs-capex; revenue recognition; lot/serial. Each is a future operator-gated decision; none blocks the S98 target.

## 9. Exact commit

One non-frozen commit (production status guard + focused test + updated costing test + journey + memo + cert), recorded on landing.

## 10. Final S98 status — GREEN pending the operator's Mac journey

**Manufacturing is certified as a governed consumer + producer of the canonical inventory + finance control plane at the sandbox level:** a BOM scales consumption; the production-order lifecycle posts real reservation/consumption/output movements against the authoritative stock ledger and the standard-cost GL; WIP settles to 5910 and nets to zero; a posted production movement is immutable to edit and delete; the production status is machine-owned so no phantom finished goods can be forged (F-S98-1 closed); and tenant/RBAC/AI boundaries plus restart durability all hold. Proven by 8/8 focused tests + manufacturing/command 262/262 + enterprise/command/ipc 1963/1963 + full main 10446/7-skipped (sandbox). One YELLOW reproduced and fixed with a canonical guard; the listed manufacturing policies remain POLICY-OPEN (not invented). No frozen change; no FG-S98 token; AI advisory-only. `certification/baseline.json` untouched; release-track files untouched (paused). **The fresh-profile real-Electron journey with a real restart runs on the operator's Mac — S98 is marked GREEN only on RESULT + exit 0 there.**
