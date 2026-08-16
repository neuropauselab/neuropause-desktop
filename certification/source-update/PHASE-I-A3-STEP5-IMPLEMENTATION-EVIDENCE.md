# Phase I-A.3 Step 5 — Durable Consumption Implementation Evidence

**Status: IMPLEMENTED + VERIFIED — AWAITING REVIEW. Not committed.** Baseline HEAD
`fafafc7`. Option B implemented within the authorized surfaces + the one authorized
`runtimeCore:2380` wiring correction.

## Exact source files changed (production)
| File | Scope | Class |
|---|---|---|
| `packages/shared/src/types/executeEngine.ts` | `ExecutionSession` += optional `decisionId?`, `bindingDigest?`, `claimNonce?` (+14) | authorized (ExecutionSession type) |
| `apps/desktop/src/main/executeEngine.ts` | `ExecuteEngineDeps.persist` → `Promise<void>\|void`; `consumedDecisions` set; `readGovernedClaim`; check→reserve→stamp→await-persist in `execute`; `seedHistory` hydration; wrap post-effect persist (+90/-) | authorized (ExecuteEngine behavior) |
| `apps/desktop/src/main/runtimeCore.ts` | line 2380: `void executionStore.save(session)` → `executionStore.save(session)` (return the promise) (+5/-1) | the one authorized wiring correction |
**Test file added:** `apps/desktop/src/main/executeEngine.durableConsumption.test.ts` (9 controls).

## Durable fields
`ExecutionSession.decisionId?` (single-use key), `bindingDigest?` (binding integrity),
`claimNonce?` (claim-instance/audit). Optional — absent = legacy/non-governed (mirrors
`tenantId?`).

## Uniqueness mechanism
Key = **`decisionId`**. A governed request (carrying `req.params.claim`) is admitted only
if `decisionId ∉ consumedDecisions`. Proven: same `decisionId` → DENY; different decision
same binding → ALLOW (`decisionId` is the key, not the binding).

## Boot hydration
`seedHistory(sessions)` adds each session's `decisionId` to `consumedDecisions` **before**
the history prune (so the consumed set is not bounded by the history cap).
`recoverInterrupted` returns the **full** persisted set (`packages/shared/.../executeEngine.ts:127`),
and `runtimeCore:2548` already calls `seedHistory(recovered)` — so hydration needs no
runtimeCore change. Proven: a new engine seeded from the durable set DENIES a replay.

## Reservation semantics
`check (consumedDecisions.has)` → `reserve (consumedDecisions.add)` is a **single
synchronous section** in `execute`'s pre-`await` prefix (no `await` between). Two concurrent
same-decision submissions ⇒ the first reserves before the second checks ⇒ exactly one
admitted. Proven (concurrent test: exactly one failed, one effect).

## Persistence ordering — the await is GENUINE
```
ExecuteEngine.execute (governed branch)
   → await this.deps.persist?.(session)           executeEngine.ts (claim branch)
   → deps.persist = (session) => executionStore.save(session)   runtimeCore.ts:2380 (returns the promise)
   → ExecutionStore.save(session): Promise<void>   executionStore.ts:116 (→ persist → writeNow → fs.rename)
   → await completion
   → executor(req)  (the consequential effect)     executeEngine.ts
```
The dep type is `Promise<void> | void`; the injection **returns** the store promise (no
longer `void`-discarded); `execute` **awaits** it before the executor. Non-governed persists
remain fire-and-forget (`void Promise.resolve(...).catch(()=>{})`).

## Persistence-failure semantics — fail closed (proven)
```
ExecutionStore.save() rejects
   → catch: consumedDecisions.delete(decisionId); un-stamp session
   → finish(session, failed, 'Durable admission failed; execution refused')
   → return  (executor NEVER invoked)
```
Proven: with a failing persist, `effects === 0` (no effect), the session is `failed`, and
the decision is **not** falsely consumed — a subsequent working attempt is admitted and runs.

## Crash / restart / concurrency behavior
- **Crash-after-admission (durable), before effect:** the persisted `decisionId` survives →
  hydrated on restart → replay **DENIED**. CONSUMED is permanent; a genuine retry requires a
  NEW governance decision. (Proven via the seedHistory/replay test.)
- **Crash-after-effect / lost response:** the session is interrupted (outcome UNKNOWN, H-J),
  `decisionId` consumed → replay **DENIED**; no blind duplicate.
- **CONSUMED ≠ effect success:** proven — a consumed decision whose effect *failed* is still
  single-use (replay DENIED, no retry).
- **Concurrency:** exactly one admitted (proven).

## Test counts
`executeEngine.durableConsumption.test.ts`: **9/9**. Regression: existing engine/store/
workforce-execution tests **33/33**. **Full main suite: 797 files, 8309 passed, 3 skipped**
— passes the declared automated test suite without detected regression. Typecheck: clean.

## Frozen-surface verification (all UNCHANGED)
`executionStore.ts` (architecture untouched — reused), m365 `executor.ts`, `mail.ts`,
`sendTransition.ts` (governedSend), `boundDecisionClaim.ts`/`boundDecisionClaimMint.ts`,
`secureBridge.ts`, `workforceActionExecutor.ts`, `runBinding` (runtimeCore change is ONLY
the persist line 2380), `workforceJobs.ts` (`GovernanceVerdict`/`ProposalApproval`), kernel
(vendored tgz). `ExecuteRunRequest` unchanged (`.strict()`, renderer-excluded).

## Negative controls (held)
No claim → non-governed (no consumption, unaffected); already-consumed decision → no second
effect; persistence failure → no effect; concurrent duplicate → ≤1 admission; restart replay
→ DENY; legacy session (no decisionId) → unaffected; renderer cannot inject `req.params.claim`
(`ExecuteRunRequest` `.strict()`, structural). Consumption ≠ effect success ≠ verification;
UNKNOWN never → success/retry.

## Residual limitation (declared, not addressed)
No `fsync`: `ExecutionStore.writeNow` does a temp-write + atomic `fs.rename` (durable for a
process restart) but no `fsync`, so a hard power-loss between rename and OS flush is an
uncovered window. **Not claimed.** Closable in a separate change.

## Certification status
**H-FINDING-3: OPEN.** This gate establishes the durable-consumption **foundation** only.
The actual Boundary-B enforcement (pre-effect verification of claim + exact binding +
consumption at `runBinding`, plus claim transport attach) remains its own separate gate.

## Permitted certification claim
*"Execution admission for the governed worker path can durably associate a governed decision
with an execution record and prevent re-admission of the same decision across supported
process-restart semantics, within the declared persistence (atomic rename; no fsync) and
single-process runtime scope."*

**Not claimed:** universal governance · Boundary-B fully enforced · effect success · provider
idempotency · verification success · hard-power-loss durability · cross-process replay ·
AuthorityLease · ExecutionClaim · policy-version provenance.
