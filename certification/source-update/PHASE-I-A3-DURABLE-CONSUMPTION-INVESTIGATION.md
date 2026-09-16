# Phase I-A.3 — Durable Decision-Claim Consumption / Replay-Identity Investigation

## 1. Status
**READ-ONLY SOURCE INVESTIGATION.** No production/test change, no commit, no push.
Baseline HEAD `fafafc7`. Evidence tags: `[PROVEN]` (source), `[INFERRED]`, `[DESIGN]`,
`[OPEN]`, `[BLOCKED]`. Supersedes the earlier uncommitted Step-5 draft.

## 2. Scope
Answer one question from the source: *where does the durable fact come from that proves
this exact governance decision was consumed by this exact consequential execution, even
after crash, concurrency and process restart?* No new store, no invented mapping, no
implementation.

## 3. Existing architectural assumptions (carried in)
Claim is in-process, by-reference, not serialized, not a credential (I-A.2/Step-3). v1
binding = 8 fields; claim = `{decisionId, nonce, bindingDigest, issuedAt, expiresAt}`
(Step-1). Transport rides `req.params.claim` un-serialized (Step-3). H-FINDING-3 OPEN.

## 4. Decision identity `[PROVEN]`
`claim.decisionId = proposal.verdict.requestId` = the governance `req.id`
(`workforce/governance/index.ts:46`, `policyEngine.ts:169`). It identifies the governance
request/decision. Uniqueness/stability per evaluation is `[INFERRED]` (it is `req.id`, the
per-evaluation request id) — not proven globally unique from this trace.

## 5. Execution identity `[PROVEN]`
`ExecutionSession.id = ` `` `exec_${this.now()}_${this.seq++}` `` (`executeEngine.ts:79`)
— per-execution, monotonic; `seq` is an **in-memory counter that resets on restart**.
Persisted. Unique within a run. **NOT tied to the claim** — a replay creates a *new*
session with a *new* id. `correlationId = job.correlationId ?? job.id` (`router.ts:40`) —
job/goal-level, shared by a job's proposals, new on re-run.

## 6. Consumption identity — **DOES NOT EXIST** `[PROVEN]`
No durable fact means "this exact decision/claim was admitted to a specific execution."
The persisted `ExecutionSession` (`executeEngine.ts:80-102`) is
`{tenantId?, id, kind, label, state, steps, currentStep, startedAt, completedAt,
durationMs, error, resultSummary, result, correlationId?}` — **no `decisionId`, no
`nonce`, no `bindingDigest`, no claim reference.** So there is no durable
decision→execution or claim→execution relationship.

## 7. Lifecycle trace `[PROVEN]`
```
proposal → GovernanceRuntime.evaluate → GovernanceVerdict{requestId=req.id}   governance/index.ts:46
  → approval (I-A.1 actor/time)                                               workerRuntime.ts:246
  → mintClaimForApprovedProposal (decisionId=verdict.requestId, nonce, digest) boundDecisionClaimMint.ts
  → ExecutionRequest.params{binding[,claim]}                                   router.ts:34
  → ExecuteEngine.execute: build session (NO params), this.sessions.set(id),
      this.deps.persist?.(session)  ← NOT awaited,  then  await executor(req)  executeEngine.ts:110-130
  → workforceActionExecutor reads req.params.binding → runBinding → M365 send  workforceActionExecutor.ts:23
  → finish(session,...) persists result                                       executeEngine.ts:131
  → on boot: recoverInterrupted: in-flight → interrupted, never rerun         executionStore.ts:6, runtimeCore.ts:2537
```

## 8. Persistence trace + the ordering finding `[PROVEN]`
`this.deps.persist?.(session)` (`executeEngine.ts:111`) is **fire-and-forget — NOT
awaited** before `await executor(...)` (`:130`). `ExecutionStore.save → persist → writeNow`
is an async file write (`executionStore.ts:116,186,192`). Therefore the durable session
write **races the effect**: "persisted before effect" is *initiated* before, not
*guaranteed complete* before. A crash after the effect but before the write completes
leaves **no durable record** of that execution.

## 9. Recovery trace `[PROVEN]`
`recoverInterrupted` marks in-flight sessions `interrupted` and they are **never rerun**.
This protects the *same* crashed session. It does **not** consult any claim identity, so a
**new** execution carrying the *same* claim is not recognized.

## 10. Concurrency trace `[PROVEN]`+`[INFERRED]`
`ExecuteEngine.execute` runs a **synchronous prefix** (build session → `this.sessions.set`
→ `persist(...)` call → `emit`) up to the first `await` (`await executor`, `:130`).
`[PROVEN]` Two `execute` calls therefore run prefix-1 fully before prefix-2 (single
thread; the map that dispatches approved bindings calls `submit` sequentially,
`workforce/index.ts:194`). `[INFERRED]` A synchronous *in-memory* nonce check-then-reserve
placed in this prefix would be atomic (no await between check and reserve). But there is
**no such mechanism today**, and the reservation would be **in-memory only** (the durable
`persist` is async and unordered), so it gives *same-run* protection, not cross-restart.

## 11. Crash-before-effect (CASE 1) `[PROVEN]`
Session `set` in-memory; `persist` initiated (maybe incomplete); effect not run. Restart:
if the write completed → interrupted-never-rerun for *that* session; a **replay** (new
submission of the same claim) → new session → executes. No durable claim identity ⇒
**replay not prevented.** The system cannot distinguish "safe recovery of the same
attempt" from "a fresh replay of the claim."

## 12. Crash-after-effect (CASE 2 / lost response) `[PROVEN]`+`[INFERRED]`
Effect occurred; `finish` not reached; result not persisted. The interrupted session
(if the pre-effect write completed) is not rerun → its outcome is **UNKNOWN** (H-J). But a
**replay** of the claim → new session → **duplicate effect**. Connector idempotency:
`M365Executor`/`mail.send` `POST /me/sendMail` is **non-idempotent** with no
provider-side idempotency key (Phase G/I-A.2) ⇒ a duplicate external send is possible.
**NOT safe** without durable claim single-use.

## 13. Lost-response analysis `[PROVEN]`
Consistent with H-J: a transmitted-but-unacknowledged send is `UNKNOWN`, must not be blind
-retried. Nothing here changes that; but the *claim* offers no durable "already-attempted"
fact to gate a later replay.

## 14. Cross-restart replay (CASE 4 — decisive) `[PROVEN]`/`[BLOCKED]`
Durable survivors: persisted `ExecutionSession`s (metadata + result), **no** `decisionId`/
`nonce`/`bindingDigest`. So after restart Boundary B **cannot** deterministically reject a
replayed claim `N` for decision `D`/execution `E`. **Cross-restart replay safety: NOT
PROVEN.**

## 15. Binding durability `[PROVEN]`
The persisted session carries **no** `params`/`binding` (grep: no `session.params`/
`binding`). So the exact binding (executor/target/account/action/params) is **not durable**
and cannot be reconstructed from durable records. A `decisionId` alone therefore could not
prove *binding* identity across restart even if it were persisted. **Binding durability:
NOT PROVEN.**

## 16. Existing reusable anchor `[PROVEN]`
`ExecutionStore` is the **correct** durable execution authority (durable file store,
boot-recovery, per-execution records) — but it currently records **neither the claim/
decision identity nor the binding**, and its write is **not ordered before the effect**.
No existing idempotency/consumption primitive covers the claim (CST `Approval.consumed`/
`ClaimStore` are **in-memory**, `sendTransition.ts:89`).

## 17. Missing invariant
`A claim admits at most one consequential execution, provable across concurrency, crash
and restart.` The missing durable facts: (a) claim/decision identity on the durable
execution record; (b) durable binding identity; (c) a **persist-before-effect** ordering
so the record exists before the effect.

## 18. Classification — **OPTION B** (minimum existing-schema extension)
`ExecutionStore`/`ExecutionSession` is the right durable authority (Option A insufficient;
Option C's new store unnecessary — no new store). But "minimum" here is **three** additions,
all touching the **frozen** `ExecuteEngine` + the `ExecutionSession` type:
1. Add `decisionId?`, `claimNonce?`, `bindingDigest?` to `ExecutionSession`.
2. Stamp them in `ExecuteEngine.execute` from `req.params.claim`.
3. **`await` the persist before the executor** (change fire-and-forget `persist(session)`
   → awaited, ordered before `await executor`) so the consumption record is durable
   *before* the effect.
Then Boundary B (Step 4): synchronous in-memory nonce reserve (concurrency) **and** a
durable check against loaded sessions (cross-restart) ⇒ DENY on a prior `decisionId`/
`nonce`. **This is not a one-field change; it requires the ordering change too.** No new
store; no invented mapping. **Requires explicit authorization (frozen surfaces).**

## 19. Exact source evidence
`executeEngine.ts`: `:79` id; `:80-102`/type `executeEngine.ts:76-102` session shape (no
params/claim); `:110-111` set + **unawaited** persist; `:130` awaited executor; `:131`
finish. `executionStore.ts`: `:116/:186/:192` async persist/writeNow; `:6`/`runtimeCore.ts:2537`
interrupted-never-rerun. `router.ts:40` correlationId; `:34-41` request params. `governance/
index.ts:46` requestId=req.id. `sendTransition.ts:89` CST stores in-memory.

## 20. Security limitations
Preserve the in-process by-reference model (no JWT/HMAC/persisted credential). The claim
remains evidence, not authority. It cannot defend against a fully-compromised local
process (declared). Option B adds **durability of a consumption fact**, not cryptographic
unforgeability.

## 21. Required tests (for the eventual Option-B implementation — DESIGN only)
Same-run: concurrent same-claim ⇒ exactly one execution. Cross-restart: claim consumed →
restart → replay same claim ⇒ DENY (durable record found). Crash-before-persist ⇒ define
behavior (fail-safe: absent record ⇒ treat unknown, do not silently permit a second
effect). Binding-mismatch vs a persisted `bindingDigest` ⇒ DENY. Decision `D`≠`D'` never
share an execution record. `consumed` ≠ `effect occurred` (separate facts).

## 22. Certification impact
**NO PASS** for durable single-use, cross-restart replay safety, concurrent-duplicate
prevention, consequential-effect enforcement, or H-FINDING-3 closure. Only established:
the durable-consumption invariant is **not** satisfiable from existing state; Option B is
the minimum path (frozen-surface change, its own gate).

## 23. Updated I-A.3 status
Step 1 (primitive) ✓ committed · Step 2 (mint) ✓ committed · Step 3 (transport) ✓
investigated/committed · **Durable consumption: BLOCKED (Option B) — needs authorized
frozen-surface changes** · Step 4 (Boundary-B enforcement) may proceed only for
*in-process same-run* single-use, and must NOT assert cross-restart safety · Step 5
(durable) = Option B.

## 24. Recommended next gate
Authorize **Option B** (add `decisionId`/`claimNonce`/`bindingDigest` to `ExecutionSession`
+ stamp in `ExecuteEngine` + await persist before the effect) as its own explicit
frozen-surface gate, with migration/rollback/tests — **before** or **jointly with** Step-4
Boundary-B enforcement. Alternatively, proceed to Step-4 enforcement scoped explicitly to
*same-run* single-use with cross-restart deferred to Option B.

---

## Final report
- **HEAD:** `fafafc7`
- **Working tree:** clean except this uncommitted investigation (+ removed the superseded uncommitted Step-5 draft)
- **Production files changed:** 0 · **Test files changed:** 0 · **Code changes:** NONE · **Commit:** NONE
- **Exact decision identity:** `proposal.verdict.requestId` (= governance `req.id`)
- **Exact execution identity:** `ExecutionSession.id = exec_<time>_<seq>` (per-execution; `seq` in-memory, resets on restart)
- **Exact durable identity (claim/decision):** **NONE exists**
- **Existing persistence anchor:** `ExecutionStore`/`ExecutionSession` — correct authority, but carries no claim/decision/binding identity and its write is not ordered before the effect
- **Claim-to-execution relationship:** **NOT PROVEN**
- **Cross-restart replay safety:** **NOT PROVEN**
- **Concurrent replay safety:** **NOT PROVEN** (same-run achievable in-memory but not implemented; durable not)
- **Binding durability:** **NOT PROVEN**
- **Classification:** **OPTION B** (minimum existing-schema extension: 3 fields + persist-before-effect ordering; reuses ExecutionStore; frozen-surface changes; authorization required)
- **H-FINDING-3:** OPEN
- **Certification:** NO PASS for durable single-use
- **Recommended next gate:** authorize Option B as its own frozen-surface gate (with migration/rollback/tests), before/with Step-4 enforcement
