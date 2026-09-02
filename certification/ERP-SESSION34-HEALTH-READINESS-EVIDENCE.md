# ERP SESSION 34 — PRODUCTION HEALTH / READINESS PROBE

**Baseline:** Session 33 (`8b330a6`).
**Classification:** **A — PRODUCTION IMPLEMENTATION** — a real health/readiness operation that executes against actual production runtime + persistence state, reachable from the real operator UI. Not certification-only, not a hardcoded indicator.
**Status:** 🟢 **GREEN** (backend probe + failure injection + no-mutation + real operator panel proven) · 🟡 packaged-macOS runtime acceptance. **No frozen surface touched.**

## 1 · S34 OBJECTIVE

Let the operator answer "is NeuroPause alive, and is it actually ready to safely operate?" from real system state, through the real application architecture, without parallel infrastructure.

## 2 · DISCOVERY FINDINGS

No platform-infra health/readiness probe existed (MISSING; confirmed against the S31 census). The existing "readiness" is business/ops readiness (`operationsModel`, seven-dimension) and `EcoHealthStatus` is marketplace health — different concerns. Real signals found + reused: `runtimeIdentity.isReady()` (runtime-initialized), the durable command journal + S31 delivered-event sink (persistence), the outbox pending count. `readStoreFile` QUARANTINES (renames) a corrupt file — so it is unusable for a read-only probe; a new non-mutating raw-read probe was added instead.

## 3 · CAPABILITY SELECTED

A governed, read-only **health/readiness probe** exposed as the `QueryPlatformHealth` operation on the S32 governed-read seam.

## 4 · EXISTING INFRASTRUCTURE REUSED

The S32 governed-read pattern (a read branch of `platform:command.dispatch`, no `journal.run`), the existing secure bridge + RBAC + principal resolver, the durable command journal, the S31 delivered-event sink, `runtimeIdentity`, and the existing Operations Platform UI + `rawInvoke` precedent. No new IPC router, command bus, health service, or store.

## 5 · HEALTH / READINESS SEMANTICS (from real repository signals)

- **LIVENESS**: the process/runtime answered → alive; `runtime` component distinguishes *initialized* (`runtimeIdentity.isReady()`) from not.
- **READINESS**: runtime initialized AND every REQUIRED durable component operational — the journal's backing file present-and-parseable (or healthy first-run empty), and the delivered-event sink likewise.
- **Failure semantics**: a required component that is CORRUPT (present but unparseable) or DOWN (probe threw) is a genuine persistence failure → **UNHEALTHY** (never hidden behind "healthy"). A component simply not yet initialized → **ALIVE_NOT_READY**. The outbox PENDING count is a reported METRIC, never a readiness gate (at-least-once delivery is retried; a backlog is a recoverable warning, not a fatal state).

## 6 · PRODUCTION FILES CHANGED

- **MODIFIED** `platform/persistence/durableJsonStore.ts` — a non-mutating `probe()` (raw read; never quarantines/writes).
- **MODIFIED** `platform/command/durableCommandJournal.ts` + `deliveredEventLog.ts` — thin `probeHealth()` delegates.
- **NEW** `platform/command/platformHealth.ts` — `computePlatformHealth` (pure computation over real signals; defensive per-component probing).
- **MODIFIED** `ipc/handlers/platformCommandIpc.ts` — the `QueryPlatformHealth` read branch + `runtimeReady` dep + production wiring (`runtimeIdentity.isReady`).
- **NEW/MODIFIED renderer** — `ipc.platform.health()`, `PlatformHealthPanel.tsx`, mounted in `EopsPlatformTab.tsx`.
- **NEW tests** — `session34PlatformHealth.test.ts` (12, backend) + `ui-tests/platformHealthPanel.test.tsx` (3, UI).

## 7 · LIVE CALL PATH

Operator opens the Operations Platform tab → `PlatformHealthPanel` → `ipc.platform.health()` → secure preload bridge → `platform:command.dispatch` (`requireAuth`) → the health read branch → server-resolved principal → `operations:read` → `computePlatformHealth({ journal, deliveredLog, runtimeReady: runtimeIdentity.isReady })` → sanitized health → rendered. No `journal.run`, no mutation, no renderer/AI→FS/DB.

## 8 · HEALTH RESPONSE CONTRACT (bounded, sanitized)

`{ status: HEALTHY|ALIVE_NOT_READY|UNHEALTHY, live, ready, checkedAt, components: { runtime{status}, journal{status}, delivery{status, pendingOutbox} } }`. No credentials/tokens/secrets, no raw filesystem paths, no tenant business data — infrastructure-level statuses only.

## 9 · UI INTEGRATION

A compact operator "Platform health" panel (Overall / Live / Ready + Runtime / Journal / Delivery component rows + pending metric + Last checked + Refresh) mounted in the existing Operations Platform tab (no redesign). It reflects actual backend state and never hardcodes GREEN — the UI test drives HEALTHY, ALIVE_NOT_READY, and UNHEALTHY responses and asserts each renders.

## 10 · AUTHORIZATION / SECURITY

Operator-authenticated: `requireAuth` at the channel + `operations:read` (the existing operational read scope — no new permission). **Deliberately NOT a public unauthenticated endpoint** (this is an Electron enterprise app, not a web service). No renderer-supplied authority; a forged `claimedTenantId` is rejected. The response leaks no secrets, paths, or tenant data.

## 11 · TENANT BEHAVIOR

Health is INFRASTRUCTURE-level and platform-wide, so its content is not tenant-scoped — and deliberately carries NO tenant business data. It still requires an authenticated principal (which implies a tenant) and validates a claimed tenant, so no cross-tenant authority is exercised and no tenant data is exposed through a global health response.

## 12 · FAILURE-INJECTION RESULTS

Proven (12 backend tests): HEALTHY (runtime ready + persistence ok); ALIVE_NOT_READY (`runtimeReady=false`); UNHEALTHY on a CORRUPT journal file (and the probe does NOT quarantine/rename it — asserted byte-identical); UNHEALTHY on a corrupt delivered-sink file; delivery `not_ready` when the sink is unwired; a pending outbox backlog reported as a METRIC while still HEALTHY/ready; UNAUTHORIZED (no `operations:read`); UNAUTHENTICATED (no principal); forged-tenant rejected; **the probe NEVER mutates durable state** (5 repeated queries leave record count + journal bytes unchanged); restart → HEALTHY.

## 13 · CONCURRENCY RESULTS

Concurrent health queries + a command in flight: all coherent; the reads add nothing (exactly one write recorded, health reads mutate nothing). The probe is read-only, so it never races the S33 serialized write path.

## 14 · RESTART / RECOVERY RESULTS

After `reload()` the readiness check returns HEALTHY/ready. A corrupt persisted file is honestly reported UNHEALTHY (not silently recovered) and is left untouched by the read-only probe.

## 15 · PERFORMANCE OBSERVATIONS

Cheap by construction: `runtimeReady` is a boolean flag; the journal/sink probes are one small-file raw read each (only on demand, never on the command path); the pending count is an in-memory O(n) read. No full journal scan, no rebuild, no write-to-measure. No caching introduced (not needed).

## 16 · S31 REGRESSION

`session31OutboxDelivery.test.ts` passes (part of the 194/194 platform run). The relay + delivered sink are unchanged apart from an additive read-only `probeHealth()`.

## 17 · S32 REGRESSION

`session32OperationalRead.test.ts` passes. The operational read is unaffected; the health branch is a sibling read on the same handler.

## 18 · S33 REGRESSION

`session33ConcurrentCommands.test.ts` + `durableJsonStore.test.ts` pass. The added `probe()` is read-only and does not touch the S33 write-serialization path.

## 19 · FULL REGRESSION

Full main (sharded 4×): **954 files · 9986 passed · 7 skipped · 0 failed** (S33 953/9974; delta +1 file/+12 tests). UI: **72 files · 411 passed** (+1 file/+3). No existing test weakened, skipped, or rewritten.

## 20 · TYPECHECK / LINT / BUILD

typecheck node+web clean; eslint clean (changed files); `npm run build` (electron-vite) ✓.

## 21 · PRODUCTION IMPLEMENTATION CLASSIFICATION

**A — PRODUCTION IMPLEMENTATION.** New production source (`platformHealth.ts`, the non-mutating store probe, the health read branch, the operator panel) reached by the real live caller (`runtimeCore` → `buildPlatformCommandHandlers` with `runtimeIdentity.isReady`; the mounted panel for the UI). The probe executes against actual runtime + persistence state and honestly reports UNHEALTHY on a real persistence failure.

## 22 · ARCHITECTURE AUDIT

No duplicate health framework / IPC router / command bus / authorization / persistence / journal / outbox / event system / audit system; no shadow health database; no renderer→FS/DB, no AI→FS/DB. Reuses the S32 governed-read pattern, existing runtime state, the existing `DurableJsonStore`, journal, outbox, S31 relay, existing authorization, and the existing UI surface. `platform/command` stays Electron-free (`runtimeIdentity` is injected via `runtimeReady`, kept in the IPC composition layer). No frozen surface changed.

## 23 · REMAINING GATES

- 🟢 The health/readiness capability is live and honest.
- 🟡 Packaged-macOS runtime acceptance of the panel + probe (operator step).
- ⚪ GRAY: richer signals (fiscal-period init, connector reachability, backend/DB reachability where applicable) could be added as future readiness inputs — deliberately not invented here (only real, currently-defined signals were used).

## 24 · NEXT RECOMMENDED SESSION

Extend readiness with additional REAL signals as they become relevant (e.g. a shutdown-in-progress state if one is introduced, or backend/DB reachability for the gated Postgres path), or resume the operational-visibility track (delivery-failure drill-down over the S31 sink). Each only when a real signal exists — no invented dependencies.

## Status: 🟢 GREEN — the platform can answer "alive, and actually ready?" from real state

A real operator can now check platform liveness + readiness through the real UI and governed IPC, computed from actual runtime + persistence state — honestly reporting UNHEALTHY on a genuine persistence failure, never hardcoding GREEN, never mutating durable state, and creating no parallel architecture or frozen change.
