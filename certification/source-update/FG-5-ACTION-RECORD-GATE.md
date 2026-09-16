# FG-5 — GATE DOC · the action-record observer emit (S34a, closes F-4)

**Status: PRESENTED — awaiting the literal token. No frozen byte changes until the token arrives.**

## The token this gate waits for (verbatim)
```
AUTHORIZED: FG-5 — connectors/index.ts action-record observer emit, one gated line, per gate doc
```
Silence is not consent; enthusiasm is not consent; only the token is consent. A diff that changes after the token needs a new token.

## Gate-ledger note (condition 5 — FG numbering coherence)
FG-5 was previously ANTICIPATED (S16 roadmap; DECISIONS D-10) for a frozen admission-record field carrying verification
state. That purpose was resolved WITHOUT a gate: D-10 made the verification state a NON-frozen store, so no frozen field
— and no FG-5 — was needed then. This gate is the FIRST ACTUAL frozen touch the FG-5 slot describes: correlating the
admission/execution outcome with a durable, queryable record (exactly what D-10 said "would be FG-5"). One gate, one number.

## 1 · Why (S34a / F-4)
F-4 (S15): the certified send path + FG-4 guard write NO structured decision record — the IPC audit line is only
`{channel, ok, durationMs}` (no recipient, outcome, actor, decisionId). Today the ONLY durable record on the send path
fires on the UNKNOWN→hold branch; AUTHORIZED / SUBMITTED / 202-ACKNOWLEDGED / DENIED / provider-failure produce nothing.
The scout confirmed every consequential stage except UNKNOWN is **silent-and-frozen**, and the event bus carries
`write_*` events only for the *ungoverned* executor path that `mail.send` bypasses. So "what happened to the email I
sent?" is unanswerable without reading raw logs. Closing F-4 for the happy path requires ONE frozen stage to emit.

## 2 · The frozen change — EXACTLY ONE gated line (+ its import), verbatim
`apps/desktop/src/main/connectors/index.ts`, in the `mail.send` branch, immediately before the existing return:
```
           if (g.semanticOutcome === 'UNKNOWN') {
             raiseM365UnknownHold(r.connectorId, r.accountId, r.actionId, g.outcome, 'Send email (Microsoft 365)');
           }
+          // S34a (FG-5) — best-effort action-record OBSERVER: assemble the queryable evidence chain for THIS
+          // send. It is an observer, NEVER a gate — fire-and-forget + self-catching, so it can never block,
+          // delay, or alter the governed send or its response; a failed emit logs an evidence gap (below).
+          void actionRecord.observe(r, g, { actor: deps.actor() ?? '', tenantId: deps.workspaceId() }).catch(() => {});
           return mapSendOutcome(g, r.confirmed);
```
+ one import at the top of the file:
```
+import { actionRecord } from './actionRecord';
```
The operative frozen change is **one import + one statement** (the FG-2 shape). It is placed AFTER `governedSend` has
fully resolved and AFTER the UNKNOWN-hold — the send + its outcome already exist; the observer only reads them. It is
`void`-discarded and `.catch`-guarded; because `observe` is `async`, no synchronous throw is possible and any rejection
is swallowed at the call site while `observe` itself logs the gap. The certified path is never weakened — this line only
OBSERVES.

## 3 · Non-frozen accompaniment (all store + emit logic; NOT token-gated)
- **`connectors/actionRecord.ts`** (new) — `ActionRecordStore` (durable append-only JSON, tenant-scoped,
  `declareStoreScope` TENANT/OWNER) + `observe(request, result, ctx)` + `query(...)` + `recordVerification(...)`.
  `observe` is `async`, wraps ALL work in try/catch, NEVER rejects; on failure it logs
  `[ACTION_RECORD] emit failed — evidence gap for <transitionId>` (honest, not swallowed).
- **Record shape (condition 3 — NO second copy of content):**
  ```
  { requestId, transitionId, at, actor,   // actor = D-12 namespace VERBATIM (e.g. local:<id>), never stripped
    tenantId, connectorId, accountId, actionId,
    recipients: { to[], cc?[], bcc?[] },   // recipients ARE the chain (to whom), not "content"
    subjectFingerprint, bodyFingerprint,   // fingerprint(text) — NEVER the subject/body themselves
    verdict, executed, outcome,            // ALLOW/DENY/HOLD/ESCALATE · bool · ACKNOWLEDGED/DENIED/UNKNOWN/…
    admissionRef,                          // = transitionId — a REFERENCE to the existing admission evidence, not a copy
    verification: null }                   // filled later by the verify wrapper (recordVerification)
  ```
- **Verify wrapper** (`s16VerifyRun` / a non-frozen verify path) calls `actionRecord.recordVerification(transitionId,
  terminal)` to complete the chain — so a VERIFIED_SUCCESS/VERIFY_FAILED terminal attaches to the same record.
- **Guard-DENIED** (the FG-4 e2e path, `firstRealSendGuard`, non-frozen): emits its own DENIED record before the early
  return, so the e2e guard terminal is covered without a second frozen touch.

## 4 · Terminal coverage (condition 2 — every terminal yields a record; refusals too)
| terminal | source | recorded via |
|---|---|---|
| guard DENIED (e2e) | `firstRealSendGuard` early return | the non-frozen guard's own emit |
| governance refusal (DENY) | `g.semanticOutcome='DENIED'`, `outcome.executed=false` | the one emit (observe) |
| NO_ACTOR (null actor → DENY) | `deps.actor()` null → governedSend DENY | the one emit (actor recorded as '') |
| HOLD / ESCALATE | `g.semanticOutcome='HOLD'/'ESCALATE'` | the one emit |
| executed → ACKNOWLEDGED (202) | `g.semanticOutcome='ACKNOWLEDGED'` | the one emit |
| provider failure (EXECUTION_FAILED) | `g.semanticOutcome='EXECUTION_FAILED'` | the one emit |
| UNKNOWN (+ hold) | `g.semanticOutcome='UNKNOWN'` | the one emit (alongside the existing DecisionRecord hold) |
| VERIFIED_SUCCESS / VERIFY_FAILED | verify wrapper | `recordVerification` completes the same record |
Every terminal — including every REFUSAL — produces a record; the chain does not only tell success stories.

## 5 · Conditions honored
| condition | where |
|---|---|
| 1 · observer never a gate; failure observable | §2 (`void … .catch`, placed post-send) + `observe` never rejects, logs the gap; **test T-1** (throwing store → gap logged, no throw, send-shaped result unaffected) |
| 2 · every terminal enumerated + proven | §4 table + **test T-2** (each `semanticOutcome` → a record) |
| 3 · no second content copy; actor verbatim; admission by reference | §3 shape — subject/body → fingerprints, `admissionRef`=transitionId, `actor` verbatim; **test T-3** (record holds no subject/body substring; actor `local:<id>` unstripped) |
| 4 · exactly one gated line (+import), store non-frozen | §2 (one import + one statement); all logic in `actionRecord.ts` |
| 5 · gate-ledger note | top of this doc |

## 6 · Threat analysis — both directions
**Frozen → the rest.** The emit runs after the send resolves and is fire-and-forget + self-catching, so it cannot
block, delay, reorder, or change the send or `mapSendOutcome`'s return (T-1). It only READS `r`/`g`/actor/tenant. It
adds no authority — the record is evidence, never consulted by governance/execution. A slow/failing disk degrades to an
evidence gap (logged), never a failed or delayed send.
**The rest → frozen.** `observe` cannot influence the certified path (no return value used; exceptions contained). The
record carries recipients + fingerprints + an admission REFERENCE — no second unbounded copy of content to leak, and the
actor is the D-12 verbatim string (a `local:` actor is disclosed as local, never stripped to look cloud-authenticated).

## 7 · Verification plan
- **T-1 observer-never-blocks:** an `observe` whose store throws → resolves (no throw), logs the evidence gap; a
  simulated handler wrapper (`void observe(...).catch`) returns the send-shaped result unchanged.
- **T-2 terminal coverage:** drive `observe` with each `GovernedSendResult` semanticOutcome (DENIED/HOLD/ESCALATE/
  ACKNOWLEDGED/EXECUTION_FAILED/UNKNOWN/VERIFIED_NOOP) → one record each, correct `outcome`/`verdict`/`executed`.
- **T-3 no-content-copy + actor verbatim:** the record contains no subject/body substring (only fingerprints + a
  reference); a `local:<id>` actor is stored verbatim; `query()` answers "what happened to <recipient/subject-fp>".
- **T-4 recordVerification:** a later terminal attaches to the same record by `transitionId`; UNKNOWN never auto-promotes.
- **Read-only confirmations for you:** `sed -n '626,632p' apps/desktop/src/main/connectors/index.ts` (the insertion
  point + the single return it precedes) · `bash certification/verify-freeze.sh | tail -3`.
- Suites: full main (incl. any renderer) + typecheck + lint + `verify-e2e-strip` PASS before the frozen commit records.

## 8 · Landing choreography (after the token)
1. Checkpoint (clean HEAD) → freeze-baseline re-record → **INTACT #1** (committed).
2. **Checkpoint commit (non-frozen):** `actionRecord.ts` + tests + the verify-wrapper + guard-DENIED emit — a
   declared-but-not-yet-emitted store (a one-commit gap covered by this doc), full suites green.
3. Re-record → INTACT (the non-frozen checkpoint is green on its own).
4. Apply the §2 frozen diff (one import + one line) — the authorized diff + minimum accompaniment — full suites green.
5. One isolated frozen commit → re-record → **INTACT #2** (committed).
6. Evidence (S34a): the frozen/non-frozen split, both INTACT baselines, this token verbatim, the terminal-coverage table,
   the query demonstration ("what happened to the email I sent?" answered from the store).

## 9 · Scope boundary (honest)
This gate lands the RECORD + the emit — the queryable data that answers F-4 at the store layer (proven by `query()` +
tests). A user-facing query IPC channel + renderer view would touch frozen `channels.ts` and is therefore a SEPARATE,
later step (its own gate or an existing-channel reuse) — deliberately NOT in this one-gated-line FG-5.
