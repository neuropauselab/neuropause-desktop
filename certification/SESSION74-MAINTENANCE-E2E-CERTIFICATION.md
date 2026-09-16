# SESSION 74 — MAINTENANCE END-TO-END WORKFLOW CERTIFICATION

**Class:** one controlled S74 domain gate (Maintenance). Reuse-only — the Maintenance domain already exists and is governed; **no new infrastructure**; **no invented maintenance/accounting policy**; no release work; no Projects, no approval-control-plane. One commit. Baseline S73 HEAD `6c127ab`.

## 1 · Discovered Maintenance modules (from the real registry/source)

Eleven registered modules under `enterprise/modules/maintenance`, all framework-governed (RBAC/tenancy/audit via `buildModuleHandlers` + `EnterpriseModule{Create,Update,Action,List,Get,Delete}`):

| Module id | Role |
|---|---|
| `maintenance-asset-categories` | asset classification master |
| `maintenance-assets` | equipment/asset master (`assetTag`, `name`, category, criticality) |
| `maintenance-plans` | maintenance plan master |
| `maintenance-preventive` | preventive tasks — actions `raiseWorkOrder`, `complete` |
| `maintenance-corrective` | corrective faults — actions `raiseWorkOrder`, `resolve` |
| `maintenance-work-orders` | the core lifecycle — actions `assign`, `start`, `complete`, `verify`, `cancel` |
| `maintenance-technicians` | technician master |
| `maintenance-history` | immutable history record created at `verify` (readOnly work-order link) |
| `maintenance-spare-parts` | parts consumed via real inventory movements — actions `consume`, `cancel` |
| `maintenance-downtime` | downtime events → authoritative machine status |
| (machine) `manufacturing-machines` | the asset whose status the WO drives |

**Not on the dedicated command spine** — Maintenance is governed at the framework layer (the `EnterpriseModuleAction`/`Update`/`Create` secure handlers each `authorize` + `audit` + tenant-scope via `scopeOrDeny`), consistent with the Warehouse/Manufacturing movement domains. No duplicate command bus / workflow engine / inventory store was created.

## 2 · Canonical state machine + workflow

**Work order:** `scheduled → assign → assigned → start → in_progress → complete → completed → verify → verified` (+ `cancel`, illegal on completed/verified). `verify` restores the machine to `running` and creates the immutable `maintenance-history` record with `totalCost = laborCost + partsCost`.

**Corrective:** fault `open → raiseWorkOrder` (creates `WO-CM-*`, type corrective, fault → `in_progress`; idempotent) `→ resolve`.
**Preventive:** task `scheduled → raiseWorkOrder` (creates preventive WO) `→ complete`.
**Spare parts:** `draft → consume` (real Inventory Ledger `production_consumption` movement, stock drops; idempotent) / `cancel`.
**Downtime:** logging downtime writes authoritative machine status and lowers the Manufacturing availability KPI.

## 3 · Governed workflow verification (per required mutation)

Real UI (`EnterpriseModuleScreen` + ReferenceField/action buttons) → secure preload → IPC `enterprise:module.*` → `runSecureHandler` (authenticate) → module handler `authorize(maintenance:manage | :read)` → hook `validate/runAction` → `EnterpriseRecordStore` (tenant-scoped `scopeOrDeny`, durable JSON write) → `onChange`/emit → audit. The spare-part consume additionally re-authorizes `inventory:manage` at the shared `postStockMovement` seam (defense in depth). Reused existing infrastructure throughout — no duplicate bus/router/workflow/approval/transaction/audit/event/inventory system.

## 4 · Evidence

**Existing per-capability proof** — `maintenance.test.ts` (15/15 green in this session): WO lifecycle → machine status + history; spare-part → real inventory consumption + idempotency; PM/CM `raiseWorkOrder` → linked WO + idempotency; downtime → machine + KPI; RBAC `maintenance:read`/`maintenance:manage`.

**New whole-journey pin** — `src/main/enterprise/modules/maintenance/session74MaintenanceJourney.test.ts`, 4/4 green, real module handlers over a tenant-scoped registry:
1. **Corrective journey:** asset+machine → fault → `raiseWorkOrder` (fault → in_progress; second raise refused, no duplicate WO) → assign technician (via governed update) → `assign` (machine → maintenance, `maintenance:manage` asserted) → `start` → **illegal verify-before-complete refused** → `complete` → **duplicate completion refused** → `verify` (machine → running; immutable history, `totalCost` 300) → spare-part `consume` (stock 50 → 45, `inventory:manage` asserted) → **duplicate consumption refused, no double stock issue**.
2. **Negative:** assigning a WO with no technician refused.
3. **Preventive journey:** plan → PM → `raiseWorkOrder` → WO lifecycle → verified + history.
4. **Tenant isolation:** a WO created in tenant-B is invisible in tenant-A (both directions), via `scopeOrDeny`.

**Real-Electron harness** — `e2e/s74MaintenanceJourney.e2e.cjs` (syntax-checked; module ids/actions verified against source): drives the corrective journey + illegal-mutation negatives through `window.neuropause.invoke` on the alternate build (`out-seam-s74`) + fresh profile. **REAL-ELECTRON EXECUTION PENDING** (sandbox is Linux, no Electron) — same pattern as the S73 journey harnesses. **Full E2E GREEN is NOT claimed until the Mac run produces evidence.**

eslint clean; harness `node --check` OK; **no production source changed** (test + harness + memo + cert only).

## 5 · Inventory + Finance integrity

- **Inventory:** parts consumption is an immutable Inventory Ledger movement (stock is never edited by a generic status/edit shortcut; the consume action is the only door and is idempotent). ✅
- **Finance/GL:** maintenance cost does **NOT** post to the GL — there is no repairs/maintenance-expense account and no journal for WO cost. This accounting treatment is **UNDEFINED and STOPPED**, memo'd in `DECISION-MEMO-S74-MAINTENANCE-COST-ACCOUNTING.md`. Not invented. Cost is captured operationally (WO fields → immutable history `totalCost`) only.

## 6 · Status integrity / security negatives

Illegal status jumps refused (verify-before-complete, assign-without-technician); duplicate completion refused; duplicate material consumption refused (no double stock issue); history created only at `verify` and its work-order link is readOnly; deletion of economically-active/historical records is governed by the framework delete door (S64 `ECONOMIC_DELETE_GUARD` + S46 origin boundary). Reused existing lifecycle guards — no second status engine.

## 7 · Authorization + tenancy

Tenant isolation proven (WO in tenant-B invisible in tenant-A); actor attribution via `ctx.actor()`; RBAC `maintenance:read`/`maintenance:manage` (+ `inventory:manage` at the ledger seam); renderer-supplied identity is never authoritative (tenant resolved by `resolveTenantScope`/`scopeOrDeny` in main). ✅

## 8 · MODULE × WORKFLOW × GOVERNANCE × E2E — Maintenance row

| Domain | Representative real-user workflow | Governed spine | Framework governance | Dedicated real-Electron E2E | Status |
|---|---|---|---|---|---|
| Maintenance | asset→fault/PM→work-order (assign→start→complete→verify)→parts/cost→history | framework-governed actions | ✓ | **journey pin (4/4) + harness (S74)** | **JOURNEY GREEN** (governed lifecycle + inventory integrity; Mac harness pending) *(maintenance-cost→GL = POLICY-BLOCKED, memo'd)* |

## 9 · Remaining policy blockers

- **Maintenance cost → GL** (repairs-expense vs capitalization + threshold, GL accounts, spare-part/labor posting): UNDEFINED, STOPPED — `DECISION-MEMO-S74-MAINTENANCE-COST-ACCOUNTING.md`. Does not block any operational Maintenance function.

## FINAL STATUS

**MAINTENANCE = GREEN** for the defined Maintenance workflow (corrective + preventive lifecycle, machine status, immutable history, real inventory parts consumption, illegal-mutation refusal, tenant isolation, RBAC) — governed layer proven by the 4/4 journey pin + the existing 15/15 suite; real-Electron harness ready and **PENDING** the Mac run. The only STOPPED item is maintenance-cost→GL accounting, which is undefined and memo'd, and blocks no operational Maintenance functionality.

**NEXT DOMAIN = PROJECTS** (not started in this gate).
