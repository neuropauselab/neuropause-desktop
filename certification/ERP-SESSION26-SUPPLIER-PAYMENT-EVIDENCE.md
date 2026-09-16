# ERP SESSION 26 — AP → PAYMENT (PaySupplierInvoice) ON THE CANONICAL PATH

**Baseline:** Session 25 (`141aebb`).
**Status:** 🟢 **GREEN** — governed supplier payment on the live path, reusing the existing vendor-payment engine; no invented policy; concurrency reproduced-first (no unprovable guard). 🟡 packaged-macOS GUI acceptance carried forward. **No frozen surface touched.**

## A · BASELINE VERIFICATION

HEAD `141aebb`, branch `cert/data-import-cst-integration`, in sync with origin (0 ahead/0 behind at start). Re-ran S25 suite → 7/7. Import graph: one canonical dispatchCommand / journal / approval / workflow.

## B · POLICY DISCOVERY / POLICY GATE

Inspected `vendorPaymentModule.ts` (`finance-vendor-payments`, `operations:manage`, registered live). **All required payment policy is DEFINED + LIVE — nothing invented:**
- **Partial payments** — DEFINED (accumulate until the bill settles).
- **Overpayment** — DEFINED refusal (`alreadyPaid + amount − bill.total > 0` → "Payment exceeds the bill's remaining balance").
- **Duplicate transaction ref** — DEFINED refusal.
- **Pay only an approved bill** — DEFINED (draft/cancelled → "approve it first").
- **Settlement / AP** — DEFINED: `onChange` re-derives `amountPaid` from the cleared payment ledger and stamps `paidDate` when covered (the ledger is the source of truth; void un-pays).
- **Accounting** — DEFINED: each cleared payment books **Dr Accounts Payable / Cr Cash** (`handleVendorPaymentChangeForGl`).
- **Payment method / currency / exchangeRate / status(pending|cleared|void)** — DEFINED fields; `status` defaults to `cleared`.
No undefined policy was hit → no PAYMENT POLICY DECISION MEMO required. **NOT in the payment model (unchanged, not invented this session):** early-payment discounts, late penalties, bank reconciliation, FX revaluation — recorded as out-of-model, not implemented.

## C · ERP SLICE IMPLEMENTED

`PaySupplierInvoice` — a CREATE command that records a **cleared** vendor payment against an approved bill through `platform:command.dispatch`. Deny-by-default: the payment is always `cleared` (a client cannot record a void/pending "payment" via this command).

## D · EXISTING INFRASTRUCTURE REUSED

Vendor-payment engine (validate guards + `onChange` settlement + GL), vendor-bill, PO, GR, movement/GL, the Session-18 durable journal, `governanceStore` audit, the S22 live IPC channel + adapter + application boundary + command bus. No new payment/AP store, no new engine.

## E · CANONICAL IPC PATH

renderer → preload → `platform:command.dispatch` → `runSecureHandler` → `ElectronClientAdapter` → Application Boundary → command bus → authorization → route → `EnterpriseModuleCreate(finance-vendor-payments, status:cleared)` → validate guards → `onChange` (settle + Dr AP / Cr Cash) → durable journal (`SupplierInvoicePaid` event + outbox) → audit → response. No parallel payment path.

## F · AUTHORIZATION · G · APPROVAL/WORKFLOW

Two-layer: `requireAuth` at the channel + fine `ctx.authorize('operations:manage')` in the command bus. The payment reuses the DEFINED gate that a bill must already be **approved** (the three-way match from S25) — a draft/cancelled bill cannot be paid. The advanced approval engine is unchanged; no payment-specific approval threshold was invented (the repo defines none for payment creation).

## H · ACCOUNTING / AP EFFECT

Proven through the live bridge: a full payment settles the bill (`amountPaid` = total, `paidDate` stamped) and posts journal lines (Dr AP / Cr Cash). Reused verbatim; no chart/tax/fiscal/FX rule invented.

## I · IDEMPOTENCY

100 concurrent SAME-key payments → exactly ONE cleared payment + one journal record (durable single-flight); a subsequent same-key call replays. Duplicate transaction-ref refused by the engine.

## J · CONCURRENCY (reproduce-first; no unprovable guard)

Two DIFFERENT-key full-balance payments against one bill → **exactly one succeeds** (the second exceeds the remaining balance). Reproduced-first with a **12× loop → 0/12 over-payments**: the engine's remaining-balance read and the create are synchronous after `store.load` (no `await` between them), so the event loop serializes concurrent same-bill payments and the invariant holds **without** a lock. Per "no unprovable guard / incidental protection is not a control," **no serialization latch was added**; the safety is recorded as incidental (a future change introducing an await between the balance read and the create must add a per-(tenant, bill) latch — the S24 pattern).

## K · TENANT ISOLATION

`claimedTenantId` ≠ resolved principal → TENANT_SCOPE_VIOLATION, no payment. A foreign-tenant bill is invisible through the tenant-scoped bill store → payment refused. Renderer-supplied tenant never authoritative.

## L · SECURITY NEGATIVE CONTROLS (load-bearing; byte-identical restore, sha-verified)

- **NC-A**: weaken `PaySupplierInvoice` permission → `operations:read` → UNAUTHORIZED test fails.
- **NC-B**: bypass the overpayment guard → the OVERPAYMENT test fails (a second over-balance payment succeeds).
- **NC-D**: defeat the command idempotency key → the 100-concurrent-same-key test yields >1 payment.
(NC-C tenant scope is the same applicationService check proven load-bearing in S22/S24 and re-exercised by the S26 tenant tests.) All files restored byte-identical.

## M · RESTART RECOVERY

`journal.reload()` preserves the outbox and replays the key to the original payment id — no second economic effect. Bill settlement + GL are durable (atomic stores).

## N · EVENT / OUTBOX / AUDIT

`SupplierInvoicePaid` event + pending outbox in the durable journal; audit via `governanceStore`. **No auto-reversal**: a cleared payment is a real Dr AP / Cr Cash effect; the create-compensation rollback (soft-delete on a failed durable commit) uses the engine's own "voiding un-pays" reconciler, not a silent bespoke reversal.

## O · UI / LIVE BRIDGE

Proven through the real `runSecureHandler` (renderer-equivalent). A dedicated on-screen "Pay" control + the packaged-macOS GUI click remain the operator step (harness `e2e/platformCommandLive.e2e.cjs` pattern) — honestly pending, not claimed GREEN.

## P · ARCHITECTURE / IMPORT AUDIT

`platform/command` stays Electron-free. No `domain→Electron/React/renderer`, no `AI→database`, no `renderer→database`. One canonical of each engine; the legacy `enterprise:module.create('finance-vendor-payments')` path remains as compatibility.

## Q · TESTS

`session26SupplierPayment.test.ts` (10, live via `runSecureHandler`): full payment settles + books; partial 40+60; overpayment refused; draft-bill refused; UNAUTHORIZED; TENANT_SCOPE_VIOLATION; foreign-tenant bill refused; 100-concurrent same-key single-effect + replay; two-different-key concurrency invariant; restart replay.

## R · TYPECHECK · S · LINT · T · BUILD

typecheck node+web clean; eslint clean (changed files); `electron-vite build` ✓.

## U · REGRESSION TOTALS

Full main (sharded 4×): **945 files · 9897 passed · 7 skipped · 0 failed** (S25 baseline 944/9887; delta +1 file/+10 tests = `session26SupplierPayment.test.ts`). UI: **70 files · 405 passed**.

## V · FROZEN SURFACES

None touched. Only non-frozen `platform/command/{domainCommand,commandBus}.ts` changed. `certification/baseline.json` not staged (custody).

## W · REMAINING YELLOW

Packaged-macOS GUI acceptance (operator step); an on-screen Pay control (transport is proven; the button is the last renderer step).

## X · POLICY DECISIONS REQUIRED

None blocking this slice. Out-of-model (not invented, available for a future session if the operator wants them): early-payment discount, late penalty, bank reconciliation, FX revaluation. The procurement chain PR→Approval→PO→GR→Inventory→Invoice→Three-Way Match→AP→**Payment** is now complete on the governed path.

## Y–AB · COMMIT / GIT / PUSH / MAC SYNC

See the handoff section in the chat response (commit SHA, branch, push status, exact Mac commands).

## Status: 🟢 GREEN (governed payment slice) / 🟡 packaged-GUI pending macOS

`PaySupplierInvoice` is a real governed end-to-end capability: authorization → approved-bill guard → overpayment/duplicate refusals → Dr AP / Cr Cash + settlement → durable event/outbox/audit, with idempotency, tenant isolation, and a proven-holding concurrency invariant. No platform rebuild, no duplicate engine, no invented policy, no frozen change.
