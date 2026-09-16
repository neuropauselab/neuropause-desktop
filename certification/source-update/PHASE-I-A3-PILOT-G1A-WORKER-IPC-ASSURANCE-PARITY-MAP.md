# Phase I-A.3 — Pilot Readiness G1-A — Worker / IPC Assurance Parity Map (READ-ONLY)

**READ-ONLY formalization of the completed G1 investigation. No implementation, no refactor, no CST/worker change,
no stage/commit/push.** Baseline HEAD `ffa2863` (parent `d2c9827`), branch `cert/data-import-cst-integration`.
Source basis: actual source + `PHASE-I-A3-H-FINDING-4-WORKER-INGRESS-CST-PARITY-DESIGN-INVESTIGATION.md` (unchanged).
Labels: `[PROVEN]` / `[PROVEN-ABSENT]` / `[INFERRED]` / `[DESIGN]` / `[OPEN]` / `[NOT PROVEN]`.

## 1. Purpose
Formalize the existing evidence into a precise assurance-parity matrix so the pilot team knows exactly what the
Worker path guarantees, what the IPC path guarantees, and where the two intentionally differ. The G1 conclusion
(**Worker↔IPC = PARTIALLY EQUIVALENT; CST equivalence = NOT PROVEN**) is preserved, not re-litigated.

## 2. Baseline `[PROVEN]`
HEAD `ffa2863c29e6c5fac7f4267abb032566c6b12548`, branch `cert/data-import-cst-integration`, working tree clean
(0 tracked/staged), diff-check clean. All 29 mutating M365 IPC actions governed (28 governedAction + mail.send
governedSend) with a committed coverage guard (`ffa2863`).

## 3. IPC path `[PROVEN]`
`M365ActionExecute` (`connectors/index.ts:528`) → `mail.send`→governedSend / cohort→governedAction → **CST kernel**
(authorization, atomic single-winner claim, canonical-identity idempotency+reconcile, pre-state revalidation,
at-most-once effect) → durable idempotency (`DurableIdempotencyStore`) → `action.run` effect. Authoritative
`actorId=deps.actor()??''`(→DENY), `tenantId=deps.workspaceId()`.

## 4. Worker path `[PROVEN]`
Trusted dispatcher `setDispatchApproved` (`workforce/index.ts:222-266`, main-process clock/nonce) → claim mint
(`router.governedRequests` → `mintClaimForApprovedProposal`, fail-closed, `decisionId=verdict.requestId`) →
`ExecuteEngine` **Step-5** durable single-use admission (`executeEngine.ts:143-186`, reserve+persist-before-effect)
→ **Boundary-B** exact 8-field binding verification (`boundaryB.ts`) → `M365Executor.execute` (ownsAccount/confirm/
scope/token) → `action.run` effect. Renderer `ExecuteRunRequest` is `.strict()` — cannot inject claim/actor/tenant/
confirmed.

## 5. Assurance parity matrix
Equivalence labels: EQUIVALENT / PARTIALLY EQUIVALENT / DIFFERENT / NOT PROVEN / NOT APPLICABLE.

| # | Property | IPC status | Worker status | Equivalence | Evidence/source | Certification interpretation |
|---|---|---|---|---|---|---|
| 1 | Identity | canonical 5-field idempotency key | 8-field bindingDigest + decisionId | PARTIALLY EQUIVALENT | governedAction.ts:253 / boundDecisionClaim.ts:74 | both deterministic canonical; different ROLE (dedup key vs correspondence) |
| 2 | Tenant | `deps.workspaceId()` | activeTenantScope + Boundary-B present | EQUIVALENT | index.ts:582 / boundaryB.ts:56 | authoritative both `[PROVEN]` |
| 3 | Actor | `deps.actor()??''`→DENY | mint + Boundary-B MISSING_ACTOR | EQUIVALENT | index.ts:583 / boundaryB.ts:54 | authoritative, no renderer fallback `[PROVEN]` |
| 4 | Account | in identity + owned | in binding + owned | EQUIVALENT | governedAction.ts:253 / executor.ts:96 | `[PROVEN]` |
| 5 | Connector | in identity (connectorId) | in binding (target) | EQUIVALENT | same | `[PROVEN]` |
| 6 | Action | in identity (actionId) | in binding (actionId) | EQUIVALENT | same | `[PROVEN]` |
| 7 | Parameters | in identity (canonical) | in binding (canonical) | EQUIVALENT | same | `[PROVEN]` |
| 8 | Authorization | CST PolicyStore verdict | executor gates + Boundary-B | PARTIALLY EQUIVALENT | governedAction.ts:318 / executor.ts:96-114 | same inputs; different verdict object |
| 9 | Ownership | ownsAccount input | executor ownsAccount | EQUIVALENT | governedAction.ts:272 / executor.ts:96 | `[PROVEN]` |
| 10 | Scope | scopes.every(hasScope) | executor scope check | EQUIVALENT | governedAction.ts:271 / executor.ts:106 | `[PROVEN]` |
| 11 | Token | getToken null→DENY | executor token null→refuse | EQUIVALENT | governedAction.ts:272 / executor.ts:113 | `[PROVEN]` |
| 12 | Confirmation | C3 approval (confirmed) | confirmed:true post-approval | EQUIVALENT | index.ts / router.ts:64 | human approval both `[PROVEN]` |
| 13 | Decision binding | idempotency key ties params | bindingDigest re-derived at Boundary-B | EQUIVALENT | governedAction.ts:253 / boundaryB.ts:77 | exact binding both `[PROVEN]` |
| 14 | Canonical action identity | idempotency key (dedup) | bindingDigest (correspondence, 8-field) | DIFFERENT (role) | governedAction.ts:253 / boundDecisionClaim.ts:74 | superset fields, different function |
| 15 | Single-use | idempotency acquire/complete | decisionId consumedDecisions | PARTIALLY EQUIVALENT | governedAction kernel / executeEngine.ts:149 | both single-use; keyed differently (§7) |
| 16 | Replay protection | by consequential identity | by decisionId | DIFFERENT | governedAction replay tests / durableConsumption:48,57 | worker: re-decision re-executes (§7) |
| 17 | Concurrency | CST atomic single-winner | synchronous check→reserve | EQUIVALENT | governedAction / executeEngine.ts:149-154, control 14 | exactly-one both `[PROVEN]` |
| 18 | Restart durability | DurableIdempotencyStore (single-proc) | ExecutionStore+seedHistory (single-proc) | EQUIVALENT | dc9e8f3 / executeEngine.ts:338, control 15 | single-process both `[PROVEN]` |
| 19 | UNKNOWN handling | NetworkError→UNKNOWN | collapsed to `{ok:false}` | DIFFERENT | governedAction.ts:356 / executor.ts:168 | **worker gap** `[PROVEN]` (§8) |
| 20 | Reconciliation | reconcile→HOLD, no blind retry | none (single-use blocks same-decision retry) | DIFFERENT | governedAction.ts:328 / executor.ts (none) | worker has no reconcile state `[PROVEN]` |
| 21 | Denial-before-effect | effectCalls=0 proven | Boundary-B + Step-5 refuse pre-effect | EQUIVALENT | governedAction tests / controls 1/16 | `[PROVEN]` both |
| 22 | Renderer exclusion | actor/tenant main-process | `.strict()`, main-process mint | EQUIVALENT | index.ts / executeEngine.ts:64-68 | `[PROVEN]` both |
| 23 | Failure classification | typed (UNKNOWN/EXECUTION_FAILED) | generic string | DIFFERENT | governedAction.ts:355 / executor.ts:161 | **worker gap** `[PROVEN]` |
| 24 | Effect boundary | action.run one layer down (at-most-once) | action.run via executor (at-most-once/decision) | PARTIALLY EQUIVALENT | governedAction.ts:351 / executor.ts:134 | both at-most-once; different wrapper |
| 25 | Evidence | CST outcome envelope | ExecutionSession + audit + platform events | PARTIALLY EQUIVALENT | governedAction / executor.ts:128-146 | both generate evidence; different form `[INFERRED-sufficient]` |
| 26 | Verification state | VERIFIED structurally unreachable (honest) | none (ACK only) | EQUIVALENT | governedAction.ts:277 / executor.ts:147 | neither manufactures VERIFIED `[PROVEN-ABSENT]` |
| 27 | Provider idempotency | not claimed | not claimed | EQUIVALENT (both absent) | — | `[PROVEN-ABSENT]` both |
| 28 | Cross-process durability | not proven | not proven | NOT PROVEN | — | `[OPEN]` both |
| 29 | Power-loss/fsync durability | not proven | not proven | NOT PROVEN | — | `[OPEN]` both |

## 6. Common proven controls `[PROVEN]`
authoritative actor · authoritative tenant · account ownership · granted scope · token gate · confirmation · exact
decision-to-effect binding · denial-before-effect · single-winner admission · single-process restart-durable
single-use · replay/concurrency control · renderer exclusion · no manufactured VERIFIED_SUCCESS. These are a strong
common core — **but NOT "CST equivalent"** (the mechanism, idempotency model, and UNKNOWN semantics differ).

## 7. Idempotency difference `[PROVEN]`
IPC/CST identity = `sha256(canonicalize({tenantId, connectorId, accountId, actionId, params}))` used as the
**idempotency key** — the same consequential action is suppressed regardless of how many times it is decided/
requested. Worker = **decisionId-keyed single-use** (`decisionId = verdict.requestId`). Demonstrated property
(`executeEngine.durableConsumption.test.ts:57`): *a different decision with the same binding CAN execute again.*
This is an **architectural semantic difference**, not automatically a bug. Pilot consequence (do not choose without
declared scope):
- If the pilot requires "same consequential action = same admission identity across re-decision" → **Worker does NOT
  currently provide that property.** `[PROVEN-ABSENT]`
- If the pilot requires only "one decision executes once" → **Worker does provide that property.** `[PROVEN]`

## 8. UNKNOWN difference `[PROVEN]`
IPC/CST: `NetworkError → UNKNOWN → HOLD/reconcile` (never blind retry; `governedAction.ts:356`, `sendTransition.ts:
270-276`). Worker: `M365Executor.execute` `classify` handles only `ActionInputError`/`AuthError`; `NetworkError`
collapses into a generic `{ok:false}` (`executor.ts:161-169`) — **no equivalent UNKNOWN/reconcile state.**
Preserve: **UNKNOWN ≠ FAILURE ≠ SUCCESS.** Pilot implication: when the external Graph outcome cannot be established
(lost response), the Worker path currently presents it to the operator as a definite failure. The assurance model
must specify what the operator sees and does in that case (see §16). Mitigation already present: single-use consumes
the decisionId BEFORE the effect, so an UNKNOWN-collapsed outcome is **not** blindly retried under the same
decision `[PROVEN]`; a re-decision could re-attempt `[PROVEN]`.

## 9. Failure semantics `[PROVEN]`
Worker terminal states: soft-fail (no binding) · Boundary-B DENY (missing/expired/mismatch/missing actor|tenant) ·
single-use denial (already-consumed) · refuse-before-effect (persist failure) · `{ok:false}` (action.run throw,
NetworkError collapsed) · `{ok:true}` = ACKNOWLEDGED (provider ack, never VERIFIED). `CONSUMED ≠ EFFECT_SUCCESS`
(`durableConsumption:98`). No `VERIFIED_SUCCESS` manufactured `[PROVEN-ABSENT]`.

## 10. Evidence comparison `[INFERRED-sufficient]`
IPC: CST `TransitionOutcome` envelope. Worker: `ExecutionSession` (persisted to `executions.json`, tenant-owned) +
audited platform-event fan-out (Timeline/Audit/Diagnostics/Executive Center) + connector activity (`executor.ts:
128-146`). Both generate durable evidence; forms differ. Equivalence of evidentiary completeness is NOT formally
proven — `[INFERRED-sufficient for admission/outcome recording]`, not certified equal.

## 11. Verification comparison `[PROVEN-ABSENT both]`
Neither path establishes external effect verification: IPC models VERIFIED as structurally unreachable (Profile A,
no read-back); Worker records provider ACK only. Both are honest ACK-not-VERIFIED. Equivalent in the sense that
**neither claims verification.**

## 12. Durability comparison `[PROVEN]`/`[OPEN]`
Single-process restart durability: both proven (IPC DurableIdempotencyStore; Worker ExecutionStore temp-file+rename
atomic + seedHistory hydration). Cross-process atomicity and power-loss/fsync durability: **NOT proven for either**
`[OPEN]`.

## 13. Renderer boundary `[PROVEN]`
Both exclude the renderer from supplying authority: IPC takes actor/tenant from main-process deps; Worker mints
claim + actor/tenant in the main process and the renderer request schema is `.strict()` (no params/claim/confirmed).
EQUIVALENT.

## 14. Effect boundary `[PROVEN]`
Both invoke the same registry `action.run` (the pure Graph write) at-most-once. IPC calls it directly inside the CST
kernel effect (preserving typed errors); Worker calls it through `M365Executor.execute` (which collapses typed
errors — §8). Same effect surface; different error-preservation at the boundary.

## 15. Pilot implications
The Worker path is **governed before effect** with a strong common core; its two material deviations from CST are
(a) decisionId (not canonical-identity) single-use and (b) no UNKNOWN/reconcile state. Neither is a data-integrity
hole in itself: denial-before-effect + single-use + restart durability hold. The deviations shape **operator-facing
semantics** (what "already done" and "ambiguous outcome" mean), which a bounded pilot can absorb via declared
operating constraints (§16) rather than code change — provided the pilot's acceptance criteria do not require the
CST-specific properties.

## 16. Pilot conditions (each marked EXISTS / NOT PROVEN / REQUIRED / OPEN)
| Condition | Status | Basis |
|---|---|---|
| Worker actions limited to approved workflows | **EXISTS** `[PROVEN]` | mint requires `approval.decision==='approved'`; confirmed:true only post-approval |
| One decision = one execution | **EXISTS** `[PROVEN]` | Step-5 single-use + restart (controls 13/15, durableConsumption:48) |
| No blind retry after ambiguous outcome | **EXISTS (same-decision)** `[PROVEN]` | decisionId consumed before effect ⇒ no same-decision retry; re-decision could re-attempt `[OPEN]` |
| Operator-visible failure state | **NOT PROVEN / REQUIRED** | UNKNOWN collapses to generic failure; operator sees `{ok:false}` message but not an UNKNOWN class (§8) |
| Explicit manual reconciliation procedure | **REQUIRED (OPEN)** | no automated reconcile on worker path; a documented manual procedure must exist for lost-response cases |
| Controlled restart procedure | **EXISTS (single-process)** `[PROVEN]` | seedHistory hydration; cross-process/power-loss `[OPEN]` |
| Bounded pilot machine (single process) | **REQUIRED** | durability proven only single-process; multi-instance NOT proven |
| Bounded account/tenant | **REQUIRED** | limits blast radius; not enforced by code, an operating constraint |
| Evidence capture | **EXISTS** `[PROVEN]` (form differs) | ExecutionSession + audit + platform events (§10) |

## 17. Open risks (each classified)
| Risk | Classification | Rationale |
|---|---|---|
| decisionId vs canonical identity | **PILOT-CONDITIONAL** | acceptable if pilot semantics = "one decision once"; blocking only if pilot requires canonical-identity idempotency |
| UNKNOWN vs generic failure | **PILOT-CONDITIONAL** | acceptable with operator-visible failure + manual reconciliation; single-use prevents blind same-decision retry |
| evidence differences | **CONTROLLED** | both durable + audited; form differs, completeness inferred-sufficient |
| verification differences | **CONTROLLED** | neither claims VERIFIED; symmetric, honest |
| cross-process durability | **OPEN (pilot-bounded)** | mitigated by single-process pilot constraint |
| power-loss/fsync durability | **OPEN (pilot-bounded)** | mitigated by controlled restart + manual reconciliation |

No difference is **PILOT-BLOCKING** on its own given the proven controls; two are **PILOT-CONDITIONAL** on the
declared scope + operating constraints.

## 18. Non-claims `[PROVEN-ABSENT]`/`[NOT PROVEN]`
NOT claimed: IPC↔Worker CST equivalence; canonical-identity idempotency on the worker path; UNKNOWN/reconcile on the
worker path; provider idempotency; provider effect success; verification success; cross-process durability; power-
loss/fsync durability; universal M365/NeuroPause governance; automatic governance of future action types; that the
worker evidence model is formally equal to CST. **IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠ UNIVERSAL. AUTHORITY ≠
DECISION ≠ ADMISSION ≠ EXECUTION ≠ EFFECT ≠ VERIFICATION ≠ CERTIFICATION.**

## 19. Final determination
Preserved G1 conclusion: **Worker ↔ IPC = PARTIALLY EQUIVALENT; CST parity = NOT PROVEN** (not upgraded).

Bounded-pilot question — *Can the Worker path be accepted for a BOUNDED pilot without changing it?*
**A. YES — with explicitly documented operating constraints**, **conditional on the declared pilot scope**. No
proven property is pilot-blocking on its own: the worker path is governed before effect with authoritative identity,
denial-before-effect, single-use, and single-process restart durability. The two material differences are
**PILOT-CONDITIONAL**, acceptable under the §16 constraints — specifically: (i) the pilot accepts "one decision =
one execution" semantics (not canonical-identity idempotency across re-decision); (ii) an operator-visible failure
state + a documented **manual reconciliation** procedure exist for ambiguous (lost-response) outcomes; (iii) the
pilot runs single-process on a bounded machine/account/tenant.
**This flips to "NOT YET / deferred to parity work (Option D)" IF the declared pilot scope requires canonical-
identity idempotency or automated UNKNOWN reconciliation** — those are the only conditions under which a difference
becomes blocking. Because the pilot's formal acceptance criteria are not declared in this gate, the YES is
**conditional**: valid under the stated constraints; re-evaluate if the declared scope demands the CST-specific
properties.

## 20. Recommended next gate `[DESIGN]`
- **If the pilot accepts the §16/§19 constraints:** proceed with a **pilot operating-constraints declaration**
  (documentation only — enumerate the required operator procedures: manual reconciliation, single-process
  restart, bounded account/tenant, operator-visible failure handling). No code change.
- **If the pilot requires CST-specific properties:** a separately-authorized **Option D parity implementation gate**
  (route the worker M365 effect through the governedAction/CST adapter to recover UNKNOWN + canonical idempotency) —
  touches FROZEN `runtimeCore.ts`/executor path and must reconcile the decisionId-vs-canonical identity model.
**DO NOT IMPLEMENT WORKER PARITY in this gate.** Await separate explicit authorization.

## STOP
Parity map only. HEAD unchanged (`ffa2863`); 0 production/test/frozen changes; exactly one new document; nothing
staged, committed, or pushed; the prior G1 investigation was not modified.
