# ERP SESSION 37 — CRASH-RECOVERY DECISION MEMO

**Status:** STOP — two recovery semantics are UNDEFINED/limited. No recovery transition was invented (per mission §3/§15). This memo states the facts, the options, and the honest current guarantee. **No production code was changed.**

---

## FINDING 1 — a crash while an outbox record is `PROCESSING` is never recovered (undefined semantic)

### The facts (measured, reproduced in `session37CrashRecovery.test.ts` TEST D + F)

`dispatchOutbox` delivers by: `markProcessing(id)` (persists `PROCESSING`, attempts+1) → `consumer(event)` → `markDelivered(id)` OR `markRetryable(id, err)`. `markProcessing` writes `PROCESSING` to disk **before** the consumer runs.

`DurableCommandJournal.pendingOutbox()` returns records whose status is `PENDING` **or** `RETRYABLE` only — it **excludes `PROCESSING`** (`durableCommandJournal.ts:197-201`). There is **no startup/boot reconciliation** anywhere that resets or re-drives a `PROCESSING` record (verified across `src/main`; the only reconciler is the unrelated M365 read-back reconciler).

**Consequence:** if the process is killed in the window between `markProcessing` and `markDelivered`/`markRetryable`, the record stays `PROCESSING` forever. On restart it is not in `pendingOutbox`, so the relay never picks it up — the delivery is **orphaned** (never delivered, never retried, never surfaced as a failure to re-drive).

### Why this is a decision, not a silent fix

A safe recovery *appears* obvious — re-drive `PROCESSING` records on restart, since the platform's stated guarantee is **at-least-once delivery + idempotent consumers**, so a re-drive of a record that may already have been delivered is a no-op (TEST D second case proves the `DeliveredEventLog` sink is idempotent by `eventId`). **But the mission explicitly forbids inventing this transition**, and there are real design questions only the operator/architect should settle:

1. **Where does recovery run?** Options: (a) fold `PROCESSING` into `pendingOutbox` (re-drive on the next dispatch/shutdown drain — simplest, but changes the meaning of "pending"); (b) a dedicated boot-time reconciliation pass that transitions stale `PROCESSING → RETRYABLE` (or `PENDING`) before the first drain; (c) an age/attempt threshold so only *stale* `PROCESSING` (older than N) is reclaimed, avoiding racing a live in-flight delivery in a multi-drain future.
2. **At-least-once contract confirmation.** Re-driving `PROCESSING` is only safe if **every** consumer is idempotent. Today the sole production consumer (`DeliveredEventLog.record`) is idempotent by construction. A recovery rule makes idempotent-consumer a hard, permanent requirement for any future outbox consumer — that is a contract decision.
3. **Interaction with a future concurrent-drain design.** Today the drain is single-flight (S31 latch). If drains ever run concurrently, a naive "re-drive all PROCESSING on boot" could double-deliver a genuinely in-flight record. The reclamation rule must be defined against the concurrency model.

### Recommended (for the operator to rule on — NOT implemented)

Option (b) + (c): a bounded boot-time reconciliation that moves **stale** `PROCESSING` records to `RETRYABLE` with a recorded reason (`"reclaimed after unclean shutdown"`), so the existing relay re-drives them and S35 delivery-operations surfaces them honestly. This reuses the existing state machine (no new state), preserves at-least-once + idempotent semantics, and adds no new store or engine. It is a small, additive, non-frozen change — but it is a **recovery-semantics decision** and is therefore deferred to an explicit ruling.

---

## FINDING 2 — the pre-commit dual-write window (inherent, bounded, pre-existing)

### The facts (TEST A + §5)

The governed command sequence is: `journal.run(execute)` where `execute` performs the **domain mutation first** (inside the module handler, e.g. the order is created + persisted) and returns a `rollback`; the journal then commits idempotency + event + outbox as **one atomic write**. If that commit **fails in-process**, `journal.run` calls `rollback` to compensate the domain effect (proven by S18 test C). A **true crash** in the window between the domain effect and the journal commit **skips the rollback**, so the domain effect can be **stranded** on disk with no committed command referencing it.

Because the order store generates a fresh `rec_<uuid>` per create (`enterpriseRecordStore.ts:466`, not self-idempotent on `orderNumber`), a client that re-submits the same command after such a crash — finding no committed journal record to replay — would **re-execute and create a second order**.

### Why this is bounded and not fixed here

- The journal's **committed-command layer is authoritatively clean** after such a crash (TEST A: zero phantom records/events/outbox), so idempotency for *committed* commands is intact and replay-safe across restart (§5 proves exactly-one durable effect per key once committed).
- The window is narrow (domain-write → atomic journal rename) and requires **both** a crash precisely in that window **and** a client re-submit to actually duplicate.
- Closing it fully requires the domain mutation to participate in the **same** durable transaction as the journal commit (a single-store transactional-outbox redesign) — a large architectural change explicitly outside this mission's scope ("This is NOT a new transaction module / persistence layer").

### Honest current guarantee

**AT-LEAST-ONCE delivery + IDEMPOTENT consumers; at-most-once *committed* command per idempotency key. NOT exactly-once external delivery, and NOT crash-atomic across the domain-effect/journal-commit boundary.** The dual-write window is a known, bounded limitation of the execute-then-commit design, recorded for a future transactional-outbox decision.

---

## What was delivered this session (no invented semantics)

- A crash-recovery certification suite exercising the **real** production components (`dispatchCommand` → `DurableCommandJournal` → real order module → `dispatchOutbox` → `DeliveredEventLog`) via deterministic failure injection at the real boundaries.
- Honest **reproduction** of both findings above (TEST A, D, F) rather than hiding them.
- Proof that the **safe** boundaries are safe: committed commands survive restart and never duplicate; PENDING/RETRYABLE re-drive to DELIVERED; retries are idempotent (never delivered twice); concurrent commits lose nothing and never duplicate; tenant isolation holds across restart; the durable files stay valid JSON (S33 atomic writes → S36-backup-able); S34 health + S35 delivery-operations report the real post-recovery state.

**Neither finding was fixed. Both await an explicit operator ruling.**
