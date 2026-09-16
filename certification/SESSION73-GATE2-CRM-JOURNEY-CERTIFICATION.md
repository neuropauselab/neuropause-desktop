# S73 GATE 2 — CRM WHOLE-USER JOURNEY CERTIFICATION

**Class:** CRM completion gate under S73 (whole-app completion). Reuses the existing module framework + governed command spine; no new infrastructure; no invented CRM policy; no release work. One controlled gate (§18), one commit.

## Journey proven

**Lead → CONVERT (Contact + Customer) → Opportunity → advanceStage → markWon → Quote (accepted) → ConvertQuoteToSalesOrder (GOVERNED command) → Sales Order.**

## Evidence

**Sandbox-runnable governed test** — `src/main/ipc/handlers/session73CrmJourney.test.ts`, 4/4 green, driving the REAL module handlers + the REAL platform command dispatch (`runSecureHandler`), tenant-scoped registry, durable journal:
1. **Lead → convert** creates a Contact (`crm`) + Customer (`crm-customers`), cross-linked; a second convert is REFUSED (no duplicate customer/contact); audit emitted.
2. **Opportunity** create → `advanceStage` → `markWon` → `closed-won`; a closed opportunity is immutable (further transition refused).
3. **Quote (accepted) → `ConvertQuoteToSalesOrder`** (the governed command, S45) creates a Sales Order, cross-links the quote to `converted`, and same-key replay is idempotent (one order, ever).
4. **Governance negatives:** the governed conversion enforces RBAC (principal without `sales:manage` → `UNAUTHORIZED`, no order) and tenant (`claimedTenantId` foreign → `TENANT_SCOPE_VIOLATION`); a lead created in tenant-B is invisible in tenant-A (`scopeOrDeny`).

**Real-Electron whole-journey harness** — `e2e/s73CrmJourney.e2e.cjs` (syntax-checked; module ids/actions verified against source): drives the entire journey through `window.neuropause.invoke` on the alternate build + fresh profile. **PENDING Mac execution** (sandbox has no Electron), same pattern as `o2cRuntime`/`s62ReversalRuntime`.

typecheck:test clean (no new errors); eslint clean; ipc/handlers regression 24 files / 226 passed (includes the new test); no production source changed (test + harness + cert only).

## Governance classification (updates the whole-app matrix CRM row)

CRM lifecycle actions run through the framework governance (RBAC + tenancy + audit + S46 origin boundary); the economically-consequential handoff (quote→order) runs the governed command spine. **CRM is GREEN at the governed layer**, with the real-Electron whole-journey pending the Mac run. No CRM business policy was invented; the lead/opportunity/quote transitions are the repository's existing defined behavior.

## Status

**CRM journey = GREEN (governed layer proven; real-Electron harness ready for Mac).** No policy-blocked item inside CRM. Next gate: HR (payroll post/disburse stays POLICY-BLOCKED under D8 until the operator supplies the approval-authority inputs).
