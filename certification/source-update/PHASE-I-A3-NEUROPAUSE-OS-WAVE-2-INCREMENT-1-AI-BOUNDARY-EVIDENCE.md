# Phase I-A.3 — NeuroPause OS Wave 2 / Increment 1 — AI → Proposal → Governance Boundary

**Reality-first. Traced the existing AI/governance paths, source-proved the AI boundary, and added a deterministic
invariant test. No new architecture, no packages imported, no frozen surface touched, nothing fabricated.**
Baseline HEAD `634c9b7`. No commit this turn. Labels: `[PROVEN]` `[IMPLEMENTED]` `[VERIFIED]` `[NOT PROVEN]`
`[OPEN]` `[BLOCKED-ENV]` `[DEFERRED]`.

## 1. HEAD before `[PROVEN]` — `634c9b7` (Work Hub fix present, unstaged, preserved).
## 2. HEAD after `[PROVEN]` — `634c9b7` (unchanged; changes unstaged).

## 3. Files changed `[PROVEN]`
- **M** `apps/desktop/src/renderer/src/hub/HubHost.tsx` — the prior Work Hub `unified:query` fix (preserved).
## 4. Files added `[PROVEN]`
- **A** `apps/desktop/src/main/assistant/assistantAiBoundary.test.ts` — 5 AI-boundary invariant tests.
- **A** `apps/desktop/ui-tests/hubUnifiedQuery.test.tsx` — the prior Work Hub contract test (preserved).
No production/frozen/shared/package change this turn (the new files are additive tests).

## 5. AI path found `[PROVEN]`
`renderer (Assistant/Ask NeuroPause) → IpcChannel.AssistantAsk → assistantService → aiEngine.run(req) → real
providers (Ollama/Anthropic/OpenAI) + privacy clamp`. The assistant executes plan steps via
`deps.execute(req: ExecutionRequest) → ExecuteEngine` (`assistantService.ts:664`). It does conversation / retrieval
/ briefing / planning / draft (text) — never a raw model command.

## 6. Proposal path found `[PROVEN]`
Consequential proposals are produced by the **workforce**: `worker → skill.run → proposals (WriteAction/binding) →
governance evaluate → require_approval → awaiting_approval`. The assistant reaches this via an `executionKind:
'worker'` step (`assistantModel.ts:386`), which runs a worker that PROPOSES. The assistant does not mint its own
proposal schema.

## 7. Approval path found `[PROVEN]`
`awaiting_approval → human approve/reject (workforce IPC) → trusted in-process dispatcher (setDispatchApproved) →
mintClaimForApprovedProposal (Bound Decision Claim)`. Approval is a distinct human action; AI cannot perform it.

## 8. Governance path found `[PROVEN]`
Two governed effect paths, both preserved and unchanged: **IPC** `M365ActionExecute → governedSend/governedAction →
CST → canonical identity → durable admission → effect` (CERTIFIED 29/29); **Worker** `ExecuteEngine Step-5 durable
admission → Boundary-B (validates the minted claim) → runBinding → executor`.

## 9. Execution path found `[PROVEN]`
The ExecuteEngine `connector` executor (`createWorkforceActionExecutor(runBinding)`) requires `req.params.binding`
(absent → "No execution binding on request", **no effect**) AND `verifyBoundaryB` (a valid Bound Decision Claim,
minted only post-approval → absent → DENY, **runBinding = 0**).

## 10. Evidence path found `[PROVEN]`
Decision records + audit + ExecutionSession + holds + the Wave-1 operator model/evidence timeline (external effect
always NOT_VERIFIED; missing facts said).

## 11. Exact connection implemented (this increment) `[IMPLEMENTED][VERIFIED]`
**The AI boundary is already correctly wired — this increment VERIFIES and pins it** (per the gate: verify/extend,
do not rewrite). Source-proven and codified by a new test:
- The assistant's plan steps use only `executionKind ∈ {automation, worker, null}` — **there is NO `connector`
  step kind**, so AI cannot dispatch a direct M365/connector write.
- The assistant sets **no `confirmed`, no `binding`, no `claim`** on steps; it never calls `governedSend`/
  `governedAction`/`m365Execute`/any executor directly (grep-verified empty).
- Every side-effecting step is `needsApproval: true` and is mode-gated (disabled/`skipped` outside Execute mode).
- Therefore the only route to a consequential effect is `AI → 'worker' proposal → human approval → trusted-dispatcher
  mint → Boundary-B → governed execution` — **AI cannot self-execute, self-approve, or mint admission.**
`[PROVEN-ABSENT of AI→direct-effect]`.

## 12. Exact things still disconnected `[DEFERRED]`
A **live, direct** "Ask NeuroPause → AI drafts a specific M365 action → structured M365 proposal → approval →
certified governedSend/governedAction execution" vertical slice is **not** wired end-to-end from the assistant (the
assistant's consequential route is the workforce `worker` path, not a direct assistant→M365 proposal). Building
that direct slice is a larger UX feature; achievable non-frozen (via the certified `M365ActionExecute` IPC,
unconfirmed → human confirm), but **not implemented or claimed here** — I stop at the proposal/approval boundary and
report it (per the gate's Section 26). ~46 packages remain disconnected (not imported).

## 13. Tests added `[TESTED]`
`assistantAiBoundary.test.ts` (5): no `connector` step kind / only {automation,worker,null}; every side-effecting
step approval-gated (non-vacuous); automation-in-Execute requires approval + waits (never auto-runs); side-effecting
steps disabled outside Execute mode; steps carry no `confirmed`/`binding`/`claim` authority fields. Plus the prior
Work Hub contract test (4).

## 14. Full regression `[PROVEN]` (fresh)
**Full main 8525 passed / 3 skipped** (809 files; +5 AI-boundary, no regression). **UI 211 passed** (27 files;
includes the +4 Work Hub test). Certification suites (coverage guard, cohorts, denial-before-effect, Boundary-B
enforcement incl. "no-claim → runBinding=0", durable store) green within the full run.
## 15. Typecheck `[PROVEN]` — clean (node+web).
## 16. Lint `[PROVEN]` — clean (`--max-warnings 0`, changed/new files).

## 17. Security results `[PROVEN]`
AI ≠ authority (proven: no connector kind, no confirmed/binding/claim, no direct governed/executor call); AI cannot
self-approve (approval is a separate human IPC); AI cannot mint admission (mint is in the trusted dispatcher
post-approval); proposal A cannot execute as B (Boundary-B re-derives the exact binding digest); un-approved binding
without a valid claim → denied, effect 0 (existing Boundary-B control 1). Tenant/actor/account authority remain
main-process; the renderer/AI supply none of it.

## 18. Frozen-surface audit `[PROVEN]`
`git diff` on the frozen set = only the renderer `HubHost.tsx` (prior fix) — no CST/governedAction/governedSend/
connectors/index.ts/runtimeCore/executor/executionStore/boundaryB/actionSdk/shared/package change. New files are
additive tests. No cohort/coverage-guard change.

## 19. Certification impact `[PROVEN]` — **NONE**. M365 IPC 29/29 stays CERTIFIED; worker/CST parity NOT PROVEN.

## 20. Live verification status `[BLOCKED-ENV]`
No live GUI/AI/M365 run in this environment. The AI boundary is proven at the source/plan layer (the exact place a
bypass would exist). A live Ask-NeuroPause→approval→M365 run remains a clean-environment step.

## 21. Pilot impact `[IMPLEMENTED]`/`[DEFERRED]`
The AI-safety boundary that a first-customer pilot depends on ("the intelligence can move fast; the consequential
action moves through NeuroPause") is now source-proven and test-pinned. A polished direct assistant→M365 proposal UX
is deferred (the governed route exists via the workforce). **Not pilot-validated** (empirical evidence still
BLOCKED-ENV).

## Acceptance criteria (Section 29) — status
Reuse existing AI provider / workspace context / proposal / approval / governance / execution paths — **PASS** (all
reused, none duplicated). No AI direct-effect bypass — **PASS [PROVEN-ABSENT]**. Tenant/account isolation — **PASS**
(upstream, unchanged). AI cannot self-approve / mint admission — **PASS [PROVEN]**. Consequential M365 via certified
IPC — **PASS** (unchanged). UNKNOWN distinct + reaches HOLD — **PASS** (Wave-1). Evidence reconstructs AI→proposal→
decision — **PARTIAL** (workforce proposal chain reconstructable; a direct assistant→M365 proposal record is part of
the deferred slice). No fake provider/connector — **PASS**. Existing tests green + new tests — **PASS**. Typecheck/
lint/diff-check — **PASS**. Frozen audit — **PASS (clean)**. Live end-to-end execution — **NOT claimed (deferred /
BLOCKED-ENV)**.

## STOP
AI boundary verified + test-pinned; the safe AI→proposal→governance→approval→execution spine already exists and is
preserved. No frozen surface, no package import, no fabrication. No commit, no push. HEAD `634c9b7`; changes unstaged
(Work Hub fix + two additive tests).
