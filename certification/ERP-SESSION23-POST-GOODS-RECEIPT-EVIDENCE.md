# ERP SESSION 23 — PostGoodsReceipt ON THE CANONICAL PLATFORM PATH (PO → Goods Receipt → Inventory + GRNI)

**Baseline:** Session 22 live IPC (`9cbf9d2`).
**Status:** 🟢 **GREEN (governed live path, real-bridge proven)** · 🟡 packaged-GUI acceptance remains a macOS operator step (unchanged from S22 — Linux sandbox cannot launch the darwin Electron binary).
**Frozen surfaces touched: NONE.** The next ERP slice rides the existing live `platform:command.dispatch` channel; only non-frozen `platform/command` changed.

## A · SESSION 22 VERIFICATION (independently re-checked, not trusted)

Import-graph verified: the production caller exists (`runtimeCore.ts:2196` pushes `buildPlatformCommandHandlers({ registry: enterprise.modules, allows: enterprise.allows })`), and there is **exactly one** of each canonical piece — `dispatchCommand` (commandBus.ts), `handleApplicationRequest` (applicationService.ts), `DurableCommandJournal` (durableCommandJournal.ts), `registerSecureHandlers` (secureBridge.ts), the advanced approval engine `evaluateApproval` (erp/approvalEngine.ts), the workflow runtime `evaluateWorkflow` (workflow/workflowRuntime.ts). No duplicate path. S22 live IPC intact.

## B · CURRENT LIVE IPC ARCHITECTURE

Unchanged and reused: renderer `window.neuropause.invoke('platform:command.dispatch', …)` → preload allowlist → `runSecureHandler` → `platformCommandIpc` → `ElectronClientAdapter` → Application Boundary → command bus → authorization → workflow → domain command → durable transaction → event → outbox → audit. Adding a new command needs NO new channel/contract/frozen change — the one governed channel carries any `DomainCommandType`.

## C · EXISTING APPROVAL ENGINE REUSED

No approval engine created or modified. The PR approved-gate (S20 workflow at the command level) and the advanced engine (subsystem B: thresholds/multi-step/SoD/self-approval/spend authority on the document `setStatus` path) both remain authoritative and untouched.

## D · ERP MODULE SELECTED · E · WHY NEXT IN SEQUENCE

**`PostGoodsReceipt`** — the goods-receipt posting step. The Part-3 canonical flow is PR → Approval → PO → **Receipt → Inventory impact** → Invoice matching → Accounting. S22 made PR→approve→convert→PO live; the receipt is the literal next step. It reuses the existing S16 goods-receipt engine (`postMultiLineReceipt` → per-line valued `receive` movement + Dr Inventory / Cr GRNI, all-or-nothing) — no new inventory store, no `stock += X`, no invented accounting.

## F · DOMAIN ENTITIES (all reused; none created)

`procurement-receipts` (goods receipt, status pending→received), `procurement-orders` (PO + lines), `inventory-stock-movements` (the movement ledger — inventory balance is derived from it), `finance-journal-entries` + `finance-ledger-accounts` (GRNI/inventory GL, auto-provisioned), `inventory-products` (standard cost). Traceability preserved: PO → PO Line → Receipt → Receipt Line → Movement (stamped by `postMultiLineReceipt` into `receiptMovements`).

## G · COMMANDS · H · IPC CONTRACTS

`PostGoodsReceipt` added to `DomainCommandType` + `GoodsReceiptPosted` to `DomainEventType`; `EVENT_FOR_COMMAND` + `PERMISSION_FOR_COMMAND` (`procurement:manage`). It acts on an existing goods-receipt (`target` = GR id). The wire contract is the existing `PlatformCommandDispatchRequest` (operation is an untrusted string validated by the bus) — no shared/contract change.

## I · AUTHORIZATION · J · POLICY · K · APPROVAL · L · WORKFLOW

Two-layer: `requireAuth` at the channel + fine `ctx.authorize('procurement:manage')` inside the command bus (the one `enterprise.allows` gate). Policy: the DEFINED no-over-receipt invariant (cumulative received ≤ ordered per SKU) is enforced by the existing engine. No new approval step is defined for goods receipt (posting is the authorized consequential action); none was invented.

## M · TRANSACTION · N · PERSISTENCE · O · EVENTS · P · OUTBOX · Q · AUDIT

Reused Session-18 `DurableCommandJournal` (idempotency + `GoodsReceiptPosted` event + outbox, atomic commit). The inventory movements themselves post all-or-nothing via `postMovementLinesAtomic`. Audit via the enterprise `governanceStore`. **Atomicity model (recorded honestly):** `PostGoodsReceipt` provides **no auto-rollback** — a posted receipt is a real inventory movement, and reversing it is a governed decision, never a silent soft-delete. At-most-once is guaranteed **without** compensation: the module's `received` status guard refuses any re-post, so a commit-failure retry is refused, not re-executed. This is the established effect/evidence two-class model (§19), not a STOP.

## R · IDEMPOTENCY · S · CONCURRENCY

Double-guarded: (1) the module refuses to re-post a `received` receipt (document-level), (2) the durable journal keys on the command's idempotency key (command-level). Proven: 100 concurrent `PostGoodsReceipt` with the same key → exactly ONE post, ONE set of movements (not 100); a subsequent same-key call replays durably; a different-key re-post is refused (CONFLICT) with no second movement.

## T · TENANT ISOLATION

`claimedTenantId` ≠ resolved principal → TENANT_SCOPE_VIOLATION, no effect. The goods receipt is resolved through the tenant-scoped registry (a foreign GR is invisible). Renderer-supplied tenant never overrides the server-resolved tenant.

## U · AI GOVERNANCE

An AI agent posting a receipt uses the identical `AIAdapter` → same command bus → same `procurement:manage` gate; no DB/store handle, no bypass. Not separately re-tested this slice (structurally identical to S21/S22 AI governance, unchanged).

## V · NEGATIVE CONTROLS (each load-bearing; byte-identical restore, sha-verified)

| NC | Guard mutated | Matched test | Result |
|----|---------------|--------------|--------|
| A | weaken PostGoodsReceipt permission → procurement:read | UNAUTHORIZED without procurement:manage | 🔴 fails → load-bearing |
| B | defeat the command idempotency key | 100 concurrent → ONE post | 🔴 fails → load-bearing |
| C | break the module double-post status guard | NO DUPLICATE RECEIPT | 🔴 fails → load-bearing |

## W · PACKAGED ELECTRON RESULT

Unchanged from S22: the packaged-GUI acceptance is a macOS operator step (`e2e/platformCommandLive.e2e.cjs` + runbook). `PostGoodsReceipt` rides the identical `platform:command.dispatch` channel already exercised by that harness, and is proven at the real-secure-bridge level here (`session23GoodsReceipt.test.ts`). The Mac harness can be extended with a receipt step; it was not, to avoid shipping unrun harness code. **Packaged-GUI is honestly marked pending, not GREEN.**

## X · ARCHITECTURE / IMPORT AUDIT

`platform/command` stays Electron-free (the S19/S21 independence tests remain green; the goods-receipt import is a const `POST_RECEIPT_ACTION`, the same shape as the existing `CREATE_PO_ACTION` import). No `domain→Electron/React/renderer`, no `AI→database`, no `renderer→database`. One canonical path; no second engine/router/workflow/transaction/event/outbox/audit.

## Y · PERFORMANCE

No new hot path; `PostGoodsReceipt` reuses the existing movement/GL engine. No measurable regression (full suite runtimes unchanged from S22).

## Z · FULL REGRESSION

Full main (sharded 4×): **942 files · 9877 passed · 7 skipped · 0 failed** (S22 baseline 941/9871; delta +1 file/+6 tests = `session23GoodsReceipt.test.ts`). UI: **70 files · 405 passed**. Focused S23 suite: 6 passed. typecheck node+web clean; typecheck:test no S23-file errors; eslint clean; `electron-vite build` ✓.

## AA · FILES CHANGED

Non-frozen only: `apps/desktop/src/main/platform/command/domainCommand.ts` (PostGoodsReceipt + GoodsReceiptPosted + maps), `apps/desktop/src/main/platform/command/commandBus.ts` (generalized module-action helper + route case), NEW `apps/desktop/src/main/ipc/handlers/session23GoodsReceipt.test.ts`, this evidence doc. **No frozen surface touched; `baseline.json` not staged.**

## AB · COMMIT SHA

One commit (see git log); the user pushes from the Mac.

## AC · REMAINING RISKS / DECISIONS

1. **Packaged-GUI acceptance** (macOS operator step) — unchanged carry-forward.
2. **Three-way match / invoice** (Part 9): the next procurement slice would route supplier-invoice matching through the command bus; the S11/S12 engine + no-over-receipt/GRNI exist, but any invoice-quantity tolerance beyond the exact ≤-received invariant is **undefined policy → STOP** (not built this session).
3. **Draft goods-receipt creation** currently uses the existing `enterprise:module.create` path (record entry, non-consequential); the consequential POSTING is now on the canonical governed path. The legacy create/action path remains as COMPATIBILITY (not removed, per Part 13).
4. Delegation/escalation/expiration/valuation-method changes remain undefined policy — not invented.

## AD · STATUS: 🟢 GREEN (governed live slice) / 🟡 packaged-GUI pending macOS

`PostGoodsReceipt` is a real governed end-to-end capability through the live secure bridge: authorization → policy (no-over-receipt) → durable transaction → REAL inventory movement + GRNI → event → outbox → audit, with double-guarded no-duplicate-receipt, 100-concurrent single-effect, tenant isolation, and three load-bearing negative controls. No platform rebuild, no duplicate engine, no frozen change. The only unproven link is the packaged-macOS mouse-click, carried forward honestly.
