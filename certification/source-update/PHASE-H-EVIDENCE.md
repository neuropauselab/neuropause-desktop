# Phase H — Evidence & Close-out (M365 `mail.send` governed transition, Profile A)

**Status: IMPLEMENTATION COMPLETE — AWAITING REVIEW. Nothing committed.**
Governing rule: *record the strongest claim the evidence supports — never a stronger
one.* A 202 is provider acknowledgement, not a verified business outcome.

Baseline: Phase G design `ce3ed6f`; authorization record `3a77ab8`. CST kernel and
`connectors/m365/executor.ts` UNCHANGED. Profile A only (no Profile B).

---

## PHASE H — ACCEPTED WITH SCOPE (frozen conclusion)

> **H-CONTRACT PASS.** The M365 `mail.send` transition is governed through the frozen
> CST contract on the `M365ActionExecute` IPC path. Unconfirmed, unauthorized,
> no-scope, no-token and missing-actor requests are refused without effect. HTTP 202
> is represented as `ACKNOWLEDGED` rather than verified success. Definite typed
> transport failures classify as `EXECUTION_FAILED`. A lost response after
> transmission produces `UNKNOWN` with exactly one effect attempt and no blind retry.
> `VERIFIED_SUCCESS` is structurally unavailable for Profile A.
>
> **H-APP SCOPED PASS.** The live application establishes the authentication boundary
> and refuses unauthenticated consequential requests before Graph effect. End-to-end
> `governedSend` execution through an authenticated renderer was not established
> because the available development session was unauthenticated. Authentication was
> not fabricated. Automated controls cover the identical wired implementation path.
>
> **H-EXTERNAL NOT ESTABLISHED.** No live M365 account was available and no external
> email was sent.
>
> **H-FINDING-1 RESOLVED.**
> **H-FINDING-2 RECORDED/ACCEPTED:** Profile-A replay after `UNKNOWN` remains `HOLD`
> pending reconciliation and does not fabricate `VERIFIED_NOOP`.
> **H-FINDING-3 RECORDED/DEFERRED:** an ExecuteEngine worker call site reaches
> `mail.send` outside the governed `M365ActionExecute` IPC path. Phase H establishes
> governance for the declared IPC ingress only, **not universal `mail.send`
> governance.**

**This is NOT** "universally certified", "externally proven", or "all `mail.send`
paths governed". It is: *the declared Phase H `M365ActionExecute` path is governed and
contractually proven, with the live application's authentication boundary established
and the external M365 effect explicitly unestablished.*

### Governance boundary locality (the deeper conclusion)
Phase H demonstrates that **governance is established at a declared ingress path, not
automatically inherited by every invocation of the underlying capability.** The
`mail.send` capability is governed via the `M365ActionExecute` IPC ingress
(`→ requireAuth → governedSend → CST`) but reachable un-governed via the ExecuteEngine
worker path (H-FINDING-3). The evidence therefore *refutes* the dangerous assumption
"because `mail.send` is governed somewhere, it is governed everywhere." This locality
is the primary architectural input to the next phase.

---

## Three conclusions (not a single "PASS")

### H-CONTRACT — **PASS**
The `mail.send` adapter (`cst/sendTransition.ts`) implements the accepted
governed-transition semantics. Evidence: `cst/sendTransition.negative.test.ts`
(**16/16**), node typecheck clean, and the full desktop main suite **793/793 files,
8267 tests** (+1 file, +16 tests vs the pre-Phase-H 792/8251). This establishes that
*the Phase H implementation passes the declared automated test suite without detected
regression* — it does **not** establish that all possible runtime behaviour is
correct.

**Regression-anomaly investigation (recorded for how the conclusion was reached).**
Running a *subset* (`cst` + `connectors`) initially showed 20 failures in
`connectors/bridge/bridge.test.ts` (`ProvenanceStore.appendConnector` — "no
organization and workspace"). Rather than assume non-causal, the changes were
**stashed** and the subset re-run: the 20 failures **reproduced without the Phase H
changes**, confirming a **pre-existing test-isolation artifact** (the bridge test
depends on org/workspace context the *full* suite provides but a subset does not). In
the full suite `bridge.test.ts` passes. Conclusion: the anomaly is **not causal** to
Phase H.

| Control | Result |
|---|---|
| H-B unconfirmed C3 | `HOLD`, `effectCalls 0` |
| H-C unauthorized (not owner) | `DENIED`, `effectCalls 0` |
| H-D missing Graph scope | `DENIED`, `effectCalls 0` |
| H-E no valid token | `DENIED`, `effectCalls 0` |
| H-O **missing authoritative actor** | `DENIED`, `effectCalls 0` (no fallback identity) |
| H-A/H-H provider 202 | **`ACKNOWLEDGED`**, once; never verified |
| H-G/G2/G3/G4 HttpError / rate-limit / auth / bad-input | `EXECUTION_FAILED`, once |
| **H-J (flagship)** lost response after transmission | **`UNKNOWN`**, `effectCalls===1`, no retry, not failure, not verified |
| H-I every path | **never `VERIFIED_SUCCESS`** (structural — no such code path) |
| H-F/H-K replay of same message | `HOLD` (reconciliation), `effectCalls 0` — no duplicate send |
| real `mail.send` + fake transport | `NetworkError→UNKNOWN`, `HttpError→EXECUTION_FAILED`, 202→`ACKNOWLEDGED` (typed error survives — the H9/Option-1 proof) |

### H-APP — **SCOPED PASS (with a declared auth boundary)**
- **Proven live:** the real launched Desktop application boots (`system:runtimeState:
  ready`) and the consequential channel `connectors:m365.execute` is `requireAuth` —
  it **refuses before any Graph effect** when the session is unauthenticated (returns
  "Sign in to continue"). A consequential external action cannot even reach the
  handler without an authenticated session. This is a live application governance
  boundary.
- **Not driven end-to-end offline (declared boundary):** the `governedSend`
  CST verdict for `mail.send` (`DENIED`/`HOLD` with `data.outcome`) was **not** driven
  through the live renderer, because the dev profile is **currently unauthenticated**
  (both `dp:analyze` and `connectors:m365.execute` report the auth gate; the session
  present during the Data Import Phase E run has since expired). Authenticating
  requires the backend/credentials and was **not faked**. This is the same auth/
  environment dependency Data Import declared in Phase E — not a defect.
- **What carries the governance claim instead:** the `mail.send` handler routes
  **exclusively** through `governedSend` (no direct-executor bypass from this call
  site — code inspection + H-FINDING-3), and the identical wired code path is proven
  by the 16 negative controls above. So the governance behaviour is established on the
  same code that runs in the app; only the live-renderer *demonstration* of it awaits
  an authenticated session.

> **Do not read H-APP as "M365 end-to-end execution proven."** It proves the live
> application governance/refusal boundary; it does not prove external execution.

### H-EXTERNAL — **NOT ESTABLISHED**
No live Microsoft 365 send was performed. No connected M365 account exists in the
profile, and NeuroPause did not connect one or send a real email to manufacture
evidence. No claim is made that a real external email was transmitted or remotely
verified. This defines the evidence boundary; it is not a failure of the work.

---

## Findings (history preserved — see PHASE-H-FINDING-1-EFFECT-BOUNDARY.md)
- **H-FINDING-1 — RESOLVED** (Option 1: effect = pure Graph send below the executor's
  error-swallow; typed transport error is the sole classification input). Proven by
  the real-`mail.send` propagation tests.
- **H-FINDING-2 — RECORDED/ACCEPTED**: Profile-A replay ⇒ `HOLD` for reconciliation,
  not `VERIFIED_NOOP` (completion unobservable); no duplicate send. Refines S-E.
- **H-FINDING-3 — RECORDED / DEFERRED**: a second call site (`runtimeCore.ts:2490`,
  ExecuteEngine worker dispatch) reaches `mail.send` ungoverned — declared
  out-of-scope boundary (Phase G deferred the orchestrator). Phase H governs the
  `M365ActionExecute` IPC leaf only; `mail.send` is **not universally governed**.
  Deliberately **not** "fixed" inside Phase H — governing the worker path is the next
  phase's investigation, not a silent Phase-H expansion.

---

## Working-tree footprint (uncommitted)
- **New:** `apps/desktop/src/main/cst/sendTransition.ts` (adapter),
  `apps/desktop/src/main/cst/sendTransition.negative.test.ts` (16 controls),
  `certification/source-update/PHASE-H-*.md` (plan, finding, this evidence).
- **Modified (2 call-site files):** `apps/desktop/src/main/connectors/index.ts`
  (route `mail.send` through `governedSend`; `actor()` dep; `mapSendOutcome`; seam
  extraction) and `apps/desktop/src/main/runtimeCore.ts` (wire `actor()` from the
  session identity authority).
- **UNCHANGED:** the CST kernel, `connectors/m365/executor.ts`, `mail.ts`, Data Import
  (`fcb3a31`), the reference (`713db12`).

## Acceptance matrix
| Gate | Status |
|---|---|
| H-CONTRACT adapter semantics | **PASS** (16/16) |
| Governance refusals (H-B/C/D/E/O) | **PASS** (effectCalls 0) |
| 202 ⇒ ACKNOWLEDGED | **PASS** |
| Definite rejections ⇒ EXECUTION_FAILED | **PASS** |
| Lost-response ⇒ UNKNOWN, once, no retry | **PASS** (H-J) |
| Structural no-VERIFIED_SUCCESS | **PASS** (H-I) |
| No direct `mail.send` bypass from the IPC call site | **PASS** (routed through governedSend; H-FINDING-3 notes the separate worker path) |
| Identity plumbing (actor ≠ tenant; null ⇒ DENY) | **PASS** (H-O) |
| Full regression + typecheck | **PASS** (793/8267, clean) |
| H-APP live application boundary | **SCOPED PASS** (auth-gate refusal live; governedSend live-demo awaits an authenticated session) |
| H-EXTERNAL real M365 effect | **NOT ESTABLISHED** (declared) |
| Frozen kernel + executor unmodified | **PASS** |

**Gate: ACCEPTED WITH SCOPE.** Committed as the Phase H follow-on to `3a77ab8`,
containing only the reviewed Phase H scope (governedSend adapter, negative controls,
`actor()` identity plumbing, runtime wiring, evidence, findings). The ExecuteEngine
worker-path governance (H-FINDING-3) is **excluded** — deferred to the next phase.
