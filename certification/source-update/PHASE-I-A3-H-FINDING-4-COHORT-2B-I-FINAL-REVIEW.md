# Phase I-A.3 — H-FINDING-4 Cohort-2B-i Final Review (READ-ONLY)

**No production/test/certification-doc change, no staging, no commit, no push.** Baseline HEAD
`8846371`. Labels: `[PROVEN]`/`[NOT PROVEN]`.

## 1. Repository state `[PROVEN]`
HEAD `8846371`, branch `cert/data-import-cst-integration`; 2 modified production + 1 new test + prior
read-only docs; nothing staged; `diff --check` clean. Matches the implementation report. No discrepancy.

## 2. Scope `[PROVEN]`
Reviewed the 9 REVERSIBLE actions only: mail.saveDraft, mail.move, mail.markRead, mail.restore,
mail.addAttachment, drive.rename, drive.move, drive.createFolder, contacts.create. Verified
drive.upload / drive.restoreVersion / contacts.update stay OUTSIDE this gate.

## 3. Diff review `[PROVEN]`
Additive: `governedAction.ts` adds `GOVERNED_ACTION_COHORT2B_I` (exactly the 9), `ACTION_REVERSIBILITY`
(the 9 → REVERSIBLE), exported `reversibilityForAction()` (default IRREVERSIBLE), and changes the
request line to `reversibility: reversibilityForAction(action.id)`. `connectors/index.ts` imports the
set and extends the condition to `COHORT1 || COHORT2A || COHORT2B_I` with the identical `governedAction`
call and the same `m365ActionPorts`. Cohort-1/2A sets unchanged; 2B-ii in no set; mail.send/governedSend
branch and the `m365.execute` fallback unchanged; no new authority / decision contract / store / second
mechanism.

## 4. Authority `[PROVEN]`
`actorId=deps.actor()` (session, never renderer, `''`→DENY), `tenantId=deps.workspaceId()`, ownership/
scope/token via `m365OwnsAccount`/`m365GrantedScopes`/`m365GetToken`, `confirmed`. No fallback identity;
checks precede the effect (denial tests). Renderer-supplied request ≠ unauthorized (governed before effect).

## 5. Reversibility metadata `[PROVEN]`
2B-i → REVERSIBLE; Cohort-1/2A/mail.send → IRREVERSIBLE (default, unchanged); 2B-ii → IRREVERSIBLE
default AND outside the governed set. Reversibility is descriptive; **NOT part of the idempotency key**
(`sha256(canonicalize({tenantId,connectorId,accountId,actionId,params}))`), so it changes neither
identity nor admission. No existing cohort semantics weakened. `[PROVEN]`

## 6. Canonical identity `[PROVEN]`
Unchanged formula; tests: reordered keys → same; materially different consequential params → different;
non-canonicalizable → fail closed; reversibility not in identity.

## 7. Denial-before-effect `[PROVEN]` (reproduced 171/171)
For all 9: unconfirmed→HOLD; unauthorized/missing-scope/missing-token/missing-actor/non-canonical→DENIED —
each `effectCalls===0` AND `action.run===0`. Effect unreachable, not merely a verdict.

## 8. Replay `[PROVEN]`
First→one effect; exact + reordered-key → suppressed; different params → independent identity (not a
binding mismatch — direct-action model).

## 9. Concurrency `[PROVEN]`
Concurrent identical → exactly one effect (CST atomic single-winner); single-process scope only.

## 10. Restart durability `[PROVEN]`
All 9: fresh `DurableIdempotencyStore` from the same file (restart) + replay → no second effect; UNKNOWN
(NetworkError)+restart → reconcile/HOLD, never re-executes. Single-process, atomic-rename scope; no
fsync/power-loss/cross-process claim.

## 11. Failure semantics `[PROVEN]`
HttpError→EXECUTION_FAILED; NetworkError→UNKNOWN, no blind retry; no VERIFIED_SUCCESS. CONSUMED ≠ EFFECT
SUCCESS ≠ VERIFICATION SUCCESS.

## 12. Action-specific consequence `[PROVEN]` (source-verified)
All 9 legitimately REVERSIBLE: saveDraft=draft (not sent), move/restore=folder move, markRead=toggle,
addAttachment=attach to a message/draft, drive.rename/move=reversible, drive.createFolder
(conflict=rename, non-destructive), contacts.create=create. None externally communicative; none a hard
delete.

## 13. 2B-ii boundary `[PROVEN]`
drive.upload / drive.restoreVersion / contacts.update in NO governed set → remain on `m365.execute`
fallback. Not certified here.

## 14. mail.send regression `[PROVEN]`
governedSend unchanged; `sendTransition.negative.test.ts` 16/16 (reproduced).

## 15. Cohort-1 regression `[PROVEN]`
governedAction negative 15/15, durable restart 6/6, storeScopeGate 12/12 (reproduced) — no regression.

## 16. Cohort-2A regression `[PROVEN]`
`governedAction.cohort2a.test.ts` 21/21 (reproduced) — no regression.

## 17. Worker regression `[PROVEN]`
Boundary-B enforcement 8/8, durable worker consumption 9/9 (reproduced); worker surfaces unchanged.

## 18. Full test results `[PROVEN — REPRODUCED THIS REVIEW]`
Cohort-2B-i **59/59**; targeted regression **171/171**; **full main suite 8468 passed / 3 skipped**
(= 8409 baseline + 59); UI **24 files / 183 passed**; typecheck clean (node+web); lint changed files
clean; `git diff --check` clean. All REPRODUCED THIS REVIEW.

## 19. Frozen surfaces `[PROVEN]`
CST kernel, `durableIdempotencyStore.ts`, `sendTransition`/governedSend, `mail.ts`, m365 `executor.ts`,
`actionSdk.ts`, BoundDecisionClaim/mint, `ExecuteEngine`/`ExecutionSession`/`ExecutionStore`, Boundary-B,
worker surfaces, `runtimeCore`, `contracts.ts`, `storeScope.ts`, `package.json`, Node engine — all
git-status blank.

## 20. Certification-claim audit `[PROVEN]`
- "...governed through the existing parameterized governedAction/CST path with an honest per-action
  REVERSIBLE classification, authoritative IPC identity/context, canonical action identity, atomic
  admission, single-process restart-durable idempotency, and demonstrated denial-before-effect." →
  **PROVEN** (§3-10, 171/171).
- "...reuses the committed durable store and unchanged CST kernel and introduces no new authority,
  decision contract, or store." → **PROVEN** (§19, same ports).
- "Reversibility is descriptive evidence only and not part of the idempotency identity, so Cohort-1/2A/
  mail.send behavior is unchanged." → **PROVEN** (§5, Cohort-2A 21/21 + mail.send 16/16 unchanged).
No sentence NOT PROVEN; no strengthening.

## 21. Non-claim audit `[PROVEN]`
Evidence disclaims: all Cohort-2B / all M365 writes / universal governance / provider idempotency /
Graph effect / effect success / verification success / renderer exclusion / cross-process / power-loss /
drive.upload / drive.restoreVersion / contacts.update governance. IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠
UNIVERSAL preserved.

## 22. Exact file scope `[PROVEN]`
Production: `cst/governedAction.ts`, `connectors/index.ts`. Test: `cst/governedAction.cohort2b.test.ts`.
Evidence: `PHASE-I-A3-H-FINDING-4-COHORT-2B-I-IMPLEMENTATION-EVIDENCE.md`. No unrelated tracked file
changed. Prior read-only docs remain untracked.

## 23. Remaining gaps
Cohort-2B-ii (drive.upload, drive.restoreVersion, contacts.update) OPEN; cross-process/power-loss
durability OPEN; provider idempotency / effect success / verification not provided.

## 24. Final decision — **A. COMMIT-READY**
Certification level: VERIFIED — SCOPED CERTIFIABLE, PENDING COMMIT. IMPLEMENTED + VERIFIED + COMMIT-READY
≠ UNIVERSAL. Recommend committing the Cohort-2B-i checkpoint (2 production + test + evidence) as a child
of `8846371`; then Cohort-2B-ii under separate authorization.

## STOP
Read-only review complete. No repository mutation performed.
