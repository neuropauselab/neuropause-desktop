# Phase I-A.3 — NeuroPause OS Wave 2 / Increment 2 — AI/Worker Execution ↔ Operator/Evidence Lifecycle

**Reality-first. Traced both lifecycles, proved the correlation, connected the safe part (renderer-only, reusing
existing records), and STOPPED at the frozen boundary with a precise blocker for the part that requires it. No new
store, no packages imported, no frozen surface touched, nothing fabricated.** Baseline HEAD `634c9b7`. No commit.
Labels: `[PROVEN]` `[IMPLEMENTED]` `[VERIFIED]` `[NOT PROVEN]` `[OPEN]` `[BLOCKED-ENV]` `[DEFERRED]`.

## 1. HEAD before `[PROVEN]` — `634c9b7`. ## 2. HEAD after `[PROVEN]` — `634c9b7` (changes unstaged).

## 3. Files changed / added `[PROVEN]`
- **M** `apps/desktop/src/renderer/src/understanding/operatorConsole.ts` — `classifyExecutionSession` +
  `correlateAssistantExecutions` (pure, additive).
- **A** `apps/desktop/ui-tests/operatorExecution.test.tsx` — 7 tests.
- (preserved from prior turns: Work Hub fix `HubHost.tsx`; `assistantAiBoundary.test.ts`; `hubUnifiedQuery.test.tsx`.)
No main/frozen/shared/package change.

## 4. AI path `[PROVEN]`
`Assistant → AssistantAsk IPC → assistantService → plan step (kind 'worker'|'automation'|null) → deps.execute
(ExecuteEngine)`. After execution the step stamps `step.executionId = session.id` (`assistantService.ts:672`) and
`message.envelope.trace.audit.executionIds.push(session.id)` (`:681`); the conversation is durably persisted
(`conversationStore.ts`).

## 5. Proposal path `[PROVEN]`
`worker skill → JobProposal (id=proposalId, verdict.requestId) → require_approval → awaiting_approval` (workforce).

## 6. Approval path `[PROVEN]`
`human approve → WorkerRuntime.decide → setDispatchApproved → mintClaimForApprovedProposal (decisionId =
verdict.requestId) → bindingToRequest (params.binding/claim/jobId/proposalId, confirmed:true, kind 'connector')`.

## 7. Execution path `[PROVEN]`
`ExecuteEngine Step-5 (session.decisionId = claim.decisionId) → Boundary-B (verify binding digest) → runBinding →
M365Executor.execute`. Job records back `job.executionId = session.id`; session records `correlationId = job.id`.
Sessions persisted to `executions.json`, exposed via `ipc.execute.sessions/history` (authz `operations:read`).

## 8. Evidence path `[PROVEN]`
Decision records + audit + holds + the Wave-1 operator model/evidence timeline.

## 9. Exact missing correlation (Phase 3 verdict) `[PROVEN]` — **PARTIAL / MISSING(hold)**
Reconstructable from durable records (EXISTS): `conversation.audit.executionIds → executions.json session →
(session.result embeds job.id; session.decisionId = verdict.requestId) → workforce-jobs job (executionId,
proposals[].approval, verdict.requestId)`. **So USER→AI→PROPOSAL→APPROVAL→ADMISSION→EXECUTION→OUTCOME is
reconstructable.**
BREAKS at HOLD→RECONCILIATION for an AI/worker M365 action: (1) the worker/M365 executor **raises NO hold on
UNKNOWN** — it collapses NetworkError into a generic `{ok:false}` (`executor.ts:161-169`); the UNKNOWN→hold sink is
wired ONLY on the IPC `governedSend`/`governedAction` path (Increment-2A), NOT `runBinding`/`M365Executor`; (2) a
`DecisionRecord` is written only when a hold is raised, and it has no `decisionId` field; (3) even raised holds set
`decisionId: null` (`raiseHold` never passes it) and key by CST transitionId — so Hold↔Session has no written join
key. `[PROVEN-ABSENT of worker UNKNOWN→hold]`.

## 10. Exact connection implemented `[IMPLEMENTED][VERIFIED]`
A **pure renderer model** over the EXISTING records (no new store, no frozen change):
- `correlateAssistantExecutions(executionIds, sessions)` — the AI→execution link (match the conversation's stamped
  `executionId`s against `ipc.execute.sessions/history`).
- `classifyExecutionSession(session)` — honest operator state from `ExecutionState`, encoding the G2-A rule:
  **a governed consequential (`kind 'connector'` + `decisionId`) session marked `failed` → `OUTCOME_UNCERTAIN`**
  ("may be an unconfirmed outcome — verify external state; do not blindly retry"), NOT a proven failure and NEVER a
  success. `completed → ACKNOWLEDGED` ("external effect not independently verified" for governed) — never
  VERIFIED_SUCCESS. `interrupted → INTERRUPTED` (reconcile if governed). `running/queued/cancelled` mapped plainly.
This makes the AI/worker execution lifecycle **observable with honest states**, and honestly surfaces the
worker-UNKNOWN collapse (a governed failure is treated as possibly-uncertain) WITHOUT the frozen fix.

## 11. Customer journey `[IMPLEMENTED model]` / `[DEFERRED live/UI]`
Model supports: an operator (or the assistant surface) can, from durable records, reconstruct an AI-assisted action
up to its honest OUTCOME and see that a governed failure may be uncertain. NOT built this turn: the renderer VIEW
that fetches `ipc.assistant` conversations + `ipc.execute.sessions` and renders the composed lifecycle (next
increment), and the live end-to-end run (BLOCKED-ENV).

## 12. Security tests `[PROVEN]`
Renderer stays presentation-only: the model is a pure function over main-produced, tenant-scoped records
(`ipc.execute.sessions` requires `operations:read`; sessions are tenant-owned). Correlation is by `executionId`
only — no authority, no id minting. The AI-boundary (Wave-2 Inc-1) is preserved: AI cannot execute/self-approve/mint.
`classifyExecutionSession` never emits VERIFIED_SUCCESS and never turns UNKNOWN into success or a proven failure
(tests assert both). Hold resolution remains non-executing (Wave-1). No new consequential path introduced.

## 13. Regression `[PROVEN]` — new suite **7/7**; **full main 8525 passed / 3 skipped** (809 files, unchanged);
**UI 218 passed** (28 files; +7 / +1 file, no regression). Certification suites green within the full run.
## 14. Typecheck `[PROVEN]` — clean. ## 15. Lint `[PROVEN]` — clean (`--max-warnings 0`).

## 16. Frozen audit `[PROVEN]`
`git diff` on the frozen set = blank (this increment). The only frozen files in the working tree remain
Increment-2A's `connectors/index.ts` + `runtimeCore.ts` (unchanged since that gate). No CST/executor/executionStore/
boundaryB/m365-actions/shared/package/cohort change.

## 17. Certification impact `[PROVEN]` — **NONE**. No authority/identity/governance/approval/admission/canonical
identity/M365-coverage/CST/worker-parity/effect-boundary/durability change. M365 IPC 29/29 stays CERTIFIED.

## 18. Live verification status `[BLOCKED-ENV]` — proven at source + tests; no live GUI/AI/M365 run here.

## 19. Pilot impact `[IMPLEMENTED]`/`[DEFERRED]` — the AI-assisted execution lifecycle is now observable with honest
states (incl. the possibly-UNKNOWN caveat a pilot operator needs). A polished operator VIEW + the worker UNKNOWN→hold
link are the remaining steps. **Not pilot-validated.**

## 20. Remaining gaps `[OPEN]`/`[DEFERRED]`
- **FROZEN BLOCKER — worker UNKNOWN→durable-hold** (§ below): an AI/worker M365 UNKNOWN does not become a hold.
- Non-frozen future: populate `HoldRecord.decisionId` (via `raiseHold`) and add a `decisionId`/`executionId` to
  `DecisionRecord` so Hold/DecisionRecord ↔ Session join by a written key (currently only correlatable via
  transitionId/heuristics). Touches the non-frozen decisions module + its tests — a separate small gate.
- The operator VIEW wiring (fetch conversations + sessions, render the composed lifecycle) — next increment.

---

## FROZEN BLOCKER — worker OUTCOME_UNKNOWN → durable hold `[DEFERRED / frozen gate]`
**Requested capability:** an AI/worker-initiated M365 action that returns UNKNOWN (transmitted, response lost) should
raise a durable hold (like the IPC path does), so the AI→…→UNKNOWN→HOLD→reconciliation chain is reconstructable.
**Exact frozen files:** `apps/desktop/src/main/connectors/m365/executor.ts` (`M365Executor.classify` collapses
NetworkError→UNKNOWN into a generic `{ok:false}` — `:161-169`) and `apps/desktop/src/main/runtimeCore.ts`
(`runBinding` m365 branch — `:2517`) and/or `apps/desktop/src/main/workforce/execution/workforceActionExecutor.ts`.
**Missing seam:** the worker effect path must (a) PRESERVE the UNKNOWN class (e.g. call `action.run` one layer down
like `governedSend`, or return a typed outcome from the executor) and (b) raise a hold on UNKNOWN with authoritative
context (the tenant/actor/action are in the main process; the runBinding site or a post-outcome hook).
**Why non-frozen integration is insufficient:** the UNKNOWN classification + authoritative tenant/actor live in the
frozen main-process worker effect path; the renderer can only observe the collapsed `failed` session (which is why
this increment conservatively classifies a governed failure as OUTCOME_UNCERTAIN — the honest, non-frozen best).
A renderer cannot raise an authoritative durable hold.
**Minimum change:** preserve NetworkError→UNKNOWN in the worker M365 effect + a post-outcome `raiseHold` on UNKNOWN
(mirroring Increment-2A's IPC seam, reusing `buildM365UnknownHoldInput`).
**Certification impact:** touches frozen `runtimeCore`/`executor`; must re-prove denial-before-effect + Boundary-B +
coverage guard; a scoped worker-path certification gate. **Tests required:** worker UNKNOWN → durable hold (deduped,
tenant-scoped); effect/`action.run` counters unaffected; no blind retry.
**Do NOT implement without authorization.** (This is the previously-declared "worker OUTCOME_UNKNOWN preservation"
gate, now precisely scoped for the AI/worker lifecycle.)

## STOP conditions check `[PROVEN]`
None triggered: no AI direct-effect path, no governance bypass, no renderer authority, no proposal/approval
substitution, hold resolution does not execute, UNKNOWN never becomes SUCCESS, and the frozen-required part was
reported (not modified). No duplicate architecture. Evidence honestly represents the state (governed failure =
possibly-uncertain, not fabricated success).

## STOP
Safe correlation model implemented + tested; the frozen part reported as a precise blocker. No frozen surface, no
package import, no fabrication. No commit, no push. HEAD `634c9b7`; changes unstaged.
