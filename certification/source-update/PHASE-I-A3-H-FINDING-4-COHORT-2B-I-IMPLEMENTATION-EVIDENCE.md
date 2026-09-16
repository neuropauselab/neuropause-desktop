# Phase I-A.3 — H-FINDING-4 Cohort-2B-i Implementation Evidence

**Status: IMPLEMENTED + VERIFIED — AWAITING REVIEW / COMMIT AUTHORIZATION. Not committed. Not
pushed.** Baseline HEAD `8846371`, branch `cert/data-import-cst-integration`. Labels: `[PROVEN]`/
`[INFERRED]`/`[DESIGN]`/`[OPEN]`/`[NOT PROVEN]`.

## 1. Baseline HEAD
`8846371` (chain `90527b4 → dc9e8f3 → 8846371`). Clean tree at start.

## 2. Exact scope
The 9 REVERSIBLE Cohort-2B-i actions. Cohort-2B-ii (`drive.upload`, `drive.restoreVersion`,
`contacts.update`) intentionally EXCLUDED and left on the existing executor.

## 3. Exact 9 actions
mail.saveDraft, mail.move, mail.markRead, mail.restore, mail.addAttachment, drive.rename, drive.move,
drive.createFolder, contacts.create.

## 4. Files changed
- **Production:** `cst/governedAction.ts` (+`GOVERNED_ACTION_COHORT2B_I` set; +`ACTION_REVERSIBILITY`
  map; +exported `reversibilityForAction()`; parameterize the request's `reversibility` from it),
  `connectors/index.ts` (import + extend routing to `COHORT1 || COHORT2A || COHORT2B_I`).
- **Tests:** `cst/governedAction.cohort2b.test.ts` (NEW, 59).
- No other production/test file changed. CST kernel, `durableIdempotencyStore.ts`, `actionSdk.ts`,
  governedSend/mail.send, worker surfaces UNCHANGED.

## 5. Metadata model (Option A) `[PROVEN]`
Per-action reversibility via `ACTION_REVERSIBILITY` (the 9 → `REVERSIBLE`) with `reversibilityForAction()`
defaulting to `IRREVERSIBLE`. The adapter's request reversibility is now `reversibilityForAction(action.id)`
instead of a hardcoded `IRREVERSIBLE`. **Reversibility is descriptive CST evidence** — the kernel does
not branch on it, and it is **NOT part of the idempotency key** — so this changes NEITHER action
identity NOR admission, only the recorded class. Cohort-1/2A/mail.send default to `IRREVERSIBLE`
(behavior unchanged; test-proven). Consequence stays `C3`. `[PROVEN]`

## 6. Routing `[PROVEN]`
The existing governedAction branch now matches `COHORT1 || COHORT2A || COHORT2B_I`, using the identical
call and the SAME durable `m365ActionPorts`. `mail.send`→governedSend and the `m365.execute` fallback
unchanged; the 3 Cohort-2B-ii actions remain on the executor. `[PROVEN]`

## 7. Authority `[PROVEN]`
`actorId = deps.actor()` (authenticated session, never renderer, `''`→DENY); `tenantId =
deps.workspaceId()`; ownership/scope/token via `m365OwnsAccount`/`m365GrantedScopes`/`m365GetToken`.
Identical to Cohort-1/2A. `[PROVEN]`

## 8. Canonical identity `[PROVEN]`
`sha256(canonicalize({tenantId,connectorId,accountId,actionId,params}))` unchanged. Tests: reordered
object keys → same identity (suppressed); a materially different consequential param (folder
destination, read-state, new name, parent, folder name) → different identity (both execute).
Reversibility is NOT in the key. `[PROVEN]`

## 9. Denial-before-effect `[PROVEN]`
For all 9: unconfirmed → HOLD; unauthorized account / missing scope / missing token / missing actor /
non-canonicalizable params → DENIED — each with `effectCalls===0` AND the injected `action.run`
counter `===0`. Effect physically unreachable, not merely a verdict. `[PROVEN]`

## 10. Replay `[PROVEN]`
First → one effect; exact + reordered-key replay → suppressed (no second effect); different params →
independent governed identity (both execute). `[PROVEN]`

## 11. Concurrency `[PROVEN]`
Concurrent identical requests (shared ports) → exactly one effect (CST atomic single-winner). `[PROVEN]`

## 12. Restart durability `[PROVEN]`
Per action (all 9): admit + effect, then a FRESH `DurableIdempotencyStore` from the same file (= restart,
new memory, hydrate from disk) + exact replay → **no second effect**. Also: `drive.rename` after a
`NetworkError` (UNKNOWN) → restart replay reconciles/HOLDs, never re-executes. Reuses the committed store;
no new store. Single-process, atomic-rename scope. `[PROVEN]`

## 13. Failure semantics `[PROVEN]`
`HttpError` → `EXECUTION_FAILED` (definite); `NetworkError` → `UNKNOWN`, transport invoked once, no blind
retry; `VERIFIED_SUCCESS` never produced (Profile A). Unchanged from Cohort-1/2A. CONSUMED ≠ EFFECT
SUCCESS ≠ VERIFICATION SUCCESS. `[PROVEN]`

## 14. Cohort-2B boundary `[PROVEN]`
A hard boundary test asserts `drive.upload`, `drive.restoreVersion`, `contacts.update` are in NO governed
set (`COHORT1`/`COHORT2A`/`COHORT2B_I`) and default to `IRREVERSIBLE` (not classified here) → they keep the
existing executor route. This preserves the 2B-i / 2B-ii causal separation for the next gate. `[PROVEN]`

## 15. Regression results (this run)
- `governedAction.cohort2b.test.ts`: **59** (reversibility model, membership + 2B-ii boundary, execution
  ×9, denial matrix ×9, identity, restart ×9, UNKNOWN restart, concurrency, failure).
- Targeted regression: **171/171** (+ Cohort-2A 21, governedAction negative 15, durable restart 6,
  durable store 11, storeScopeGate 12, mail.send negative 16, Boundary-B 8, durable worker consumption 9,
  m365Write 14).
- Full main suite: **8468 passed / 3 skipped** (was 8409 at `8846371` → +59). UI: **24 files / 183
  passed**. Typecheck: clean (node+web). Lint (changed files, `--max-warnings 0`): clean. `git diff
  --check`: clean.

## 16. Frozen surfaces — UNCHANGED `[PROVEN]`
CST kernel, `durableIdempotencyStore.ts`, `sendTransition`/governedSend, `mail.ts`, m365 `executor.ts`,
`actionSdk.ts`, BoundDecisionClaim/mint, `ExecuteEngine`/`ExecutionSession`/`ExecutionStore`, Boundary-B,
`workforceActionExecutor`, worker router/index/runtime, `runtimeCore`, `contracts.ts`, `storeScope.ts`,
`package.json`, Node engine — all git-status blank. No new authority, decision contract, or store.

## 17. Certification level
**SCOPED CERTIFIABLE** (same tier as Cohort-1/2A) for the 9 Cohort-2B-i IPC actions, with HONEST
per-action REVERSIBLE classification. IMPLEMENTED + VERIFIED — awaiting review. Not committed.

## 18. Permitted claim
> "The nine Cohort-2B-i M365 IPC actions (mail.saveDraft, mail.move, mail.markRead, mail.restore,
> mail.addAttachment, drive.rename, drive.move, drive.createFolder, contacts.create) are governed through
> the existing parameterized governedAction/CST path with an HONEST per-action REVERSIBLE consequence
> classification, authoritative IPC identity/context, canonical consequential-action identity, atomic
> admission, single-process restart-durable idempotency, and demonstrated denial-before-effect. The
> implementation reuses the committed durable idempotency store and the unchanged CST kernel and does not
> introduce a new authority, decision contract, or durable store. Reversibility is descriptive evidence
> only and is not part of the idempotency identity, so Cohort-1/2A/mail.send behavior is unchanged."

## 19. Explicit non-claims
NOT claimed: all Cohort-2B actions · all M365 writes · universal M365/NeuroPause governance · provider
idempotency · Graph effect success · verification success · renderer exclusion · cross-process /
power-loss durability · precise governance of drive.upload / drive.restoreVersion / contacts.update (the
2B-ii overwrite/partially-reversible actions remain OPEN). **IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠
UNIVERSAL**; AUTHORITY ≠ DECISION ≠ CLAIM ≠ ADMISSION ≠ EXECUTION ≠ EFFECT ≠ VERIFICATION ≠ EVIDENCE ≠
CERTIFICATION.

## 20. Remaining gaps
- Cohort-2B-ii (drive.upload, drive.restoreVersion, contacts.update) — overwrite / partially-reversible
  with conditional server-side loss; OPEN, separate gate.
- Cross-process / power-loss durability — OPEN.
- Provider idempotency / effect success / verification — not provided by any path.

## 21. Next gate
Separate **commit authorization** for this Cohort-2B-i checkpoint (as `90527b4 → dc9e8f3 → 8846371`),
then a separately-authorized **Cohort-2B-ii** gate (per-action PARTIALLY_REVERSIBLE/DIFFICULT_TO_REVERSE
class + explicit overwrite/loss review). This gate does NOT begin either.

## STOP
Implemented; tests run; evidence written; frozen surfaces checked. **No commit. No push.**
