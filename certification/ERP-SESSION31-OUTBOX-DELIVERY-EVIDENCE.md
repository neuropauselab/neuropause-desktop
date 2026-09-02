# ERP SESSION 31 — PRODUCTION OUTBOX DELIVERY RELAY (production-readiness track)

**Baseline:** Session 30 (`c26f19c`).
**Classification:** **A — PRODUCTION IMPLEMENTATION** (new production source wired to the real live caller) + B (integrates the existing test-only `dispatchOutbox` relay). **Not certification-only.**
**Status:** 🟢 **GREEN** for the code path (build → integrate → attack → operate proven) · 🟡 packaged-macOS runtime acceptance (operator). **No frozen surface touched.**

## 1 · SESSION 31 OBJECTIVE

Begin the production-readiness track: identify and BUILD one genuinely missing operational capability on the real governed path, not another ERP transaction.

## 2 · CAPABILITY SELECTED

**Production outbox delivery relay** — drain the durable command journal's outbox in production, delivering each committed domain event to a durable, tenant-scoped, idempotent sink, with a shutdown drain.

## 3 · WHY IT WAS SELECTED

Discovery proved the durable outbox was **written-and-never-drained in production**: every governed write (S17–S29) commits a PENDING outbox entry, but the relay `dispatchOutbox` had **only test callers** — so the platform's advertised "durable at-least-once delivery" delivered nowhere, and the emitted domain events were ignored. This is the single highest production-readiness value at the lowest architectural risk: it fixes a genuine reliability gap by INTEGRATING existing, already-tested machinery on the exact governed seam, needs no UI (background infra), and maps directly to OPERATE (restart/shutdown/recovery/idempotency).

## 4 · DISCOVERY FINDINGS (classified)

- **Outbox delivery/relay** — PARTIAL: `dispatchOutbox` (`outboxDispatcher.ts`) correct but test-only; production outbox never drained. ← **selected**
- **Governed read/query of command history** — MISSING (recorded as next-session candidate).
- **Health/readiness probe** — MISSING (candidate).
- **Domain event consumption** — MISSING (events emitted-and-ignored; closed as a side effect of this work).
- **Shutdown drain for journal/outbox** — MISSING (closed here).
- **RBAC/user-role admin** — DEFINED+LIVE (separate enterprise IPC).
- **Audit/governance read surface** — PARTIAL (tenant-scoped reads exist on enterprise IPC).
- **Tenant/org administration** — DEFINED+LIVE (separate enterprise IPC).
- **Config/secrets** — DEFINED+LIVE (guarded key access).

## 5 · PRODUCTION FILES CHANGED

- **NEW** `platform/command/deliveredEventLog.ts` — the durable, tenant-scoped, idempotent outbox SINK (a downstream read-model over the existing `DurableJsonStore`; NOT a second outbox/event bus/command bus/audit).
- **MODIFIED** `ipc/handlers/platformCommandIpc.ts` — wire the existing `dispatchOutbox` into the live composition seam: an optional (test-injectable) `outboxConsumer`, a **serialized** best-effort drain after each dispatch, the production consumer (`DeliveredEventLog.record`), and a `registerShutdownFlush('platform-command-outbox', …)` drain.
- **NEW** test `ipc/handlers/session31OutboxDelivery.test.ts`.

## 6 · LIVE CALL PATH

`runtimeCore` (`:2196`) → `buildPlatformCommandHandlers` constructs the journal + `DeliveredEventLog` + shutdown drain → `buildPlatformCommandDispatchDef` (the same def every governed command uses) → on `platform:command.dispatch`, after `adapter.submit` commits the durable outbox entry, the serialized drain calls the existing `dispatchOutbox(journal, consumer)` → `DeliveredEventLog.record`. Same secure preload → IPC → adapter → command bus path; the relay is downstream of the committed transaction and never on the business command's critical path.

## 7 · DATA / PERSISTENCE CHANGES

One new durable file under `userData`: `platform-delivered-events.json` (id-keyed upsert; one row per delivered event; tenant-attributed from the event). No schema change to any existing store; no migration; the journal's outbox schema is unchanged.

## 8 · AUTHORIZATION / TENANT CONTROLS

The relay delivers only events the governed command path already produced (which enforced authorization + tenant at commit time), so it introduces no new authority. **Tenant attribution is taken from `event.tenantId`, never ambient process state**, so a shared-process drain attributes each delivery to its own tenant; the sink's reads are tenant-scoped and never return another tenant's events (proven). No renderer/AI can reach the sink or the relay — they are main-process infrastructure with no IPC channel; AI uses the same governed command path as a user and cannot bypass it.

## 9 · UI INTEGRATION

None required — the relay is background delivery infrastructure with no user-facing control (Phase 4: no UI control needed). Operator-visible surfacing of delivery status is a follow-on (recorded YELLOW), not part of this capability.

## 10 · CONCURRENCY ANALYSIS (reproduce-first → real race found → fixed)

Reproduce-first **found a real race**: draining on every dispatch under concurrent dispatches ran concurrent drains that raced on the shared single-file durable stores (`DurableJsonStore` write-tmp/rename interleave) and **lost a delivered row** (the S31 CONCURRENCY test failed 8/12 before the fix). Fix = a **single-flight serialized drain** (a per-handler chained-promise latch, the S24/S28 pattern) so drains run strictly one-at-a-time, each looping until the outbox is empty so an entry committed mid-drain is still delivered by the tail pass. Post-fix: **12/12 stable**. This is the correct design for an outbox relay (one drain loop, not N concurrent), and it never serializes the COMMITS — only the fast delivery pass. Recorded finding (not fixed here — out of scope, a shared primitive): `DurableJsonStore` is not safe under truly concurrent `put()` to the same file; the serialized drain avoids exercising that on the delivery path.

## 11 · FAILURE / RECOVERY ANALYSIS

- **Consumer failure → fail-open + retry**: if the sink throws, the command response is still `ok` (delivery is never on the business command's critical path), the outbox entry is left RETRYABLE, and a later drain (next dispatch or shutdown) delivers it. Proven.
- **Restart**: DELIVERED outbox state + delivered-log rows survive a journal/log reload; a re-drain delivers nothing new (idempotent). Proven.
- **Shutdown**: `registerShutdownFlush('platform-command-outbox', …)` drains remaining PENDING/RETRYABLE on quit (reuses the established flush registry).

## 12 · ATTACK / NEGATIVE TEST RESULTS

`session31OutboxDelivery.test.ts` (7, live via `runSecureHandler` + real command bus + real durable journal):
- delivery after a governed write (event DELIVERED, sink recorded, outbox empty);
- **backward-compat**: with no consumer injected, the outbox is NOT drained (S17–S30 behavior byte-preserved) — the load-bearing guard that keeps every prior test unchanged;
- **fail-open**: consumer throws → command still ok, entry RETRYABLE, later drain delivers it;
- **tenant isolation**: each delivery attributed to the event tenant; tenant-A cannot see tenant-B's delivered events;
- **at-least-once idempotency**: a replayed command posts no second outbox entry; the sink stays one row; a re-drain is a no-op;
- **concurrency**: concurrent dispatches → exactly one delivered row per event, none lost, none duplicated (12/12 after the fix);
- **restart**: DELIVERED + rows survive reload; re-drain delivers nothing new.

## 13 · REGRESSION RESULTS

Full main (sharded 4×): **950 files · 9950 passed · 7 skipped · 0 failed** (S30 baseline 949/9943; delta +1 file/+7 tests). Platform-command + `platform/**` suites: 14 files / 178 passed. UI: **70 files · 405 passed**. No existing test weakened, skipped, or rewritten.

## 14 · TYPECHECK / LINT / BUILD

typecheck node+web clean; eslint clean (changed files); `npm run build` (electron-vite) ✓.

## 15 · CLASSIFICATION

**A — PRODUCTION IMPLEMENTATION.** New production source (`deliveredEventLog.ts`) + production wiring in `platformCommandIpc.ts` reached by the real live caller (`runtimeCore` → `buildPlatformCommandHandlers`), integrating the existing relay. The durable outbox is now actually delivered in production; delivery survives restart and drains on shutdown.

## 16 · ARCHITECTURE AUDIT

No duplicate infrastructure: the relay is the existing `dispatchOutbox`; the sink reuses the existing `DurableJsonStore` primitive; no second command bus / Application Boundary / authorization / approval / workflow / transaction engine / event bus / audit system; no shadow balance; no renderer→DB; no AI→DB; no frozen/shared contract changed; no security or tenant boundary weakened. The delivered-event log emits no events and drives no workflow (no automation side effect). The canonical engines remain singular.

## 17 · REMAINING YELLOW / RED / GRAY

- 🟡 Packaged-macOS runtime acceptance of the relay + shutdown drain (operator step; cannot run from Linux).
- 🟡 An operator-visible surface for delivery status / command history (a governed read command) — the natural next session; the sink + journal already hold the data.
- 🔴 (pre-existing, recorded) `DurableJsonStore` concurrent-`put` to one file is not lock-safe; the serialized drain avoids it on the delivery path, but the shared primitive itself is a separate hardening item.
- ⚪ GRAY: production-scale delivery latency/throughput of the serialized drain under high command volume (a future optimization: background interval drain vs await-per-dispatch).

## 18 · NEXT RECOMMENDED SESSION

A governed operational READ command (command history + outbox/delivery status), reusing this session's sink + the journal read models — closes the "journal is write-only to the app" gap and gives operators the visibility surface (Phase 4 UI) that this background capability deliberately did not build.

## Status: 🟢 GREEN (production capability proven on the governed path) / 🟡 packaged-runtime acceptance pending

The durable outbox is now a real, restart-surviving, shutdown-draining, tenant-safe, idempotent, at-least-once delivery relay in production — integrating existing machinery on the canonical governed seam, with a real race reproduced-first and fixed by the smallest correct serialization, and zero parallel architecture or frozen-surface change.
