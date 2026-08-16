# Phase I-A.3 — H-FINDING-4 Cohort-2A Implementation Evidence

**Status: IMPLEMENTED + VERIFIED — AWAITING REVIEW / COMMIT AUTHORIZATION. Not committed. Not
pushed.** Baseline HEAD `dc9e8f3`, branch `cert/data-import-cst-integration`. Labels: `[PROVEN]`/
`[PROVEN-ABSENT]`/`[INFERRED]`/`[DESIGN]`/`[OPEN]`/`[NOT PROVEN]`.

## 1. Baseline
HEAD `dc9e8f3` (Cohort-1 governance `90527b4` + Option-C durability `dc9e8f3`). Clean tree at start.

## 2. Exact three actions
`calendar.create`, `calendar.update`, `teams.createChannel`. Cohort 2B (12 reversible internal
actions) intentionally NOT touched.

## 3. Files changed
- **Production:** `cst/governedAction.ts` (+`GOVERNED_ACTION_COHORT2A` id set), `connectors/index.ts`
  (extend the existing governedAction routing branch to also match the 2A set).
- **Tests:** `cst/governedAction.cohort2a.test.ts` (NEW, 21).
- No other production/test file changed. `durableIdempotencyStore.ts`, the CST kernel, `actionSdk.ts`,
  governedSend/mail.send, and all worker surfaces are UNCHANGED.

## 4. Routing architecture `[PROVEN]`
```
M365ActionExecute
  → mail.send?  → governedSend (unchanged)
  → COHORT1.has(id) OR COHORT2A.has(id)?  → governedAction(action, …, ports: m365ActionPorts) → mapActionOutcome
  → else → m365.execute (unchanged executor)
```
The 2A branch reuses the IDENTICAL `governedAction` call and the SAME durable `m365ActionPorts` as
Cohort 1 — one code path, extended by set membership only. `[PROVEN]`

## 5. Authority sources `[PROVEN]`
`actorId = deps.actor()` (authenticated session `displayName ?? email`; never renderer; `''`→DENY);
`tenantId = deps.workspaceId()`; ownership/scope/token via `m365OwnsAccount`/`m365GrantedScopes`/
`m365GetToken`. Identical to Cohort-1 / the certified mail.send path. `[PROVEN]`

## 6. Consequence classification `[PROVEN]`/`[DESIGN]`
All three: `C3` (mutating → confirmation-gated; the `confirmed` flag is the C3 approval) — correct.
`IRREVERSIBLE` conservative tier reused (the adapter's uniform class). Honest for this externally-
communicative subset; precise/param-conditional reversibility is deliberately NOT claimed. No new
per-action metadata system; `WriteAction`/`actionSdk.ts` unchanged.

## 7. calendar.create external-communication semantics `[PROVEN]`
`calendar.create` sends invitations when `attendees` present (`calendar.ts:47-48,58-67`) — the params
capture attendees, so a different attendee list is a DIFFERENT governed request (test: two creates
with differing attendees → both execute). Governance runs BEFORE `action.run` (denial-before-effect).
We do NOT claim Graph delivered any notification. `[PROVEN]` (governance-before-effect) / `[PROVEN-ABSENT]`
(provider notification success).

## 8. calendar.update conservative treatment `[PROVEN]`
`calendar.update` (`calendar.ts:69-73`) notifies depending on the target event's EXISTING server-side
attendees, which are NOT in the request params. The implementation makes NO attempt to infer server
state and NO observation oracle; it governs conservatively at the C3/IRREVERSIBLE tier. **Precise
consequence classification is NOT claimed.** `[PROVEN]`

## 9. teams.createChannel treatment `[PROVEN]`
`teams.createChannel` (`teams.ts:115-123`) creates a team-visible channel (reversible by delete),
governed at the same conservative tier. No direct notification claimed. `[PROVEN]`

## 10. Canonical identity `[PROVEN]`
`sha256(canonicalize({tenantId,connectorId,accountId,actionId,params}))` — reordered object keys →
same identity (second suppressed); different consequential param (subject / attendee list / teamId) →
different identity (both execute). Proven by the identity tests. `[PROVEN]`

## 11. Durable admission `[PROVEN]`
Reuses the committed `DurableIdempotencyStore` via the shared `m365ActionPorts` (production wiring) and
via injected durable ports (tests). No new store, no new persistence file, no second idempotency
mechanism. `[PROVEN]`

## 12. Restart replay `[PROVEN]`
Per action: admit + effect on store instance A, then a FRESH `DurableIdempotencyStore` from the same
path (= restart) + exact replay → **no second effect** (`s.calls` stays 1, `effectCalls===0`). Also:
`calendar.update` after a `NetworkError` (UNKNOWN) → restart replay reconciles/HOLDs, never re-executes.
Single-process, atomic-rename scope. `[PROVEN]`

## 13. Denial-before-effect `[PROVEN]`
For the three ids: unconfirmed → HOLD; unauthorized account → DENIED; missing scope → DENIED; missing
token → DENIED; missing actor → DENIED — each with `effectCalls===0` AND the injected `action.run`
counter `===0`. Effect physically unreachable, not merely a verdict. `[PROVEN]`

## 14. Concurrency `[PROVEN]`
Concurrent identical requests (shared ports) → exactly one effect (CST atomic single-winner). `[PROVEN]`

## 15. Failure semantics `[PROVEN]`
`HttpError` → `EXECUTION_FAILED` (definite); `NetworkError` → `UNKNOWN`, transport invoked once, no
blind retry; `VERIFIED_SUCCESS` never produced (Profile A). Unchanged from Cohort-1. `[PROVEN]`

## 16. mail.send regression `[PROVEN]`
`governedSend`/`mail.send` unchanged; `sendTransition.negative.test.ts` **16/16**.

## 17. Worker regression `[PROVEN]`
Worker code unchanged; `boundaryBEnforcement.test.ts` 8/8, `executeEngine.durableConsumption.test.ts`
9/9. Committed worker certification intact.

## 18. Remaining actions excluded `[PROVEN]`
`GOVERNED_ACTION_COHORT2A` contains EXACTLY the three; a membership test asserts the 12 Cohort-2B
actions (mail.saveDraft/move/markRead/restore/addAttachment, drive.upload/rename/move/createFolder/
restoreVersion, contacts.create/update) are NOT in either cohort set → they still route to the
existing `m365.execute` executor, unchanged.

## 19. Test evidence (this run)
- `governedAction.cohort2a.test.ts`: **21** (membership, governed ×3, denial-before-effect ×5+, identity,
  restart ×3, UNKNOWN restart, concurrency, failure).
- Targeted regression: **112/112** (+ governedAction negative 15, durable restart 6, durable store 11,
  storeScopeGate 12, mail.send negative 16, Boundary-B 8, durable worker consumption 9, m365Write 14).
- Full main suite: **8409 passed / 3 skipped** (was 8388 at `dc9e8f3` → +21). UI: **24 files / 183
  passed**. Typecheck: clean (node+web). Lint (changed files, `--max-warnings 0`): clean.
  `git diff --check`: clean.

## 20. Frozen surfaces — UNCHANGED `[PROVEN]`
CST kernel, `durableIdempotencyStore.ts`, `sendTransition`/governedSend, `mail.ts`, m365 `executor.ts`,
`actionSdk.ts`, BoundDecisionClaim/mint, `ExecuteEngine`/`ExecutionSession`/`ExecutionStore`, Boundary-B,
`workforceActionExecutor`, worker router/index/runtime, `runtimeCore`, `contracts.ts`, `storeScope.ts`,
`package.json`, Node engine — all git-status blank. No new authority, decision contract, or store.

## 21. Exact permitted claim
> "The three Cohort-2A M365 IPC actions (calendar.create, calendar.update, teams.createChannel) are
> governed through the committed governedAction/CST path and the SAME durable idempotency store as
> Cohort 1: authoritative IPC identity/context, canonical consequential-action identity, atomic
> process-lifetime + single-process-restart-durable admission, and demonstrated denial-before-effect
> (effect unreachable on every refusal). calendar.create is externally-communicative when attendees are
> present (param-derivable); calendar.update's external consequence depends on non-param-derivable
> server-side attendee state and is governed CONSERVATIVELY (precise reversibility NOT claimed);
> teams.createChannel is team-visible and reversible-by-delete. The CST kernel is unchanged and no new
> authority, decision contract, or durable store was introduced."

## 22. Exact non-claims
NOT claimed: all M365 actions/writes governed · universal governance · Microsoft Graph effect
guaranteed · provider idempotency · effect success · verification success · that calendar.update is
precisely classified as reversible · renderer exclusion · cross-process / power-loss durability · that
Cohort 2B is addressed. **IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠ UNIVERSAL**; AUTHORITY ≠ DECISION ≠
ADMISSION ≠ EXECUTION ≠ EFFECT ≠ EFFECT SUCCESS ≠ VERIFICATION ≠ EVIDENCE ≠ CERTIFICATION.

## 23. Remaining gaps
- Cohort 2B (12 reversible internal actions) still IPC-partial (RBAC+confirmed executor) — OPEN,
  separate gate; needs per-action reversibility metadata (not the conservative uniform class).
- Cross-process / power-loss durability — OPEN (fs / Node-20 limits).
- Provider idempotency / effect verification — NOT provided by any path.

## 24. Next gate
Separate **commit-authorization** for this Cohort-2A checkpoint (exactly as `90527b4 → dc9e8f3`), then a
**Cohort-2B** gate (per-action reversibility metadata for the 12 reversible internal actions). This gate
does NOT begin either.

## STOP
Implemented; tests run; evidence written; frozen surfaces checked. **No commit. No push.**
