# Phase H — Finding H-FINDING-1: the effect boundary collapses UNKNOWN into FAILURE

**Discovered during Phase H implementation (before any code). OBSERVE → RECORD →
CLASSIFY → STOP.** No code written; awaiting a boundary decision on H9.

## Observation

The Profile-A outcome model requires the adapter to distinguish, after execution:
`ACKNOWLEDGED` (202) · `UNKNOWN` (transmitted, response lost) · `EXECUTION_FAILED`
(definite rejection). The plan (H9) said "wrap `M365Executor.execute` verbatim as the
kernel effect."

- The **transport** already distinguishes these (`unified/sync/http.ts`):
  - timeout / aborted request → `NetworkError` (line ~109: "fails fast as a NetworkError") — the ambiguous **UNKNOWN** case.
  - definite HTTP rejection → `HttpError(status)` / `AuthError(401|403)` — the **FAILURE / DENIED** case.
- But **`M365Executor.execute` swallows the distinction**: its `try/catch`
  (`connectors/m365/executor.ts:148–158`) routes every thrown error through
  `classify()` (`:161`), which special-cases only `AuthError` and returns a generic
  `{ ok:false, message }` for `NetworkError` and `HttpError` alike. A timeout after the
  mail was transmitted is therefore reported identically to a definite rejection.
- `mail.ts:49 send()` additionally hardcodes `ok:true` on any non-throwing POST — a
  202 ack presented as success (the SEEN/EXECUTED ≠ EFFECT_CONFIRMED collapse).

## Classification

This is **not a kernel defect and not a Data Import defect.** It is an
**integration-boundary finding**: `M365Executor.execute` bundles authorization +
confirmation + effect **and** erases the transport's own `NetworkError` vs `HttpError`
distinction in its return value. Consequently, wrapping `execute()` **verbatim** as
the CST effect **cannot** honor the frozen invariants H-2/H-3 (a 202 must be
`ACKNOWLEDGED` not verified; a lost response must be `UNKNOWN` not `FAILURE`). The
required distinction exists one layer down but is discarded before the adapter can see
it.

## Options (a boundary decision, refining H9 — NOT to be resolved unilaterally)

- **Option 1 (recommended) — effect = the pure send below the swallow.** The adapter's
  kernel-effect performs the send by reusing the executor's *parts*
  (`ownsAccount`/`grantedScopes`/`getToken`/`makeHttp` + the `WriteAction.run`) so the
  **typed transport error propagates** (`NetworkError → UNKNOWN`, `HttpError/AuthError →
  FAILURE/DENIED`, 202 → `ACKNOWLEDGED`). Governance (C3, approval-from-`confirmed`,
  claim, authorization) lifts into the kernel — **exactly mirroring Data Import**, where
  `applyImportPlan` is the pure effect and auth/approval sit outside it. The executor
  file stays **UNMODIFIED** (we consume its deps, not edit it). Cost: the one call site
  reconstructs the effect from the executor's parts rather than calling `execute()` as a
  black box (still one adapter + one call site).
- **Option 2 — minimally surface error class from `execute()`.** Add an optional
  discriminator to `ConnectorWriteResult` (e.g. `outcomeKind: 'acknowledged' |
  'rejected' | 'unknown'`) that `execute()` sets from the caught error type, without
  changing its behavior. The adapter then wraps `execute()` verbatim and reads it. Cost:
  edits the preserved effect + a shared type (broader than "one adapter + one call site";
  modifies the effect contract).
- **Option 3 — fold ambiguity into UNKNOWN.** Without error class, treat every
  post-attempt non-success as `UNKNOWN` (never `FAILURE`). Safe but loses the legitimate
  `EXECUTION_FAILED` distinction for definite rejections and blurs pre-effect
  `DENY`/`HOLD` vs post-effect `UNKNOWN`. Weakest.

## Recommendation

**Option 1.** It keeps the frozen kernel and the executor file unmodified, mirrors the
Data Import integration precisely (pure effect + kernel governance), and is the only
option that honestly supports `ACKNOWLEDGED` / `UNKNOWN` / `EXECUTION_FAILED` without
weakening assurance. H9 should be refined from "wrap `execute()` verbatim" to "the
effect is the pure Graph send; the executor's authorization/scope/token parts are
reused as governance/effect inputs; the executor file is unmodified."

## Disposition

```
H-FINDING-1   STATUS: RESOLVED BY DESIGN DECISION
Finding:      M365Executor.execute() erases transport outcome distinctions.
Decision:     Option 1.
Resolution:   The CST effect is the PURE Graph send (WriteAction.run), below the
              executor's error-swallowing classification layer, so the typed
              transport error (NetworkError → UNKNOWN, HttpError/AuthError →
              FAILURE/DENIED, 202 → ACKNOWLEDGED) is the sole classification input.
Kernel:       UNCHANGED.   Executor (executor.ts): UNCHANGED.
H9:           REFINED (effect = pure send; executor seams reused as governance inputs).
Assurance:    UNCHANGED.   Profile: A (acknowledgement-only).
Proven by:    cst/sendTransition.negative.test.ts — the real `mail.send` action with a
              fake transport propagates NetworkError → UNKNOWN and HttpError →
              EXECUTION_FAILED to the adapter intact (execute() would have collapsed both).
```

---

# H-FINDING-2 — Profile-A replay HOLDs for reconciliation, not VERIFIED_NOOP

**Discovered while running the Phase H negative controls (H-F/H-K).**

## Observation
The plan's control S-E anticipated that a duplicate send (same idempotency key) would
resolve to `VERIFIED_NOOP`. The kernel instead returns **`HOLD`** for the replay, with
**`effectCalls === 0`** (no second external send).

## Classification — honest, not a defect
In Profile A the FIRST send is only `ACKNOWLEDGED`; its completion is **unobservable**
(no authoritative read-back). The kernel therefore cannot treat the prior transition as
*confirmed complete*, so a replay is IN_FLIGHT/unconfirmed and the reconcile port
(honest `{known:false}`) drives a **HOLD for reconciliation** rather than a fabricated
no-op. This is the **strongest honest outcome**: consequence control is preserved (no
duplicate email — `effectCalls 0`) **and** the system does not overclaim a `NOOP` it
cannot prove. It is a direct consequence of the frozen invariants (`UNKNOWN ↛ VERIFIED`,
absence-of-observation ↛ proof) and of the "no blind retry" rule applied to replays.

## Disposition
```
H-FINDING-2   STATUS: RECORDED — behaviour ACCEPTED as the honest Profile-A outcome
Effect on plan: S-E refined — Profile-A duplicate ⇒ HOLD (reconciliation), not
                VERIFIED_NOOP. Consequence control (no second send) unchanged.
Profile B note: an authoritatively-confirmed prior send COULD yield VERIFIED_NOOP;
                that requires the (deferred) remote-observation contract.
Kernel/executor: UNCHANGED.   Assurance model: UNCHANGED (in fact strengthened).
Proven by:      cst/sendTransition.negative.test.ts — H-F/H-K.
```

---

# H-FINDING-3 — a SECOND call site reaches mail.send ungoverned (declared scope boundary)

**Surfaced by the "prove the bypass is gone" inspection during the call-site wrap.**

## Observation
`m365Executor.execute` has TWO callers of `mail.send`:
1. `connectors/index.ts` `M365ActionExecute` IPC handler — **now governed** through
   `governedSend`; there is no direct-executor bypass for `mail.send` from this call site.
2. `runtimeCore.ts:2490` — the **ExecuteEngine worker-action dispatch**
   (`binding.executor === 'm365'`), reached via the assistant/worker path. This calls
   `connectors.m365Executor.execute(...)` directly and is **NOT** governed by this phase.

## Classification — declared boundary, not a defect
Phase G explicitly deferred governing the ExecuteEngine orchestrator ("govern a leaf
effect it dispatches, not the orchestrator"). Phase H governs the **`M365ActionExecute`
IPC call site**. Therefore the honest, narrow claim is:

> The `M365ActionExecute` IPC path for `mail.send` is governed by the CST boundary.
> `mail.send` is **not universally governed**: the ExecuteEngine worker path
> (`runtimeCore.ts:2490`) still reaches the executor directly and is un-governed,
> deferred to a later phase (a second, distinct call site — the same leaf, a
> different entry).

## Disposition
```
H-FINDING-3   STATUS: RECORDED — declared scope boundary (not resolved this phase)
Governed:     M365ActionExecute IPC handler → governedSend (no direct bypass here).
Un-governed:  ExecuteEngine worker dispatch (runtimeCore.ts:2490) → executor.execute.
Decision:     Deferred (Phase G deferred the orchestrator). Governing that entry is
              future scope; it does NOT weaken the narrow Phase-H claim.
Kernel/executor: UNCHANGED.
```
