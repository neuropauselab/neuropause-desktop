# Phase I-A.3 — Pilot Readiness G1-B — Bounded Pilot Operating-Constraints Declaration (READ-ONLY)

**READ-ONLY documentation gate. No production/test/worker/CST/runtime/durability change; no commit/push.**
Baseline HEAD `ffa2863` (parent `d2c9827`), branch `cert/data-import-cst-integration`.
Source basis: `PHASE-I-A3-H-FINDING-4-WORKER-INGRESS-CST-PARITY-DESIGN-INVESTIGATION.md` and
`PHASE-I-A3-PILOT-G1A-WORKER-IPC-ASSURANCE-PARITY-MAP.md` (both unchanged).
Labels: `[PROVEN]` / `[PROVEN-ABSENT]` / `[INFERRED]` / `[DESIGN]` / `[OPEN]` / `[NOT PROVEN]`.
This gate does NOT strengthen any prior conclusion.

## 1. Purpose
Define exactly what a bounded pilot of the Worker M365 ingress is allowed to claim, and exactly how operators must
behave where current Worker semantics differ from CST semantics. It converts the G1/G1-A evidence into operating
constraints — it adds no runtime enforcement and no new Worker guarantee.

## 2. Certified baseline `[PROVEN]`
HEAD `ffa2863c29e6c5fac7f4267abb032566c6b12548`. All 29 mutating M365 IPC actions governed (28 governedAction +
mail.send governedSend) with a committed coverage-regression guard. Working tree clean; no change in this gate.
**CERTIFIED BUILD ≠ PILOT-VALIDATED SYSTEM.**

## 3. G1 conclusion (preserved) `[PROVEN]`
Worker ↔ IPC = **PARTIALLY EQUIVALENT**; CST equivalence = **NOT PROVEN**. Worker HAS: authoritative actor,
authoritative tenant, account ownership, scope, token gate, confirmation, exact decision/effect binding, Boundary-B,
Step-5 durable single-use admission, restart durability (single-process), concurrency control, renderer exclusion,
denial-before-effect, no manufactured VERIFIED_SUCCESS. Worker does NOT currently provide proven CST-equivalent:
canonical consequential-action idempotency, UNKNOWN→reconcile semantics, CST kernel execution path, cross-process
durability, power-loss/fsync durability.

## 4. G1-A conclusion (preserved) `[PROVEN]`
Bounded pilot = **YES, CONDITIONAL** on explicit operating constraints. Two material differences are
**PILOT-CONDITIONAL** (decisionId-vs-canonical identity; UNKNOWN-vs-generic-failure); none is pilot-blocking on its
own given the proven controls.

## 5. Pilot boundary
The pilot is **BOUNDED · CONTROLLED · DECLARED · EVIDENCE-GENERATING**. It is NOT: universal ·
production-equivalent · CST-equivalent · fully verified · provider-idempotent · universally governed.
**PILOT VALIDATION ≠ UNIVERSAL ASSURANCE.**

## 6. Allowed workflows `[DESIGN]`/`[REQUIRED]`
Only explicitly declared pilot workflows execute through Worker. Any undeclared/unknown workflow → **HOLD / DO NOT
EXECUTE**. The declared workflow list is a pilot-operating artifact (must be produced before pilot start) —
`[REQUIRED]`. Governance already refuses actions lacking approval/claim/binding `[PROVEN]`, but the *pilot allow-list*
itself is an operating declaration, not code — `[OPEN until declared]`.

## 7. Worker operating constraints (summary)
| # | Constraint | Basis | Status |
|---|---|---|---|
| 1 | Approved workflows only | approval-gated mint; confirmed:true post-approval | `[PROVEN]` mechanism; allow-list `[REQUIRED]` |
| 2 | One decision = one execution | Step-5 single-use + restart | `[PROVEN]` (decisionId-scoped, §8) |
| 3 | No blind retry | single-use blocks same-decision retry | `[PROVEN]` same-decision; re-decision `[OPEN]` |
| 4 | UNKNOWN / lost-response procedure | executor collapses NetworkError | `[REQUIRED]` operator procedure (§9/§10) |
| 5 | Bounded (single-process) machine | durability proven single-process only | `[REQUIRED]` operating constraint |
| 6 | Bounded account / tenant | limits blast radius | `[REQUIRED]` operating declaration |
| 7 | Operator visibility (lifecycle states) | see §14 | `[REQUIRED / OPEN]` if UI lacks states |
| 8 | Manual reconciliation | no automated reconcile on worker path | `[REQUIRED]` operator procedure (§10) |
| 9 | Evidence preservation | ExecutionSession + audit + platform events | `[PROVEN]` partial; gaps `[OPEN]` (§13) |

## 8. Idempotency constraint `[PROVEN]`
Worker single-use is **decisionId-based** (`decisionId = verdict.requestId`). Therefore: same decision → cannot
execute twice `[PROVEN]`; a **new decision + same consequential action → MAY execute again** `[PROVEN]`
(`durableConsumption:57`). **The pilot must NOT claim canonical consequential-identity idempotency for Worker.** The
pilot's semantic contract is "one decision = one execution", not "one consequential action = one admission identity."

## 9. Unknown-outcome constraint `[PROVEN gap → REQUIRED procedure]`
Because `M365Executor.execute` collapses `NetworkError` into a generic failure (`executor.ts:161-169`), define an
operational state **OUTCOME UNCERTAIN**. It MUST NOT be represented as SUCCESS. Required operator sequence:
`OUTCOME UNCERTAIN → HOLD → DO NOT BLIND RETRY → INVESTIGATE/RECONCILE → DETERMINE EXTERNAL STATE → ONLY THEN DECIDE
NEXT ACTION`. **No automated reconciliation is claimed** — `OUTCOME UNCERTAIN` is an operator-facing pilot state, not
a Worker runtime state (the runtime currently emits a generic failure). Marked `[REQUIRED / OPEN]` until the pilot UI/
runbook surfaces it.

## 10. Manual reconciliation `[REQUIRED procedure]`
For an uncertain external result, the operator MUST: (1) stop automatic retry; (2) record the `decisionId`;
(3) record action/account/tenant; (4) record time + failure state; (5) determine whether the external provider
changed state (out-of-band, e.g. Graph read); (6) record the observed external state; (7) only after reconciliation
determine the next **governed** decision. **No blind retry.** This procedure is documentation, not code.

## 11. Restart constraint `[PROVEN single-process]`/`[OPEN]`
Pilot Worker execution occurs in a declared **single-process** environment. Single-process restart durability is
proven (seedHistory hydration; controls 15). The pilot must NOT claim cross-process atomicity, multi-instance
single-winner, power-loss durability, or fsync durability — `[NOT PROVEN]`. A controlled-restart procedure (verify
`consumedDecisions` hydrated before resuming consequential actions) is `[REQUIRED]`.

## 12. Tenant / account constraint `[PROVEN isolation]`/`[REQUIRED declaration]`
Tenant isolation and account ownership are enforced (`[PROVEN]`). The pilot must additionally DECLARE the specific
tenant, account(s), and authorized operator/actor and keep the scope explicitly bounded (`[REQUIRED]`).

## 13. Evidence requirements
For each pilot consequential action, retain where available: request · tenant · actor · account · action · parameters
· decisionId · approval · admission · execution state · failure state · external observation · reconciliation result
· operator decision. Currently produced `[PROVEN]`: request/tenant/actor/account/action/params (in binding),
decisionId, approval (dispatcher), admission (ExecutionSession), execution + failure state (session), audit/platform
events. Currently NOT produced by the runtime `[OPEN]`: **external observation**, **reconciliation result**, and the
explicit **operator decision** — these are pilot-operator artifacts (manual capture), not runtime fields. Do not
claim these fields exist in the runtime.

## 14. Operator lifecycle `[REQUIRED / OPEN]`
Every Worker action should carry an operator-visible lifecycle state, at minimum: `REQUESTED · APPROVED · ADMITTED ·
EXECUTION_STARTED · COMPLETED · FAILED · OUTCOME_UNCERTAIN · HELD · RECONCILIATION_REQUIRED`. The runtime today emits
session states (started/completed/failed) + platform events + single-use denial + Boundary-B denies; it does **not**
emit a distinct `OUTCOME_UNCERTAIN` / `RECONCILIATION_REQUIRED` state (NetworkError collapses to FAILED). Therefore
the full lifecycle is `[REQUIRED / OPEN]` for the pilot surface — **not implemented in this gate**; if the current UI
does not distinguish these, the pilot must supply them operationally (runbook + manual tracking). Non-success states
MUST NOT be collapsed into SUCCESS.

## 15. Failure model `[DESIGN]`
```
                         REQUEST
                            │
                            ▼
                          GOVERN
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
            DENY          HOLD          ADMIT
                                         │
                                         ▼
                                       EXECUTE
                                         │
                        ┌────────────────┼────────────────┐
                        ▼                ▼                ▼
                     SUCCESS           FAILED          UNCERTAIN
                        │                │                │
                        ▼                │                ▼
                    OBSERVE*             │              HOLD
                        │                │                │
                        ▼                │                ▼
                    VERIFY* (none)       │            RECONCILE (manual)
                        │                │                │
                        ▼                ▼                ▼
                    EVIDENCE          EVIDENCE       DECISION → EVIDENCE
```
`* OBSERVE/VERIFY are NOT provided by the Worker runtime (no read-back oracle) — ACK only.` Invariants:
**UNCERTAIN ≠ FAILED**, **UNCERTAIN ≠ SUCCESS.** On the current runtime, `UNCERTAIN` is an operator classification of
a runtime `FAILED` whose cause was a lost response — the pilot procedure (§9/§10) reclassifies and holds.

## 16. Stop / HOLD conditions `[DESIGN]`
| Condition | Disposition | Basis |
|---|---|---|
| unknown tenant / actor / account | **DENY** | Boundary-B MISSING_ACTOR/TENANT; executor ownsAccount |
| invalid / missing approval | **DENY** | mint requires approved decision |
| missing decision binding | **DENY / soft-fail** | no-binding soft-fail; Boundary-B BINDING_MISMATCH |
| unexpected / undeclared action | **HOLD** | pilot allow-list (operating) |
| duplicate decision | **DENY (single-use)** | Step-5 consumedDecisions |
| ambiguous external outcome | **HOLD → RECONCILE** | §9/§10 (no blind retry) |
| corrupted local state / persistence failure | **STOP / refuse-before-effect** | Step-5 persist-failure refuses (control 16) |
| connector unavailable / auth failure | **DENY / HOLD** | executor token/AuthError |
| unexpected provider response | **HOLD → RECONCILE** | classify + operator review |
| evidence cannot be reconstructed | **ESCALATE / STOP** | operator judgement |
| operator cannot determine external state | **HOLD / ESCALATE** | do not manufacture verification |
Not every condition is a permanent failure: DENY/HOLD/ESCALATE/RECONCILE/STOP per the evidence.

## 17. Pilot acceptance matrix
| Property | Current state | Pilot requirement | Status |
|---|---|---|---|
| governance | Boundary-B + Step-5 + executor | governed before effect | **PROVEN** |
| authorization | executor gates + approval | authoritative | **PROVEN** |
| confirmation | confirmed:true post-approval | human approval | **PROVEN** |
| decision binding | 8-field bindingDigest re-derived | exact binding | **PROVEN** |
| single-use | decisionId consumedDecisions | one decision once | **PROVEN** |
| replay | decisionId-keyed | same decision blocked | **PROVEN** (decision-scoped) |
| concurrency | synchronous reserve | exactly one | **PROVEN** |
| restart | seedHistory (single-proc) | single-process durable | **PROVEN** (single-proc) |
| UNKNOWN handling | collapsed to failure | operator OUTCOME_UNCERTAIN + HOLD | **REQUIRED / OPEN** |
| reconciliation | none automated | manual procedure | **REQUIRED** |
| denial-before-effect | Boundary-B + Step-5 | no effect on deny | **PROVEN** |
| evidence | session + audit + events (partial) | preserve pilot fields | **PROVEN** partial; **OPEN** (external obs/reconcile/decision) |
| operator visibility | started/completed/failed | full lifecycle incl. UNCERTAIN/HELD | **REQUIRED / OPEN** |
| tenant isolation | enforced | bounded declared tenant | **PROVEN** + **REQUIRED** declaration |
| account isolation | ownsAccount | bounded declared account | **PROVEN** + **REQUIRED** declaration |
| renderer exclusion | `.strict()` + main-process mint | no renderer authority | **PROVEN** |
| cross-process durability | not proven | single-process bound | **NOT CLAIMED / OPEN** |
| power-loss durability | not proven | controlled restart | **NOT CLAIMED / OPEN** |
| provider idempotency | not provided | not required (one-decision-once) | **PROVEN-ABSENT / NOT CLAIMED** |
| effect success | ACK only | not claimed | **PROVEN-ABSENT** |
| verification success | none | not claimed | **PROVEN-ABSENT** |
OPEN is never converted to PASS.

## 18. Pilot non-claims `[PROVEN-ABSENT]`/`[NOT PROVEN]`
No claim of: Worker/CST equivalence · canonical Worker idempotency · automatic UNKNOWN reconciliation · provider
idempotency · provider reversibility · Graph effect success · verification success · cross-process durability ·
power-loss/fsync durability · universal M365 governance · universal NeuroPause governance. Preserve:
**IMPLEMENTED ≠ VERIFIED · VERIFIED ≠ CERTIFIED · CERTIFIED ≠ PILOT-VALIDATED · PILOT-VALIDATED ≠ UNIVERSAL.**

## 19. Open requirements (must be satisfied operationally before/at pilot start)
1. `[REQUIRED]` Declared pilot workflow allow-list.
2. `[REQUIRED/OPEN]` Operator-visible `OUTCOME_UNCERTAIN` / `RECONCILIATION_REQUIRED` states (runtime emits FAILED
   today).
3. `[REQUIRED]` Written manual reconciliation runbook (§10).
4. `[REQUIRED]` Declared single-process pilot environment + controlled-restart procedure.
5. `[REQUIRED]` Declared bounded tenant/account/operator.
6. `[OPEN]` Evidence capture for external observation / reconciliation result / operator decision (not runtime
   fields).
None of these require code changes; all are pilot-operating declarations/procedures.

## 20. Pilot readiness interpretation — final determination
*Can the current Worker architecture participate in a bounded pilot?* **YES — CONDITIONAL** (G1-A conclusion,
NOT upgraded). It is conditional on the eight primary constraints:
1. approved workflows only · 2. one decision = one execution · 3. no blind retry · 4. manual reconciliation for
uncertain outcomes · 5. bounded single-process environment · 6. bounded tenant/account · 7. operator-visible
failure/hold state · 8. evidence preservation.
Constraints 1–3, 5(single-process durability), 6(isolation) rest on **PROVEN** controls; constraints 4, 7, and the
external-observation portion of 8 are **REQUIRED/OPEN operator procedures** the pilot must supply (they do not exist
as runtime features and are not implemented in this gate). If any REQUIRED/OPEN item cannot be satisfied by the pilot
environment, it is a genuine gap — not to be treated as satisfied.

## 21. Next gate `[DESIGN]`
**G2 — Runtime Readiness** (separately authorized): assess whether the runtime/UI can surface the required lifecycle
states (`OUTCOME_UNCERTAIN`/`RECONCILIATION_REQUIRED`) and evidence fields, or whether the pilot proceeds purely on
operator procedure. Do NOT implement Worker parity or lifecycle states in any gate without explicit authorization.

## STOP
Documentation only. HEAD unchanged (`ffa2863`); 0 production/test/frozen changes; exactly one new document; prior
G1/G1-A documents unchanged; nothing staged, committed, or pushed.
