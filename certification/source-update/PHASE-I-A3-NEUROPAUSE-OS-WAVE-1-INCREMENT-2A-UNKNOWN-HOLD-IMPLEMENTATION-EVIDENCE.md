# Phase I-A.3 — NeuroPause OS Wave 1 / Increment 2A — M365 OUTCOME_UNKNOWN → Existing Durable Hold

**Status: IMPLEMENTED + VERIFIED — AWAITING FINAL REVIEW / COMMIT AUTHORIZATION. Not committed, not pushed.**
Baseline HEAD `ffa2863`. Increment-1 changes preserved. This gate made the **minimum authorized frozen-surface
change** to connect the authoritative M365 IPC `OUTCOME_UNKNOWN` to the **existing** hold ledger.
Labels: `[PROVEN]` `[IMPLEMENTED]` `[VERIFIED]` `[OPEN]` `[NOT PROVEN]` `[NOT CLAIMED]`.

## 1. Starting HEAD `[PROVEN]`
`ffa2863`, branch `cert/data-import-cst-integration`. Increment-1 present and preserved.

## 2. Exact authorization `[PROVEN]`
Wave-1 Increment-2A — connect authoritative M365 IPC UNKNOWN → existing `raiseHold`/HoldStore/HoldsView/
reconciliation; minimum frozen seam authorized (`connectors/index.ts` + `runtimeCore.ts`); no worker/CST/
ExecutionStore/Boundary-B change; no renderer-authored hold; no second store.

## 3. Exact files changed `[PROVEN]`
Frozen (additive only, **77 insertions / 0 deletions**):
- **M** `apps/desktop/src/main/connectors/index.ts` — `M365UnknownHoldRaiser` type; `ConnectorSubsystem.
  setUnknownHoldRaiser`; a `let unknownHoldRaiser`; a post-outcome `raiseM365UnknownHold` helper; a guarded call
  `if (g.semanticOutcome === 'UNKNOWN')` on both governed paths (send + action); the setter on the returned subsystem.
- **M** `apps/desktop/src/main/runtimeCore.ts` — one import + one wiring line:
  `connectors.setUnknownHoldRaiser((input) => raiseHold(buildM365UnknownHoldInput(input)))`.
Non-frozen (new):
- **A** `apps/desktop/src/main/decisions/m365UnknownHold.ts` — pure `buildM365UnknownHoldInput` mapping.
- **A** `apps/desktop/src/main/decisions/m365UnknownHold.test.ts` — 9 tests.
Increment-1 (unchanged): `M365WritePanel.tsx`, `m365Outcome.ts`, `ui-tests/m365Outcome.test.tsx`.

## 4. Frozen files touched `[PROVEN]`
Exactly two: `connectors/index.ts`, `runtimeCore.ts`. **No** change to CST kernel, `governedAction`/`sendTransition`
semantics, `actionSdk`, m365 action implementations, `durableIdempotencyStore`, `executeEngine`, `ExecutionSession`,
`executionStore`, `boundaryB`, worker router/runtime, `contracts.ts`, `storeScope.ts`, `packages/shared`,
`package.json`, Node engine (audit §18).

## 5. Why each touched frozen file was necessary `[PROVEN]`
- `connectors/index.ts`: the **only** site holding, together, the authoritative tenant (`deps.workspaceId()`), actor
  (`deps.actor()`), account/connector/action, and the actual `semanticOutcome`. No non-frozen seam observes the
  governed outcome (governedSend/governedAction emit no events; the executor that emits `writeEvents` is bypassed).
- `runtimeCore.ts`: the composition root — the only place both the `connectors` subsystem (built at line 432) and
  `raiseHold` (built at line 1202, tenant-scoped `holdStore`) exist, so the late-bound wiring must live here. A
  single line; the mapping logic is the non-frozen, unit-tested `buildM365UnknownHoldInput`.

## 6. Existing HoldStore reused `[PROVEN]`
No new store, ledger, reconciliation engine, or schema. Reused: `decisions/holdStore.ts` (`open` per-subject
idempotent), `decisions/raiseHold.ts` (`HoldStore.open → DecisionRecord → audit`), the `verification_unavailable`
reason ("Cannot verify the outcome", an ABSENCE reason), tenant-scoped `HoldRecord`, `ipc.holds.list`/`resolve`, and
`HoldsView`. No `HoldRecord` schema extension was required (STOP condition #1 not hit).

## 7. Authoritative outcome source `[PROVEN]`
The hold is raised from the main-process governed result inside the certified handler — never from a renderer
assertion. `tenantId`/`actor` come from `deps.workspaceId()`/`deps.actor()` (the same seams the governed transition
used). The renderer supplies no authority (STOP condition #3 not hit).

## 8. UNKNOWN→Hold sequence `[PROVEN]`
`governedSend`/`governedAction` returns → `if (g.semanticOutcome === 'UNKNOWN')` → `raiseM365UnknownHold(...)` (post
-outcome) → runtime adapter → `raiseHold(buildM365UnknownHoldInput(...))` → `HoldStore.open` (tenant-scoped) →
DecisionRecord + audit → `HoldsView` lists it. **Strictly after** the outcome; the raise touches no effect.

## 9. Deduplication `[PROVEN]`
`subject` = the CST **transitionId** (`m365-send:${idem}` / `m365-action:${idem}`, where `idem` is the canonical
identity hash `sha256(canonicalize({tenantId,connectorId,accountId,actionId,params}))`). `HoldStore.open` is
idempotent per subject, so a repeated identical UNKNOWN → ONE hold; a materially different action → a distinct hold.
Tests prove same-subject→1 (`.id` equal, one audit) and different-subject→2. Not a random UUID; reconstructable.
Also proven deterministic: two identical governed requests yield the SAME transitionId.

## 10. Tenant/actor/account security `[PROVEN]`
`holdStore.bindScope(activeTenantScope)` (runtimeCore:1008) → holds are tenant-owned; a store with no active
org/workspace **refuses** to record (proven by the store itself). Actor recorded from the authoritative signed-in
identity. Account is a hold field, not an authority. Renderer cannot supply tenant/actor and cannot raise a hold
(`ipc.holds` exposes only `list`/`resolve` — no `raise`).

## 11. No-blind-retry `[PROVEN]`
The hold path performs no execution. `HoldsView` resolution ("does not execute anything") only records disposition.
Any further action must traverse the certified governedSend/governedAction path (a new governed decision). No retry
control re-runs the original action. (STOP condition #7/#8 not hit — no worker/ExecutionStore change.)

## 12. No VERIFIED_SUCCESS `[NOT CLAIMED]`
The repository has no independent postcondition verification. An operator resolution records an observation/decision;
it is **never** promoted to VERIFIED_SUCCESS. The hold reason `verification_unavailable` states exactly this.

## 13. HoldsView result `[PROVEN]`
The existing `HoldsView` (`ipc.holds.list`) surfaces the new hold with the `verification_unavailable` label ("Cannot
verify the outcome") and its known/unknown/resolution — no HoldsView redesign. (The unified operator console is NOT
built here.)

## 14. Reconciliation result `[PROVEN]`
Reused `ipc.holds.resolve(id, 'took_alternative'|'cancelled', note)` — no new reconciliation API. Test proves resolve
→ `status:'resolved'`, `resolvedOutcome` set, open count → 0, and nothing executed. (STOP condition #2 not hit — the
existing vocabulary represents the pilot dispositions.)

## 15. Denial-before-effect `[PROVEN]`
The raise is strictly post-outcome and never calls `action.run`/the effect, so `effectCalls`/`action.run` are
unaffected. Test proves an ACKNOWLEDGED outcome is NOT UNKNOWN (guard skips → no hold), and the certified
denial-before-effect suites (governedAction/negative, coverage guard, boundaryB-enforcement) remain green in the
full run.

## 16. Test results `[PROVEN]`
- New `m365UnknownHold.test.ts`: **9/9** (pure mapping ×2; real HoldStore integration + dedup + resolve ×4;
  governed UNKNOWN trigger + stable transitionId + ACKNOWLEDGED-not-UNKNOWN ×3).
- Increment-1 `m365Outcome.test.tsx`: **11/11** (within the UI suite).

## 17. Full regression `[PROVEN]` (fresh)
- **Full main suite: 8520 passed / 3 skipped** (808 files) — was 8511/807 → **+9 / +1 file**, no regression.
- **UI suite: 194 passed** (25 files) — unchanged from Increment-1.
- Certification suites (coverage guard, cohort-1/2A/2B-i/2B-ii, negative, sendTransition.negative, boundaryB
  enforcement, durable idempotency, storeScopeGate, m365Write, raiseHold/hold/decisionsIpc) all pass **within the
  full run**. (Note: a hand-picked subset of the hold tests fails in isolation with "no active org/workspace" — a
  pre-existing ambient-tenant-scope test-isolation artifact unrelated to this change; the full suite installs the
  scope and all pass.)
- Typecheck (node+web): clean. Lint (7 changed/new files, `--max-warnings 0`): clean. `git diff --check`: clean.

## 18. Frozen-surface audit `[PROVEN]`
`git diff --name-only` on the frozen set = only `connectors/index.ts` + `runtimeCore.ts` (additive, 77 insertions,
0 deletions). Blank diff for CST/executor/executionStore/boundaryB/m365-actions/shared/package. No cohort membership
changed (coverage guard green). No worker behavior changed. No governance/idempotency mechanism changed.

## 19. Certification impact `[PROVEN]`
No change to authority, actor/tenant sourcing (same seams, read-only use), canonical action identity (read, not
recomputed/altered), governance verdict, admission, idempotency, effect boundary, cohort membership, CST behavior,
worker behavior, or provider semantics. The only new behavior is **post-outcome evidence (hold) creation on
UNKNOWN**. The certified governance decision/admission/effect mechanism is unchanged. Proven from the additive,
guarded diff + green certification suites.

## 20. Remaining gaps `[OPEN]`
- Increment-2A raises the hold in the main process; a **minimal HoldsView label refinement** to badge the M365 origin
  distinctly was NOT required (the existing `verification_unavailable` label suffices) — optional future polish.
- Remaining Wave-1: unified operator console; evidence timeline; additive cross-boundary security tests; signed+
  notarized `ffa2863`-based artifact + clean-machine verification; five-user acceptance.
- Deferred frozen gate (separate): worker OUTCOME_UNKNOWN preservation; ExecutionStore fail-closed.

## 21. Explicit non-claims `[NOT CLAIMED]`
NOT claimed: VERIFIED_SUCCESS / provider verification; worker-path UNKNOWN handling (unchanged); automatic
reconciliation; provider idempotency; cross-process/power-loss durability; universal governance; pilot readiness
(five-user evidence not yet gathered). **IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠ PILOT-VALIDATED ≠ UNIVERSAL.**

## Handoff
- IMPLEMENTED + VERIFIED: **YES** (this increment).
- COMMIT-READY: **YES** — pending explicit commit authorization (changes left unstaged; Increment-1 + Increment-2A
  together).

## STOP
Minimum frozen seam only; full regression green; no worker/CST/ExecutionStore/Boundary-B change. **No commit. No
push.** HEAD `ffa2863`; changes unstaged.
