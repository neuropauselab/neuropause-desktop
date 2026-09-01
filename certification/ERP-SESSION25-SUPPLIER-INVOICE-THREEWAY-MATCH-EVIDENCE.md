# ERP SESSION 25 — SUPPLIER INVOICE (ApproveSupplierInvoice) ON THE CANONICAL PATH + THREE-WAY-MATCH POLICY GATE

**Baseline:** Session 24 (`ba62154`).
**Status:** 🟢 **GREEN** — the exact three-way-match invoice approval is now a governed command on the live path, reusing the existing engine; a concurrency claim was reproduced-first and honestly withdrawn (no unprovable guard shipped). 🟡 packaged-macOS GUI acceptance carried forward. One governance NOTE (not a blocker) recorded. **No frozen surface touched.**

## A · SESSION 24 VERIFICATION (independent)

Re-ran the S24 concurrency test: PO 100, three concurrent 100-unit receipts → **one accepted, on-hand 100**. S24 hardening intact. Import graph: one canonical dispatchCommand/journal/approval/workflow; PostGoodsReceipt route present.

## B · ERP SLICE SELECTED

`ApproveSupplierInvoice` — approve a supplier invoice (vendor bill) through the fail-closed three-way match (PO↔GR↔Bill) → GRNI relief / AP, on the live `platform:command.dispatch` path. The next step after S24's Goods Receipt → Inventory.

## C · EXISTING CODE REUSED (no duplication)

The vendor-bill module (`finance-vendor-bills`, `operations:manage`), its `approve` action, the S11/S12/S16 three-way match (`goodsBillMatch.ts` → `threeWayMatch`), GRNI relief + AP posting, and the movement/GL engine — all reused verbatim. No new invoice/AP store; no new match engine.

## D · NEW CODE (non-frozen)

`domainCommand.ts`: `ApproveSupplierInvoice` + `SupplierInvoiceApproved` event + maps (`operations:manage`). `commandBus.ts`: a route case calling the existing vendor-bill `approve` via the generalized module-action helper. A 10-line concurrency NOTE comment in `vendorBillModule.ts` (no behavior change). No frozen change (rides the live channel).

## E–G · DOMAIN ENTITIES / COMMANDS / IPC PATH

Entities (reused): vendor bill, PO, goods receipt, stock movement, journal/ledger. Command: `ApproveSupplierInvoice` (target = bill id). IPC: renderer → preload → `platform:command.dispatch` → `runSecureHandler` → adapter → Application Boundary → command bus → authorization → `approve` (three-way match) → GRNI/AP → durable journal (event + outbox) → audit → response.

## H · AUTHORIZATION · I · APPROVAL

Two-layer: `requireAuth` at the channel + fine `ctx.authorize('operations:manage')` in the command bus (the one `enterprise.allows` gate). The advanced approval engine (subsystem B) and the workflow runtime are unchanged and remain canonical; no delegation/escalation/expiration invented.

## J · THREE-WAY MATCH — POLICY GATE (resolved; corrects the S24 claim)

**Tolerance is DEFINED, not undefined** — this corrects S24's "THREE-WAY MATCH TOLERANCE POLICY DECISION REQUIRED." `erp/threeWayMatch.ts` carries `DEFAULT_TOLERANCE`, used by the live vendor-bill `approve` today:
- `quantityAbsolute: 0` → **quantity match is EXACT** (billed ≤ received, the invariant Part 7 names).
- `pricePercent: 0.01` (1%), `priceAbsolute: 0.05`, `overReceiptPercent: 0.05` (5%) — pre-existing repo decisions.
- currency mismatch → MISMATCH (exact); tax is matched ex-tax; date is not matched.

I **reused these verbatim and invented nothing** (Part 5 honored). The quantity invariant (Part 7) is exact and fail-closed. **GOVERNANCE NOTE (not a blocker):** whether the non-zero `pricePercent`/`overReceiptPercent` defaults are a *ratified business policy* or a *developer default* is an operator question — recorded, values unchanged. If the operator wants price/over-receipt tolerance = 0 (strict), that is a one-line `DEFAULT_TOLERANCE` decision, not code I will change unprompted.

Proven through the live bridge: billed = received → approves + GRNI relieved; **billed > received → three-way match fails closed (CONFLICT), no approval**; nonexistent/foreign PO → the match cannot resolve it → held/refused.

## K · ACCOUNTING · L · INVENTORY INTERACTION

Reused GRNI/AP: approving a goods bill relieves GRNI / books AP via the existing GL seam (journal lines posted). No new chart/tax/valuation/fiscal rules. The receipt side (inventory movements) is unchanged from S23/S24; approval consumes received quantity, never mutates stock.

## M–P · TRANSACTION / EVENT / OUTBOX / AUDIT

Reused Session-18 `DurableCommandJournal`: `SupplierInvoiceApproved` event + outbox + idempotency, atomic commit. Audit via `governanceStore`. **No auto-rollback**: an approved goods bill relieves GRNI / books AP — a real accounting effect whose reversal is a governed operation, never a silent soft-delete; the non-draft status guard makes a commit-failure retry a refusal.

## Q · IDEMPOTENCY

100 concurrent SAME-key approvals → one economic effect (journal single-flight); one approved bill, one journal record. A different-key re-approve of an already-approved bill → refused (non-draft status guard) → CONFLICT.

## R · CONCURRENCY — REPRODUCE-FIRST, and an honest withdrawal

Part 9 asks whether a concurrent over-billing race exists. **Reproduced first**: with a per-(tenant,PO) serialization latch temporarily removed, two DIFFERENT-key full-quantity bills against one PO were approved concurrently, **12 times** → **0/12 over-billings** (aggregate billed never exceeded received; exactly one approved each time).

**Finding:** unlike the S24 receipt path (which has an `await` between its cumulative check and its write — a real race, hardened with a latch), the bill approve's cumulative already-billed read and the `stampAndEmit` run with **NO `await` between them**, so the event loop serializes two concurrent approvals of the same PO — the second reads the first's committed approval. The invariant holds **without** an explicit lock.

**Action (honest):** I initially added a per-PO latch by analogy to S24, then a negative control showed it was **not load-bearing** (the test passed without it). Per reproduce-first + "no unprovable guard / incidental protection is not a control" (§2 #31), I **removed** the latch rather than ship a guard I cannot prove matters. The over-billing invariant is asserted by the concurrency test and holds. **Recorded limit:** this safety is INCIDENTAL to the read→stamp being synchronous; a future change that introduces an `await` there MUST add the per-(tenant,PO) latch (the S24 pattern) — flagged in a code comment at the approve site.

## S · TENANT ISOLATION

The match resolves the PO through the tenant-scoped store (a foreign-tenant PO is invisible → held). `claimedTenantId` ≠ resolved principal → TENANT_SCOPE_VIOLATION, no approval. Renderer-supplied tenant never authoritative.

## T · NEGATIVE CONTROLS (each load-bearing; byte-identical restore, sha-verified)

- **NC-B**: weaken `ApproveSupplierInvoice` permission → `operations:read` → the UNAUTHORIZED test fails → the command authorization is load-bearing.
- **NC-C**: bypass the three-way-match `postable` gate → the "billed > received" test fails (an over-bill approves) → the match gate is load-bearing.
(No latch NC — the latch was withdrawn as not load-bearing, §R.) Both files restored byte-identical.

## U · RESTART RECOVERY

The durable journal's idempotency + event + outbox persist across restart (S18); a replayed key returns the original result. The GRNI/AP journal entries and the bill's approved state are durable (atomic stores). No duplicate economic effect.

## V · ARCHITECTURE / IMPORT AUDIT

`platform/command` stays Electron-free (the goods-receipt/vendor-bill imports are const action strings). No `domain→Electron/React/renderer`, no `AI→database`, no `renderer→database`. One canonical of each engine; the legacy `enterprise:module.action('approve')` path remains as compatibility.

## W · TESTS

`session25SupplierInvoice.test.ts` (7, live via `runSecureHandler`): exact match approves + event/journal/audit + GRNI; billed>received → CONFLICT; already-approved → CONFLICT; UNAUTHORIZED; TENANT_SCOPE_VIOLATION; concurrent two-bill invariant (one approves); 100-concurrent same-key single effect.

## X · TYPECHECK · Y · LINT · Z · BUILD

typecheck node+web clean; eslint clean (changed files); `electron-vite build` ✓.

## Full regression

Full main (sharded 4×): **944 files · 9887 passed · 7 skipped · 0 failed** (S24 baseline 943/9880; delta +1 file/+7 tests = `session25SupplierInvoice.test.ts`). UI: **70 files · 405 passed**.

## AA · COMMIT SHA · AB · GIT STATUS

See the handoff section below. Branch `cert/data-import-cst-integration`. `certification/baseline.json` NOT staged (custody).

## AD · POLICY DECISIONS REQUIRED

1. **GOVERNANCE NOTE (not a blocker):** ratify or adjust `DEFAULT_TOLERANCE` price (1%) / over-receipt (5%) — pre-existing defaults, reused unchanged (§J). Quantity is already exact.
2. **Packaged-macOS GUI acceptance** — operator step, carried forward.
3. Next slice (AP → Payment): inspect the existing vendor-payment engine; any payment-terms/discount policy is undefined → STOP if reached.

## AE · STATUS: 🟢 GREEN (governed invoice slice) / 🟡 packaged-GUI pending macOS

`ApproveSupplierInvoice` is a real governed end-to-end capability: authorization → exact three-way match (fail-closed) → GRNI/AP → durable event/outbox/audit, with idempotency, tenant isolation, and a proven-holding concurrency invariant (with an honest incidental-protection note). Two load-bearing negative controls. No platform rebuild, no duplicate engine, no invented tolerance, no frozen change.
