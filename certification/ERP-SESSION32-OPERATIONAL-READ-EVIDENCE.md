# ERP SESSION 32 — GOVERNED OPERATIONAL READ SURFACE

**Baseline:** Session 31 (`159ea29`).
**Classification:** **A — PRODUCTION IMPLEMENTATION** (new production source + a real operator UI, wired to real callers). **Not certification-only.**
**Status:** 🟢 **GREEN** for the code path (backend read + attack + operate + a rendered operator panel, all proven) · 🟡 packaged-macOS runtime acceptance (operator) · 🔴 pre-existing `DurableJsonStore` concurrent-*write* race (sharpened here; out of scope). **No frozen surface touched.**

## 1 · S32 OBJECTIVE

Close the write-only operational gap by exposing governed, tenant-safe operational information (command history + outbox/delivery status + delivered events) from the EXISTING durable command journal and the S31 delivered-event sink — reachable by a real operator through the real UI.

## 2 · DISCOVERY FINDINGS

All 13 platform commands are writes; the durable journal was write-only to the app; `PlatformCommandDispatchRequest`/`Response` can carry a read (operation string + payload + `data`) **without a frozen change**; the channel is on the preload allowlist; the frozen `IpcResponseMap` has no entry for it, so the renderer uses the sanctioned `rawInvoke` precedent (`m365Propose`) — no frozen change. Forcing a read through `journal.run` would fabricate a transaction/event/outbox and was rejected.

## 3 · CAPABILITY IMPLEMENTED

A governed **READ operation** `QueryOperationalHistory` answered on a READ BRANCH of the existing `platform:command.dispatch` handler that NEVER enters the command bus / `journal.run` — it mints no event, commits no transaction, writes no outbox, mutates nothing. It returns a tenant-scoped, bounded, sanitized projection of command history + outbox status + delivered events, and is surfaced in a real operator panel.

## 4 · ARCHITECTURE / DESIGN CHOSEN AND WHY

A **read branch alongside the write path**, in the non-frozen IPC handler — not a new command type in the command bus (which would have forced fake `EVENT_FOR_COMMAND`/`journal.run` semantics), not a new IPC channel/router (which would touch frozen `packages/shared`), not a second data-access framework. The read is a pure PROJECTION over the existing journal + S31 sink. This reuses the exact governed seam (secure bridge → server-resolved principal → RBAC → tenant scope) while keeping reads off the durable-write path.

## 5 · PRODUCTION FILES CHANGED

- **NEW** `platform/command/operationalRead.ts` — the sanitized, bounded, tenant-scoped read projection.
- **MODIFIED** `ipc/handlers/platformCommandIpc.ts` — the governed read branch (auth/RBAC/tenant/bounds/sanitize) + `deliveredLog` threaded into the deps and the production wiring.
- **NEW** `renderer/operationsPlatform/OperationalHistoryPanel.tsx` — the operator panel.
- **MODIFIED** `renderer/lib/ipc.ts` — `ipc.platform.operationalHistory()` (rawInvoke precedent, no frozen change).
- **MODIFIED** `renderer/operationsPlatform/EopsPlatformTab.tsx` — mounts the panel in the existing Operations Platform tab.
- **NEW** tests: `ipc/handlers/session32OperationalRead.test.ts` (backend, 12) + `ui-tests/operationalHistoryPanel.test.tsx` (UI, 3).

## 6 · LIVE READ CALL PATH

Operator opens the Operations Platform tab → `OperationalHistoryPanel` → `ipc.platform.operationalHistory()` → secure preload bridge → `platform:command.dispatch` (`requireAuth`) → the read branch → server-resolved principal → `operations:read` RBAC → tenant from the principal → `buildOperationalHistory(journal, deliveredLog, tenantId, bounded params)` → sanitized response → rendered. No renderer→DB, no AI→DB, no second router.

## 7 · AUTHORIZATION MODEL

`requireAuth` at the channel + `operations:read` checked against the server-resolved principal's permissions (the existing RBAC set, `enterprise.allows`). Deny-by-default: no principal → UNAUTHENTICATED; missing `operations:read` → UNAUTHORIZED. No new permission invented — `operations:read` is the existing operational read scope.

## 8 · TENANT-ISOLATION MODEL

The tenant is the server-resolved principal's tenant; `journal.records(tenantId)` / `pendingOutbox(tenantId)` / `deliveredLog.delivered(tenantId)` are tenant-filtered by construction. A renderer-supplied `claimedTenantId` that mismatches → TENANT_SCOPE_VIOLATION. A forged tenant can never widen the read; tenant-A cannot see tenant-B history (proven).

## 9 · UI INTEGRATION

A real operator panel (`OperationalHistoryPanel`) mounted in the existing `EopsPlatformTab` (no new nav/shell), read-only, showing recent governed commands, their outbox/delivery status, and pending/delivered counts, with a Refresh control. UI test (jsdom + Testing Library, the house pattern) drives the real `render` → `ipc.platform.operationalHistory` → routed bridge → asserts it sends `QueryOperationalHistory` and renders the history, the unavailable state on refusal, and the empty state.

## 10 · DATA / READ-MODEL SOURCE

Command history + outbox status from the durable command journal (Session 18); delivered-event status from the S31 `DeliveredEventLog`. No new store, no shadow operational database. Sanitized fields only: txId, commandType, actor, aggregate id/type, correlationId, committedAt, idempotencyKey, outbox status/attempts/lastError, delivered eventId/type/deliveredAt. Excluded: raw command `result`, raw event `detail`, and anything secret-shaped. Bounded (limit clamped 1–100, default 25); a malformed status filter FAILS CLOSED.

## 11 · CONCURRENCY ANALYSIS (reproduce-first)

The read is PURE (no mutation), so it can run concurrently with the S31 serialized drain without racing it — proven: 8 concurrent reads return a deterministic snapshot and mutate nothing (record count + outbox state unchanged), stable over repeated runs. **Reproduce-first also surfaced a real PRE-EXISTING defect, sharpened from S31's note:** concurrent *writes* (different-key `CreateSalesOrder`) fail 7/8 because `DurableJsonStore.persist()` uses a fixed `${filePath}.tmp` and concurrent persists collide (ENOENT on rename) — records persist but `journal.run` throws and reports failure. This is a WRITE-path defect in a shared primitive, NOT introduced by S32's read; per scope discipline it is recorded as a RED gate (a dedicated hardening session: unique tmp names or a per-store write latch), not fixed in a read-surface session.

## 12 · ATTACK / NEGATIVE TEST RESULTS

`session32OperationalRead.test.ts` (12, live via `runSecureHandler`): happy path (history + outbox + delivered); sanitization (no `result`/`detail`/secret-shaped fields); empty history; UNAUTHORIZED (no `operations:read`); UNAUTHENTICATED (no principal); cross-tenant (A cannot see B); forged tenant → TENANT_SCOPE_VIOLATION; malformed status filter → VALIDATION_ERROR (fail closed); oversized/unbounded pagination clamped (999999→100, default 25); valid status filter narrows; concurrent reads safe + non-mutating; restart survives. UI (3): renders history, unavailable-on-refusal, empty state.

## 13 · RESTART / RECOVERY RESULTS

After `journal.reload()` + `deliveredLog.reload()`, the read still returns the correct history + delivery counts. Reads observe durable state; they persist nothing, so restart cannot lose or corrupt anything through the read path.

## 14 · FULL REGRESSION

Full main (sharded 4×): **951 files · 9962 passed · 7 skipped · 0 failed** (S31 950/9950; delta +1 file/+12 tests). UI: **71 files · 408 passed** (+1 file/+3). No existing test weakened/skipped/rewritten.

## 15 · TYPECHECK / LINT / BUILD

typecheck node+web clean; eslint clean (all changed files); `npm run build` (electron-vite) ✓.

## 16 · PRODUCTION IMPLEMENTATION vs CERTIFICATION

**A — PRODUCTION IMPLEMENTATION.** New production source (`operationalRead.ts` + the handler read branch + the renderer service + the operator panel) reached by the real live caller (`runtimeCore` → `buildPlatformCommandHandlers` for the backend; the mounted panel for the UI). A real operator can request operational history through the real UI, through the real secure bridge and governed IPC, and receive tenant-authorized data from the existing journal + S31 sink.

## 17 · ARCHITECTURE AUDIT

No second command bus / IPC router / Application Boundary / authorization system / audit system / journal / outbox / event bus; no shadow operational database; no renderer-direct or AI-direct persistence. S31's `DeliveredEventLog` stays canonical for delivered events; the durable journal stays canonical for command history. The read is a projection over both. `platform/command` stays Electron-free. No frozen/shared contract changed.

## 18 · REMAINING YELLOW / RED / GRAY

- 🟡 Packaged-macOS runtime acceptance of the panel + governed read (operator step).
- 🟡 Richer operator views (delivery-failure drill-down, filters beyond status, pagination cursors) — deferred; the read model + panel are minimal by design.
- 🔴 (pre-existing, sharpened) `DurableJsonStore` concurrent-`put` to one file is not lock-safe — a WRITE-path defect (a command can report failure while its record persisted). Recommended dedicated hardening session (unique tmp filenames or per-store write serialization).
- ⚪ GRAY: read latency/throughput at large journal sizes (the read is O(n) over the tenant's records; fine for realistic volumes, a future pagination-cursor optimization if needed).

## 19 · NEXT RECOMMENDED SESSION

Harden `DurableJsonStore` concurrent writes (the RED gate) — the smallest correct fix (unique per-persist tmp filenames, plus a per-store write latch) with reproduce-first + a regression test, restoring correct at-least-once behavior for concurrent governed commands across the whole platform.

## Status: 🟢 GREEN (governed operational read surface, real UI proven) / 🟡 packaged-runtime acceptance pending

A real operator can now view tenant-scoped governed command + delivery history through the real application UI and governed IPC, over the existing durable journal + S31 sink — with no parallel architecture, no frozen-surface change, no security or tenant boundary weakened, and a genuine pre-existing write-path concurrency defect reproduced and recorded (not papered over).
