# Phase I-A.3 Step 5 — Implementation Discrepancy (STOP before code)

**READ-ONLY. No source changed, no commit, no push.** Baseline HEAD `fafafc7`. The
mandatory pre-code source review found that the approved Option-B design **cannot be
realized within the two authorized surfaces alone** (`ExecutionSession` type + `ExecuteEngine`
behavior). One required change lies outside them. Reporting per the rule "If implementation
discovers a required change outside this scope: STOP and report the discrepancy. Do not
resolve it silently."

## The discrepancy — the durable persist is fire-and-forget, and making it awaitable
requires a change outside the authorized surfaces

**Approved design (critical ordering):** synchronously reserve `decisionId` → stamp the
session → **AWAIT successful durable persistence** → *only then* invoke the executor.
("Do not interpret 'persist called' as 'persisted'.")

**Source reality `[PROVEN]`:**
- `ExecuteEngineDeps.persist?: (session: ExecutionSession) => void` (`apps/desktop/src/main/executeEngine.ts:40`) — typed to return **`void`**.
- Injection: `persist: (session) => void executionStore.save(session)` (`apps/desktop/src/main/runtimeCore.ts:2380`) — the **`void` operator discards** the `Promise<void>` that `ExecutionStore.save` returns (`executionStore.ts:116`). Fire-and-forget.
- `finish()` also calls `this.deps.persist?.(...)` fire-and-forget for the POST-effect result write (`executeEngine.ts:173`) — that one need NOT be awaited.

**Consequence:** To actually await the durable write before the effect, BOTH are needed:
1. Change `ExecuteEngineDeps.persist` type → `(session) => Promise<void> | void` — in
   `apps/desktop/src/main/executeEngine.ts`. **WITHIN authorized surface #2** (ExecuteEngine).
2. Change the **injection** to return the promise: `persist: (session) => executionStore.save(session)`
   (drop the `void` operator) — in **`runtimeCore.ts:2380`**. **OUTSIDE** the two authorized
   surfaces (ExecutionSession type + ExecuteEngine behavior).

**Why it cannot be worked around:** if only the dep type changes and the injection keeps
`void executionStore.save(...)`, then `await this.deps.persist?.(session)` awaits `void` and
resolves immediately — the disk write is **not** actually awaited. Implementing that would
be a **silent weakening** ("persist called" ≠ "persisted"), which the authorization
explicitly forbids. So the design's core ordering is **unrealizable** without the
`runtimeCore.ts:2380` injection change.

## Everything else IS within the authorized surfaces (ready once the above is authorized)
- `ExecutionSession` += optional `decisionId?`, `bindingDigest?`, `claimNonce?`
  (`packages/shared/src/types/executeEngine.ts`, the `ExecutionSession` type — authorized #1).
- `ExecuteEngine`: a `consumedDecisions: Set<string>`; a synchronous check-then-reserve for
  claim-bearing requests in `execute`'s pre-`await` prefix; stamp the three fields on the
  session; `await` persist before the executor (`executeEngine.ts` — authorized #2).
- **Boot hydration folds into `seedHistory`** (authorized #2): `recoverInterrupted`
  (`packages/shared/.../executeEngine.ts:127`) returns the **full** persisted set, and
  `runtimeCore:2548` already calls `seedHistory(recovered)` — so populating
  `consumedDecisions` from the seeded sessions' `decisionId`s needs **no runtimeCore change**.
  (Populate before the history prune so the consumed set is not bounded by the history cap.)

## Minimal resolution requested
Authorize the **one-line** `runtimeCore.ts:2380` change (`void executionStore.save(session)`
→ `executionStore.save(session)`) as part of the ExecuteEngine durable-consumption **wiring**
— it does not change `ExecutionStore`, does not change what `save` does, and is the only
change outside the two named surfaces. With it, the awaited-persist-before-effect ordering
becomes real.

## Not doing
No source changed. No silent runtimeCore edit. No fake await. No new store. No `fsync` (the
declared residual). H-FINDING-3 OPEN. Awaiting authorization for the `runtimeCore:2380`
one-liner before implementing Option B.
