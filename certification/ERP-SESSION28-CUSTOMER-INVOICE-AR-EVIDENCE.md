# ERP SESSION 28 — O2C: CUSTOMER INVOICE → AR ON THE CANONICAL PATH

**Baseline:** Session 27 (`13daf9e`).
**Status:** 🟢 **GREEN** — governed customer invoicing + AR posting on the live path, reusing the existing sales-conversion + finance-invoice + GL engines; no invented policy; a REAL concurrency race reproduced-first and closed with the existing serialization pattern (load-bearing, proven). 🟡 packaged-macOS GUI acceptance carried forward. **No frozen surface touched.**

## A · BASELINE VERIFICATION

HEAD `13daf9e`, branch `cert/data-import-cst-integration`, clean (no S28 changes at start). S27 suite re-runnable. Import graph: one canonical `dispatchCommand` / durable journal / GL engine; `finance` invoice module + `sales-orders` live-registered (`enterprise/index.ts:1252,1261`).

## B · REPOSITORY DISCOVERY

The customer-invoice capability **already exists**: the sales-order `convertToInvoice` action → `sales/conversion.ts::convertOrderToInvoice` raises a Finance invoice (`finance` module, `createInvoiceModule`). Its GL bridge is `finance/glPosting.ts::handleInvoiceChangeForGl` (`onChange`), and the invoice lifecycle actions are `issue` / `markPaid` / `cancel`.

## C · POLICY GATE (each rule classified; nothing invented)

- **Invoice eligibility** — DEFINED + LIVE: `INVOICEABLE_ORDER_STATUSES = {shipped, fulfilled, closed}`; a pending/cancelled order is refused.
- **Duplicate invoicing** — DEFINED + LIVE: the order's `convertedInvoice` guard refuses a second invoice.
- **Invoice amount / pricing** — DEFINED + LIVE: amount = order total; **tax NOT re-applied** (the order total is already final).
- **Tax** — DEFINED + DEFAULT: `taxRate: 0` on conversion (no re-tax).
- **Numbering** — DEFINED + LIVE: `INV-<orderNumber>`.
- **Payment terms / due dates** — DEFINED + LIVE: terms from the order or `net30`; `issue` stamps issue+due dates.
- **AR posting** — DEFINED + LIVE: `issue` moves the invoice to a non-draft status and `handleInvoiceChangeForGl` posts **Dr Accounts Receivable (1100) / Cr Sales Revenue (4000)** (control accounts auto-seeded via `seedControlAccountsIfEmpty`). A **draft** invoice posts NOTHING (`live: status !== 'draft'`).
- **Cancellation / reversal** — DEFINED + LIVE: the `cancel` action + `deleted`/`cancelled` revokes the GL.
- **Authorization** — DEFINED + LIVE: the invoice module write scope `operations:manage`.
- **Partial invoicing** — UNDEFINED: `convertOrderToInvoice` invoices the whole order total, all-or-nothing → **OUT OF SCOPE, not invented.**
- **Revenue recognition (schedules), customer credit limit, FX revaluation, credit notes** — UNDEFINED / separate → **OUT OF SCOPE, not invented.**

**No required rule was undefined → no CUSTOMER INVOICE POLICY DECISION MEMO. Nothing invented for GREEN.**

## D · INVOICE CAPABILITY · E · AR CAPABILITY

Two governed commands, both routing EXISTING actions, realizing SHIPMENT → CUSTOMER INVOICE → AR:
- **`InvoiceSalesOrder`** → sales-order `convertToInvoice` → a DRAFT customer invoice (no GL yet).
- **`IssueCustomerInvoice`** → finance-invoice `issue` → Dr AR (1100) / Cr Sales Revenue (4000).

## F · EXISTING INFRASTRUCTURE REUSED

Sales-conversion (`convertOrderToInvoice`), finance-invoice engine (`issue` action + status machine), the GL bridge (`handleInvoiceChangeForGl` + `seedControlAccountsIfEmpty` + `GL_CONTROL_ACCOUNTS`), the ledger-account + journal modules, the Session-18 durable journal, `governanceStore` audit, and the S22 live IPC path. No new invoice/AR/GL/accounting/transaction/approval/command/event/outbox/audit store or engine.

## G · CANONICAL IPC PATH

renderer → preload → `platform:command.dispatch` → `runSecureHandler` → `ElectronClientAdapter` → Application Boundary → command bus → authorization (`operations:manage`) → route → `EnterpriseModuleAction(sales-orders,'convertToInvoice')` / `(finance,'issue')` → existing engine → durable journal (`SalesOrderInvoiced` / `CustomerInvoiceIssued` event + outbox) → audit → response. No parallel invoice path; no renderer→DB; no AI→DB.

## H · AUTHORIZATION · I · APPROVAL/WORKFLOW

Two-layer: `requireAuth` at the channel + fine `ctx.authorize('operations:manage')` in the command bus. `convertOrderToInvoice` additionally asserts the Finance write scope internally (a sales-only actor cannot mint invoices). The advanced approval engine is unchanged; **no invoice-specific approval threshold was invented** (the repo defines none for `convertToInvoice`/`issue`). The order status machine + the invoice `convertedInvoice`/status guards are the gates.

## J · INVOICE ELIGIBILITY (proven)

Shipped order → invoiceable ✓. Unshipped (pending) → refused (CONFLICT). Cancelled → refused. Already-invoiced → refused (one invoice). Nonexistent/foreign-tenant → NOT_FOUND. Partial invoicing left out of scope (undefined).

## K · ACCOUNTING / AR EFFECT (proven through the live bridge)

A DRAFT invoice posts nothing (AR balance 0). Issuing posts **Dr AR 1100 = order total** and **Cr Sales Revenue 4000 = subtotal** (tax 0 → subtotal == total); asserted via the ledger-account balances. Reused verbatim — no chart/tax/recognition/FX rule invented.

## L · IDEMPOTENCY

100 concurrent SAME-key `InvoiceSalesOrder` → exactly ONE invoice + one journal record. 100 concurrent SAME-key `IssueCustomerInvoice` → exactly ONE AR effect (AR = total, never 100×). Durable single-flight; subsequent same-key calls replay.

## M · CONCURRENCY (reproduce-first — a REAL race found and closed)

Reproduce-first **found a genuine race**: two DIFFERENT-key `InvoiceSalesOrder` of the same order produced **TWO invoices** (the initial test run failed with 2). Root cause: `convertOrderToInvoice` reads the already-invoiced guard, then `await`s the invoice-store load BEFORE stamping the order — an open check→stamp window that different idempotency keys (which bypass the journal's same-key single-flight) both slip through. **The smallest existing pattern was applied** — the S24 per-key chained-promise latch (`serializeInvoiceConversion`, keyed on the globally-unique order id) plus a **fresh re-read of the order inside the serialized section** (the latch alone is insufficient — the guard must see the committed stamp, not the captured snapshot). After the fix: two different-key attempts → exactly ONE invoice, stable over a 10× loop. The `issue` action has **no** race (its status read→update is synchronous before the GL `onChange`) → no latch added there (reproduce-first, no unprovable guard). NC-E proves the latch is load-bearing (bypass → 2 invoices).

## N · TENANT ISOLATION

`claimedTenantId` ≠ resolved principal → TENANT_SCOPE_VIOLATION, no invoice. A foreign-tenant order is invisible (tenant-scoped store) → NOT_FOUND. Renderer-supplied tenant never authoritative.

## O · SECURITY NEGATIVE CONTROLS (load-bearing; byte-identical restore, verified)

- **NC-A**: weaken `InvoiceSalesOrder` permission → `operations:read` → UNAUTHORIZED test fails.
- **NC-B**: bypass the invoice eligibility guard (`INVOICEABLE_ORDER_STATUSES`) → the UNSHIPPED-order test fails.
- **NC-C**: tenant scope is the same `applicationService` check proven load-bearing in S22/S24, re-exercised by the S28 tenant tests.
- **NC-D**: defeat the command idempotency key (`+ Math.random()`) → the 100-concurrent-same-key `InvoiceSalesOrder` test fails.
- **NC-E**: bypass `serializeInvoiceConversion` → the two-different-key test fails (2 invoices) — proves the concurrency latch is load-bearing (and the race was real).

All mutated files restored byte-identical; no NC residue; S28 suite re-confirmed 13/13 after NC cycling.

## P · RESTART RECOVERY

`journal.reload()` preserves the outbox and replays BOTH keys (invoice + issue) to their original results — no second invoice, no second AR posting. Invoice status + journal are durable (atomic stores).

## Q · EVENT / OUTBOX · R · AUDIT

`SalesOrderInvoiced` + `CustomerInvoiceIssued` events + pending outbox in the durable journal; audit via `governanceStore`. **No auto-rollback**: a draft invoice has no economic effect (its `convertedInvoice` guard gives at-most-once); issuing books a real Dr AR / Cr Revenue whose reversal is the governed `cancel` action, never a silent soft-delete.

## S · UI / LIVE BRIDGE

Proven through the real `runSecureHandler` (renderer-equivalent). Dedicated on-screen "Generate Invoice" / "Issue" controls + the packaged-macOS GUI click remain the operator step: **BACKEND GOVERNED / UI CONTROL PENDING** (transport proven; the button is the last renderer step).

## T · AI GOVERNANCE

Any AI invoice action uses the identical governed command path (the AIAdapter is just another client; `ctx.authorize` is the sole gate). No AI→DB, no AI-specific bypass of authorization/approval/tenant isolation.

## U · ARCHITECTURE / IMPORT AUDIT

`platform/command` stays Electron-free; domain/application React-free + renderer-free; no domain→DB bypass. One canonical of each engine; the legacy `enterprise:module.action` path remains as compatibility. No duplicate infrastructure introduced.

## V · TESTS

`session28CustomerInvoice.test.ts` (13, live via `runSecureHandler`): ship→invoice(draft, AR 0)→issue(Dr AR/Cr Revenue) + event/audit; cannot invoice unshipped / cancelled; cannot double-invoice; cannot re-issue (no double AR); UNAUTHORIZED; TENANT_SCOPE_VIOLATION; foreign-tenant NOT_FOUND; 100-same-key invoice single-effect; 100-same-key issue single-AR-effect; two-different-key invoice concurrency (ONE invoice); two-different-key issue concurrency (ONE AR); restart replay.

## W · TYPECHECK · X · LINT · Y · BUILD

typecheck node+web clean; eslint clean (changed files); `npm run build` (electron-vite) ✓.

## Z · FULL REGRESSION

Full main (sharded 4×): **947 files · 9919 passed · 7 skipped · 0 failed** (S27 baseline 946/9906; delta +1 file/+13 tests = `session28CustomerInvoice.test.ts`). UI: **70 files · 405 passed**. All pre-existing sales-conversion tests pass unchanged (the latch + fresh re-read is behavior-preserving for single calls).

## AA · FROZEN SURFACES

None touched. Only non-frozen `platform/command/{domainCommand,commandBus}.ts` + `enterprise/modules/sales/conversion.ts` + the new test changed. `certification/baseline.json` not staged (custody).

## AB · REMAINING YELLOW

Packaged-macOS GUI acceptance (operator step); on-screen Generate-Invoice / Issue controls (transport proven; buttons pending). Customer Receipt (cash collection) is the next candidate slice, deliberately out of this session per §20.

## AC · POLICY DECISIONS REQUIRED

None blocking this slice. Out-of-model (not invented, available if the operator wants them later): partial/split invoicing, deferred revenue recognition, customer credit limits, credit notes/refunds, FX revaluation.

## Status: 🟢 GREEN (governed customer invoice → AR) / 🟡 packaged-GUI pending macOS

`InvoiceSalesOrder` + `IssueCustomerInvoice` are real governed end-to-end capabilities: authorization → eligibility guard → draft invoice → issue → Dr AR / Cr Revenue → durable event/outbox/audit, with idempotency, tenant isolation, restart recovery, and a REAL concurrency race reproduced-first and closed with a load-bearing latch. No platform rebuild, no duplicate engine, no invented policy, no frozen change. The O2C chain now runs Sales Order → Shipment → Customer Invoice → AR.
