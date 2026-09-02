# ERP SESSION 40 — INTENT-FIRST DUAL-WRITE RECOVERY (closes S37 Finding #2)

**Baseline:** S39 (`2d8d48e`). Implements ONLY the S39 Option A architecture (`ERP-SESSION39-TRANSACTIONAL-OUTBOX-DECISION-MEMO.md`).
**Classification:** **A — PRODUCTION IMPLEMENTATION.** Intent-first crash recovery wired into the non-frozen `DurableCommandJournal` on the real governed command path, proven by real-path failure-injection. **No frozen surface touched. No new database/WAL/queue/engine.**
**Status:** 🟢 GREEN — the pre-commit crash/retry duplication case is eliminated on the governed path and proven by the real-path test + load-bearing negative control. Delivery remains at-least-once + idempotent (NOT exactly-once).

## 1 · BASELINE

S39 `2d8d48e` (decision memo + reproduction). S39 RED reproduction was GREEN (4/4 — the dual-write window reproduced) before any S40 production change.

## 2 · S39 RED REPRODUCTION BEFORE FIX

Run first, unchanged: `session39DualWriteWindow.test.ts` 4/4 GREEN — a domain effect durably flushed then a crash before journal commit leaves the effect with no committed command, and a same-key retry creates a duplicate. (That test uses an *ungoverned* `createOrderDirect` proxy that bypasses `journal.run`; S40 additionally reproduces the window through the *governed* `journal.run` path where the fix applies.)

## 3 · EXACT PRODUCTION FILES CHANGED

- `platform/command/durableCommandJournal.ts` — the `CommandIntent` type + co-located intent ledger (same `DurableJsonStore` primitive); intent-first `reserve → execute → commit → clear` in `run`; IN_FLIGHT→HOLD orphan check (per-process `bootEpoch`, reused from S38); fail-closed on a corrupt ledger (probe-before-load); `reconcileOrphanedIntents` (boot); `heldIntents` (read); `load`/`reload`/`destroy` extended to the ledger.
- `platform/persistence/durableJsonStore.ts` — additive `delete(id)` (serialized, S33) used to clear a transient intent marker.
- `ipc/handlers/platformCommandIpc.ts` — boot seam runs `reconcileOrphanedIntents` (before S38's PROCESSING recovery, before the first drain).
- `platform/command/deliveryOperations.ts` — S35 read surfaces `heldReconciliations` (sanitized).
- `storage/storePaths.ts` — registers `platform-command-journal.intents.json` in the S36 backup registry.
- `platform/command/session18DurableTransaction.test.ts` — test C's `put` mock made precise (target the durable COMMIT — a `CommittedCommand` carries an `event` — not the new intent-reserve `put`); NOT weakened.

## 4 · EXACT INTENT LIFECYCLE

`run(input)`: `store.load()` → committed record? → **replay** (authoritative, unchanged S18). Else (intent-first): probe the ledger (corrupt → **RECONCILIATION_REQUIRED**, fail closed) → HOLD intent? → **RECONCILIATION_REQUIRED** → IN_FLIGHT from a *prior* `bootEpoch`? → transition to HOLD, **RECONCILIATION_REQUIRED**. Else single-flight → **reserve** IN_FLIGHT (this `bootEpoch`, durable, BEFORE `execute`) → `execute` (domain effect) → on failure **delete** intent (retryable) → build event+record → `store.put` (commit) → on commit failure rollback + **delete** intent (retryable) → on success **delete** intent (the committed record supersedes it). Boot: `reconcileOrphanedIntents` — a prior-epoch IN_FLIGHT with a committed record → cleared; without → **HOLD**.

## 5 · EXACT CRASH BOUNDARY NOW CLOSED

A crash between the domain effect (inside `execute`) and the journal commit leaves the intent IN_FLIGHT with a prior `bootEpoch` and no committed record. On restart, a same-key retry finds that orphan → **HOLD (RECONCILIATION_REQUIRED)** and **never re-executes the domain effect** → no duplicate business effect. (Test C: order count stays 1; retry returns RECONCILIATION_REQUIRED.)

## 6 · HOLD / RECONCILIATION SEMANTICS

An orphaned intent becomes `HOLD` (reason `"reconciliation required after unclean shutdown"`). A command in HOLD returns `error: 'RECONCILIATION_REQUIRED'` on every retry (F) — no re-execution, no duplicate. HOLD is reached at dispatch (prior-epoch orphan) or at boot reconciliation, and is idempotent (G: transitioned exactly once; a second boot reclaims nothing). The active in-flight execution of THIS process (same `bootEpoch`) is NEVER held — the in-memory single-flight map handles concurrent same-key; no time threshold is used.

## 7 · CONCURRENCY EVIDENCE

H: 3 concurrent same-key dispatches → one durable intent + one committed record + one order. I: concurrent different-key commands each commit once, no cross-key corruption, valid JSON. Reuses S33 serialized writes; no new lock.

## 8 · TENANT / SECURITY EVIDENCE

J: two tenants with the SAME idempotency key are isolated — a crash-HOLD in tenant A never blocks tenant B (intent keyed `${tenant}::${key}`); A stays HELD, B commits. K: an unauthorized command fails `UNAUTHORIZED`, produces no effect, leaves no lingering intent (released, not held → still retryable), and no authorization bypass — the same key executes normally once authorized. Authorization stays on the governed command path (inside `execute`). Renderer/AI never touch intent storage directly (it lives behind `journal.run`). No new permission.

## 9 · NEGATIVE-CONTROL EVIDENCE

A journal constructed with `{ intentRecovery: false }` (a test-only seam; production hard-codes `true`) reproduces the S39 duplicate: same governed crash → retry → `ok:true`, **order count 2** (duplicate). The identical scenario with the production default (`intentRecovery: true`) returns `RECONCILIATION_REQUIRED`, order count 1. This proves the intent reservation is LOAD-BEARING. The production default is unchanged (byte-for-byte; the seam only lets a test disable it).

## 10 · S31–S39 REGRESSION

S18 (13), S31 (7), S32 (12), S33 (6), S34 (12), S35 (13), S36 (13), S37 (13), S38 (12), S39 (4), durableJsonStore (6), storePaths (6) — plus S40 (15) = **141/141**. S18 test C's mock was made precise (target the commit) to accommodate the new intent-reserve `put` — a correction, not a weakening (all 22 S18 tests pass). No other existing test changed.

## 11 · FULL TEST COUNTS

Full main (sharded 4×): **960 files · 10056 passed · 7 skipped · 0 failed** (S39 was 959 / 10041 / 7 — delta exactly +1 file / +15 tests). UI: **73 files · 414 passed** (unchanged — no renderer change). No test weakened, skipped, or rewritten (S18 C mock made more precise only).

## 12 · TYPECHECK / LINT / BUILD

typecheck node + web clean; eslint clean; `npm run build` (electron-vite) ✓.

## 13 · FROZEN-SURFACE STATUS

**None touched.** All changed production files (`durableCommandJournal.ts`, `durableJsonStore.ts`, `platformCommandIpc.ts`, `deliveryOperations.ts`, `storePaths.ts`) are non-frozen (verified against `certification/frozen-surfaces.json`: frozen = `packages/shared`, `runtimeCore.ts`, `connectors/index.ts`, `cst/`, `enterprise/index.ts`, `tenantContext.ts`, `auth/`). The frozen `cst/durableIdempotencyStore.ts` was consulted as the architectural REFERENCE (its IN_FLIGHT→HOLD semantics) but NOT modified or imported — it cannot serve directly (no HOLD state, no enumeration), so the intent-first pattern is implemented on the non-frozen journal using the existing `DurableJsonStore` primitive. `certification/baseline.json` was pre-modified at session start (preserved, NOT staged).

## 14 · ARCHITECTURE SINGULARITY AUDIT

ONE command bus (`dispatchCommand`); ONE Application Boundary (`handleApplicationRequest`); ONE `DurableCommandJournal`; ONE outbox (the journal record's `outbox`); ONE delivery sink (`DeliveredEventLog`); ONE `DurableJsonStore` primitive (the intent ledger reuses it — not a second store engine); ONE intent/idempotency mechanism (the journal's committed-record replay + its intent ledger are one mechanism); ONE recovery path (the S38 boot seam, now running intent + PROCESSING reconciliation). No shadow persistence, no renderer/AI filesystem authority, no duplicate transaction engine, no duplicate queue, no new database/WAL/microservice, no frozen-surface change.

## 15 · REMAINING GREEN / YELLOW / GRAY

- 🟢 **GREEN** — the pre-commit dual-write duplication (S37 Finding #2) is eliminated on the governed path: a crash-orphaned command HOLDs on retry instead of re-executing. Success/replay/delivery/tenant/concurrency/authorization all proven; corrupt ledger fails closed; negative control proves load-bearing.
- 🟡 **YELLOW** — real-OS-`SIGKILL` packaged-runtime e2e of the intent-first recovery (operator step; the deterministic injection is faithful, but a real kill is not claimed).
- ⚪ **GRAY** — none outstanding for Finding #2. (An ungoverned domain effect created OUTSIDE `journal.run` carries no intent and is out of scope by construction — the governed path is the only production command path.) Delivery remains honestly at-least-once + idempotent, NOT exactly-once.
- 🔴 **RED** — none.

## 16 · COMMIT HASH

`feat(erp-s40): close command dual-write window` — SHA at commit time (see §17/§18).

## 17 · PUSH STATUS

The Linux sandbox has no git credentials — **push cannot be performed here**. Do NOT assume it was pushed.

## 18 · MAC HANDOFF

```
git log -1 --oneline          # expect the erp-s40 commit at HEAD
git push origin cert/data-import-cst-integration
```

## Status: 🟢 GREEN — the command dual-write window is closed via intent-first recovery on the governed path. A crash between the domain effect and the journal commit now HOLDs the command for reconciliation on retry instead of silently re-executing it — proven by the real-path failure-injection test and a load-bearing negative control, with no frozen change, no new infrastructure, and no exactly-once claim. S37 Finding #2 is CLOSED.
