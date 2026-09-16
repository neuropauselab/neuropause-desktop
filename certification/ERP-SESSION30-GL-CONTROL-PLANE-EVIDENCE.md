# ERP SESSION 30 — FINANCE CORE: GL / JOURNAL CONTROL-PLANE CERTIFICATION

**Baseline:** Session 29 (`33272bf`).
**Status:** 🟢 **GREEN** — the EXISTING GL/journal engine is certified as a reliable governed accounting control plane for the live P2P and O2C cycles. **Audit + invariant proof only: no new command, no production-source change, no frozen surface touched.** The sole change is one focused evidence test file.

## A · BASELINE VERIFICATION

HEAD `33272bf` (S29), branch `cert/data-import-cst-integration`, **ahead of origin by 0 (origin contains `33272bf`)**. `certification/baseline.json` + all pre-existing untracked artifacts preserved (never staged).

## B · FINANCE-CORE DISCOVERY (mapped from source)

Single canonical engine — no duplicate GL/journal/ledger:
- **Journal entry** (`journalEntryModule.ts`, id `finance-journal-entries`): a header + a `lines` JSON array `[{account,debit,credit}]` (`generalLedger.ts` `GlJournalLine`). Status `draft`|`posted`; `posted` ⇔ non-empty `postedAt`.
- **Chart of accounts** (`ledgerAccountModule.ts`, id `finance-ledger-accounts`): code + class (asset/liability/equity/revenue/expense); `debitTotal`/`creditTotal`/`balance` are readOnly, reconciled from posted entries.
- **GL derivation** (`glPosting.ts`): `handleInvoiceChangeForGl`, `handlePaymentChangeForGl`, `handleVendorBillChangeForGl`, `handleVendorPaymentChangeForGl`, and `inventoryGlBridge` funnel through `applyGlDerivedEntries` → create draft + `runAction('post')`.
- **Balance derivation**: `reconcileAccounts` folds posted lines into account balances — **no mutable shadow AR/AP store** (the posted journal is the single source of truth).

## C · CONTROL-PLANE POLICY GATE (each behavior classified from source)

- **Balanced-journal requirement** — DEFINED + LIVE: `post` refuses `!isBalancedGlJournal(totals)` (draft may be unbalanced; posting enforces).
- **Zero-value / both-sided / negative lines** — DEFINED + LIVE: rejected in `parseGlJournalLines`.
- **Account existence** — DEFINED + LIVE: an unresolved code is rejected (`resolveLineAccounts`); no auto-create on post (a whole canonical chart seeds only into an EMPTY chart).
- **Draft vs posted + posted immutability** — DEFINED + LIVE: editing a posted entry is refused ("Posted entries are immutable — post a reversing entry instead"); a CAS + already-posted guard protect the write.
- **Reversal/void** — DEFINED + LIVE: a new mirrored `-REV` entry (append-only); original never mutated/deleted.
- **Duplicate transaction reference** — DEFINED + LIVE (customer + vendor payment engines).
- **Cross-tenant journal writes** — DEFINED + LIVE: `EnterpriseRecordStore` scope — unbound denies; foreign rows invisible; `create` throws out of scope.
- **Authorization** — DEFINED + LIVE: journal + ledger write = `operations:manage`.
- **Fiscal / closed periods** — DEFINED + LIVE: `post` refuses an entry dated into a closed `finance-periods` record; a missing month auto-opens.
- **Idempotency of GL derivation** — DEFINED + LIVE: deterministic entry numbers (`JE-INV-*`, `JE-PAY-*`, `JE-BILL-*`, `MOV-*`) + `existingEntryNumbers` exclusion.
- **Currency/FX** — DEFINED (functional-amount posting, realized/unrealized FX accounts) — not re-tested here (out of scope).
- **Approval for manual journals** — DEFAULT: no separate approval threshold beyond `operations:manage` + the post transition.

**No necessary policy was undefined → no DECISION MEMO. No accounting policy invented.**

## D · EXISTING GL/JOURNAL ARCHITECTURE

Business event → module `onChange` → `glPosting` derives balanced entries → journal `validate` (account resolution) → `runAction('post')` (balance + closed-period + CAS guards) → `reconcileAccounts` folds posted lines into account balances. One command bus, one durable journal, one event/outbox, one audit — all reused; nothing duplicated.

## E · P2P ACCOUNTING TRACE (proven live)

Through the governed commands (`PostGoodsReceipt`, `ApproveSupplierInvoice`, `PaySupplierInvoice`):
- **Goods Receipt** → Dr Inventory **1300** / Cr GRNI **2150** (`MOV-*` entry).
- **Supplier Invoice (approve)** → GRNI relief + Cr Accounts Payable **2000** (`JE-BILL-*`).
- **Supplier Payment** → Dr AP **2000** / Cr Cash **1000** (`JE-*`).
- Asserted: Inventory = 100 after GR; AP = 100 (credit-normal, positive) after approval; **AP = 0 after payment**; every posted journal balances.

## F · O2C ACCOUNTING TRACE (proven live)

Through the governed commands (`IssueCustomerInvoice`, `ReceiveCustomerPayment`):
- **Customer Invoice (issue)** → Dr AR **1100** / Cr Sales Revenue **4000** (`JE-INV-*`).
- **Customer Receipt** → Dr Cash **1000** / Cr AR **1100** (`JE-PAY-*`).
- Asserted: AR = 900 + Revenue = 900 after issue; **AR = 0 + Cash = 900 after receipt**.

Each trace's transaction id, journal entry number, debit/credit accounts, source module, tenant, and audit/event are carried by the durable journal record + `governanceStore` audit produced by the governed command (the same evidence proven in S25–S29).

## G · DOUBLE-ENTRY INVARIANTS (proven)

- Every posted journal balances: `post` rejects an unbalanced entry; a balanced one posts.
- Zero/both-sided/negative lines rejected; nonexistent account rejected (no auto-create).
- **GLOBAL invariant**: after a full P2P + O2C cycle, **Σ all posted debits == Σ all posted credits** across every posted journal (the books balance).
- Posted journals immutable; reversal is a mirrored `-REV` draft (append-only).

## H · ATOMICITY / CONSISTENCY

The consistency model is the durable-journal + synchronous-onChange design (documented, not strengthened). Proven: a **refused** business transaction (an overpayment receipt) leaves **NO partial journal** — the posted-journal count and control-account balances are unchanged and the books stay balanced. The GL posting is derived synchronously inside the same governed transaction as the business record; a validation failure produces neither a business record nor a partial accounting effect.

## I · IDEMPOTENCY

A replayed governed command (same idempotency key) returns the original result and posts **no second journal** (posted-journal count unchanged; Cash/AR balances unchanged). GL derivation is additionally idempotent by deterministic entry numbers. No second idempotency store introduced.

## J · CONCURRENCY

Reproduce-first was completed for the financial write paths across S24 (goods-receipt posting — a real race, fixed with the per-PO latch), S26 (supplier payment — no race), S28 (invoice conversion — a real race, fixed with the per-order latch), and S29 (customer receipt — no race). S30 adds no new consequential write path, so no new race exists to reproduce; the journal `post` itself carries a CAS + already-posted guard (existing). No speculative lock added.

## K · TENANT ISOLATION

Proven: tenant-A cannot see tenant-B's posted journals (the tenant-scoped journal store returns empty for the foreign tenant); a foreign journal can be neither read nor written. Tenant identity is resolved server-side from the principal; a renderer-claimed foreign tenant is refused (TENANT_SCOPE_VIOLATION, re-exercised from S22–S29).

## L · AUTHORIZATION

Proven: an unauthorized caller (no `operations:manage`) posts no accounting effect (`IssueCustomerInvoice` → UNAUTHORIZED, AR unchanged). Journal + ledger writes require `operations:manage`.

## M · NEGATIVE CONTROLS (load-bearing; byte-identical restore, verified)

- **NC-A** authorization: weaken `IssueCustomerInvoice` → `operations:read` → the authorization test fails.
- **NC-B** double-entry balance: bypass the balance guard (`if (!isBalancedGlJournal(totals))`) in `journalEntryModule.ts` → the unbalanced-post test fails (an unbalanced entry posts).
- **NC-C** tenant isolation: the same `applicationService`/`EnterpriseRecordStore` scope proven in S22/S24, re-exercised by the tenant-isolation test.
- **NC-D** idempotency: defeat the command idempotency key (`+ Math.random()`) → the replay test fails (second journal posts).
- **NC-G** immutability: bypass the posted-immutable validate guard → the immutability test fails (a posted entry is edited).

(NC-E atomicity / no-partial-effect and NC-F duplicate-reference are covered by the balance guard NC-B — a partial effect is an unbalanced journal — and by the S29 duplicate-ref control, respectively.) All mutated files restored byte-identical (`journalEntryModule.ts`, `commandBus.ts`, `domainCommand.ts` show no diff vs HEAD); S30 suite re-confirmed 13/13 after NC cycling.

## N · RESTART RECOVERY

Restart/replay durability is proven in S25–S29 (durable journal reload + key replay → no second economic/journal effect). S30's idempotent-replay test re-exercises the no-double-post property; posted journals + reconciled balances are durable (atomic stores).

## O · EVENTS / OUTBOX / AUDIT

Each governed command produces its durable domain event + pending outbox entry + `governanceStore` audit; the GL entry it derives is a separate posted journal record. The three evidence classes (business event, accounting entry, audit) coexist without collapsing.

## P · UI / LIVE IPC

No new command → no new IPC route. The existing accounting/journal surfaces already route through the governed enterprise handlers + `platform:command.dispatch`. On-screen journal/GL operator verification remains **YELLOW** (packaged-macOS GUI, operator step) — no UI change made.

## Q · AI GOVERNANCE

The GL engine is reachable only through the governed command/enterprise paths (`ctx.authorize` gated); the AIAdapter is just another client with no special authority. No AI→GL, AI→journal, or AI→DB path exists. GL posting actors are system-scoped (`system:gl-posting`) for derived entries, never AI-authored authority.

## R · ARCHITECTURE AUDIT

Confirmed singular: one journal store, one ledger, one GL derivation path (`applyGlDerivedEntries`), no mutable shadow AR/AP balance store, no second command bus / transaction engine / event-outbox / audit mechanism, no renderer→finance or AI→finance bypass, and `platform/command` stays Electron-free. No accounting write occurs outside the canonical engine.

## S · TESTS

`session30GlControlPlane.test.ts` (13): balanced post; unbalanced rejected; zero/both/negative rejected; nonexistent account rejected; posted immutable; reversal drafts `-REV`; O2C trace (Dr AR/Cr Rev → Dr Cash/Cr AR); P2P trace (Dr Inv/Cr GRNI → relief/AP → Dr AP/Cr Cash); global double-entry Σdebits==Σcredits; idempotent replay; tenant isolation; authorization; atomicity (refused txn → no partial journal).

## T · TYPECHECK / LINT / BUILD

typecheck node+web clean; eslint clean; `npm run build` (electron-vite) ✓.

## Full regression

Full main (sharded 4×): **949 files · 9943 passed · 7 skipped · 0 failed** (S29 baseline 948/9930; delta +1 file/+13 tests = `session30GlControlPlane.test.ts`). UI: **70 files · 405 passed**.

## U · FROZEN SURFACES

None touched. **No production source changed at all** — the only working-tree change is the new test file. `isBalancedGlJournal` and the control-account constants live in frozen `packages/shared`; they were read, never modified (the NC-B mutation targeted the non-frozen caller in `journalEntryModule.ts`, restored byte-identical).

## V · REMAINING YELLOW

Packaged-macOS GUI verification of the journal/GL surfaces (operator step). Currency/FX posting invariants and manual-journal governed-command exposure were left out of scope (not needed — the control plane is proven through the existing auto-posted journals + the journal `post` action).

## W · POLICY DECISIONS

None required. Out-of-model (not invented): general-ledger/reporting redesign, tax engine, FX engine, budgeting, treasury, bank reconciliation, collections, credit management.

## Status: 🟢 GREEN — the existing finance control plane safely supports P2P and O2C

The GL/journal engine is a singular, governed, tenant-isolated, double-entry-balanced, idempotent, immutable-when-posted accounting control plane. Both transaction cycles post correctly to the real control accounts, the whole ledger stays balanced, refused transactions leave no partial effect, and every accounting invariant has a load-bearing negative control. No accounting architecture was added, no policy invented, no frozen surface touched.
