# ERP SESSION 37 — PRODUCTION CRASH-RECOVERY / UNCLEAN-SHUTDOWN RESILIENCE

**Baseline:** Session 36 (`23b547a`).
**Classification:** **A — PRODUCTION IMPLEMENTATION (verification)** for the crash-recovery properties that ARE safe — exercised against the REAL production components — **plus GRAY (2 decision-memo items)** for two recovery semantics that are UNDEFINED/limited and were reproduced, not invented-away. Tests + memo only; **no production source changed** (a crash-recovery *certification* + honest gap disclosure, like S30).
**Status:** 🟢 GREEN for the safe boundaries · ⚪ GRAY for the two undefined boundaries (see `ERP-SESSION37-CRASH-RECOVERY-DECISION-MEMO.md`) · 🟡 real-OS-kill e2e (operator step). **No frozen surface touched.**

## 1 · OBJECTIVE

Prove the canonical governed spine (COMMAND → DURABLE JOURNAL → OUTBOX → DELIVERY) stays correct after an abrupt termination — no duplicate business effects, no lost committed commands, no corrupted journal, no lost outbox events, no false DELIVERED, no duplicate delivery, no tenant leakage, no broken idempotency — and honestly state where recovery is undefined.

## 2 · DISCOVERY FINDINGS

- **Commit ordering is domain-effect-then-journal-commit, inverted from the mission's assumed taxonomy.** `dispatchCommand` → `journal.run({ execute })` where `execute` performs the domain mutation (inside the module handler) and returns a `rollback`; the journal then commits idempotency + event + outbox as ONE atomic `DurableJsonStore.put` (tmp+rename). A commit FAILURE runs `rollback`; a true crash skips it.
- `DurableJsonStore` writes atomically (unique-tmp + rename, S33), so any on-disk file is complete JSON — never torn.
- `journal.pendingOutbox()` = `PENDING | RETRYABLE` **only** — it EXCLUDES `PROCESSING`.
- **No boot-time outbox reconciliation exists** (verified across `src/main`).
- The order store generates a fresh `rec_<uuid>` per create — not self-idempotent on `orderNumber`.

## 3 · CRASH BOUNDARIES IDENTIFIED (real ordering)

1. Before `execute` completes → nothing persisted → clean.
2. **After the domain effect (inside execute), before the journal commit** → the domain effect can be stranded without a committed command; a same-key retry can duplicate (order store not self-idempotent). **Pre-commit dual-write window — bounded, undefined for a true crash → MEMO Finding 2.**
3. After journal commit, before delivery → committed command + `PENDING` outbox survive; re-driven on next drain. **Safe.**
4. **During delivery (after `markProcessing` persists `PROCESSING`, before `markDelivered`/`markRetryable`)** → the record is orphaned: `pendingOutbox` excludes `PROCESSING` and nothing re-drives it. **Undefined recovery → MEMO Finding 1.**
5. After delivery, before `markDelivered` (sink row written, journal still `PROCESSING`) → external effect happened once (idempotent sink); journal orphaned as in (4). **No duplicate effect, but stuck.**
6. After `markDelivered` → `DELIVERED`, terminal. **Safe.**
7. During shutdown drain → the S31 shutdown-flush best-effort drain; a crash mid-drain leaves records `PENDING`/`RETRYABLE` (re-driven) or `PROCESSING` (orphaned, as (4)).

## 4 · EXISTING RECOVERY SEMANTICS

Committed-command idempotency is durable and replay-safe across restart (S18). `PENDING`/`RETRYABLE` outbox records are re-driven on the next dispatch or the shutdown flush; the consumer is idempotent (at-least-once + idempotent = no duplicate external effect). `DELIVERED` is terminal. **`PROCESSING` has no recovery path (undefined).** The honest guarantee is **at-least-once delivery + idempotent consumers; at-most-once *committed* command per key — NOT exactly-once, NOT crash-atomic across the dual-write window.**

## 5 · TEST METHODOLOGY

`session37CrashRecovery.test.ts` (13 tests) drives the REAL `dispatchCommand` → `DurableCommandJournal` → real order module (a genuine governed business effect: `CreateSalesOrder`) → `dispatchOutbox` → `DeliveredEventLog`, over stable temp files. A "crash + restart" ABANDONS the in-memory instances and re-constructs fresh ones over the SAME on-disk files (`boot()`) — exactly what a restarted process does (re-reads the durable file). The persistence-boundary failure (TEST A) makes the journal's atomic `rename` reject so the commit never lands. No production behaviour is weakened; no `DELIVERED` is set artificially; no failed record is deleted.

## 6 · REAL CRASH vs DETERMINISTIC INJECTION

This suite uses **DETERMINISTIC FAILURE INJECTION**, explicitly labelled — NOT a real OS `SIGKILL`. The abandon-and-reload mechanism is faithful because a restarted process's only knowledge of prior state is the on-disk durable file, which is exactly what a fresh instance reads. A true child-process kill at an exact microsecond boundary (e.g. mid-`markProcessing`) is not reliably reproducible; the deterministic injection hits the exact boundary. Real-Electron kill e2e is recorded as a 🟡 operator step (the repo has `_electron` harnesses for a coarser cycle).

## 7 · BUSINESS-EFFECT EVIDENCE (§5)

Exactly one durable business effect per idempotency key across restart: `CreateSalesOrder(k1)` → 1 order, 1 journal record; after `boot()`, a re-submit of the SAME key replays (`replayed:true`, execute never re-runs) → still 1 order, 1 journal record, 1 `SalesOrderCreated` event. No duplicate GL/inventory/order effect on the committed path.

## 8 · JOURNAL EVIDENCE

TEST A: a commit that never reaches disk leaves ZERO phantom committed records/events/outbox after restart (authoritative layer clean; idempotency intact). TEST E: 5 committed commands all survive restart, none lost. TEST G: 3 concurrent commits → 3 records, 3 distinct idempotency keys, no duplicate; the on-disk journal is always valid JSON.

## 9 · OUTBOX EVIDENCE

TEST B: a `PENDING` outbox survives restart and drains to `DELIVERED` exactly once. TEST F: after restart, `PENDING`+`RETRYABLE` re-drive to `DELIVERED`, `DELIVERED` stays, **`PROCESSING` remains stuck** (the reproduced gap) — matching the ACTUAL state machine. TEST D: a `PROCESSING` record is excluded from `pendingOutbox` and never re-driven (`attempted:0`, sink count 0).

## 10 · DELIVERY EVIDENCE

TEST C: a failed delivery is `RETRYABLE` across restart and re-drives to `DELIVERED` exactly once (`attempts` 1→2, sink count 1 — never delivered twice). TEST D (2nd case): if delivery reached the sink before the crash, a re-delivery is a no-op (idempotent sink by `eventId`) → no duplicate external effect. **At-least-once + idempotent, honestly — not exactly-once.**

## 11 · S33 PERSISTENCE EVIDENCE

TEST G + the S36-precondition test: after concurrent commits and after a crash, the journal + sink files are always complete valid JSON (atomic tmp+rename, S33) — never a torn write. Crash testing does not bypass or regress the S33 serialization (no ad-hoc writes; only real `DurableJsonStore`/`DurableCommandJournal` methods are used).

## 12 · S34 HEALTH EVIDENCE

After recovery, `computePlatformHealth` reports `HEALTHY` with `journal.status: 'ok'` (present + parseable) — derived from real post-crash state, not hardcoded. (S34 already proves a corrupt journal → `UNHEALTHY`.)

## 13 · S35 OPERATIONAL EVIDENCE

After a crash following a failed delivery, `buildDeliveryOperations` still reports `counts.retryable = 1` — the retryable delivery is NOT hidden by the restart.

## 14 · S36 BACKUP COMPATIBILITY

A crash leaves the journal + sink files as complete valid JSON (atomic writes), so they remain backup-able and integrity-validatable under the S36 sha256-manifest contract — a crash does not leave the canonical stores in a state that violates the backup contract. Backup architecture unchanged.

## 15 · TENANT / SECURITY EVIDENCE

Two-tenant crash/restart: tenant-A stays A and tenant-B stays B; each record's `event.tenantId` is preserved; a tenant-A read returns no tenant-B rows. Restart does not broaden scope. No renderer authority, no forged-tenant authority (tenant is principal-derived through the real command bus). No new permission (infrastructure behaviour).

## 16 · CONCURRENCY EVIDENCE

TEST G: 3 concurrent `dispatchCommand`s immediately before a crash → no lost committed record, no duplicate (3 distinct keys), valid JSON on disk, 3 orders after restart.

## 17 · RECOVERY TIMING (§12)

Deterministic in-memory reload; representative volumes small (≤5 committed commands, ≤4 outbox records per test). Recovery = one `DurableJsonStore.load()` (a single small-file read) per store; delivery drain = one `dispatchOutbox` pass over the re-read `pendingOutbox`. **Duplicate effects observed: 0. Lost committed records observed: 0.** The full 13-test suite runs in ~34 ms. No background polling or new infrastructure introduced.

## 18 · FULL REGRESSION COUNTS

Focused S37 13/13. S18 · S31 · S32 · S33 · S34 · S35 · S36 · durableJsonStore = 91/91 unchanged. Full main (sharded 4×): **957 files · 10025 passed · 7 skipped · 0 failed** (S36 was 956 / 10012 / 7 — delta exactly +1 file / +13 tests). UI: **73 files · 414 passed** (unchanged — no renderer change). No test weakened, skipped, or rewritten.

## 19 · TYPECHECK / LINT / BUILD

typecheck node + web clean; eslint clean; `npm run build` (electron-vite) ✓.

## 20 · FILES CHANGED

Tests — **NEW** `src/main/platform/command/session37CrashRecovery.test.ts` (13). Docs — **NEW** `certification/ERP-SESSION37-CRASH-RECOVERY-DECISION-MEMO.md`, `certification/ERP-SESSION37-CRASH-RECOVERY-EVIDENCE.md`. **No production source change** (a certification + decision-memo session; no invented recovery transition).

## 21 · FROZEN SURFACES

**None.** `certification/baseline.json` was already modified at session start (pre-existing, preserved, NOT staged).

## 22 · ARCHITECTURE AUDIT

One journal (`DurableCommandJournal`), one outbox (the journal record's `outbox`), one delivery sink (`DeliveredEventLog`), one persistence primitive (`DurableJsonStore`), one backup/recovery system (S36 `BackupManager`), one governed command path (`dispatchCommand`). No duplicate recovery/transaction engine, no crash-specific storage, no second journal, no recovery database, no lock framework, no WAL, no alternate persistence path, no new queue, no microservice. No renderer/AI filesystem authority, no shadow database. No frozen surface modified.

## 23 · GREEN / YELLOW / RED / GRAY

- 🟢 **GREEN** — committed-command survival + at-most-once per key across restart; `PENDING`/`RETRYABLE` re-drive; idempotent retry (no double delivery); concurrency no-loss/no-dup; tenant isolation; valid-JSON durability (S33/S36); honest post-recovery health/ops (S34/S35).
- ⚪ **GRAY (decision required)** — Finding 1: a `PROCESSING` record orphaned by a crash is never re-driven (undefined recovery). Finding 2: the pre-commit dual-write window can strand a domain effect on a true crash. Both reproduced, neither invented-away. See the DECISION MEMO.
- 🟡 **YELLOW** — real-OS-`SIGKILL` child-process crash e2e (operator step).
- 🔴 **RED** — none.

## 24 · COMMIT HASH

`feat(erp-s37): crash recovery resilience` — SHA at commit time (see §25/§26).

## 25 · PUSH STATUS

The Linux sandbox has no git credentials — **push cannot be performed here**. Do NOT assume it was pushed.

## 26 · MAC HANDOFF

From the repo root on the Mac:

```
git log -1 --oneline          # expect the erp-s37 commit at HEAD
git push origin cert/data-import-cst-integration
```

## Status — HONEST SUMMARY

The governed spine is **crash-safe for committed commands and for PENDING/RETRYABLE delivery** (proven against the real components: no lost commands, no duplicate business effects, no double delivery, no tenant leakage, intact idempotency, valid-JSON durability). It is **NOT** unconditionally "crash safe": a `PROCESSING` record orphaned by a crash is never recovered, and the pre-commit dual-write window can strand a domain effect. Those two boundaries are **reproduced and referred to a DECISION MEMO — not claimed safe, and not silently fixed.** Delivery is honestly **at-least-once + idempotent, not exactly-once.**
