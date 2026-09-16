# SESSION 75 — PROJECTS END-TO-END WORKFLOW CERTIFICATION

**Class:** one controlled S75 domain gate (Projects). Reuse-only — the Projects domain already exists and is governed; **no new infrastructure**; **no invented project/accounting policy**; no release work; no Maintenance/CRM/HR redesign; no approval-control-plane; no D8–D11/D12/bank-recon reversal. One commit. Baseline S74 HEAD `54c4ce5`.

## 1 · Discovered Projects modules (from the real registry/source)

| Module id | Role / actions |
|---|---|
| `projects-projects` | project master — actions `complete`, `cancel`; `customerRef`/`contractRef` resolve against real stores; closure freezes |
| `projects-tasks` | task board (`todo`/`in_progress`/`done`), `projectRef` guarded; refused on closed project |
| `projects-time-entries` | timesheet — billable, `hourlyRate`; `projectRef` guarded; frozen once invoiced |
| `projects-billing-runs` | billing run — action `issueInvoice` → real draft invoice via Finance; issued runs immutable |

Framework-governed (RBAC/tenancy/audit via `buildModuleHandlers` + `EnterpriseModule{Create,Update,Action,List,Get}`); **not on a dedicated command spine** — consistent with the other operational domains. No duplicate command bus / workflow / approval / invoice / customer / employee store created. Cross-module references (`crm-customers`, `finance`) reuse the existing stores through ReferenceField-style id resolution.

## 2 · Actual lifecycle + state machine

**Project:** open → `complete` (freezes: `completedAt`, `percentComplete` 100, immutable) / `cancel`. A closed project refuses new tasks, field edits, and re-close.
**Task:** board moves `todo`→`in_progress`→`done` via update; `projectRef` must resolve; refused once the project is closed.
**Time entry:** created billable+rated; frozen (immutable, stamped `invoicedBy`) once its billing run issues.
**Billing run:** create previews the amount deterministically → `issueInvoice` creates a REAL draft invoice via the Finance module, stamps entries, closes the run (`invoiced`); **one invoice per run** (re-issue refused; a re-run of the period finds nothing).

## 3 · Governed mutation path

Real UI (`EnterpriseModuleScreen` + ReferenceField for customer/project + action buttons) → secure preload → IPC `enterprise:module.*` → `runSecureHandler` (authenticate) → module handler `authorize(operations:read | operations:manage)` → hook `validate`/`runAction` (ref guards, closure guards) → `EnterpriseRecordStore` (tenant-scoped `scopeOrDeny`, durable JSON) → `onChange`/emit → audit. Preserved the established framework-governed architecture — no duplicate command infrastructure introduced just to make Projects look different.

## 4 · Evidence

**Existing per-capability proof** — `projects.test.ts` + `projectBilling.test.ts` (green in this session): project runtime state/health, task-board progress, project/task ref guards, **project closure freeze (closed projects refuse task writes + edits + cancel)**; billing-run engine (unbilled billable time, rate grouping); **issue → REAL draft invoice + entry freeze + one-invoice-per-run**.

**New whole-journey pin** — `src/main/enterprise/modules/projects/session75ProjectsJourney.test.ts`, 2/2 green, real module handlers over a tenant-scoped registry:
1. **Journey:** CRM customer → project (`customerRef` resolves the real customer; a ghost customer is refused) → tasks (ghost project refused) → move task to done → billable rated time (`operations:manage` asserted) → billing run previews **320** (4×50 + 2×60) → `issueInvoice` → **real draft invoice `INV-BR-PRJ-1-1` amount 320 status draft** via Finance → **time entries frozen** (stamped `invoicedBy`, edit refused) → **idempotent re-issue refused** (one invoice) → project `complete` (freezes) → **illegal: new task / edit / cancel on closed project all refused**.
2. **Tenant isolation:** a project created in tenant-B is invisible in tenant-A (both directions), via `scopeOrDeny`.

**Real-Electron harness** — `e2e/s75ProjectsJourney.e2e.cjs` (syntax-checked; module ids/actions verified against source): drives the full journey + negatives through `window.neuropause.invoke` on the alternate build (`out-seam-s75`) + fresh profile. **REAL-ELECTRON EXECUTION PENDING** (sandbox is Linux, no Electron) — same pattern as the S73/S74 harnesses. **Full E2E GREEN is NOT claimed until the Mac run produces evidence.**

eslint clean; harness `node --check` OK; **no production source changed** (test + harness + memo + cert only).

## 5 · Time / expense / cost + Inventory / Finance integration

- **Time → billing → invoice:** proven end-to-end; the draft invoice is a real Finance record that walks the certified S28 issue→GL→payment chain.
- **Finance/GL:** Projects itself posts **no** GL. Project cost→GL, revenue recognition, capitalization, labor-cost methodology, budget-variance/write-off are **UNDEFINED and NOT implemented** → STOPPED and memo'd (`DECISION-MEMO-S75-PROJECT-COST-REVENUE-ACCOUNTING.md`). Not invented. This blocks no operational Projects function.
- **Cross-module integrity:** `customerRef` resolves against the real `crm-customers` store (tenant-scoped, refused if absent); billing writes through the real `finance` invoice module. No duplicate customer/invoice/employee/item stores.

## 6 · Status integrity / security negatives

Illegal transitions refused: task or edit on a closed project; cancel-after-complete; ghost customer/project references; duplicate invoice issue (idempotent, no second invoice); invoiced time entries immutable. Closed projects are immutable history. Reused existing lifecycle guards — no second workflow/status engine.

## 7 · Authorization + tenancy

Tenant isolation proven (project in tenant-B invisible in tenant-A); actor attribution via `ctx.actor()`; RBAC `operations:read`/`operations:manage`; renderer-supplied identity never authoritative (tenant resolved by `resolveTenantScope`/`scopeOrDeny` in main). ✅

## 8 · MODULE × WORKFLOW × GOVERNANCE × E2E — Projects row

| Domain | Representative real-user workflow | Governed spine | Framework governance | Dedicated real-Electron E2E | Status |
|---|---|---|---|---|---|
| Projects | customer→project→task→time→billing-run→draft invoice→close | draft invoice → certified S28 chain | ✓ | **journey pin (2/2) + harness (S75)** | **JOURNEY GREEN** (portfolio→billing→draft invoice + closure immutability + idempotency + tenant isolation; Mac harness pending) *(project-cost/revenue→GL = POLICY-BLOCKED, memo'd)* |

## 9 · Remaining policy blockers

- **Project cost/revenue → GL** (revenue recognition, project-cost/WIP accounts + capitalization + threshold, labor-cost method, budget-variance/write-off): UNDEFINED, STOPPED — `DECISION-MEMO-S75-PROJECT-COST-REVENUE-ACCOUNTING.md`. Does not block any operational Projects function.

## FINAL STATUS

**PROJECTS = GREEN** for the defined Projects workflow (portfolio → tasks → time → billing run → real draft invoice + entry freeze + run closure, project closure immutability, idempotency, cross-module tenant-scoped references, tenant isolation, RBAC) — governed layer proven by the 2/2 journey pin + the existing `projects.test.ts`/`projectBilling.test.ts`; real-Electron harness ready and **PENDING** the Mac run. The only STOPPED item is project-cost/revenue→GL accounting, which is undefined, not implemented, and memo'd — blocking no operational Projects functionality.

**WHOLE-APP STATUS = NOT COMPLETE** — the operational domain journeys are now all journey-GREEN, but completion is gated on (a) executing the six Mac journey harnesses (CRM/HR/Warehouse/Manufacturing/Maintenance/Projects) for real-Electron evidence, and (b) the operator-gated policy blockers (D8–D11 payroll/variance/scrap sign-off, D12 PO approve-send, bank-reconciled reversal, maintenance-cost→GL, project-cost/revenue→GL). A consolidated remaining-gap list follows this gate.
