# Phase I-A.3 — NeuroPause OS — Worker OUTCOME_UNKNOWN → Durable Hold (FROZEN GATE)

**Authorized frozen-surface gate. Implemented, verified, committed, pushed.** Baseline HEAD `634c9b7`.
Labels: `[PROVEN]` `[IMPLEMENTED]` `[VERIFIED]` `[NOT PROVEN]` `[OPEN]` `[DEFERRED]`.

## Gate status `[VERIFIED]`
Worker/M365 consequential UNKNOWN now (a) is preserved as UNKNOWN, (b) creates a durable, tenant-scoped, decisionId-
correlated reconciliation hold, (c) cannot be represented as success, (d) is fail-closed, (e) is not blindly retried.
Full regression green; committed and pushed.

## Root cause `[PROVEN]`
`M365Executor.execute` `classify()` collapsed a `NetworkError` (transmitted, response lost = UNKNOWN) into a generic
`{ok:false, message}` (`executor.ts:161-169`), and `runBinding`/`workforceActionExecutor` propagated it as a plain
failure. The UNKNOWN→hold sink existed only on the IPC `governedSend`/`governedAction` path (Increment-2A), never on
the worker `runBinding`/`M365Executor` path. So an AI/worker M365 UNKNOWN produced no hold and looked like a definite
failure — the correlation chain broke at HOLD (per the Wave-2 Increment-2 audit).

## Frozen files changed (minimal, additive) `[PROVEN]`
- **`apps/desktop/src/main/connectors/m365/executor.ts`** (+9): catch now detects `NetworkError` and returns
  `{ ok:false, message, data:{ outcome:'UNKNOWN' } }` — stops swallowing the UNKNOWN class. HttpError/AuthError/
  input errors stay a plain failure; `ok` is false either way (UNKNOWN is never success).
- **`apps/desktop/src/main/workforce/execution/workforceActionExecutor.ts`** (+12/-3): forwards the Boundary-B-
  verified `decisionId` to `runBinding` (correlation id only; no new authority; Boundary-B already passed).
- **`apps/desktop/src/main/runtimeCore.ts`** (+32): `runBinding` m365 branch — on `r.data?.outcome === 'UNKNOWN'`,
  raises a durable hold through the EXISTING `raiseHold` seam (reason `verification_unavailable`, subject
  `m365-worker:${decisionId}`, `decisionId` recorded), then returns `{ok:false, error:'Outcome unknown — … held for
  reconciliation'}`. Strictly POST-outcome; never calls `action.run`; fail-closed (a hold-raise failure is logged
  and the outcome stays non-success).
Non-frozen supporting changes: `decisions/raiseHold.ts` (+ optional `decisionId` threaded to `HoldStore.open`, which
already supported it) and `decisions/m365UnknownHold.ts` (+ optional `decisionId` on the context/output). Test
assertion updates: `boundaryBEnforcement.test.ts`, `workforceActionExecutor.test.ts` (now also verify the forwarded
`decisionId` — strengthened, not weakened).
**Untouched frozen cores:** CST kernel/`@neuropause/cst`, `governedAction`/`governedSend`, `actionSdk`,
`durableIdempotencyStore`, `ExecuteEngine`/`ExecutionSession`/`ExecutionStore`, `boundaryB.ts`, `connectors/index.ts`
routing, `storeScope`, `contracts.ts`, `packages/shared`, `package.json`, Node engine, cohort/coverage definitions.

## Correlation design (ExecutionSession ↔ HoldRecord ↔ DecisionRecord) `[PROVEN]`
Uses only existing lifecycle ids — none invented:
- `ExecutionSession.decisionId` = the BoundDecisionClaim decision (Step-5 stamp) = `verdict.requestId`.
- The worker UNKNOWN hold now records the SAME `decisionId` (via `HoldRecord.decisionId`, previously always null) and
  keys its subject `m365-worker:${decisionId}`. → **ExecutionSession.decisionId ↔ HoldRecord.decisionId.**
- `raiseHold` writes the paired `DecisionRecord` with `holdId = hold.id`. → **HoldRecord.id ↔ DecisionRecord.holdId.**
Chain complete: `ExecutionSession.decisionId → HoldRecord(decisionId, id) → DecisionRecord.holdId`.

## Security / safety preserved `[PROVEN]`
- **Denial-before-effect:** unchanged. Boundary-B still gates (`runBinding` only after `verdict.ok`); the hold-raise
  is post-effect and never invokes `action.run`. Coverage guard + Boundary-B + durable-consumption suites green.
- **No new authority:** the hold's actor comes from `raiseHold`'s authoritative authService accessor; tenant from the
  tenant-bound `holdStore` scope — never renderer-supplied. `decisionId` is a correlation id, not authority.
- **UNKNOWN ≠ SUCCESS ≠ FAILURE:** an UNKNOWN returns `ok:false` (never success) AND is held (not a proven failure).
- **No blind retry:** the decision is single-use (Step-5); resolution records disposition and executes nothing; a
  further action requires a new governed decision.
- **Fail-closed:** a hold-raise failure is logged and the outcome remains non-success.
Tenant/actor/account isolation, approval, consent, provenance, Boundary-B: all unchanged.

## Tests `[VERIFIED]`
New `apps/desktop/src/main/decisions/m365WorkerUnknownHold.test.ts` (**8/8**):
- M365Executor: NetworkError → `data.outcome:'UNKNOWN'` (ok:false); HttpError → plain failure (no UNKNOWN); success
  → ok:true only (no UNKNOWN).
- worker UNKNOWN hold carries the `decisionId` (ExecutionSession correlation) + reason `verification_unavailable`;
  the paired DecisionRecord links by holdId; dedupes by decision; resolution executes nothing.
- builder threads `decisionId` only when present (IPC path unchanged).
Updated (strengthened) assertions now verify the forwarded `decisionId`: `boundaryBEnforcement.test.ts`,
`workforceActionExecutor.test.ts`. No existing test weakened.

## Regression `[PROVEN]` (fresh)
- **Full main suite: 8533 passed / 3 skipped** (810 files) — was 8525 → +8, no regression.
- **UI suite: 218 passed** (28 files) — unchanged.
- Affected/cert suites green: boundaryBEnforcement, boundaryB, workforceActionExecutor, m365Write, coverage guard,
  cohorts, sendTransition.negative, durable idempotency, durableConsumption, raiseHold/holds.
- Typecheck (node+web): clean. Lint (changed files, `--max-warnings 0`): clean. `git diff --check`: clean.

## Certification impact `[PROVEN]` — **frozen worker-ingress behavior change; NO impact on the certified M365 IPC path**
- **Changed (worker ingress):** `M365Executor` failure classification now distinguishes NetworkError→UNKNOWN
  (previously collapsed), and the worker path raises a hold on UNKNOWN. This **narrows the previously-OPEN "worker
  UNKNOWN collapse" gap** (G1-A / G2 / Wave-2 Inc-2) — an assurance IMPROVEMENT.
- **Unchanged (certified IPC path):** CST kernel, governedSend/governedAction, canonical identity, durable admission,
  denial-before-effect, and the M365 IPC 29/29 coverage guard are untouched and green. No cohort membership change.
- **Not weakened:** definite failures stay failures; success stays ACKNOWLEDGED-only; Boundary-B/Step-5 intact.
- **Still NOT claimed:** worker/CST equivalence (this adds honest UNKNOWN handling + a hold; it does NOT route the
  worker through CST). Worker/CST parity remains **NOT PROVEN**. Provider idempotency/verification, cross-process/
  power-loss durability: unchanged, not claimed.

## Readiness-matrix update `[PROVEN]`
- Worker OUTCOME_UNKNOWN preservation → durable hold: **DEFERRED/OPEN → CLOSED (worker ingress)** for the M365 worker
  path (NetworkError preserved as UNKNOWN; durable decisionId-correlated hold; no blind retry; fail-closed).
- ExecutionSession ↔ HoldRecord ↔ DecisionRecord correlation: **MISSING → PRESENT** (via decisionId + holdId) for the
  worker UNKNOWN path.
- Worker/CST parity: **NOT PROVEN** (unchanged). ExecutionStore fail-closed: **OPEN** (unchanged, separate gate).

## Commit / push `[PROVEN]`
Committed as one atomic commit on `cert/data-import-cst-integration` (this gate's files only; the prior unstaged
Wave-1/Wave-2 product increments were left untouched, awaiting their own authorization). Commit SHA + push status
appended below by the runbook.

## Exact next gate `[REQUIRED]`
- The operator VIEW that fetches conversations + `ipc.execute.sessions` + holds and renders the correlated AI-assisted
  lifecycle end-to-end (renderer, non-frozen).
- ExecutionStore fail-closed hardening (separate frozen gate).
- Clean-machine + five-user pilot validation (BLOCKED-ENV until a real pilot environment).

## Remaining blockers `[OPEN]`
Worker/CST parity (not attempted here — out of scope); ExecutionStore fail-open; cross-process/power-loss durability;
provider idempotency/verification; live pilot validation. None weakened by this gate.
