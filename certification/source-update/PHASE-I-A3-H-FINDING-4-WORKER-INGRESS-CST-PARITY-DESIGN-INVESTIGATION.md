# Phase I-A.3 — H-FINDING-4 Worker-Ingress CST Parity — Design Investigation (READ-ONLY)

**READ-ONLY architecture/certification investigation. No production/test/frozen change, no stage/commit/push.**
Baseline HEAD `ffa2863` (parent `d2c9827`), branch `cert/data-import-cst-integration`.
Labels: `[PROVEN]` / `[PROVEN-ABSENT]` / `[INFERRED]` / `[DESIGN]` / `[OPEN]` / `[NOT PROVEN]`.
Two independent methods were used (direct source reads + a bypass/trace sweep) and agree where marked `[PROVEN]`.

## 1. Repository state `[PROVEN]`
HEAD = `ffa2863c29e6c5fac7f4267abb032566c6b12548`. Branch `cert/data-import-cst-integration`. Working tree: 0 tracked
modifications, 0 staged. Untracked = 8 preserved certification docs. Chain
`90527b4 → dc9e8f3 → 8846371 → cc184d0 → d2c9827 → ffa2863` verified.

## 2. Investigation question
"Can the Worker M365 ingress be shown to provide an equivalent or otherwise sufficient governance/assurance boundary
to the IPC governedAction/CST path, and exactly what would be required before any claim of cross-ingress governance
equivalence could be made?" Equivalence is neither assumed nor denied — only source is trusted.

## 3. Worker ingress architecture `[PROVEN]`
Single-pathed, trusted-dispatcher-minted, gated twice before effect:
1. **Mint (Boundary A)** — a human approval triggers the in-process dispatcher `runtime.setDispatchApproved`
   (`workforce/index.ts:222-266`), which calls `governedRequests(job, bindings, {actor: deps.actor(), tenantId:
   activeTenantScope().tenantId, nowMs: claimClock(), ttlMs, nonce: claimNonce})`. `claimClock`/`claimNonce` are
   main-process (`Date.now`/`randomUUID`), never renderer (`index.ts:215-216`).
2. **`governedRequests`/`bindingToRequest`** (`workforce/execution/router.ts:47-120`) — mints one
   `BoundDecisionClaim` per approved consequential proposal (fail-closed: first un-mintable proposal aborts the
   batch, `:108`); builds an `ExecutionRequest` with `params.binding` + sibling `params.claim/actor/tenantId`, sets
   `confirmed:true` (`:64`, "the human approval IS the confirmation"), `kind:'connector'`.
3. **`mintClaimForApprovedProposal`** (`cst/boundDecisionClaimMint.ts:56-92`) — fail-closed: requires
   `approval.decision==='approved'`, an execution binding, complete effect fields, non-null actor+tenantId,
   canonicalizable params; `decisionId = verdict.requestId`.
4. **ExecuteEngine Step-5 durable admission** (`executeEngine.ts:143-186`) — see §8.
5. **`workforceActionExecutor`** (`workforce/execution/workforceActionExecutor.ts`) — no-binding → soft-fail
   (`:34-37`, before Boundary-B); else `verifyBoundaryB(req, now)`; DENY ⇒ `runBinding` NOT called (`:39-45`).
6. **`runBinding` case `'m365'`** (`runtimeCore.ts:2508-2521`) → `connectors.m365Executor.execute(target,
   accountId, actionId, params, confirmed)`.
7. **`M365Executor.execute`** (`connectors/m365/executor.ts:78-159`) — ownsAccount + confirmation + scope + token
   gates → `action.run` (the Graph effect, `:134`).
Registration: `executeEngine.register('connector', createWorkforceActionExecutor(runBinding))` (`runtimeCore.ts:2542`);
workforce reaches the engine only via `workforce.setExecutionSubmit(req => executeEngine.execute(req))` (`:2544`).

## 4. Boundary-B architecture `[PROVEN]`
`verifyBoundaryB(req, nowMs)` (`workforce/execution/boundaryB.ts:42-80`): (1) claim must be present with a
non-empty `decisionId` (else `MISSING_CLAIM`); (2) authoritative `actor` + `tenantId` must be present (else
`MISSING_ACTOR`/`MISSING_TENANT` — they are digest fields, never a fallback); (3) reconstruct the EXACT eight-field
`EffectBinding` from the ACTUAL request; (4) `verifyBoundDecisionClaim` re-derives `sha256(canonicalize(binding))`
and compares — it NEVER trusts `claim.bindingDigest`. Fail-closed on any missing/malformed/expired/mismatched
input. It is SEMANTIC in-process verification (not cryptographic issuer auth; not a bearer token) and does NOT
itself perform durable single-use consumption (that is Step-5).

## 5. Complete execution trace `[PROVEN]`
`approval → setDispatchApproved (mint, main-process clock/nonce) → governedRequests/bindingToRequest (claim+actor+
tenant siblings, confirmed:true) → executeEngine.execute → Step-5 reserve+persist-before-effect → workforceAction
Executor.verifyBoundaryB → runBinding('m365') → M365Executor.execute (ownsAccount/confirm/scope/token) → action.run
→ Graph`. No other production caller of `runBinding` or `m365Executor.execute` exists on the worker side.

## 6. Authority analysis `[PROVEN]`
Authoritative actor = `deps.actor()` (main-process); tenant = `activeTenantScope().tenantId`. Both are (a) minted
into the claim digest, (b) required present at Boundary-B, (c) part of the 8-field binding. Ownership/scope/token
enforced in the executor (`:96-114`). Confirmation = `confirmed:true`, produced only by the trusted dispatcher after
`approval.decision==='approved'`; the renderer `ExecuteRunRequest` is `.strict()` with no `params`, so it cannot
inject claim/actor/tenant/confirmed. Renderer exclusion holds `[PROVEN]`.

## 7. Identity analysis `[PROVEN]`
Worker binding identity = `sha256(canonicalize({executor, target, accountId, actionId, params, actor, tenantId,
decisionId}))` — **eight** fields, a SUPERSET of the IPC canonical identity `{tenantId, connectorId(=target),
accountId, actionId, params}` (five). BUT the two models differ in ROLE: the IPC sha256 is the **idempotency key**
(dedup/replay by consequential identity); the worker bindingDigest proves **decision→effect correspondence** while
**single-use is keyed on `decisionId`, not the digest** (`executeEngine.ts:149`; test
`executeEngine.durableConsumption.test.ts:57` — "different decision with the same binding is ALLOWED — decisionId is
the key, not the binding"). So a re-decided identical action gets a new decisionId and would execute again — the
worker does NOT suppress by consequential identity the way CST idempotency does. `[PROVEN difference]`

## 8. Admission analysis `[PROVEN]`
Step-5 (`executeEngine.ts:143-186`): `readGovernedClaim` extracts {decisionId, bindingDigest, claimNonce} (it does
NOT verify — that is Boundary-B). Then a SINGLE synchronous section: `consumedDecisions.has(decisionId)` → if present
`finish('already admitted (single-use)')`, else `.add(decisionId)` + stamp session. No `await` between check and
reserve ⇒ concurrent duplicates cannot both reserve (test control 14 / durableConsumption:77 → exactly one). Then it
`await persist(session)` BEFORE the effect; persist failure → rollback (`delete` decisionId/digest/nonce, remove from
`consumedDecisions`) + `finish('Durable admission failed; execution refused')` — no executor, no effect
(control 16 / durableConsumption:85). Store = `ExecutionStore` → `executions.json` via temp-file + `fs.rename`
atomic replace, mode 0600 (`executionStore.ts:186-198`), `persist` returns the store promise so the engine awaits
it (`runtimeCore.ts:2383`).

## 9. Idempotency analysis `[PROVEN]` / `[PROVEN difference]`
Worker: **decisionId single-use** — same decisionId replay denied (durableConsumption:48, control 13); different
decisionId for the SAME binding is ALLOWED (durableConsumption:57). IPC/CST: **canonical-identity idempotency** —
same `{tenant,connector,account,action,params}` suppressed regardless of request/decision (governedAction replay
tests). These are DIFFERENT guarantees: the worker prevents double-admission of one decision; CST prevents
re-execution of one consequential identity. Neither is a superset of the other, but they are not interchangeable.
`[PROVEN — non-equivalent idempotency models]`

## 10. Restart analysis `[PROVEN]`
`consumedDecisions` is an in-memory ledger hydrated at boot by `seedHistory` (`executeEngine.ts:338-349`, before the
history prune) from persisted sessions carrying a `decisionId`; boot recovery `executionStore.loadAllSync()` →
`recoverInterrupted` → `seedHistory` (`runtimeCore.ts:2548-2551`). Replay after restart → denied (control 15 /
durableConsumption:65). Single-process restart durability holds `[PROVEN]`; power-loss/fsync and cross-process
atomicity are NOT proven `[OPEN]` (same limitation as the IPC durable store).

## 11. UNKNOWN analysis `[PROVEN gap]`
The worker effect runs through `M365Executor.execute`, whose catch calls `classify(err)` which handles ONLY
`ActionInputError` and `AuthError`; everything else falls to `err.message` and returns `{ok:false, message}`
(`executor.ts:148-169`) — it does not import or branch on `NetworkError`/`HttpError`. So a `NetworkError`
(transmitted, response lost → should be UNKNOWN/must-not-retry) is **collapsed into a definite `{ok:false}`**, the
same as a real `HttpError` rejection. The certified CST paths deliberately avoid this by calling `action.run` one
layer down: `governedSend`/`governedAction` classify `NetworkError→'unknown'`, `HttpError→'failure'`, unclassifiable
→`'unknown'` (`sendTransition.ts:270-276`, `governedAction.ts:355-361`; header `sendTransition.ts:8-13` states the
executor "swallows the transport's typed error taxonomy … into a generic FAILURE"). **The worker M365 ingress has no
UNKNOWN class and no reconcile→HOLD.** Mitigation: single-use consumption occurs BEFORE the effect, so even an
UNKNOWN-collapsed failure is not retried under the SAME decisionId (no blind same-decision retry); but a new decision
could re-attempt, and a lost-response success is misrepresented as failure. `[PROVEN gap — assurance below CST]`

## 12. Failure analysis `[PROVEN]`
Worker outcomes: no claim → soft-fail (`workforceActionExecutor:34-37`); missing/expired/mismatched claim or
missing actor/tenant → Boundary-B DENY (controls 1/3/5); already-consumed decision → single-use denial
(durableConsumption:48); persist failure → refuse-before-effect (control 16); action.run throws → `{ok:false}`
(NetworkError collapsed, §11); provider ack → `{ok:true}` = ACKNOWLEDGED, never VERIFIED. No path manufactures
`VERIFIED_SUCCESS` `[PROVEN-ABSENT]`. `CONSUMED ≠ EFFECT_SUCCESS` (durableConsumption:98).

## 13. Denial-before-effect analysis `[PROVEN]`
Two independent pre-effect gates: (a) Step-5 durable admission (reserve+persist BEFORE executor; failure refuses),
(b) Boundary-B semantic verification (DENY ⇒ runBinding not called). Enforcement tests: control 1 (no claim →
runBinding=0, effect=0), control 5 (tampered binding target → DENY, runBinding=0), control 3 (expired → DENY),
control 16 (persist-failure → runBinding=0). `[PROVEN]`

## 14. Replay / concurrency analysis `[PROVEN]`
Replay same decision → second effect 0 (control 13 / durableConsumption:48). Concurrent duplicates → exactly one
effect (control 14 / durableConsumption:77; synchronous check→reserve). Restart replay → denied (control 15).
Substitution (decision/action/param/target) → Boundary-B `DECISION_MISMATCH`/`BINDING_MISMATCH` (control 5, digest
recomputation). `[PROVEN]`

## 15. Bypass analysis `[PROVEN]` / `[OPEN, separate ingress]`
- **Worker ingress: no bypass.** `m365Executor.execute` has exactly one worker caller (`runtimeCore.ts:2509` in
  `runBinding`), reachable only through `workforceActionExecutor` (Boundary-B first) and `executeEngine.execute`
  (Step-5 first). No-binding requests soft-fail before Boundary-B. `[PROVEN]`
- **Direct Graph mutation outside the registry: none** (established prior gate; every mutation is a
  `connectors/m365/*` WriteAction). `[PROVEN-ABSENT]`
- **Separate (non-worker) ingress, flagged:** the IPC `M365ActionExecute` fallback `m365.execute(...)`
  (`connectors/index.ts:596`) reaches `M365Executor.execute` WITHOUT Boundary-B/Step-5 — but it is the human/renderer
  path (requires renderer `confirmed`+ownsAccount+scope), and the committed coverage guard proves only read-only
  actions reach it today (no mutating action). It inherits the §11 NetworkError-collapse. This is out of scope for
  the WORKER ingress but is the same executor, and both non-CST executor ingresses share the UNKNOWN gap. `[OPEN]`

## 16. IPC vs Worker comparison matrix
| Property | IPC governedAction | Worker Boundary-B+Step-5 | Evidence | Status |
|---|---|---|---|---|
| authoritative actor | yes (`deps.actor()??''`→DENY) | yes (mint + Boundary-B MISSING_ACTOR) | index.ts:583 / boundaryB.ts:54 | match `[PROVEN]` |
| authoritative tenant | yes (`deps.workspaceId()`) | yes (activeTenantScope + Boundary-B) | index.ts:582 / boundaryB.ts:56 | match `[PROVEN]` |
| account ownership | yes | yes (executor `ownsAccount`) | governedAction.ts:272 / executor.ts:96 | match `[PROVEN]` |
| granted scope | yes | yes (executor scope check) | governedAction.ts:271 / executor.ts:106 | match `[PROVEN]` |
| token availability | yes | yes (executor token) | governedAction.ts:272 / executor.ts:113 | match `[PROVEN]` |
| confirmation | yes (C3 approval) | yes (confirmed:true post-approval) | index.ts:… / router.ts:64 | match `[PROVEN]` |
| decision identity | idempotency key (5-field) | decisionId (=verdict.requestId) | governedAction.ts:253 / boundDecisionClaimMint.ts:83 | different model `[PROVEN]` |
| canonical action identity | 5-field sha256 (idempotency) | 8-field bindingDigest (correspondence) | governedAction.ts:253 / boundDecisionClaim.ts:74 | superset fields, different role `[PROVEN]` |
| exact action binding | via idempotency key | via bindingDigest (re-derived) | — / boundaryB.ts:77 | match `[PROVEN]` |
| admission | CST kernel claim | Step-5 durable reserve | governedAction kernel / executeEngine.ts:143 | different mechanism `[PROVEN]` |
| single-winner | CST atomic claim | synchronous check→reserve | governedAction / executeEngine.ts:149-154 | match (both single-winner) `[PROVEN]` |
| idempotency | canonical-identity replay+reconcile | decisionId single-use | governedAction / durableConsumption:57 | **non-equivalent** `[PROVEN]` |
| restart durability | DurableIdempotencyStore | ExecutionStore + seedHistory | dc9e8f3 / executeEngine.ts:338 | match (single-process) `[PROVEN]` |
| UNKNOWN handling | NetworkError→UNKNOWN→HOLD | collapsed to `{ok:false}` | governedAction.ts:356 / executor.ts:168 | **worker gap** `[PROVEN]` |
| denial-before-effect | yes (effectCalls=0 proven) | yes (Boundary-B + Step-5) | governedAction tests / controls 1/16 | match `[PROVEN]` |
| replay suppression | by idempotency key | by decisionId | governedAction / control 13 | match on decision, differ on identity `[PROVEN]` |
| concurrency | CST single-winner | synchronous reserve | governedAction / control 14 | match `[PROVEN]` |
| failure classification | typed (UNKNOWN/FAILED) | generic string (no UNKNOWN) | governedAction.ts:355 / executor.ts:161 | **worker gap** `[PROVEN]` |
| verification | VERIFIED unreachable (honest) | none (ACK only) | governedAction.ts:277 / executor.ts:147 | match (both no VERIFIED) `[PROVEN-ABSENT]` |
| evidence generation | CST outcome envelope | ExecutionSession + audit + platform events | governedAction / executor.ts:128-146 | different form, both present `[INFERRED-sufficient]` |
| renderer exclusion | yes (actor/tenant main-process) | yes (`.strict()`, main-process mint) | index.ts / executeEngine.ts:64-68 | match `[PROVEN]` |
| provider idempotency | not claimed | not claimed | both | match `[PROVEN-ABSENT]` |
| per-decision policy version | POLICY_VERSION recorded | deliberately excluded | governedAction.ts:68 / boundDecisionClaim.ts:24-29 | different `[PROVEN]` |

## 17. Equivalence verdict — **D. PARTIALLY EQUIVALENT** `[PROVEN]`; full equivalence `[NOT PROVEN]`
The worker ingress shares a strong common core with IPC/CST: authoritative actor/tenant, ownership/scope/token,
confirmation, exact decision→effect binding, denial-before-effect, single-winner admission, single-process restart
durability, replay/concurrency control, renderer exclusion, and honest no-VERIFIED semantics — all `[PROVEN]`. It
DIFFERS materially on three axes: (1) **idempotency model** — decisionId single-use vs canonical-identity
replay/reconcile (a re-decided identical action re-executes on the worker path); (2) **UNKNOWN/failure semantics** —
the executor collapses NetworkError into a definite failure, so the worker has no UNKNOWN class or reconcile→HOLD;
(3) **governance mechanism** — Boundary-B + Step-5 + executor gates, NOT the CST kernel (no PolicyStore verdict, no
ResourceStore pre-state revalidation, no reconciler, no per-decision policy version). Therefore the worker is an
**independently-sufficient admission/binding boundary**, but its assurance is **NOT identical to** the CST path.
**Full IPC↔Worker governance equivalence cannot currently be claimed.**

## 18. Exact supported certification boundary
> "At `ffa2863`, the Worker M365 ingress is single-pathed and governed before effect by a trusted-dispatcher-minted
> Bound Decision Claim, ExecuteEngine Step-5 durable single-use admission (decisionId-keyed, persist-before-effect,
> restart-durable within a single process), Boundary-B exact-binding semantic verification, and the confirmation-
> gated M365 executor with authoritative actor/tenant/ownership/scope/token. It shares a strong common governance
> core with the IPC governedAction/CST path and has no worker-path bypass. It is NOT CST-equivalent: it uses
> decisionId single-use rather than canonical-consequential-identity idempotency, and — because it runs through
> M365Executor.execute — it collapses NetworkError into a definite failure and therefore has no UNKNOWN/reconcile
> outcome. IPC↔Worker governance equivalence is NOT claimed."

## 19. Exact non-claims `[PROVEN-ABSENT]`/`[NOT PROVEN]`
NOT claimed: IPC↔Worker governance equivalence; that the worker path runs the CST kernel; canonical-identity
idempotency on the worker path; UNKNOWN/reconcile semantics on the worker path; provider idempotency; provider
effect success; verification success; cross-process durability; power-loss/fsync durability; universal M365 or
NeuroPause governance; automatic governance of future action types. **IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠
UNIVERSAL. AUTHORITY ≠ DECISION ≠ ADMISSION ≠ EXECUTION ≠ EFFECT ≠ VERIFICATION ≠ CERTIFICATION.**

## 20. Remaining gaps `[OPEN]`
- Worker UNKNOWN/reconcile absence (executor collapses NetworkError) — the primary assurance gap vs CST.
- Worker idempotency is decisionId-scoped, not consequential-identity-scoped.
- Second non-CST executor ingress (IPC `:596` fallback) shares the UNKNOWN collapse (read-only-only today, guarded).
- Cross-process atomicity, power-loss/fsync durability (both ingresses).
- No per-decision policy provenance on the worker path (deliberate).

## 21. Minimum next gate (options; none implemented) `[DESIGN]`
| Option | Files touched | Frozen touched | New claim enabled | Risk / burden |
|---|---|---|---|---|
| **A. Evidence-only parity mapping (RECOMMENDED minimum)** | 1 doc | none | formalizes PARTIAL equivalence + the two gaps; no new equivalence claim | none — smallest, honest |
| B. Additional worker tests (pin current behavior) | new test(s) | none | strengthens existing worker claims (not equivalence) | low |
| C. Boundary-B strengthening (e.g. carry policy provenance) | boundaryB + claim + mint | boundaryB (frozen) | per-decision policy provenance | medium; touches frozen |
| D. CST-adapter integration of the worker ingress (achieves PARITY) | runtimeCore, runBinding/executor path | **runtimeCore (frozen), executor** | IPC↔Worker CST equivalence (UNKNOWN, canonical idempotency) | high; frozen surfaces + identity-model reconciliation (decisionId vs canonical key) |
| E. Shared governance primitive (unify CST + Boundary-B) | broad | many frozen | strongest, uniform | highest; architectural |
| F. Cross-ingress equivalence proof w/o code | 1 doc | none | would CONCLUDE non-equivalence (= A) | none |

**Recommendation `[DESIGN]`:** the smallest source-supported next gate is **Option A** — an evidence-only parity
mapping that formalizes the partial equivalence and the two specific gaps (UNKNOWN collapse; decisionId-vs-canonical
identity) with NO new equivalence claim. Achieving actual PARITY is **Option D** (route the worker M365 effect
through the same governedAction/CST adapter, recovering UNKNOWN + canonical idempotency), which touches FROZEN
surfaces (`runtimeCore.ts`, the executor path) and must reconcile the decisionId-vs-canonical-identity model — a
larger, separately-authorized implement+verify gate, not an immediate step.

## 22. Files a future parity (Option D) gate would touch `[DESIGN]`
`apps/desktop/src/main/runtimeCore.ts` (runBinding m365 branch — FROZEN), the worker→executor effect path
(potentially bypassing `M365Executor.execute` to call `action.run` one layer down like governedSend, or wrapping it
in governedAction), plus new worker-parity tests. Option A/B touch NO production or frozen surface.

## 23. Frozen surfaces that must remain protected `[PROVEN unchanged this gate]`
`@neuropause/cst 1.3.0` + kernel, `durableIdempotencyStore.ts`, `governedAction.ts`, `connectors/index.ts`,
`sendTransition`/governedSend, `mail.ts`, m365 `executor.ts`, `actionSdk.ts`, `boundDecisionClaim(.ts)`/mint,
`ExecuteEngine`/`ExecutionSession`/`ExecutionStore`, `boundaryB.ts`, worker router/runtime, `runtimeCore.ts`,
`contracts.ts`, `storeScope.ts`, `package.json`, Node engine. NEUROPAUSE-FINAL untouched; vendored CST unchanged
(1.3.0). This gate modified none of them — investigation only.

## STOP
Investigation only. HEAD unchanged (`ffa2863`); 0 production/test/frozen changes; exactly one new investigation
document; nothing staged, committed, or pushed; NEUROPAUSE-FINAL untouched.
