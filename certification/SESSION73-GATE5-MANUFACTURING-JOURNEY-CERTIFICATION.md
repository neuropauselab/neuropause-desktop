# S73 GATE 5 — MANUFACTURING WHOLE-USER JOURNEY CERTIFICATION

**Class:** Manufacturing completion gate under S73 (whole-app completion). Reuse-only — the manufacturing + inventory modules already exist and are proven; **no new infrastructure**; **no invented manufacturing/variance policy**; no release work. One controlled gate (§18), one commit. This is the **fourth and final** of the operator's "all 4 step by step" journey gates (CRM → HR → Warehouse → Manufacturing).

## Journey proven (Inventory Ledger is the single source of truth)

**Seed components → BOM → Production Order (plan → allocate → start → complete) → BOM-driven component consumption + finished-goods output → Quality inspection → Costing → tenant isolation.**

## Evidence

**Existing per-capability proof** — `manufacturing.test.ts`, `mesExecution.test.ts`, `productionCostingAndVariance.test.ts`, `bomExplosionModule.test.ts`, `scheduleProposal.test.ts` (all green in the manufacturing suite): BOM component scaling with waste/yield; allocate reserves each component; start consumes each component + releases reservations; complete yields finished goods; the MES execution state machine (start→inspect→complete/scrap/rework); production cost + variance.

**New whole-journey pin** — `src/main/enterprise/modules/manufacturing/session73ManufacturingJourney.test.ts`, 2/2 green, driving the REAL module handlers over a tenant-scoped registry:
1. **End-to-end journey:** seed COMP-1/COMP-2/FG-1 → BOM (2×COMP-1, 5×COMP-2 per unit) → MO qty 10 → plan → allocate (reserves 20 + 50, on-hand unchanged) → start (consumes → COMP-1 80, COMP-2 50, reservations released) → complete (FG-1 currentStock 10). Both the action authority (`manufacturing:manage`) and the reservation movement's authority (`inventory:manage`) are asserted on allocate. Quality inspection + costing recorded for the run.
2. **Tenant isolation:** a production order created in tenant-B is visible only in tenant-B and invisible in tenant-A (both directions), via `scopeOrDeny`.

**Real-Electron whole-journey harness** — `e2e/s73ManufacturingJourney.e2e.cjs` (syntax-checked; module ids/actions verified against source): drives the entire journey through `window.neuropause.invoke` on the alternate build (`out-seam-s73`) + fresh profile. **PENDING Mac execution** (sandbox has no Electron), same pattern as `manufacturing`/`o2cRuntime`/`s62ReversalRuntime`.

eslint clean; harness `node --check` OK; **no production source changed** (test + harness + cert only).

## POLICY-BLOCKED / DECISION-NOTED (NOT driven, NOT invented)

The manufacturing **mechanisms** (BOM-driven consumption, MES execution, costing) are governed and proven. What remains gated on operator authority:
- **Quality `postDisposition` → inventory quarantine/reject mapping** carries the Session-4 decision note; the confirmed mapping is implemented, but any disposition requiring an **approval authority** (who signs off a reject/write-off, materiality threshold) is not invented.
- **Production cost-variance settlement / scrap write-off** carries the Session-5 note; the **variance-approval authority** (executor≠approver SoD, threshold, write-off GL treatment, decider role) is UNDEFINED and STOPPED per S73 §9 — see `DECISION-MEMO-S60-APPROVAL-CONTROL-PLANE.md`. Nothing about variance/scrap-approval authority is invented in this gate.

## Status

**Manufacturing journey = GREEN for the governed production lifecycle** (BOM → order plan→allocate→start→complete with real component consumption + FG output, quality + costing recorded, RBAC + tenant isolation); real-Electron harness ready for Mac. **Variance/scrap-approval authority = POLICY-BLOCKED** pending the operator's approval-authority inputs. Whole-app matrix Manufacturing row: GREEN(production lifecycle) + POLICY-BLOCKED(variance/scrap-approval authority).

**All four S73 journey gates (CRM, HR, Warehouse, Manufacturing) are now GREEN at the governed layer**, each with a Mac harness pending execution and each with its policy-blocked items honestly named (never invented). Remaining before "WHOLE-APP COMPLETE": the operator's approval control-plane authority inputs (unblocking D8–D11 payroll/variance/scrap sign-off, D12 PO approve-send, bank-reconciled reversal), then the whole-app matrix rows flip to fully GREEN and release preparation resumes.
