# DECISION MEMO — S98 F-S98-1: production-order `status` was NOT machine-owned, letting the edit door forge a lifecycle transition and produce finished goods from nothing (YELLOW, fixed)

**Classification: YELLOW — manufacturing-integrity gap (the production status machine was enforced by the lifecycle actions but the edit door could hand-set status, bypassing every real inventory movement), reproduced and FIXED by making the status field machine-owned (`readOnly` + a validate hook refusing status edits), mirroring the sales-order (S45) and stock-movement (S55) guards. Not RED (requires `manufacturing:manage` + same tenant), not GRAY (cause fully understood), not POLICY-OPEN (the lifecycle status machine is declared by the module itself).**

## 1. Finding (reproduced first)

A production order's lifecycle is `draft → planned → released → running → completed`, and each transition is what posts the real inventory movements + GL: `allocate` reserves the BOM components, `start` posts `production_consumption` (Dr WIP / Cr Inventory) and consumes on-hand, `complete` posts `production_output` (Dr FG / Cr WIP) and yields finished goods, and the `completed` `onChange` settles the WIP variance to 5910. The lifecycle actions are the only intended door.

But the `status` field was an ordinary editable `select`. So the generic **edit door** (`enterprise:module.update`) could hand-set `status` directly. Reproduced two ways:
1. Edit `status: draft → running` (no material consumed, no WIP posted), then run `complete` → the order produced 5 finished units of FG from **zero** consumed material: a `production_output` (Cr WIP with no Dr WIP) → phantom finished-goods stock and a broken/negative WIP balance.
2. Edit `status` directly to `completed` → additionally fired the variance-settlement `onChange` GL against WIP that was never debited.

Either path forges a lifecycle transition that skips the material and cost movements the transition exists to post.

## 2. Why it is a defect (not an undefined rule)

The production-order module DECLARES a status machine (the six-state lifecycle, each state reachable only through its action) and ENFORCES the ordering inside `runAction` (e.g. `complete` refuses unless the order is `running`). But it left the status field itself editable, so the edit door was an unguarded second path around a declared invariant — exactly the machine-owned-status defect class already closed for sales orders (S45) and stock movements (S55). The fix strengthens the module's own declared invariant; it invents no policy.

## 3. Canonical fix (reuses existing architecture; strengthens an existing invariant)

`apps/desktop/src/main/enterprise/modules/manufacturing/productionOrderModule.ts`:
- the `status` field is marked `readOnly: true`;
- a `validate` hook (the first hook, added ahead of `onChange`) runs the standard `validateEnterpriseRecordInput`, and — only on an EDIT (`input.recordId` present) with a real prior status — refuses any change of `status` with: *"Production order status changes only through the lifecycle actions (Plan, Allocate, Start, Complete, Cancel)."*

The lifecycle actions call `store.update(...)` **raw** (they never re-enter the validate hook), so Plan/Allocate/Start/Complete/Cancel continue to work exactly as before; creates (no `recordId`) and status-less importer rows are unaffected; a non-status edit (e.g. `operator`, `machine`) is still allowed. This is the exact structural analogue of the sales-order (`orderModule.ts`, S45) machine-owned-status guard.

## 4. Verification

- Reproduce → now refused: `manufacturingControlPlane.test.ts` "F-S98-1" asserts the `running` and `completed` status edits are refused, the order stays `draft`, and NO consumption/output movement and NO GL are produced from the forged edits; a non-status edit still succeeds.
- The lifecycle happy path (plan→allocate→start→complete), the reservation/consumption/output movements, the WIP/FG/5910 GL, immutability, tenant/RBAC/AI, and restart durability all pass through the real action + IPC doors.
- One existing regression test relied on reaching `completed` via the edit door (`productionCostingAndVariance.test.ts` Part C, the onChange-settlement test). It was updated to the faithful path — a raw `store.update` to `completed` (the lifecycle-action door, which never re-enters validate) plus a benign non-status field edit to re-fire `onChange` — the same re-fire technique the file already used for movements. No assertion was weakened; the test now exercises the same settlement it always did.
- Regression: manufacturing + platform/command **262/262**; enterprise + platform/command + ipc/handlers **1963/1963**; full main **10446 passed / 7 skipped** (the single non-S98 failure was `auth/loopbackServer.test.ts`, a port-binding flake — green 3/3 in isolation, Class C environmental).
- Not faking green: the fix closes a real manufacturing-integrity corruption path (phantom finished goods).

## 5. Scope / bounds

Applies to the production-order status field only. It does not change costing methodology, scrap/yield approval, production-variance approval, routing/operation approval, or any other manufacturing policy — all of those remain POLICY-OPEN (not invented) per the S98 directive. Posted-movement immutability (edit + delete) is the already-shipped S55/S97 (F-S97-1) guard, reused here for production movements.

## 6. Files changed

Production: `apps/desktop/src/main/enterprise/modules/manufacturing/productionOrderModule.ts` (readOnly status + validate hook). Test: `apps/desktop/src/main/platform/command/manufacturingControlPlane.test.ts` (new) + `apps/desktop/src/main/enterprise/modules/manufacturing/productionCostingAndVariance.test.ts` (Part C completion path updated to the lifecycle door). Harness: `apps/desktop/e2e/s98ManufacturingJourney.e2e.cjs` (new). All non-frozen (gate-detector PROCEED).
