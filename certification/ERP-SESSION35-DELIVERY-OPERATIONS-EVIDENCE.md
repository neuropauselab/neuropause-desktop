# ERP SESSION 35 — DELIVERY FAILURE OPERATIONS / OUTBOX DRILL-DOWN

**Baseline:** Session 34 (`8fbb92b`).
**Classification:** **A — PRODUCTION IMPLEMENTATION** — a real governed read over actual S31 outbox/delivery state, reachable from the real operator UI, that makes genuine delivery FAILURES observable. Not certification-only, not a hardcoded indicator, not a mock dashboard.
**Status:** 🟢 **GREEN** (real failure reproduced through the S31 relay + observable through the new surface + tenant/authz/sanitization live + real operator panel). 🟡 packaged-macOS runtime acceptance. **No frozen surface touched.**

## 1 · OBJECTIVE

Let an authenticated operator answer: what deliveries are pending, which failed/retried, what event, when it was queued/delivered, how many attempts, the current delivery state — and inspect all of it safely (no secrets, no tenant data leakage). Built over the EXISTING S31 delivery relay + Session-18 durable outbox, through the S32/S34 governed read seam — no new event system, queue, or monitoring framework.

## 2 · DISCOVERY FINDINGS

The single source of delivery truth is the **Session-18 durable command journal's outbox state** (`CommittedCommand.outbox`), which already persists everything needed for drill-down:

- `outbox.status` — `PENDING | PROCESSING | DELIVERED | RETRYABLE`
- `outbox.attempts` — incremented on each `markProcessing` (real per-pass count)
- `outbox.lastError` — set on `markRetryable` (the failure reason)
- `outbox.deliveredAt` — set on `markDelivered` (completion time)
- plus `committedAt` (queued time) and the immutable `event` (type / aggregate / correlation).

The S31 `DeliveredEventLog` sink holds **only successes by design** (its docstring: "delivery state stays in the journal's outbox") — so it is a corroborating confirmation, NOT the drill-down source. The S32 `buildOperationalHistory` already projected outbox status/attempts/lastError, confirming the data is present and safe to expose.

**No STOP / decision memo needed:** useful failure drill-down IS supported by existing durable data. One honest gap recorded (GRAY, §19): there is no per-attempt / explicit `failedAt` timestamp — the persisted instants are `committedAt` (queued) and `deliveredAt` (completed). Adding a `failedAt` would be a write-path change to the S18 journal schema (a mutation), out of scope for a read-only session; it was NOT invented.

## 3 · CAPABILITY IMPLEMENTED

A governed, read-only **`QueryDeliveryOperations`** operation — a delivery-failure-focused, tenant-scoped, bounded, sanitized projection of the outbox delivery state. Routed through the SAME S32/S34 read branch of `platform:command.dispatch` (no new channel, command, bus, queue, delivery engine, store, or router). The operator panel answers all seven questions from real state.

Derived delivery states (a PURE re-labelling of the four persisted outbox statuses — no invented lifecycle/policy): `PENDING` (queued, never attempted) · `IN_FLIGHT` (PROCESSING) · `RETRYING` (RETRYABLE — the failure the operator hunts) · `DELIVERED`.

## 4 · EXISTING INFRASTRUCTURE REUSED

The S32 governed-read branch (`OPERATIONAL_READ_OPERATIONS` set + shared `boundLimit`/`trimError`/`OUTBOX_STATUSES`), the existing secure bridge + `requireAuth` + `operations:read` RBAC + server-resolved principal + claimed-tenant validation, the Session-18 durable journal (`journal.records(tenant)`), the S31 delivered sink (corroborating count), the `rawInvoke` renderer precedent, and the existing Operations Platform tab. No new IPC router, command bus, permission, store, event system, or monitoring service.

## 5 · CANONICAL LIVE PATH

Operator opens the Operations Platform tab → `DeliveryOperationsPanel` → `ipc.platform.deliveryOperations()` → secure preload bridge → `platform:command.dispatch` (`requireAuth`) → the read branch → server-resolved principal → `operations:read` → tenant validated against the principal → `buildDeliveryOperations(journal, deliveredLog, principal.tenantId, params)` → sanitized projection → rendered. No `journal.run`, no command bus, no mutation, no renderer/AI → FS/DB.

## 6 · DELIVERY-STATE SEMANTICS

Read from real persisted outbox state. Per delivery: `txId`, `eventId`, `eventType`, `aggregateId`, `correlationId`, `deliveryState` (derived), `status` (raw outbox), `attempts`, `queuedAt` (= committedAt), `deliveredAt?`, bounded `lastError?`. Counts always reflect the FULL tenant picture (`total`/`pending`/`inFlight`/`retryable`/`delivered`) even while a status filter narrows the row list — so the operator sees the true number of failed deliveries regardless of filter. `sinkDelivered` is the S31 sink's corroborating count.

**Delivery operations (S35) vs health (S34) are kept separate:** health asks "can the platform operate its required infrastructure?"; delivery operations asks "what happened to individual committed events?". A live query endpoint never turns a failed delivery GREEN — a RETRYABLE entry renders `RETRYING` (red), always.

## 7 · SECURITY / RBAC

`requireAuth` at the channel + `operations:read` (the existing operational read scope — **no new permission**; discovery confirmed it is the same scope S32/S34 use and is sufficient). Deliberately NOT a public unauthenticated endpoint (Electron enterprise app). No renderer-supplied authority; a forged `claimedTenantId` is rejected (`TENANT_SCOPE_VIOLATION`). Sanitized projection: no raw command `result`, no event `detail`/payload, no secrets/tokens/credentials, no filesystem paths; `lastError` is bounded to 200 chars. Malformed status filter fails closed (`INVALID_STATUS_FILTER` → `VALIDATION_ERROR`); pagination bounded (default 25, max 100).

## 8 · TENANT ISOLATION

Delivery records carry tenant attribution (`CommittedCommand.tenantId`), so the surface is tenant-scoped: `journal.records(tenantId)` filters by construction, and the tenant is the server-resolved principal's, never the renderer's. Test H proves tenant-A cannot see tenant-B's failed deliveries and the response never contains tenant-B identifiers.

## 9 · FAILURE-INJECTION EVIDENCE (13 backend tests, `session35DeliveryOperations.test.ts`)

Failures are REPRODUCED FIRST through the EXISTING production relay `dispatchOutbox` with a throwing consumer — never weakened to pass. Real committed commands are created through the REAL command bus / `journal.run`, then delivery is driven explicitly through the real relay for deterministic single-attempt outcomes.

- **A** healthy DELIVERED — `deliveryState=DELIVERED`, real `deliveredAt`, delivered count 1.
- **B** delivery FAILURE (throwing consumer) — surfaces as `RETRYING`/`RETRYABLE`, bounded `lastError` ("downstream sink unreachable…"), `attempts ≥ 1`, retryable count 1, no `deliveredAt`.
- **C** retry semantics unchanged — a RETRYABLE entry is redelivered on the next relay pass and becomes DELIVERED, `attempts` 1→2 (retry genuinely happened, observable), sink delivered exactly once (idempotent).
- **D** PENDING (never attempted) — visible as `PENDING`, 0 attempts, no `deliveredAt`.
- **E** multiple events — most-recent-first, bounded; oversized limit clamped to 100, default 25 (never "everything"); a valid status filter narrows rows while counts stay truthful over the full set.
- **F** restart — after `journal.reload()` the RETRYABLE state + `lastError` survive (existing durability).
- **G** concurrent reads — 8 concurrent reads deterministic; journal record count + pending count unchanged (reads mutate nothing).
- **H** tenant isolation — tenant-A cannot see tenant-B failed deliveries; no tenant-B leakage.
- **I** UNAUTHORIZED (no `operations:read`), UNAUTHENTICATED (no principal), FORGED tenant — all refused.
- **J** malformed filter fails closed.
- Plus SANITIZED (no result/detail/secrets/paths) and NO-MUTATION (5 reads leave `journal.records` byte-identical).

## 10 · CONCURRENCY EVIDENCE

Test G: the read is pure (no `journal.run`, no `store.put`), so concurrent reads never race the S33 serialized write path, are deterministic, and mutate neither the journal nor the sink.

## 11 · RESTART EVIDENCE

Test F: a real failed (RETRYABLE) delivery survives a `reload()` (fresh-process simulation) with its `lastError` intact — the operator still sees the failure after restart, per existing durability semantics.

## 12 · UI EVIDENCE (3 tests, `ui-tests/deliveryOperationsPanel.test.tsx`)

`DeliveryOperationsPanel` renders from the real governed IPC (asserts `QueryDeliveryOperations` is the operation sent): DELIVERED renders green; a FAILED delivery visibly renders `RETRYING` (red) with its bounded reason — never hardcoded success; PENDING renders as pending. Mounted in the existing Operations Platform tab (`EopsPlatformTab`) — no new navigation. Read-only: no retry/replay/delete/force-deliver controls.

## 13 · S31 / S32 / S33 / S34 REGRESSION

`session31OutboxDelivery` 7/7 · `session32OperationalRead` 12/12 · `session33ConcurrentCommands` 6/6 · `durableJsonStore` 6/6 · `session34PlatformHealth` 12/12 — all pass unchanged. The only edits to shared files are additive (exported helpers; one routing branch; one appended read method + one mounted panel).

## 14 · FULL TEST COUNTS

Full main (sharded 4×): **955 files · 9999 passed · 7 skipped · 0 failed** (S34 was 954 / 9986 / 7 — delta exactly +1 file / +13 tests, the new backend suite). UI: **73 files · 414 passed** (S34 72 / 411 — delta +1 file / +3, the new panel suite). One first-run UI flake in the pre-existing `errorStatesGate15Round47.test.tsx` (KnowledgeWorkspaceView async-retry timing, unrelated to S35) did not reproduce on a clean re-run (73/414). No existing test weakened, skipped, or rewritten.

## 15 · TYPECHECK / LINT / BUILD

typecheck node + web clean; eslint clean on all changed/new files; `npm run build` (electron-vite) ✓.

## 16 · FILES CHANGED

Production source — **NEW** `platform/command/deliveryOperations.ts` (the projection); **MODIFIED** `platform/command/operationalRead.ts` (register `QueryDeliveryOperations`; export shared `boundLimit`/`trimError`/`OUTBOX_STATUSES`/`MAX_LIMIT`/`DEFAULT_LIMIT`), `ipc/handlers/platformCommandIpc.ts` (route the new op on the existing read branch), `renderer/src/lib/ipc.ts` (`ipc.platform.deliveryOperations`), `renderer/src/operationsPlatform/EopsPlatformTab.tsx` (mount the panel); **NEW** `renderer/src/operationsPlatform/DeliveryOperationsPanel.tsx`. Tests — **NEW** `ipc/handlers/session35DeliveryOperations.test.ts` (13), `ui-tests/deliveryOperationsPanel.test.tsx` (3). Evidence — this file.

## 17 · FROZEN SURFACES TOUCHED

**None.** `git diff --name-only` shows no `packages/shared`, `runtimeCore.ts`, `cst/`, `connectors/index.ts`, `enterprise/index.ts`, `tenantContext`, or `auth/`. `certification/baseline.json` was already modified in the working tree at session start (pre-existing, preserved) and is deliberately NOT staged. The read reuses the existing `PlatformCommandDispatch` channel via `rawInvoke` — no frozen IPC contract change (the S32/S34 precedent).

## 18 · ARCHITECTURE AUDIT

No duplicate outbox / delivery sink / event bus / queue / persistence store / IPC router / command bus / auth framework / monitoring service; no shadow delivery database; no renderer → FS/DB, no AI → FS/DB; no tenant authority in the renderer; no new microservice/Kafka/Redis. The projection holds no state, opens no store, mints no event, and performs zero writes — it only shapes the SAME journal outbox state S32/S34 already read. Delivery state has ONE owner (the Session-18 journal outbox); this surface reads it, never a second copy.

## 19 · REMAINING YELLOW / GRAY / RED

- 🟡 **YELLOW** — packaged-macOS runtime acceptance of the panel + read (operator step; standing each session).
- ⚪ **GRAY** — no per-attempt / `failedAt` timestamp is persisted (only queued/delivered instants); adding one is an S18 journal write-path change, deliberately not invented here.
- ⚪ **GRAY / OUT OF SCOPE** — retry / replay / force-deliver / manual state mutation are read-only-excluded: their operator-action policy is UNDEFINED, so no mutating control was added. Recorded as a separate future policy decision, not invented.
- 🔴 **RED** — none.

## 20 · COMMIT HASH

`feat(erp-s35): delivery failure operations` — SHA recorded at commit time (see §21/§22).

## 21 · PUSH STATUS

The Linux sandbox has no git credentials — **push cannot be performed here**. Do NOT assume it was pushed.

## 22 · MAC HANDOFF

From the repo root on the Mac:

```
git log -1 --oneline          # expect the erp-s35 commit at HEAD
git push origin cert/data-import-cst-integration
```

## Status: 🟢 GREEN — real delivery failures are now observable and actionable to an authenticated operator, from real S31 outbox state, through the governed read path and a real operator panel — with no parallel architecture, no frozen change, and no mutation.
