# S73 GATE 4 — WAREHOUSE WHOLE-USER JOURNEY CERTIFICATION

**Class:** Warehouse completion gate under S73 (whole-app completion). Reuse-only — the warehouse modules + inventory ledger already exist and are proven; **no new infrastructure**; **no invented warehouse/variance policy**; no release work. One controlled gate (§18), one commit.

## Journey proven (Inventory Ledger is the single source of truth — stock is never edited)

**Seed on-hand → Transfer (approve → dispatch → receive, net-zero relocation) → Pick → Pack → Ship (issues stock, releases the reservation) → tenant isolation.**

## Evidence

**Existing per-capability proof** — `src/main/enterprise/modules/warehouse/warehouse.test.ts` (13/13 green in this session): paired transfer movements (WH-1 −30, WH-2 +30, IN-TRANSIT settles to 0, product total unchanged); cycle-count variance posts a signed adjustment and reconciles idempotently; stock-adjustment reason drives the sign; pick→pack→ship issues through the ledger; **RBAC** reads authorize `warehouse:read`, writes `warehouse:manage`, and the movement leg adds **defense-in-depth `inventory:manage`**.

**New whole-journey pin** — `src/main/enterprise/modules/warehouse/session73WarehouseJourney.test.ts`, 2/2 green, driving the REAL module handlers (`EnterpriseModuleCreate/Action/List/Get`) over a tenant-scoped registry:
1. **End-to-end journey:** seed 100 → transfer 30 approve→dispatch→receive → `completed`, product total stays 100 (net-zero relocation); pick 5 → reserve → pick → createPacking → pack → createShipment → ship → on-hand 95. Both the action authority (`warehouse:manage`) and the reservation movement's authority (`inventory:manage`) are asserted on approve.
2. **Tenant isolation:** a transfer created in tenant-B is visible only in tenant-B and invisible in tenant-A (both directions), via `scopeOrDeny`.

**Real-Electron whole-journey harness** — `e2e/s73WarehouseJourney.e2e.cjs` (syntax-checked; module ids/actions verified against source): drives the entire journey through `window.neuropause.invoke` on the alternate build (`out-seam-s73`) + fresh profile. **PENDING Mac execution** (sandbox has no Electron), same pattern as `warehouse`/`o2cRuntime`/`s62ReversalRuntime`.

eslint clean; harness `node --check` OK; **no production source changed** (test + harness + cert only).

## POLICY-BLOCKED (NOT driven, NOT invented) — D10

Cycle-count `reconcile` and stock-adjustment `post` **mechanisms** are governed and proven (they post signed ledger movements, never overwrite stock). What is UNDEFINED is the **economic-variance materiality approval**: the threshold above which a counted variance / write-off requires sign-off, the decider role, executor≠approver SoD, and the write-off GL treatment. Per S73 §9 that approval gate is STOPPED and left to the approval control-plane until the operator supplies the inputs — see `DECISION-MEMO-S60-APPROVAL-CONTROL-PLANE.md`. Nothing about variance-approval authority is invented in this gate.

## Status

**Warehouse journey = GREEN for the governed movement lifecycle** (transfer net-zero relocation, pick→pack→ship issue, cycle-count/adjustment ledger posting, RBAC + tenant isolation); real-Electron harness ready for Mac. **Cycle-count/adjustment variance-approval = POLICY-BLOCKED (D10)** pending the operator's approval-authority inputs. Whole-app matrix Warehouse row: GREEN(movement lifecycle) + POLICY-BLOCKED(variance-approval authority). Next gate: Manufacturing (BOM → production order → execution → quality → costing).
