# Phase I-A.3 — M365 IPC Restart-Durability (Option C) Implementation Evidence

**Status: IMPLEMENTED + VERIFIED — AWAITING REVIEW / COMMIT AUTHORIZATION. Not committed. Not
pushed.** Baseline HEAD `90527b4`, branch `cert/data-import-cst-integration`. Labels: `[PROVEN]`/
`[INFERRED]`/`[DESIGN]`/`[OPEN]`/`[NOT PROVEN]`.

## 1. Repository state before implementation
HEAD `90527b4` (Cohort-1 committed); working tree clean except the prior read-only durability design
doc. Node `>=20.11.0`.

## 2. Scope
**SINGLE-PROCESS restart-durable single-use** for the H-FINDING-4 Cohort-1 M365 IPC governed-action
path (13 actions). Not fsync/power-loss, not cross-process, not the remaining 15 actions, not
mail.send changes.

## 3. Design chosen — Option C
A **new Node-20-compatible durable CST `IdempotencyStore`** (`DurableIdempotencyStore`) that persists
the idempotency INTENT with the repository's atomic-rename pattern, **adapted to the SYNCHRONOUS
`IdempotencyStorePort` contract** (`fs.writeFileSync` + `fs.renameSync`). The CLAIM store stays the CST
in-memory `ClaimStore` — atomic single-winner is a within-process property (NP-PG-10); only the intent
(NP-PG-09 DURABILITY) must cross a process boundary. The **CST kernel is unchanged** — it already
provides the restart/replay control flow store-agnostically; only the injected intent store became
durable. `[DESIGN → PROVEN by tests]`

## 4. Why the Node-20 CST DurableStore was not used
`CST-1.3.0-DEFECTS-FOUND.md` D-CST-B: the CST `DurableStore` imports `node:sqlite` (Node ≥22), which
throws `ERR_UNKNOWN_BUILTIN_MODULE` on the declared Node-20 host. Wiring it would require a Node
upgrade (forbidden). `[PROVEN]`

## 5. New durable store architecture (`cst/durableIdempotencyStore.ts`)
In-memory `Map<key, {state, outcome?}>` mirrored to a JSON file. Constructor **hydrates
synchronously** from the file (boot = process start). `acquire`/`complete`/`release` mutate the map
and **persist synchronously before returning**. Corruption fails closed; a missing file is a fresh
(empty) start.

## 6. Store contract compliance `[PROVEN]`
Implements `IdempotencyStorePort` exactly: `acquire(key) → {fresh,state,outcome?}`, `complete(key,
outcome)`, `release(key)` — all synchronous, so the kernel's synchronous check→reserve→persist has NO
suspension point (atomicity preserved). Injected via `createGovernedActionPorts(idempotency?)`
(defaults to the in-memory store, so existing tests are unaffected). Wired in `connectors/index.ts`
with `join(app.getPath('userData'), 'm365-governed-actions.json')` — the same userData pattern as
`windowState`/`runtimePreferences`; no `runtimeCore` change.

## 7. Persistence ordering `[PROVEN]`
`acquire` writes the IN_FLIGHT intent **durably BEFORE** returning (⇒ before the kernel's effect,
NP-CST-106). `complete` overwrites DONE **after** the effect. The durable IN_FLIGHT from `acquire` is
the restart safety net even if `complete`'s write is lost.

## 8. Restart hydration `[PROVEN]`
The constructor reads the file and rebuilds the map. A fresh instance from the same path shares NO
in-memory state — it recovers only what is on disk. Tests model restart by constructing a NEW store
from the same path (correct single-process-restart model: new memory + hydrate from file; the file is
the only channel). Proven: a DONE intent written by instance A is seen by instance B.

## 9. Atomic admission `[PROVEN]`
Concurrent duplicates within one process → exactly one effect (CST `claimAtomic` in-memory single-
winner; the durable `acquire` write is synchronous, no yield). Test: `concurrent duplicates … exactly
one effect`.

## 10. Replay behavior `[PROVEN]`
- Restart + exact replay → durable DONE → kernel returns the original outcome, `duplicateSuppressed`,
  **no second effect** (effect counter stays 1).
- Restart + reordered object keys → same canonical identity → suppressed (no second effect).
- Restart + different consequential params → different identity → executes independently.

## 11. Concurrency behavior `[PROVEN]` in-process; `[NOT PROVEN]` cross-process
Single-process atomic single-winner proven. Cross-process/multi-instance atomic single-winner is NOT
provided (a JSON file has no cross-process check-reserve primitive; SQLite PRIMARY KEY would, but
`node:sqlite` is unavailable) — `[OPEN / NOT CLAIMED]`.

## 12. Crash behavior `[PROVEN]` (single-process restart) / distinctions preserved
- admitted → IN_FLIGHT persisted; crash before effect → restart replay sees IN_FLIGHT → reconcile
  ({known:false}) → **HOLD**, never re-executes.
- effect ran then crash (UNKNOWN, NetworkError) → the intent is DONE-with-UNKNOWN / IN_FLIGHT → restart
  replay reconciles/HOLDs → **no blind duplicate** (test: `RESTART after a NetworkError … NEVER
  re-executes`). CONSUMED ≠ EFFECT_SUCCESS ≠ VERIFICATION; UNKNOWN stays UNKNOWN; no blind retry.
- Power loss (no fsync): `[NOT CLAIMED]`.

## 13. Corruption behavior `[PROVEN]`
Corrupt JSON / unexpected shape / invalid record → throws `DurableStoreError` on construction — the
store is **NEVER silently reset to empty** (which could permit a duplicate effect). A missing file
(never existed) → safe fresh empty start. Any non-ENOENT read error → fail closed (throw).

## 14. Persistence failure behavior `[PROVEN]`
`acquire`: if the durable write fails, the in-memory reservation is **rolled back and the error
rethrown** — no admission, therefore no effect (test: `persistence failure at acquire ⇒ rolls back …
no admission`). `complete`/`release` swallow a persist error because the durable IN_FLIGHT from
`acquire` still prevents restart re-execution (fail-closed: never a duplicate effect).

## 15. Test evidence (this run) `[PROVEN]`
- `durableIdempotencyStore.test.ts` — **11** (persist/hydrate/restart, DONE permanence, missing→fresh,
  corrupt→throw, invalid record→throw, persistence-failure rollback, unreadable→throw).
- `governedAction.durableRestart.test.ts` — **6** (restart exact-replay no-2nd-effect, reordered-keys,
  different-params independent, NetworkError-UNKNOWN restart no-re-execute, fresh store executes,
  concurrent one-effect).
- `governedAction.negative.test.ts` — **15** (unchanged, still green).
- `storeScopeGate.test.ts` — **12** (the tenancy governance gate; the new store now declares its
  scope). Focused: **44/44**.
- Full main suite: **8388 passed / 3 skipped** (was 8371 at `90527b4` → +17). UI: **24 files / 183
  passed**. Typecheck: clean. Lint (changed files, `--max-warnings 0`): clean. `git diff --check`: clean.

## 16. Frozen surfaces — UNCHANGED `[PROVEN]`
CST kernel, `sendTransition.ts`/governedSend, `mail.ts`, m365 `executor.ts`, `actionSdk.ts`,
BoundDecisionClaim/mint, `ExecuteEngine`/`ExecutionSession`/`ExecutionStore`, Boundary-B,
`workforceActionExecutor`, worker router/index/runtime, `runtimeCore`, `contracts.ts`, `storeScope.ts`,
`package.json`, Node engine — all git-status blank. Changed only: NEW `durableIdempotencyStore.ts`
(+ its declareStoreScope + tests); `governedAction.ts` (port type widened to `IdempotencyStorePort` +
optional injection); `connectors/index.ts` (wire the durable store). The Cohort-1 action list,
canonical identity formula, and mail.send path are unchanged.

## 17. Remaining limitations `[OPEN]` / `[NOT CLAIMED]`
- fsync / power-loss durability: NOT CLAIMED (atomic rename only).
- cross-process / multi-instance atomic single-winner: NOT PROVEN (fs limitation under Node-20).
- remaining 15 M365 write actions: OPEN (separate cohort gate).
- provider idempotency, effect success, verification success, renderer exclusion, universal
  governance: NOT CLAIMED.

## 18. Certification status
**IMPLEMENTED — AWAITING REVIEW.** Single-process restart-durable single-use for Cohort-1 is
demonstrated by the tests within the declared atomic-rename scope. Not committed.

## 19. Permitted claim
> "The Cohort-1 M365 IPC governed-action path preserves its consequential-action admission/idempotency
> intent across supported single-process restarts using a Node-20-compatible durable persistence
> mechanism (synchronous atomic temp-file + rename), preventing re-admission of the same canonical
> consequential action after restart, and reconciling/HOLDing an interrupted (UNKNOWN) intent rather
> than re-executing — within the declared atomic-rename persistence scope and WITHOUT claiming
> fsync/power-loss durability or cross-process/multi-instance atomic single-winner. The CST kernel is
> unchanged; no new authority, decision contract, or tenant model was introduced."

## 20. Non-claims
Fsync/power-loss durability · cross-process/multi-instance single-winner · remaining 15 M365 actions ·
provider idempotency · effect success · verification success · renderer exclusion · worker/IPC
mechanism equivalence · shared worker/IPC decision identity · universal M365 governance · universal
certification. **IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠ UNIVERSAL.**

## 21. Next gate
Either (a) the **remaining 15 M365 write actions** cohort, or (b) a **cross-process / power-loss
durability** gate (only if the runtime later establishes `node:sqlite`/fsync). Both separately
authorized. This gate does NOT start them.

## STOP
Implementation complete; tests run; evidence written; frozen surfaces checked. **No commit. No push.**
