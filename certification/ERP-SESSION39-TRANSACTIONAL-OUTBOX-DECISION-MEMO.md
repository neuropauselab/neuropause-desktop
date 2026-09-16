# ERP SESSION 39 — TRANSACTIONAL OUTBOX DECISION MEMO

**Baseline:** S38 (`aaead70`).
**Status:** DECISION GATE — investigation + reproduction + recommendation only. **NO production fix was implemented in S39.** No production source was changed or weakened. This memo selects the architecture and defines the exact S40 boundary.

---

## 1 · THE EXACT REPRODUCED FAILURE

`session39DualWriteWindow.test.ts` (4 tests, real command path, deterministic injection — NOT a real OS kill):

- **True crash between the two persistence boundaries (no rollback):** the domain effect is written through the SAME module handler the command bus route uses and durably flushed (boundary #1), then the process "crashes" before `journal.run` commits (boundary #2) and before any rollback. After restart: **the domain effect exists (1 order on disk) but the journal has ZERO committed records, ZERO events, ZERO outbox entries.** The unsafe state is real.
- **Duplicate on retry:** a client re-submitting the SAME idempotency key after such a crash finds no committed record to replay, so `execute` runs again and the order store (which mints a fresh `rec_<uuid>` per create) produces a **SECOND order** — a duplicate business effect (`replayed` is undefined, order count 2).
- **In-process commit failure (rollback path):** on the real `dispatchCommand` path, forcing the journal's atomic rename to reject returns `COMMIT_FAILED` and leaves the committed-command layer clean after restart (0 records/events/outbox). The in-process rollback (soft-delete) is **best-effort** — the domain effect may still survive (observed, recorded, not asserted as a guarantee).
- **Control:** a normal dispatch persists BOTH boundaries and replays idempotently (1 order, 1 record) — proving the window is ONLY the crash-between-boundaries case, not the happy path.

## 2 · CURRENT CRASH GUARANTEE (classified, §4)

| Property | Current state |
| --- | --- |
| **Command idempotency** (committed) | ✅ durable + replay-safe across restart (S18): same tenant+key → one committed effect, replayed thereafter |
| **Journal durability** | ✅ atomic tmp+rename (S33); a committed record is whole or absent, never torn |
| **Outbox durability** | ✅ committed atomically with the event in ONE record; PENDING/RETRYABLE re-driven (S31); stale PROCESSING recovered at boot (S38) |
| **Consumer idempotency** | ✅ `DeliveredEventLog` idempotent by `eventId` (at-least-once, not exactly-once) |
| **Domain transaction atomicity** (domain effect ⇄ journal commit) | ❌ **the gap** — the domain effect and the journal commit are TWO separate atomic writes; a crash between them strands the domain effect with no committed command |

So the architecture provides **C (idempotent replay only) + partial B (in-process rollback atomicity on a commit *failure*)**, but **NOT A (crash atomicity)** across the domain-effect/journal-commit boundary.

## 3 · THE EXACT UNSAFE WINDOW

Between **persistence boundary #1** (the domain module store's atomic write, inside `execute`) and **persistence boundary #2** (the journal's atomic `store.put`, in `journal.run`). Compensation (`rollback`) covers an in-process commit *failure*; a *crash* skips it. Duplication additionally requires the domain effect to be non-idempotent (the order store mints a fresh id per create — true today) AND a client retry of the same key.

## 4 · AFFECTED PRODUCTION PATH (traced, with awaits)

`platform:command.dispatch` handler (`ipc/handlers/platformCommandIpc.ts`) → `ElectronClientAdapter.submit` (`platform/adapter/clientAdapter.ts`) → `await handleApplicationRequest` (`platform/application/applicationService.ts`, authenticate → validate claimed tenant → authorize) → `await dispatchCommand` (`platform/command/commandBus.ts`) → `await deps.journal.run({ execute })` (`platform/command/durableCommandJournal.ts`):
1. `await this.store.load()` → idempotency check (existing → replay).
2. `await input.execute()` → `authorizeAndRoute` → `route` → module handler → **`EnterpriseRecordStore` write (boundary #1, atomic tmp+rename)** + returns `rollback`.
3. build event + outbox PENDING record.
4. `await this.store.put(record)` → **journal atomic tmp+rename (boundary #2)**.
5. on put failure → `await outcome.rollback?.()` (compensation) → `COMMIT_FAILED`.

The window is between steps 2 and 4. All of the above are **non-frozen** files.

## 5 · EXISTING TRANSACTION PRIMITIVES DISCOVERED (§3, repository-first)

1. **`DurableJsonStore`** (non-frozen) — atomic single-file write (tmp+rename, S33 serialized). Per-file atomicity only; no cross-file transaction.
2. **`DurableCommandJournal`** (non-frozen) — the S18 execute-then-commit journal with in-process `rollback` compensation. This is the mechanism that HAS the window.
3. **`cst/durableIdempotencyStore.ts` — `DurableIdempotencyStore` (FROZEN, `cst/`)** — the decisive find. It implements the **intent-first** pattern: `acquire(key)` writes a durable `IN_FLIGHT` intent **BEFORE** the external effect (NP-CST-106); `complete(key, outcome)` moves it to `DONE` after; on restart a `DONE` key replays without re-executing and **an `IN_FLIGHT` key reconciles/HOLDs rather than re-executes** (NP-CST-107). Fail-closed on corrupt file; synchronous atomic persist. This is a working, production-proven primitive that CLOSES exactly this class of window.
4. **CST kernel + `cst/journalPostTransition.ts` / `cst/importTransition.ts`** — a full governed transaction: durable idempotency intent + CAS (fresh-read + revision-check + write inside the effect) + `expectedPostState` + independent `observe` verification. `journalPostTransition` (non-frozen, consumes the frozen kernel) demonstrates a domain effect made crash-safe at-most-once via the intent store. The kernel itself is FROZEN (`cst/`).
5. **`commandBus` route `rollback`** (non-frozen) — per-command in-process compensation (soft-delete); best-effort, does not survive a crash.

## 6 · OPTIONS CONSIDERED (evidence-supported only)

**Option A — Intent-first journal (reserve BEFORE execute), reusing the existing pattern. [RECOMMENDED]**
Add a durable `IN_FLIGHT` intent write to `DurableCommandJournal.run` BEFORE `execute`, keyed by (tenantId, idempotencyKey); finalize to the committed record (the existing atomic record write) after `execute`. On restart: a committed record replays (unchanged S18); an `IN_FLIGHT`-without-committed-record intent means "a domain effect MAY have run but did not commit" → **HOLD/reconcile, never silently re-execute** — closing the duplicate path. This is the `DurableIdempotencyStore` semantics applied to the command bus.
- Correctness: closes the duplicate-on-retry path (crash between intent and commit → HOLD, not re-execute). It does NOT make the domain effect and journal a single atomic write, but it makes the SYSTEM safe (no duplicate business effect, no silent re-execute) — the honest target, matching the platform's at-least-once + reconcile posture (S37/S38).
- Migration complexity: MODERATE — localized to `DurableCommandJournal.run` (+ a reconcile surface, reusing S38's boot-reconciliation seam pattern).
- Affected production files: `platform/command/durableCommandJournal.ts`, possibly `platform/command/commandBus.ts` (HOLD result mapping), `ipc/handlers/platformCommandIpc.ts` (boot reconcile), all **non-frozen**.
- Frozen-surface impact: **NONE** — either implement the intent inline on the non-frozen journal, or CONSUME the frozen `DurableIdempotencyStore` by import (as `journalPostTransition` does), never modifying `cst/`.
- Crash semantics: crash pre-intent → nothing; crash between intent and commit → IN_FLIGHT → HOLD/reconcile (no duplicate); crash post-commit → committed, replay-safe.
- Concurrency: reuses S33 serialized writes; single-flight; no new lock.
- Tenant/security: intent keyed by (tenantId, idempotencyKey); no cross-tenant; no renderer/AI authority; no new permission.
- Compatibility with S31/S38 outbox: FULL — the outbox is still committed with the record; HOLD is a new pre-commit terminal that never fabricates an outbox entry.
- Rollback/recovery: the existing rollback stays for the in-process case; the intent adds crash-safe reconcile.
- Operational complexity: LOW — one durable intent per command; bounded; reconciled at boot like S38.

**Option B — Transactional outbox (domain effect + journal in ONE store/write).**
Merge the domain effect and the journal record into a single atomic `DurableJsonStore` write.
- Correctness: fully closes the window (true crash atomicity).
- Migration: **HIGH** — the domain effect lives in 106+ separate tenant-scoped enterprise-module stores; co-locating them with the journal is a persistence-architecture redesign.
- Frozen impact: likely touches `enterprise/index.ts` (frozen) and the module framework. **Rejected** on migration cost + frozen impact + mission §6 ("do not replace the persistence architecture").

**Option C — Adopt the full CST kernel per command (kernel + CAS + verify).**
Route every command through a per-call CST kernel transaction like `journalPostTransition`.
- Correctness: strongest (durable intent + CAS + independent verification).
- Migration: **HIGH** — rewrites the S17–S31 command bus onto the kernel; the kernel expects a CAS-capable domain effect (revision check), which the generic module create does not provide; reconciling the kernel's outcome with the S31 outbox/event is substantial. Consuming the kernel is non-frozen, but the scope is a command-bus rewrite. **Rejected** for this finding as disproportionate (Option A reuses the same intent store's *semantics* at a fraction of the cost).

**Option D — Make domain effects idempotent (dedupe by orderNumber / idempotency key).**
- Correctness: closes duplication for self-idempotent modules only.
- Migration: **HIGH + unbounded** — requires every one of 106+ modules to be self-idempotent; not a general guarantee. **Rejected.**

**Option E — Accept + document (no code).**
- The window is narrow and requires a precise crash + a client retry; the committed layer is always clean. **Rejected as the primary answer** because a general safe primitive exists (Option A) — but retained as the honest fallback if S40 is deferred.

## 7 · RECOMMENDED ARCHITECTURE

**Option A — intent-first on the non-frozen `DurableCommandJournal`, applying the proven `DurableIdempotencyStore` semantics (reserve IN_FLIGHT before `execute`; a crash-orphaned IN_FLIGHT reconciles to HOLD, never silently re-executes).** It closes the duplicate-on-retry path using an existing, production-proven pattern, requires no frozen change, reuses S33 durability and the S38 boot-reconciliation seam, and preserves the honest at-least-once + reconcile posture. It does not claim exactly-once external delivery and does not claim domain/journal single-write atomicity — it claims **no duplicate business effect and no silent re-execution after a crash in the window.**

## 8 · EXACT S40 SCOPE (implementation boundary for a FUTURE session)

- Add a durable per-command IN_FLIGHT intent to `DurableCommandJournal.run`, written and flushed BEFORE `execute`, keyed by (tenantId, idempotencyKey); finalize/clear on commit; either implement inline on the non-frozen journal using `DurableJsonStore`, or CONSUME the frozen `DurableIdempotencyStore` by import (never modify `cst/`).
- On restart: committed record → replay (unchanged); IN_FLIGHT-without-committed-record → a new `HOLD`/`RECONCILIATION_REQUIRED` command result (do NOT re-execute); surface via S35 delivery-operations and reconcile at the S38 boot seam.
- Reproduce-first with `session39DualWriteWindow.test.ts` as the pre-fix red; after S40 the duplicate-on-retry test must show HOLD (no second effect).
- MUST NOT: modify any frozen surface (`cst/`, `enterprise/index.ts`, `packages/shared`, `runtimeCore.ts`, `connectors/index.ts`, `auth/`, `tenantContext`); add a new database/WAL/queue/microservice/lock framework; change the domain-effect ordering wholesale (Option B); claim exactly-once.
- Preserve S31/S38 outbox delivery semantics unchanged; no new permission.

## 9 · MIGRATION / RISK ASSESSMENT

LOW–MODERATE. All target files non-frozen; the pattern is production-proven (`DurableIdempotencyStore`); durability reuses S33; recovery reuses the S38 boot seam. Primary risk: correctly defining the HOLD terminal so an IN_FLIGHT whose domain effect actually committed-but-journal-didn't is reconciled without double-effect (the intent must carry enough to decide, or the reconcile must be conservative HOLD). This is a design task for S40, not a blocker — the repository contains sufficient evidence (the `DurableIdempotencyStore` IN_FLIGHT→HOLD precedent) to proceed, so this is NOT a STOP.

## 10 · REGRESSION (this session)

Focused: `session39DualWriteWindow` 4/4 (reproduction). S37 `session37CrashRecovery`, S38 `session38StaleProcessingRecovery`, S18 durable-transaction, S31/S32/S33/S34/S35 platform, S36 backup — all unchanged. Full main + UI run in the session report. No production code changed.

## 11 · EXPLICIT NON-IMPLEMENTATION STATEMENT

**No production fix was implemented in S39.** The only files added are this decision memo and the reproduction test (evidence). No production source was modified. S37 Finding #2 remains **GRAY** until S40 implements Option A under the boundary above.
