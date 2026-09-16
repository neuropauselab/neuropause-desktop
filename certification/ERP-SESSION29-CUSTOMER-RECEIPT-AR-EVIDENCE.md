# ERP SESSION 29 — O2C: CUSTOMER RECEIPT → AR SETTLEMENT ON THE CANONICAL PATH

**Baseline:** Session 28 (`a5c268b`).
**Status:** 🟢 **GREEN** — governed customer receipt + AR settlement on the live path, reusing the existing customer-payment engine; no invented policy; concurrency reproduced-first (no race → no unprovable latch). 🟡 packaged-macOS GUI acceptance carried forward. **No frozen surface touched.**

## A · BASELINE VERIFICATION

HEAD `a5c268b` (S28, pushed), branch `cert/data-import-cst-integration`, clean (no S29 changes at start). Import graph: one canonical `dispatchCommand` / durable journal / GL engine; the customer-payment module (`finance-payments`) is live-registered (`enterprise/index.ts:1267`).

## B · REPOSITORY DISCOVERY

The customer-receipt capability **already exists**: `finance/paymentModule.ts` (`createPaymentModule(storePath, invoiceStore, aiRunner?)`, id `finance-payments`, "Record and reconcile customer payments against invoices"). Its `validate` guards invoice-existence, positive amount, duplicate transaction ref, and overpayment; its `onChange` (`handlePaymentChangeForGl` + `reconcileInvoice`) posts Dr Cash / Cr AR and re-derives the invoice's paid amount + status from the real payment ledger. `markPaid` on the invoice was **traced and rejected as the receipt mechanism** — it is a manual status flip that posts no cash; the real cash-receipt accounting lives in the payment engine.

## C · POLICY GATE (each rule classified; nothing invented)

- **Receipt eligibility (invoice exists)** — DEFINED + LIVE: `!invRecord → "No matching invoice was found."`
- **Invoice status requirement** — DEFINED + PERMISSIVE: the engine does NOT gate on invoice status; any existing invoice may receive a payment, bounded only by its total (overpayment). Recorded as a policy observation; **no stricter status guard was invented** (a receipt against a still-draft invoice is possible in the engine — noted as YELLOW, not changed).
- **Full receipts** — DEFINED + LIVE. **Partial receipts** — DEFINED + LIVE (accumulate; invoice → `partially_paid`).
- **Overpayment** — DEFINED + LIVE: `alreadyApplied + amount > total` → refused ("Payment exceeds the invoice balance (remaining X)").
- **Payment / reference uniqueness** — DEFINED + LIVE: duplicate `transactionRef` refused.
- **Cash / bank account** — DEFINED: GL posts the Cash control (1000); the `method` field labels the instrument but there is no per-bank sub-account selection (single cash control). Not invented.
- **AR settlement** — DEFINED + LIVE: `reconcileInvoice` re-derives `amountPaid` + status through the invoice's own validate; a fully-covered invoice settles to `paid`.
- **Receipt cancellation / void** — DEFINED: `status: 'void'` (or delete) un-applies + reverses the GL.
- **Payment date** — DEFAULT (optional field). **Currency / FX** — DEFINED (`exchangeRate`, functional posting); FX not tested (out of scope).
- **Customer credit limits, unapplied cash** — UNDEFINED (invoiceRef is required → no unapplied cash) → **OUT OF SCOPE, not invented.**

**No required rule was undefined → no DECISION MEMO. Nothing invented for GREEN.**

## D · EXISTING CUSTOMER RECEIPT CAPABILITY · E · COMMAND IMPLEMENTED

**`ReceiveCustomerPayment`** — a CREATE command that records a **cleared** customer payment against an invoice through `platform:command.dispatch`, routing `EnterpriseModuleCreate(finance-payments, {...payload, status:'cleared'})`. Deny-by-default: the payment is always `cleared` (a client cannot record a void/pending "receipt"). Reuses the customer-payment engine verbatim — its guards + `onChange` (Dr Cash / Cr AR + invoice reconcile) do all the work.

## F · CANONICAL LIVE PATH

renderer → preload → `platform:command.dispatch` → `runSecureHandler` → `ElectronClientAdapter` → Application Boundary → command bus → authorization (`operations:manage`) → route → `EnterpriseModuleCreate(finance-payments, status:cleared)` → validate guards → `onChange` (Dr Cash / Cr AR + reconcile invoice) → durable journal (`CustomerPaymentReceived` event + outbox) → audit → response. No parallel receipt path; no renderer→DB; no AI→DB.

## G · AUTHORIZATION / APPROVAL

Two-layer: `requireAuth` at the channel + fine `ctx.authorize('operations:manage')` in the command bus. No receipt-specific approval threshold was invented (the repo defines none for recording a customer payment). The engine's guards (invoice-exists, overpayment, duplicate ref) are the business-policy gates.

## H · ACCOUNTING / AR SETTLEMENT (proven from the actual ledger)

Control accounts read from the repo: **Cash `1000`, Accounts Receivable `1100`.** A full receipt against a 900 issued invoice posts **Dr Cash 900 / Cr AR 900**: Cash 0→900, AR 900→0, invoice status → `paid`. Partial 400 then 500: AR 900→500→0, Cash 400→900, status `partially_paid`→`paid`. AR decreases only by the valid receipt amount; Cash increases only by it; entries balance. No account codes assumed — asserted against the real ledger balances.

## I · ELIGIBILITY / INVARIANTS (proven)

Overpayment refused; duplicate ref refused; nonexistent invoice refused; foreign-tenant invoice invisible → refused; duplicate command → no duplicate GL; restart/replay → no duplicate GL.

## J · IDEMPOTENCY

100 concurrent SAME-key receipts → exactly ONE payment + ONE Cash/AR effect (Cash 900, never 90000) + one journal record; subsequent same-key call replays. Uses the existing durable journal — no second idempotency store.

## K · CONCURRENCY (reproduce-first result)

Reproduce-first: two DIFFERENT-key full receipts (900 each) against one 900 invoice → **exactly one succeeds**, stable over a **12× loop (0 double-receipts / 0 overpayments)**. **No race exists**: the overpayment guard reads the invoice + payment ledger and creates the payment synchronously after `store.load` (no `await` between the read and the create), so the event loop serializes concurrent same-invoice receipts. Per "no unprovable guard," **no serialization latch was added** — the safety is the synchronous critical section, recorded (a future change introducing an `await` between the balance read and the create must add a per-(tenant, invoice) latch — the S24 pattern). NC-E proves the overpayment invariant is load-bearing (and that it is what holds under concurrency).

## L · TENANT ISOLATION

`claimedTenantId` ≠ resolved principal → TENANT_SCOPE_VIOLATION, no receipt. A foreign-tenant invoice is invisible through the tenant-scoped invoice store → "no matching invoice" (VALIDATION_ERROR), refused. Renderer-supplied tenant never authoritative.

## M · SECURITY NEGATIVE CONTROLS (load-bearing; byte-identical restore, verified)

- **NC-A**: weaken `ReceiveCustomerPayment` permission → `operations:read` → UNAUTHORIZED test fails.
- **NC-B**: bypass the invoice-exists guard (`if (!invRecord)`) → the NONEXISTENT-invoice test fails.
- **NC-C**: tenant scope is the same `applicationService` check proven load-bearing in S22/S24, re-exercised by the S29 tenant tests.
- **NC-D**: defeat the command idempotency key (`+ Math.random()`) → the 100-concurrent-same-key test fails.
- **NC-E**: bypass the overpayment guard (`alreadyApplied + amount > total`) → the OVERPAYMENT test fails (this is also the invariant that holds the concurrency case; there is no separate lock to break, so NC-F is intentionally absent — no race was found).

All mutated files restored byte-identical (`paymentModule.ts` shows no diff vs HEAD); no residue; S29 suite re-confirmed 11/11 after NC cycling.

## N · RESTART RECOVERY

`journal.reload()` preserves the outbox and replays the key to the original payment id — no second receipt, no second Dr Cash / Cr AR. Invoice settlement + GL are durable (atomic stores).

## O · EVENTS / OUTBOX / AUDIT

`CustomerPaymentReceived` event + pending outbox in the durable journal; audit via `governanceStore`. **No auto-rollback of a real financial effect for an audit/outbox hiccup**: the create-compensation soft-delete (only on a failed durable commit) uses the engine's own "voiding un-pays" reconciler, not a bespoke reversal.

## P · UI / LIVE IPC

Proven through the real `runSecureHandler` (renderer-equivalent). A dedicated on-screen "Receive Payment / Collect" control + the packaged-macOS GUI click remain the operator step: **BACKEND GOVERNED / UI CONTROL PENDING** (transport proven; no second IPC route created).

## Q · AI GOVERNANCE

Any AI receipt action uses the identical governed command path (the AIAdapter is just another client; `ctx.authorize` is the sole gate). No AI→invoice/AR/payment/cash/GL store writes; no AI-specific bypass.

## R · ARCHITECTURE / IMPORT AUDIT

`platform/command` stays Electron-free; domain/application React-free + renderer-free; no domain→DB bypass. One canonical of each engine (command bus, approval, journal, event/outbox, audit, AR/GL, customer-payment); the legacy `enterprise:module.create('finance-payments')` path remains as compatibility. No duplicate infrastructure introduced.

## S · TESTS

`session29CustomerReceipt.test.ts` (11, live via `runSecureHandler`): full receipt (Dr Cash/Cr AR, invoice paid) + event/audit; partial 400+500; overpayment refused; duplicate-ref refused; nonexistent invoice refused; UNAUTHORIZED; TENANT_SCOPE_VIOLATION; foreign-tenant invisible; 100-same-key single-effect; two-different-key concurrency invariant; restart replay.

## T · TYPECHECK / LINT / BUILD

typecheck node+web clean; eslint clean (changed files); `npm run build` (electron-vite) ✓.

## Full regression

Full main (sharded 4×): **948 files · 9930 passed · 7 skipped · 0 failed** (S28 baseline 947/9919; delta +1 file/+11 tests = `session29CustomerReceipt.test.ts`). UI: **70 files · 405 passed**.

## U · FROZEN SURFACES

None touched. Only non-frozen `platform/command/{domainCommand,commandBus}.ts` + the new test changed. The customer-payment engine was reused verbatim (no change). `certification/baseline.json` not staged (custody).

## V · REMAINING YELLOW

Packaged-macOS GUI acceptance (operator step); on-screen Receive-Payment control (transport proven; button pending). The engine's permissive receipt eligibility (no invoice-status gate; a draft invoice could be paid, producing a negative AR) is recorded as an observation for a future policy session — **not invented/changed** here.

## W · POLICY DECISIONS REQUIRED

None blocking this slice. Out-of-model (not invented, available if the operator wants them later): customer credit limits, unapplied cash / on-account receipts, FX revaluation, bank reconciliation, an explicit invoice-status eligibility gate for receipts.

## Status: 🟢 GREEN (governed customer receipt → AR settlement) / 🟡 packaged-GUI pending macOS

`ReceiveCustomerPayment` is a real governed end-to-end capability: authorization → invoice-exists/overpayment/duplicate guards → Dr Cash / Cr AR + invoice settlement → durable event/outbox/audit, with idempotency, tenant isolation, restart recovery, and a concurrency invariant proven-holding without an unprovable lock. No platform rebuild, no duplicate engine, no invented policy, no frozen change. The O2C chain now runs Sales Order → Shipment → Customer Invoice → AR → **Customer Receipt → AR settlement / Cash**.
