# Phase I-A.3 — NeuroPause OS Wave 1 / Increment 3 — Operator Console + Evidence Timeline

**Status: IMPLEMENTED + VERIFIED — AWAITING FINAL REVIEW / COMMIT AUTHORIZATION. Not committed, not pushed.**
Baseline HEAD `ffa2863`. Increment-1 + 2A preserved. **P0-SAFE: renderer-only; NO frozen surface changed this
increment.** Labels: `[PROVEN]` `[IMPLEMENTED]` `[VERIFIED]` `[OPEN]` `[NOT PROVEN]` `[NOT CLAIMED]`.

## 1. Starting HEAD `[PROVEN]`
`ffa2863`, branch `cert/data-import-cst-integration`. Increment-1 + 2A present and preserved.

## 2. Exact changed files `[PROVEN]`
- **A** `apps/desktop/src/renderer/src/understanding/operatorConsole.ts` — pure operator model.
- **M** `apps/desktop/src/renderer/src/understanding/HoldsView.tsx` — additive: operator-facing state label per open
  hold + a reconstructable evidence timeline per decision record (+ `cn` import, `EvidenceTimeline` sub-component).
- **A** `apps/desktop/ui-tests/operatorConsole.test.tsx` — 13 tests.
No main-process/frozen/shared/package change this increment. (Increment-2A's two frozen files remain from that gate.)

## 3. Architecture connection `[IMPLEMENTED]`
The operator surface is **extended, not duplicated**. The existing `holds` section (`HoldsView`, "Holds & decisions")
is already the consequential-governance operator home; Increment-3 composes the EXISTING durable evidence
(`ipc.holds.list` → HoldRecord; `ipc.decisionRecords.list` → DecisionRecord, paired via `holdId`/`decisionId`) into:
- an **operator state** per hold (plain words), surfacing Increment-2A's M365 UNKNOWN holds as "Outcome uncertain";
- a **reconstructable evidence timeline** per consequential decision (REQUEST → IDENTITY → GOVERNANCE → EXECUTED →
  EXTERNAL EFFECT → HOLD → RECONCILIATION → DISPOSITION).
No new nav section was added (the nav-lock test `sections.test.ts` position-locks the first visible sections; the
`operations`/`holds` surfaces already exist), avoiding nav-lock risk.

## 4. Existing infrastructure reused `[PROVEN]`
`ipc.holds.list`/`ipc.holds.resolve`, `ipc.decisionRecords.list`, the durable `HoldStore`/`DecisionRecordStore`, and
the existing `HoldsView`. **No** new store, ledger, execution state machine, reconciliation engine, identity system,
or governance mechanism. No disconnected `@neuropause/*` package was imported.

## 5. New behavior `[IMPLEMENTED]`
Pure model (`operatorConsole.ts`): `classifyHold` → OperatorHoldState {APPROVAL_REQUIRED / OUTCOME_UNKNOWN / HELD /
RESOLVED} with operator-facing labels; `buildEvidenceTimeline` → ordered steps with an explicit `TimelineFact`
(OBSERVED / NOT_OBSERVED / NOT_VERIFIED / NOT_AVAILABLE); `attentionHolds` → open holds, newest first. HoldsView
renders the state label (+ "reconcile before any retry — do not blindly retry" on UNKNOWN/HELD) and the timeline.

## 6. Security properties `[PROVEN]`/`[NOT CLAIMED]`
- **Renderer ≠ authority:** the model is a pure function over records the MAIN process already produced + tenant-
  scoped (`ipc.holds.list` is tenant-filtered, P12; holds are `bindScope`-owned). The renderer manufactures no
  tenant/actor/verdict/identity. `[PROVEN]`
- **Hold resolution ≠ external execution:** resolution goes through the existing `ipc.holds.resolve` (records
  disposition only; HoldsView says "It does not execute anything"). The mounted test asserts resolving exercises
  only `HoldResolve` — no executor/effect channel. `[PROVEN]`
- **No blind retry:** no retry control exists; UNKNOWN/HELD show reconciliation guidance; any further action needs a
  new governed decision. `[PROVEN]`
- Tenant/account isolation of the underlying holds/records is enforced upstream (existing hold tenant tests + P12);
  not re-implemented here. `[PROVEN upstream]`

## 7. Test results `[PROVEN]` (fresh)
- New `operatorConsole.test.tsx`: **13/13** — classifyHold states (incl. UNKNOWN≠RESOLVED, no invented ESCALATED),
  buildEvidenceTimeline (effect ALWAYS NOT_VERIFIED; open→reconciliation/disposition NOT_OBSERVED; resolved→OBSERVED;
  missing actor→NOT_AVAILABLE; lifecycle order), attentionHolds (empty→empty; open-only newest-first), and mounted
  HoldsView (UNKNOWN badge + "do not blindly retry", no "verified success"; expanded record shows the timeline with
  "NOT VERIFIED"; resolve calls `ipc.holds.resolve` and executes nothing else).
- **Full main suite: 8520 passed / 3 skipped** (808 files) — unchanged (renderer-only).
- **UI suite: 207 passed** (26 files) — was 194/25 → **+13 / +1 file**, no regression (existing HoldsView-rendering
  tests still pass).
- Typecheck (node+web): clean. Lint (3 Increment-3 files, `--max-warnings 0`): clean. `git diff --check`: clean.

## 8. Frozen-surface audit `[PROVEN]`
`git diff --name-only` on the frozen set = only Increment-2A's `connectors/index.ts` + `runtimeCore.ts`. **Increment-3
added ZERO frozen change** — it is renderer-only (`understanding/*`, `ui-tests/*`). No CST/executor/executionStore/
boundaryB/m365-actions/shared/package change; no cohort membership change (coverage guard green).

## 9. Certification impact `[PROVEN]`
None. The console re-presents already-certified/already-durable evidence; it alters no authority, identity, verdict,
admission, idempotency, effect boundary, cohort, CST, worker, or provider behavior. M365 IPC 29/29 stays CERTIFIED.

## 10. Pilot impact `[IMPLEMENTED]`
An operator can now, without reading terminal output: see which consequential actions need attention (Outcome
uncertain / On hold / Approval required), read the reconstructable evidence timeline for each governed decision with
honest gaps, and record a non-executing reconciliation. This supports the five-user acceptance scenarios (§ matrix)
but does **not** by itself constitute pilot validation.

## 11. Remaining gaps `[OPEN]`
- A broader single-console aggregation (health + approvals + active executions + connector health + holds + evidence
  in one view) is NOT built; the existing `mission-control`/`operations` surfaces + this enhanced `holds` surface
  cover the pieces. Optional future consolidation.
- Evidence "external observation" / operator-entered reconciliation notes beyond the existing `resolvedNote` are not
  a new runtime field (unchanged from G2-A).
- Remaining Wave-1: signed+notarized `ffa2863`-based artifact + clean-machine verification; five-user acceptance.
- Deferred frozen gates: worker OUTCOME_UNKNOWN; ExecutionStore fail-closed.

## 12. Non-claims `[NOT CLAIMED]`
NOT claimed: VERIFIED_SUCCESS / provider verification; a fully unified multi-domain console; worker-path changes;
automatic reconciliation; provider idempotency; cross-process/power-loss durability; universal governance; pilot
validation (five-user evidence not gathered). **IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠ PILOT-VALIDATED ≠ UNIVERSAL;
UNKNOWN ≠ SUCCESS ≠ FAILURE; ACKNOWLEDGED ≠ VERIFIED_SUCCESS.**

## 13. Exact next gate `[REQUIRED]`
Wave-1 continuation (P0-SAFE): signed+notarized build from an `ffa2863`-based integration HEAD + clean-machine
install/startup/restart verification (closes G2-A NOT-EXECUTED); then the five-user acceptance run. Separately-gated
frozen work: worker OUTCOME_UNKNOWN; ExecutionStore fail-closed.

## Wave-1 acceptance matrix (updated) — PASS requires EXECUTED evidence
| ID | Property | Input | Expected | Observed | Evidence | Status |
|---|---|---|---|---|---|---|
| A1 | M365 write outcome is honest | governed mail.send | distinct ACK/UNKNOWN/HELD/DENIED state, no fake success | rendered per class | `m365Outcome.test.tsx` 11/11 | **VERIFIED** (Inc-1) |
| A2 | UNKNOWN → durable tenant hold | authoritative UNKNOWN | one deduped hold, `verification_unavailable` | hold raised, deduped | `m365UnknownHold.test.ts` 9/9 | **VERIFIED** (Inc-2A) |
| A3 | Operator sees attention states | open holds | plain-words state + reconcile guidance | rendered | `operatorConsole.test.tsx` | **VERIFIED** (Inc-3) |
| A4 | Evidence timeline reconstructable | decision + hold | ordered steps, effect NOT_VERIFIED, gaps said | rendered | `operatorConsole.test.tsx` | **VERIFIED** (Inc-3) |
| A5 | Hold resolution non-executing | resolve a hold | records disposition, no effect | only HoldResolve called | `operatorConsole.test.tsx` | **VERIFIED** (Inc-3) |
| A6 | AI cannot bypass governance | AI draft → send | draft is text; send is human+governed | sole mutating caller human-gated | Inc-1/2A Phase-B | **PROVEN** |
| A7 | Denial-before-effect intact | denials | effectCalls=0 ∧ action.run=0 | suites green | governedAction/coverage suites | **VERIFIED** |
| A8 | Clean-machine launch (ffa2863) | packaged artifact | boot → ready | — | — | **NOT EXECUTED** |
| A9 | Five-user acceptance | 5 users, real workflows | controlled outcomes | — | — | **NOT EXECUTED** |
Rows A8/A9 remain **NOT EXECUTED** — the product is not pilot-validated.

## STOP
Renderer-only; full regression green; no frozen change this increment. **No commit. No push.** HEAD `ffa2863`;
changes unstaged (Increment-1 + 2A + 3 together).
