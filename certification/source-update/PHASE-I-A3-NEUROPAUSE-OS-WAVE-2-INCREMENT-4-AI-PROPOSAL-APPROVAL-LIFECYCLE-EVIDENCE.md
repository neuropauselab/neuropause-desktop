# Phase I-A.3 — NeuroPause OS Wave 2 / Increment 4 — AI → Proposal → Approval → Governance → Execution Lifecycle Card

**Renderer-only. The existing operator surface (HoldsView) now composes the FULL action lifecycle — request → AI
proposal → human approval → governance verdict → admission → execution → outcome → hold → reconciliation →
disposition — from records that ALREADY exist, correlated ONLY by authoritative ids (never guessed, never
cross-tenant). No new store, console, nav, AI engine, or package. No frozen surface touched. Nothing fabricated.
No commit, no push.**
Labels: `[PROVEN]` `[IMPLEMENTED]` `[VERIFIED]` `[NOT PROVEN]` `[OPEN]` `[DEFERRED]` `[BLOCKED-ENV]`.

## 1. Baseline `[PROVEN]`
HEAD **`670b52e`** (the worker OUTCOME_UNKNOWN→hold frozen gate, committed+pushed in a prior turn — so worker
UNKNOWN holds carry `decisionId` and are authoritatively correlatable). Prior Wave-1/Wave-2 renderer increments and
the Work Hub unified:query fix preserved unstaged. This increment adds only renderer composition + one UI test.

## 2. Files changed this increment `[PROVEN]`
- **M** `apps/desktop/src/renderer/src/understanding/operatorConsole.ts` — added the pure lifecycle model:
  `LifecycleFact` / `LifecycleStage` / `OperatorActionLifecycle` types, `sameTenant`, `correlateJobForSession`,
  `correlateProposalForSession`, `buildActionLifecycle`. Pure functions; no IO, no authority.
- **M** `apps/desktop/src/renderer/src/understanding/HoldsView.tsx` — fetch `ipc.workforce.jobs({limit:200})`;
  render a collapsible **Full lifecycle** card per open hold via `LifecycleCard` (only when a session links).
- **A** `apps/desktop/ui-tests/operatorActionLifecycle.test.tsx` — 12 tests (9 pure model + 3 mounted).
No main / frozen / shared / package change this increment (frozen audit §20).

## 3. Existing records reused `[PROVEN]`
All read-only, tenant-scoped, RBAC-gated, main-produced:
- `ipc.holds.list` → HoldRecord (incl. `decisionId`), `operations`/governance scope.
- `ipc.execute.sessions` → ExecutionSession (incl. `decisionId`, `id`, `tenantId`).
- `ipc.workforce.jobs` → JobPage `{jobs, total}`; Job carries `executionId`, `tenantId`, `proposals[]`
  (each proposal: `verdict.requestId`, `verdict.decision`, `approval{decision, decidedBy}`), `workforce:read`.
No new store/console/ledger/engine; no `@neuropause/*` package imported (still only `shared`).

## 4. Lifecycle correlation — AUTHORITATIVE ids only `[PROVEN]`
Three authoritative joins, each an exact-id equality, same tenant only — never timestamp/action/actor/text/order:
- **hold ↔ session**: `HoldRecord.decisionId === ExecutionSession.decisionId` (`linkHoldToSession`, Inc-3).
- **session ↔ job**: `Job.executionId === ExecutionSession.id` **AND** `sameTenant` (`correlateJobForSession`).
- **session ↔ proposal**: `JobProposal.verdict.requestId === ExecutionSession.decisionId` (`correlateProposalForSession`).
`sameTenant(a,b)` refuses any cross-tenant join. Any missing link → the stage reads `NOT_LINKED` / `NOT_AVAILABLE`,
never a guessed one. Tested: cross-tenant executionId match → **null**; no decisionId → **null** proposal.

## 5. UI entry point `[IMPLEMENTED]`
The EXISTING "Holds & decisions" surface (`HoldsView`). No new navigation item, no second console. The lifecycle
appears as a collapsible `<details>` **Full lifecycle** card inline on each open hold that authoritatively links to
a session. If no session links, no card renders — the existing execution line already states `NOT_LINKED` honestly.

## 6. Lifecycle model `[IMPLEMENTED]`
`buildActionLifecycle({session, job?, proposal?, hold?, requestText?})` → ordered stages, each `{key,label,value,fact}`:
`request` · `ai` · `proposal` · `approval` · `governance` · `admission` · `execution` · `effect` · (`hold` ·
`reconciliation` · `disposition` when a hold is present, else a bare `reconciliation` note when the outcome is
uncertain). `reconciliationRequired` rolls up execution + hold. Product-level `requestText` only — no chain-of-thought.

## 7. AI-request visibility `[IMPLEMENTED — honest]`
`ai` stage: with a linked proposal → "NeuroPause generated an action proposal (AI proposed — it did not execute)."
Without → `NOT_LINKED`. The renderer never claims the AI executed anything; the AI boundary (Inc-1) is unchanged.

## 8. Proposal visibility `[IMPLEMENTED]`
`proposal` stage shows `proposal.title` (+ "(consequential)" when `sideEffects`). No linked proposal → `NOT_LINKED`.

## 9. Approval visibility — human, distinct from AI `[PROVEN]`
`approval` stage: `Approved by <decidedBy>` / `Rejected by <decidedBy>` from `proposal.approval` (OBSERVED); a
proposal awaiting decision → "Approval required — not yet decided" (`NOT_OBSERVED`); no proposal → `NOT_LINKED`.
Tested: **AI proposed ≠ human approved** — an un-approved proposal never renders as approved.

## 10. Governance visibility — verdict, never inferred `[PROVEN]`
`governance` stage shows `proposal.verdict.decision` (`allow` / `deny` / `require_approval`) verbatim. It is NEVER
inferred from execution success and NEVER conflated with the human approval. Tested: approval `Approved by ada…`,
governance `allow`, execution `Outcome uncertain` render as **three distinct facts**.

## 11. Admission visibility `[VERIFIED]`
`admission` stage OBSERVED only when the session carries a governed `decisionId` ("Admitted (single-use governed
decision)"); otherwise `NOT_OBSERVED` ("No governed admission recorded"). Never invented.

## 12. Execution + outcome semantics `[PROVEN]`
`execution` reuses `classifyExecutionSession` (Inc-2): a governed consequential `failed` session → **Outcome
uncertain** (OUTCOME_UNCERTAIN), a `completed` one → **Acknowledged**. `effect` is ALWAYS "Not independently
verified" (`NOT_VERIFIED`) — there is no postcondition oracle. Tested: no stage ever reads "verified success" /
"sent successfully"; ACKNOWLEDGED ≠ VERIFIED_SUCCESS; UNKNOWN ≠ SUCCESS.

## 13. Hold semantics `[PROVEN]`
When an authoritative hold is present, `hold` reuses `classifyHold` (a worker UNKNOWN hold → "Outcome uncertain").
The card is only built for holds that link to a session, so it never contradicts the hold list above it.

## 14. Reconciliation + disposition semantics `[PROVEN]`
Unresolved / uncertain → `reconciliation` = "Reconciliation required — verify external state; do not blindly retry".
`disposition` = "Open" until resolved; resolved → "Resolved (<outcome>) — an operator decision, **not proof of
external effect**". No "Retry" control. Resolution still flows only through `ipc.holds.resolve` (executes nothing).

## 15. Correlation limitations `[PROVEN — honest]`
- Worker UNKNOWN hold → session LINKED → **full card** (AI/proposal/approval/governance present when the job carries
  them). ✓
- IPC UNKNOWN hold (Inc-2A) → `decisionId` null, no ExecuteEngine session → **NOT_LINKED → no card**. Correct.
- Non-governed hold (governed-delete, connector-unreachable) → NOT_LINKED → no card. Correct.
- Session links but the job is another tenant → job/proposal stages **NOT_LINKED** (card still shows the
  authoritative execution). Tested. The UI never composes across tenants and never invents a proposal/approval.

## 16. Security tests `[VERIFIED]`
`operatorActionLifecycle.test.tsx` (12):
- **Pure (9)**: `correlateJobForSession` matches by executionId within-tenant; **refuses cross-tenant** even on an
  executionId match; `correlateProposalForSession` matches by `verdict.requestId === decisionId`; no decisionId →
  null; full slice — approval ≠ governance ≠ execution, effect `NOT_VERIFIED`, **no "verified success"**; UNKNOWN
  slice — `Outcome uncertain` + reconciliationRequired + "do not blindly retry" + disposition Open; resolved hold →
  disposition "not proof of external effect"; no-proposal action → ai/proposal/governance `NOT_LINKED`, admission
  `NOT_OBSERVED`; awaiting approval → `NOT_OBSERVED` "approval required" (**AI proposed ≠ human approved**).
- **Mounted HoldsView (3)**: reconstructs USER→AI→PROPOSAL→APPROVAL→GOVERNANCE→ADMISSION→EXECUTION→OUTCOME→HOLD from
  real records with approval/governance/execution as distinct facts, and asserts the body contains **no**
  `verified success` / `sent successfully` / `access_token` / `bearer ` / `password`; a hold with no linked session
  renders **no** fabricated card; a same-executionId **cross-tenant** job yields `NOT LINKED` (no approval leaks).
Renderer stays presentation-only: pure maps over main-produced tenant-scoped records; correlation by authoritative
id; no executor / governedSend / governedAction / claim-mint / direct-M365 call; no authority minted.

## 17. Regression `[PROVEN]` (fresh)
- New suite **12/12**. **Full UI 236 passed / 30 files** (was 224/29; +12/+1, no regression). **Full main 8533
  passed / 3 skipped / 810 files** — unchanged from baseline (renderer-only change). Certification suites green
  within the full runs.

## 18. Typecheck `[PROVEN]` — clean (`npm run typecheck`, exit 0).

## 19. Lint `[PROVEN]` — the three changed files are clean (`eslint … --max-warnings 0`, exit 0). One repo-wide
eslint error exists in `apps/desktop/src/main/cst/sendTransition.negative.test.ts` (unused `WriteActionResult`
import) — **pre-existing at HEAD `670b52e`, untouched by this increment** (verified via `git show HEAD:…`). Not
introduced here; flagged for a separate cleanup, not this renderer increment's regression.

## 20. Frozen audit `[PROVEN]`
`git diff --stat` over the frozen set (connectors, executor.ts, executionStore.ts, ExecuteEngine, boundaryB.ts,
runtimeCore.ts, actionSdk.ts, durableIdempotencyStore.ts, storeScope.ts, packages/shared, package.json) = **empty**.
`git diff --check` = clean. This increment is renderer-only. The committed worker-gate frozen changes (670b52e) are
in history, not the working tree.

## 21. Certification impact `[PROVEN]` — **NONE**
M365 IPC 29/29 UNCHANGED; CST UNCHANGED; governance / authority / admission / effect-boundary UNCHANGED; worker/CST
parity NOT PROVEN. This increment only re-presents existing records in the existing surface.

## 22. Complete-composition proof `[VERIFIED]`
Phase-22 fixture (mounted test #1) represents the full chain — USER↓ASSISTANT(AI)↓PROPOSAL↓APPROVAL↓GOVERNANCE↓
DECISION↓EXECUTION SESSION↓OUTCOME↓HOLD↓RECONCILIATION↓DISPOSITION — built from real `Job`/`JobProposal`/
`ExecutionSession`/`HoldRecord` shapes, and asserts the UI reconstructs it stage-by-stage with the honesty
invariants intact (approval ≠ governance ≠ execution; effect NOT_VERIFIED; no verified-success/credential leakage).

## 23. Live status `[BLOCKED-ENV]` — TEST VERIFIED ≠ LIVE VERIFIED. No clean env / signed artifact / live M365
tenant / five-user run. The lifecycle composition is proven over fixtures and the real renderer, not a live tenant.

## 24. Pilot impact `[IMPLEMENTED]` — an operator can now, in the existing surface, expand a hold to see the full
authoritative chain (who asked, what the AI proposed, who approved, what governance decided, whether it was
admitted, what executed, that the effect is unverified, and the reconciliation/disposition). **Not pilot-validated.**

## 25. No-guess guarantee `[PROVEN]`
Every stage derives from an exact id equality or reads an explicit honest state. No timestamp proximity, action-name
match, actor match, text similarity, or array position is ever used to link records (asserted). Missing → said.

## 26. Renderer non-authority `[PROVEN]`
`LifecycleCard` / `buildActionLifecycle` perform zero side effects: no `ipc.execute.run`, no executor, no
governedSend/governedAction, no claim mint, no direct M365. They map records to text. Resolution remains the only
mutation and still routes through `ipc.holds.resolve` (records disposition; executes nothing).

## 27. Credential safety `[VERIFIED]`
The technical-details block renders only `decisionId` / execution `id` / `job.id` / `proposal.id` — never tokens,
secrets, or payloads. The mounted test asserts the rendered body contains no `access_token` / `bearer ` / `password`.

## 28. Remaining gaps `[OPEN]`/`[DEFERRED]`
- `requestText` (the product-level user turn) is not yet threaded from a conversation record into HoldsView, so the
  `request` stage currently reads `NOT_AVAILABLE` in the live surface — the model supports it; wiring the
  conversation→session correlation into this view is a later renderer step (records exist; rendering is the work).
- IPC-hold lifecycle is genuinely NOT_LINKED (no ExecutionSession) — correct, not a defect.
- ExecutionStore fail-closed durability; cross-process/power-loss; provider verification; worker/CST parity; live
  pilot validation — all unchanged, separate gates.

## STOP conditions check `[PROVEN]`
None triggered: no new store, no new console/nav, no new AI engine, no renderer authority, no worker-UNKNOWN/
ExecutionStore change, no guessed correlation (NOT_LINKED/NOT_AVAILABLE shown honestly), no cross-tenant join, no
frozen surface, no AI direct-effect, no approval/governance/execution conflation, UNKNOWN never SUCCESS, no
credential/token rendered, no fabricated evidence, no `@neuropause/*` package imported.

## STOP
Renderer-only full-lifecycle card implemented + tested; composed from existing records by authoritative ids only,
never across tenants, with honest NOT_LINKED/NOT_AVAILABLE where no authoritative join exists. No commit, no push,
no frozen surface, no packages imported. HEAD `670b52e`; changes unstaged (Work Hub + Wave-2 Inc-1/2/3/4).
