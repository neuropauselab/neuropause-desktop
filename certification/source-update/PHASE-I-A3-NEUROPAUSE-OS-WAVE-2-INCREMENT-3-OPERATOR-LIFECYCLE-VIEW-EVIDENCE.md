# Phase I-A.3 — NeuroPause OS Wave 2 / Increment 3 — Operator Lifecycle View

**Renderer-only. The existing operator surface (HoldsView) now shows a hold's correlated ExecutionSession, joined
ONLY by the authoritative governed `decisionId`, with honest NOT_LINKED where no authoritative join exists. No new
store, no new console, no packages imported, no frozen surface touched, nothing fabricated. No commit.**
Labels: `[PROVEN]` `[IMPLEMENTED]` `[VERIFIED]` `[NOT PROVEN]` `[OPEN]` `[DEFERRED]` `[BLOCKED-ENV]`.

## 1. Baseline `[PROVEN]`
HEAD **`670b52e`** (not `634c9b7` — the worker OUTCOME_UNKNOWN→hold frozen gate was committed+pushed in the prior
turn). Because of that, **worker UNKNOWN holds now carry `decisionId`**, so the Hold↔Session correlation the earlier
audit called MISSING is now authoritatively available for the worker path. Prior Wave-1/Wave-2 renderer increments
preserved unstaged.

## 2. Files changed `[PROVEN]`
- **M** `apps/desktop/src/renderer/src/understanding/operatorConsole.ts` — added `linkHoldToSession` (+ `HoldLinkState`
  / `HoldSessionLink`), pure.
- **M** `apps/desktop/src/renderer/src/understanding/HoldsView.tsx` — fetch `ipc.execute.sessions()`; render the
  correlated execution state (or NOT_LINKED) per open hold.
- **A** `apps/desktop/ui-tests/operatorLifecycle.test.tsx` — 6 tests.
No main/frozen/shared/package change this increment.

## 3. Existing records reused `[PROVEN]`
`ipc.holds.list` (HoldRecord, incl. `decisionId`), `ipc.decisionRecords.list` (DecisionRecord), `ipc.execute.sessions`
(ExecutionSession, incl. `decisionId`) — all existing, tenant-scoped, `operations:read`/RBAC-gated. Reused the
Wave-2 Increment-2 model (`classifyHold`, `classifyExecutionSession`, evidence timeline). No new store/console/ledger.

## 4. Lifecycle correlation `[PROVEN]`
Authoritative join only: `HoldRecord.decisionId` ↔ `ExecutionSession.decisionId` (both = the BoundDecisionClaim
decision). `linkHoldToSession` returns LINKED only on an exact decisionId match; otherwise NOT_LINKED with an honest
reason. **Never guesses** from timestamps / action names / actor / text / array position (tested).

## 5. UI entry point `[IMPLEMENTED]`
The EXISTING "Holds & decisions" surface (`HoldsView`) — no new navigation item, no second console. The correlated
execution appears inline on each open hold.

## 6. Lifecycle model `[IMPLEMENTED]`
Per open hold: operator state (`classifyHold`) + reconciliation guidance (Wave-1 Inc-3) + the correlated execution
(`classifyExecutionSession` of the linked session) OR `Execution: not linked — <reason>`.

## 7-10. AI / proposal / approval / governance visibility `[PARTIAL / DEFERRED]`
This increment surfaces the hold ↔ EXECUTION correlation (the newly-available authoritative link). The fuller
AI-request → proposal → approval → governance card (composing assistant conversations + worker job/proposal records)
is **not** built here — it is the next renderer step (the assistant/job records exist and are correlatable via
`executionId`/`decisionId`, per Increment-2, but composing and rendering them is a larger surface). Not claimed.

## 11. Execution visibility `[VERIFIED]`
Reuses `classifyExecutionSession` (Increment-2): PENDING / EXECUTING / ACKNOWLEDGED / OUTCOME_UNCERTAIN /
EXECUTION_FAILED / INTERRUPTED / CANCELLED. A governed consequential `failed` session shows **OUTCOME_UNCERTAIN**
(possibly-UNKNOWN, reconcile) — never a bare "failed", never "success".

## 12. Outcome semantics `[PROVEN]`
ACKNOWLEDGED ≠ VERIFIED_SUCCESS (external effect "not independently verified"); OUTCOME_UNCERTAIN ≠ EXECUTION_FAILED;
UNKNOWN ≠ SUCCESS. Tests assert the UI never renders "verified success" / "sent successfully".

## 13. Hold semantics `[PROVEN]`
Reuses the existing HoldStore/HoldsView. A worker UNKNOWN hold (reason `verification_unavailable`, from the committed
worker gate) shows "Outcome uncertain — reconcile before any retry — do not blindly retry".

## 14. Reconciliation semantics `[PROVEN]`
No "Retry" control for UNKNOWN. Resolution reuses `ipc.holds.resolve` (records disposition, executes nothing —
tested). The existing HoldsView copy already states "Resolving records who cleared this and why. It does not execute
anything."

## 15. Correlation limitations `[PROVEN — honest]`
- **Worker UNKNOWN holds → LINKED** (carry decisionId; a matching ExecutionSession exists). ✓
- **IPC UNKNOWN holds (Increment-2A) → NOT_LINKED** — `decisionId` is null AND the IPC path does not run through the
  ExecuteEngine, so there is genuinely no ExecutionSession to link. NOT_LINKED is **correct**, not a gap.
- **Non-governed holds** (governed-delete, connector-unreachable) → NOT_LINKED (no session). Correct.
The UI never invents a link. (A future non-frozen enhancement could carry a correlation id onto IPC holds, but they
have no ExecutionSession, so it would not produce a session link — recorded, not needed here.)

## 16. Security tests `[VERIFIED]`
`operatorLifecycle.test.tsx` (6): LINKED only on exact decisionId; NOT_LINKED when hold has no decisionId; NOT_LINKED
when no session carries it (never picks a different session); mounted — worker hold → OUTCOME_UNCERTAIN + linked
execution, no "verified success"/"sent successfully"; IPC hold → "Execution: not linked"; resolution exercises only
`HoldResolve` (no ExecuteRun/executor). Renderer stays presentation-only (pure maps over main-produced, tenant-scoped
records; correlation by authoritative id; no executor call; no authority minting).

## 17. Regression `[PROVEN]` (fresh)
- New suite **6/6**. **Full main 8533 passed / 3 skipped** (810 files, unchanged). **UI 224 passed** (29 files; +6 /
  +1 file, no regression). Certification suites green within the full run.
## 18. Typecheck `[PROVEN]` — clean. ## 19. Lint `[PROVEN]` — clean (`--max-warnings 0`).

## 20. Frozen audit `[PROVEN]`
`git diff` on the frozen set = blank this increment (renderer-only). The committed worker-gate frozen changes
(670b52e) are in history, not the working tree.

## 21. Certification impact `[PROVEN]` — **NONE**
M365 IPC 29/29 UNCHANGED; CST UNCHANGED; governance/authority/admission/effect-boundary UNCHANGED; worker/CST parity
NOT PROVEN. This increment only re-presents existing records.

## 22. Live status `[BLOCKED-ENV]` — TEST VERIFIED ≠ LIVE VERIFIED. No clean env / signed artifact / live M365 tenant
/ five-user run.
## 23. Pilot impact `[IMPLEMENTED]` — an operator can now, in the existing surface, see a hold's correlated execution
state honestly (incl. the possibly-UNKNOWN caveat and NOT_LINKED honesty). **Not pilot-validated.**

## 24. Remaining gaps `[OPEN]`/`[DEFERRED]`
- The full AI-request → proposal → approval → governance lifecycle card (compose assistant conversations + worker
  job/proposal records) — next renderer increment (records exist; rendering is the work).
- IPC-hold session linkage is genuinely NOT_LINKED (no ExecutionSession) — correct, not a defect.
- ExecutionStore fail-closed; cross-process/power-loss durability; provider verification; live pilot validation — all
  unchanged, separate gates.

## STOP conditions check `[PROVEN]`
None triggered: no new store, no new governance path, no renderer authority, no worker-UNKNOWN/ExecutionStore change,
no guessed correlation (NOT_LINKED shown honestly), no frozen surface, no AI direct-effect, no approval substitution,
UNKNOWN never SUCCESS, no fabricated evidence.

## STOP
Renderer-only operator lifecycle correlation implemented + tested; honest NOT_LINKED where no authoritative join
exists. No commit, no push, no frozen surface, no packages imported. HEAD `670b52e`; changes unstaged (Work Hub +
Wave-2 Inc-1/2/3).
