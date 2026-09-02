# ERP SESSION 38 — CRASH-ORPHANED PROCESSING OUTBOX RECOVERY

**Baseline:** Session 37 (`8ba690d`). Addresses ONLY S37 **Finding #1**. S37 Finding #2 (pre-commit dual-write) is OUT OF SCOPE and untouched.
**Classification:** **A — PRODUCTION IMPLEMENTATION.** A real recovery transition wired into the production startup/composition path, exercising the real journal/outbox/relay/sink. **No frozen surface touched.**
**Status:** 🟢 GREEN — stale PROCESSING recovers to DELIVERED via the existing state machine; active PROCESSING is provably protected; delivery stays at-least-once + idempotent (not exactly-once). ⚪ GRAY (Finding #2, unchanged) · 🟡 real-OS-kill packaged e2e (operator).

## 1 · DECISION MEMO INTERPRETED

`ERP-SESSION37-CRASH-RECOVERY-DECISION-MEMO.md` Finding 1 authorizes (option b, recommended b+c): "a dedicated boot-time reconciliation pass that transitions stale `PROCESSING → RETRYABLE` ... before the first drain," with the recovery reason `"reclaimed after unclean shutdown"`, reusing the existing state machine (no new state), preserving at-least-once + idempotent semantics. Its design-question 3 records that the "race a live in-flight delivery" risk is a *future multi-drain* concern, not today's single-flight/single-instance model. Implemented within that decision — no different policy invented.

## 2 · EXACT STALE CRITERION

**A PROCESSING record is reclaimed iff its `processingEpoch` ≠ this process's `bootEpoch`.** `bootEpoch` is a per-process nonce generated once per `DurableCommandJournal` construction; `markProcessing` stamps it onto the record. A record whose epoch differs from the current process's was set PROCESSING by a process that is no longer running (single-instance app) → provably ABANDONED. A record set PROCESSING by the CURRENT process carries the current epoch → ACTIVE → never reclaimed. **This is an identity nonce, not a timestamp — no clock is read and no age threshold is invented** (mission §2/§3: "Do NOT add a new timestamp"; "Do not use arbitrary age assumptions"). It is strictly more reliable than an age threshold: it cannot false-positive on a slow-but-live delivery nor false-negative on a fast crash. The memo's recommended run point ("before the first drain") makes the criterion trivially true at boot (no current-epoch PROCESSING exists yet), and the epoch keeps it safe even if invoked later.

**Why not `committedAt`:** it records when the command committed, NOT when it entered PROCESSING — a record can commit, sit PENDING, then enter PROCESSING much later, so `committedAt` is not a reliable PROCESSING-staleness signal. No PROCESSING-transition timestamp exists; adding one is discouraged and unnecessary given the epoch.

## 3 · DISCOVERY FINDINGS

`dispatchOutbox`: `markProcessing` (persists PROCESSING, attempts+1) → consumer → `markDelivered`/`markRetryable`. `pendingOutbox()` = PENDING | RETRYABLE only (excludes PROCESSING). No boot reconciliation existed (S37). The relay is single-flight (S31 latch); the app is single-instance. `DeliveredEventLog.record` is idempotent by `eventId`. `DurableJsonStore` writes atomically (tmp+rename, S33).

## 4 · EXISTING STATE MACHINE (reused, unchanged shape)

PENDING → PROCESSING → DELIVERED | RETRYABLE; RETRYABLE re-drives via `pendingOutbox` → `dispatchOutbox`. S38 adds ONE transition into the existing machine: **stale PROCESSING → RETRYABLE** (`reconcileStaleProcessing`). No new state, no new terminal.

## 5 · BEFORE-STATE REPRODUCTION (§6)

`session38StaleProcessingRecovery.test.ts` first proves the S37 gap on the real journal: commit → `markProcessing` → "crash+restart" (fresh journal instance) → `dispatchOutbox` alone leaves the record stuck PROCESSING (`attempted:0`, never delivered). Then reconciliation + `dispatchOutbox` proves PROCESSING → RETRYABLE → DELIVERED with exactly one delivery. (S37's own suite still shows the raw-journal gap — reconciliation is a separate method, wired at boot, not into `dispatchOutbox`.)

## 6 · RECOVERY IMPLEMENTATION

`DurableCommandJournal.reconcileStaleProcessing(): { reclaimed, ids }` — loads, filters `status==='PROCESSING' && processingEpoch !== bootEpoch`, and transitions each to RETRYABLE with `lastError: 'reclaimed after unclean shutdown'` via the existing atomic `setOutbox` (one `DurableJsonStore` write each). It NEVER invokes a consumer, NEVER marks DELIVERED, NEVER bypasses idempotency, and creates NO recovery-specific delivery path. `attempts` is NOT incremented (reclaiming is not a delivery attempt; the next `markProcessing` on re-drive increments). Tenant attribution preserved verbatim. Idempotent: a second run reclaims nothing.

## 7 · STARTUP INTEGRATION

`buildPlatformCommandDispatchDef` gains an opt-in `reconcileStaleProcessingOnBoot`; the production wiring (`buildPlatformCommandHandlers`, called once by `runtimeCore`) sets it true. At composition (boot), it seeds the SAME S31 drain latch with `reconcileStaleProcessing()` and then triggers ONE `dispatchOutbox`, so recovery runs exactly once, BEFORE the first drain, ordered ahead of any later dispatch's drain (never races it). Best-effort: a reconciliation failure never throws to the caller and never blocks a business command. No new lifecycle manager; the flag is off for every existing injectable-seam test, so S17–S37 seam behavior is unchanged.

## 8 · ACTIVE PROCESSING PROTECTION (§7, mandatory, load-bearing)

Proven: a record set PROCESSING by the CURRENT instance (current `bootEpoch`) is NOT reclaimed by `reconcileStaleProcessing` on that same instance (`reclaimed:0`, stays PROCESSING); a record set PROCESSING by a PREVIOUS instance (different epoch) IS reclaimed. The mixed-state test additionally holds one active (current-epoch) and one stale (prior-epoch) PROCESSING in a single journal and proves ONLY the stale one is reclaimed.

## 9 · STALE PROCESSING RECOVERY EVIDENCE (§6)

Stale PROCESSING → `reconcileStaleProcessing` → RETRYABLE (reason recorded) → `dispatchOutbox` → consumer → `DeliveredEventLog` → DELIVERED, sink count exactly 1.

## 10 · MIXED-STATE EVIDENCE (§9)

PENDING, stale PROCESSING, active PROCESSING, RETRYABLE, DELIVERED in one journal after restart: reconciliation reclaims ONLY the stale PROCESSING; PENDING/RETRYABLE/DELIVERED untouched; active PROCESSING stays PROCESSING. Then one drain: PENDING + RETRYABLE + reclaimed all reach DELIVERED; active PROCESSING and DELIVERED unchanged. No incorrect promotion/downgrade.

## 11 · DUPLICATE-DELIVERY EVIDENCE (§8)

Consumer effect reaches the sink, crash before `markDelivered` → restart → reconcile (PROCESSING→RETRYABLE) → re-drive: the relay reports a delivery pass, but the sink stays at exactly one row (idempotent by `eventId`) — **no duplicate durable delivery effect, no second business effect.** Honest guarantee preserved: **AT-LEAST-ONCE + IDEMPOTENT consumer, not exactly-once.**

## 12 · CONCURRENCY EVIDENCE (§10)

Four stale PROCESSING + three concurrent `reconcileStaleProcessing` calls → every record RETRYABLE exactly once, exactly 4 distinct records reclaimed (never more), none lost, valid JSON after concurrent writes (S33 serialization — no new lock), then all 4 delivered once. Repeated reconciliation is idempotent (a second/third boot reclaims 0).

## 13 · TENANT / SECURITY EVIDENCE (§11)

Two tenants each with a stale PROCESSING → both reclaimed to RETRYABLE with `tenantId` unchanged; a tenant-A read returns no tenant-B rows. No cross-tenant mutation, no scope broadening, no renderer/AI authority. Internal lifecycle behaviour — **no new permission.**

## 14 · S34 INTEGRATION

After reconciliation `computePlatformHealth` reports HEALTHY with a valid journal (derived from real state, not hardcoded).

## 15 · S35 INTEGRATION

`buildDeliveryOperations` surfaces the reclaimed record as RETRYING with `lastError: 'reclaimed after unclean shutdown'` (the recovery is visible, not hidden by the restart), then DELIVERED after re-drive. S35 semantics unchanged; `processingEpoch` is NOT leaked (the sanitizers pick explicit fields).

## 16 · S36 COMPATIBILITY

Reconciliation writes complete valid JSON (atomic tmp+rename), so the journal + sink remain backup-able and integrity-validatable under the S36 contract. Backup architecture untouched.

## 17 · PERFORMANCE (§14)

Bounded: one pass over `journal.all()` filtering PROCESSING, one atomic write per reclaimed record, then one drain pass. No unrelated data scanned, no polling loop, no background watcher. The 12-test suite (each a real commit + reconcile, most a real drain) runs in ~44 ms. Measured this session: outbox records ≤ 5 per test; PROCESSING per test 0–4; reclaimed = exactly the stale set; duplicate effects 0; lost records 0.

## 18 · FULL REGRESSION COUNTS

Focused S38 12/12. S18 · S37 · S31 · S32 · S33 · S34 · S35 · S36 · durableJsonStore = 116/116 (S37 still faithfully shows the raw-journal gap; nothing perturbed by the additive `processingEpoch`). Full main (sharded 4×): **958 files · 10037 passed · 7 skipped · 0 failed** (S37 was 957 / 10025 / 7 — delta exactly +1 file / +12 tests). UI: **73 files · 414 passed** (unchanged — no renderer change). No test weakened, skipped, or rewritten.

## 19 · TYPECHECK / LINT / BUILD

typecheck node + web clean; eslint clean; `npm run build` (electron-vite) ✓.

## 20 · FILES CHANGED

Production source — **MODIFIED** `platform/command/durableCommandJournal.ts` (`OutboxState.processingEpoch` optional field; per-process `bootEpoch`; `markProcessing` stamps it; new `reconcileStaleProcessing`), `ipc/handlers/platformCommandIpc.ts` (opt-in `reconcileStaleProcessingOnBoot` dep + boot-seam reconcile-then-drain + production wiring flag). Tests — **NEW** `platform/command/session38StaleProcessingRecovery.test.ts` (12). Evidence — this file.

## 21 · FROZEN SURFACES

**None.** `durableCommandJournal.ts` and `platformCommandIpc.ts` are non-frozen platform/IPC source. No `packages/shared`, `runtimeCore.ts`, `cst/`, `connectors/index.ts`, `enterprise/index.ts`, or `auth/` change. `certification/baseline.json` was already modified at session start (preserved, NOT staged).

## 22 · ARCHITECTURE AUDIT

One outbox (the journal record's `outbox`), one journal (`DurableCommandJournal`), one delivery sink (`DeliveredEventLog`), one `dispatchOutbox` implementation, one persistence primitive (`DurableJsonStore`), one idempotency mechanism (journal tenant+key), **one recovery transition (`reconcileStaleProcessing`, PROCESSING→RETRYABLE only)**. No duplicate queue/recovery engine/transaction engine, no new database, no WAL, no new lock framework, no renderer/AI filesystem access, no shadow state, no new state. No frozen-surface change.

## 23 · REMAINING GREEN / YELLOW / RED / GRAY

- 🟢 **GREEN** — crash-orphaned stale PROCESSING now recovers to DELIVERED via the existing machine; active PROCESSING provably protected; at-least-once + idempotent preserved; concurrency/tenant/valid-JSON durability proven; wired into the production boot path.
- 🟡 **YELLOW** — real-OS-`SIGKILL` packaged-runtime e2e of the boot recovery (operator step; the deterministic injection is faithful, but a real kill is not claimed).
- ⚪ **GRAY** — S37 **Finding #2** (pre-commit dual-write window) remains OUT OF SCOPE and undefined, per mission §15; not touched this session.
- 🔴 **RED** — none.

## 24 · COMMIT HASH

`feat(erp-s38): recover stale processing outbox` — SHA at commit time (see §25/§26).

## 25 · PUSH STATUS

The Linux sandbox has no git credentials — **push cannot be performed here**. Do NOT assume it was pushed.

## 26 · MAC HANDOFF

```
git log -1 --oneline          # expect the erp-s38 commit at HEAD
git push origin cert/data-import-cst-integration
```

## Status: 🟢 GREEN — crash-orphaned PROCESSING outbox records are now safely recovered at boot (stale → RETRYABLE → existing relay → DELIVERED), with active PROCESSING provably never reclaimed and delivery honestly at-least-once + idempotent. S37 Finding #2 remains GRAY and untouched.
