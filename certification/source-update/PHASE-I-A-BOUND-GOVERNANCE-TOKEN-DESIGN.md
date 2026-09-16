# Phase I-A — Bound Governance Token Design

## 1. Status

**DESIGN / ANALYSIS ONLY.** No implementation. No commit of code. No test changes.
No universal-governance claim. Kernel, `executor.ts`, `mail.ts`, Data Import and the
Phase H reference are untouched. This artifact ends in a decision gate.

**Verdict (see §27): BLOCK** — Option 2 is architecturally realizable with *existing*
primitives, but a hard prerequisite is unmet: **Boundary A does not currently bind an
authoritative actor** (the approver is the literal `'user'`). *Option 2 cannot be
safely realized until the approval authority is strengthened.* This is not solved by
inventing or defaulting an identity.

## 2. Trigger

- **H-FINDING-3** — `mail.send` is governed at the `M365ActionExecute` IPC ingress but
  reachable un-governed via the worker-approval path (`runBinding` `'m365'`).
- **I-FINDING-1** — the worker path carries the *effect* (`ExecutionBinding`) and the
  *approval* (`confirmed:true`) but **strips the authoritative actor/purpose/context**.

The worker is an **execution context, not an authority context**. Reconstructing the
original actor at `runBinding` would push semantic responsibility into a layer that
provably lacks it — violating the frozen Phase-I §30 principle. Option 2 avoids
transporting semantic context; it transports a **bound decision**.

## 3. Selected Direction

**OPTION 2 — BOUND GOVERNANCE TOKEN.** Boundary A (where authority exists) mints a
decision artifact bound to the exact consequential effect; Boundary B verifies it
before the effect. Selected because it keeps authority where the context lives and
makes Boundary B a *verifier*, not a *decider*. **Not implemented** — this is design.

## 4. Architectural Objective

- **Boundary A — admission governance.** Rich authoritative context (actor, purpose,
  policy, verdict, approval). Decides *should this happen?* Mints the bound decision.
- **Boundary B — consequential-effect enforcement.** Close to the effect. Enforces
  *no valid, matching governance decision ⇒ no consequential effect.* It verifies
  integrity + binding + scope + validity; it does **not** reconstruct the actor.

Invariant: `NO REQUIRED GOVERNANCE STATE ⇒ NO CONSEQUENTIAL EFFECT.`

### DIAGRAM 1
```
            AUTHORITATIVE APPROVAL
                     |
                     v
              GOVERNANCE DECISION
                     |
                     v
            BOUND GOVERNANCE TOKEN
                     |
                     v
              EXECUTION BINDING
                     |
                     v
              WORKER / runBinding
                     |
                     v
              TOKEN VERIFICATION
                     |
                +----+----+
                |         |
              VALID     INVALID
                |         |
                v         v
              EFFECT     DENY
```

## 5. Current Worker-Path Trace (grounded)

```
IPC WorkforceProposalApprove  (workforce/index.ts:371-376; requireAuth + 'workforce:approve'
     via withWorkforceAuthz, authzGate.ts:86-96)
  → runtime.approveProposal(jobId, proposalId, 'user', note, r.now)   [approver = literal 'user']
  → proposal.approval = { decision, decidedBy:'user', decidedAt } (workerRuntime.ts:246)
  → setDispatchApproved(job, proposals) (workforce/index.ts:183)
  → bindingToRequest(job, proposal) (workforce/execution/router.ts:31-42)
        ⇒ { kind, targetId:job.id, params:{binding,jobId,proposalId}, confirmed:TRUE, correlationId }
  → executeEngine.execute(req) (executeEngine.ts:77; stamps tenantId ONLY, :107)
  → 'connector' executor → runBinding(binding, confirmed) (runtimeCore.ts:2482)
  → case 'm365' → connectors.m365Executor.execute(target, accountId, actionId, params, confirmed) (runtimeCore.ts:2498)
  → M365Executor.execute → pure Graph send (mail.ts:49)   [EFFECT]
```

`ExecutionBinding` = `{ executor, target, accountId, actionId, params }`
(`workforceJobs.ts:39`). Secure bridge passes payload only, no principal
(`secureBridge.ts:143-166`).

## 6. Authoritative Context Inventory

| Field | At A? | At B? | Authoritative? | Required at B? | Source |
|---|---|---|---|---|---|
| actor / principal | **NO** (`'user'`) | no | **NO today** | yes (bound) | `authService` exists but unthreaded |
| purpose | partial (job/proposal) | no | weak | in token | job/proposal |
| intent | partial | no | weak | optional | job |
| relationship | no | no | no | optional | — |
| tenant | yes (engine) | yes | yes | yes | `executeEngine` tenantId (:107) |
| workspace | yes | yes | yes | (≠ actor) | workspaceStore |
| target | yes | yes | yes | yes | `ExecutionBinding.target` |
| account | yes | yes | yes | yes | `binding.accountId` |
| capability/executor | yes | yes | yes | yes | `binding.executor` |
| action | yes | yes | yes | yes | `binding.actionId` |
| params | yes | yes | yes (but non-canonical) | yes (committed) | `binding.params` |
| approval verdict | yes | no | yes (machine) | in token | `GovernanceVerdict` (workforceGovernance.ts:92) |
| human approval | yes (`'user'`) | no | **NO** (role marker) | in token | `proposal.approval` (workerRuntime.ts:246) |
| policy / version | partial | no | partial | in token | `GovernanceVerdict` |
| risk | yes | no | yes | optional | `GovernanceVerdict.risk` |
| correlationId | yes | yes | yes | optional | `job.correlationId` |
| causationId | **absent** | absent | — | optional | DOES NOT EXIST |
| issuance time | renderer `r.now` | — | **NO** (renderer-supplied) | yes (authoritative) | must use main-process clock |
| expiry | — | — | — | yes | pattern exists (`APPROVAL_TTL_MS`) |

### DIAGRAM 2
```
Semantic Context (actor/purpose/relationship/authority)
        |
        v
    Boundary A  --tokenized decision-->  Worker Path  -->  Boundary B  --verify-->  Consequential Effect
```

## 7. I-FINDING-1 (why a naive wrapper violates §30)

At `runBinding` there is **no authoritative actor** — only tenant + `confirmed:true` +
effect params. A naive `runBinding → governedSend` wrap would be forced to (1)
fabricate identity, (2) use session/fallback identity, (3) reuse tenant as actor, or
(4) DENY every worker send. All four are prohibited (§28/§30). Governance must not be
moved to a boundary lacking the authoritative context; Option 2 moves the *decision*
to Boundary A and only the *verification* to Boundary B.

## 8. Boundary A Definition

**Location:** the workforce proposal-approval seam —
`WorkforceProposalApprove` handler (`workforce/index.ts:371-376`) →
`runtime.approveProposal` → `proposal.approval` (`workerRuntime.ts:246`), with the
machine decision in `GovernanceVerdict` (`workforceGovernance.ts:92`). It is
`requireAuth` + `workforce:approve`-gated (`authzGate.ts:86-96`).

**Deficiency:** it possesses a permission gate and tenant scope but **binds no
authoritative principal** — `decidedBy = 'user'`, and issuance time is renderer
`r.now`. The authoritative identity (`authService.getStatus().session.user`, used on
the CST path at `runtimeCore.ts:480,778`) is **not threaded here** because the secure
bridge hands handlers the payload only (`secureBridge.ts:143-166`). Therefore Boundary
A, *as coded today*, cannot mint an actor-bound decision.

## 9. Governance Decision Object (conceptual)

Keep three concerns distinct:
- **Decision** — the machine `GovernanceVerdict` (allow/deny/require_approval + risk +
  policy) — already exists (`workforceGovernance.ts:92`).
- **Authorization** — the *authoritative approval* (who, on whose behalf) — currently
  `'user'` (deficient).
- **Evidence** — an append-only record (the `AuditChain`, `auditChain.ts`) — exists
  (tamper-evident, unsigned).

The bound token is the **binding of Decision + Authorization to the exact effect**,
not a new authority. (No implementation code here.)

## 10. Token Semantics

> **The token is evidence of a prior governance decision made at Boundary A. It is
> NOT an independent source of authority.** A worker holding it cannot invent or
> elevate authority; it can only *attempt* the exact effect the decision already
> authorized. Absence/invalidity ⇒ no effect.

## 11. Token Binding — evaluation

| Candidate | Verdict | Why |
|---|---|---|
| A. capability `mail.send` | **REJECT** | authorizes *any* send — retarget/param-substitution trivial |
| B. requestId | **REJECT** | opaque id; doesn't constrain target/params |
| C. actionId | **REJECT** | `mail.send` for any recipient — too broad |
| D. ExecutionBinding identity (id) | **WEAK** | only safe if the binding is immutable & content-addressed; a mutable id can be repointed |
| E. canonical digest/commitment of the complete binding | **STRONG** | binds executor+target+account+action+canonical(params); any change → different digest |
| F. E **+** actor + tenant + policy/version + decisionId | **STRONGEST / SELECT** | narrowest: cannot cross action/target/params/tenant/actor/policy |

**Select F** built on **E** (canonical binding digest) — the narrowest enforceable
binding.

## 12. Token Contents

| Field | Purpose | Authoritative source | Required? | Verified at B | Replay protection |
|---|---|---|---|---|---|
| decisionId | ties to the Boundary-A decision | `GovernanceVerdict`/approval | REQUIRED | integrity | via consumption |
| bindingDigest | canonical hash of {executor,target,account,action,canonical(params)} | Boundary A over `ExecutionBinding` | REQUIRED | recompute + compare | — |
| actor | principal the decision was made for | **authService (NOT AVAILABLE at seam today)** | REQUIRED | integrity only | — |
| tenantId | tenant scope | `executeEngine` tenant | REQUIRED | equals runtime tenant | — |
| capability/action | defense-in-depth vs digest | binding | REQUIRED | equals binding | — |
| policyVersion | decision provenance | `GovernanceVerdict` | REQUIRED | integrity | — |
| issuedAt | validity start | **authoritative main-process clock (NOT r.now)** | REQUIRED | integrity | window |
| expiresAt | validity end | Boundary A (issuedAt+TTL) | REQUIRED | now ≤ expiresAt | window |
| nonce / jti | single-use id | Boundary A | REQUIRED | consumption store | consume-once |
| correlationId | trace | `job.correlationId` | OPTIONAL | — | — |
| integrity (sig/mac) | unforgeability | Ed25519/HMAC (see §13) | REQUIRED (if serialized/persisted) | verify | — |

Classification: `actor`, `issuedAt` → **NOT AUTHORITATIVE / NOT AVAILABLE today**
(the two blockers). All others → available/derivable.

## 13. Integrity Mechanism

**Existing, reusable — no new crypto required:**
- **Ed25519 detached signatures** — `nps/signature.ts` (`sign`/`verify`/trust store),
  with a **first-party local keypair already wired** (`workforce/install/signingKey.ts`,
  `packaging.ts:35` signs a canonical digest). Directly reusable to sign a canonical
  token.
- **HMAC-SHA256** — `webhooks/signing.ts` (`createHmac` + `timingSafeEqual`,
  replay-windowed). Alternative for a symmetric in-process MAC.
- **Canonical serialization** — `packaging.ts` `canonicalize`/`sortKeys`.

**Important trust-model caveat (determines whether crypto is even required):** the
worker path is **in-process** (main process). Two sub-cases:
- *Same-session, by-reference dispatch* → a **capability-style in-memory decision
  object** (module-private constructor, passed by reference A→B) is unforgeable by
  construction; **no signature needed**. This is the minimal safe form.
- *Persisted / cross-restart dispatch* → executions ARE persisted
  (`executionStore`, `recoverInterrupted`, `runtimeCore.ts:2537`), so a decision that
  must survive restart crosses a serialization boundary and **then** needs Ed25519
  integrity + persisted consumption. (Node-20 in-memory limit from Phase E/H applies.)

Neither sub-case removes the §12 blockers — both still require an **authoritative
actor** bound at Boundary A.

## 14. Replay Model

| Case | Verdict | Mechanism |
|---|---|---|
| duplicate execution (same token twice) | **DENY** (2nd) | single-use `nonce/jti` consumption (CST `Approval.consumed` pattern) |
| worker restart then reuse | **DENY** if consumed persisted; **UNKNOWN→HOLD** if consumption state lost | needs persisted consumption (gap; Node-20 in-memory) |
| concurrent workers race | **one wins** | claim/consume-once (CST `ClaimStore` pattern) — atomic consume |
| retry after failure | **DENY** unless decision explicitly permits; UNKNOWN never auto-retried | per Phase H no-blind-retry |
| after expiry | **DENY** | `now > expiresAt` |
| after revocation | **DENY** | revocation list / decision state = revoked (gap: no revocation store today) |
| token copied | **DENY on 2nd consume** | consume-once; copy doesn't grant a second effect |
| malicious worker constructs a token | in-process by-reference: **impossible** (private constructor); serialized: **DENY** (bad signature) | §13 |

## 15. Parameter Substitution

With binding **E/F** (canonical digest over `{executor,target,account,action,
canonical(params)}`): changing target/account/action/params yields a **different
digest** → verification fails → **DENY**. **Prerequisite:** params must be committed
via the **canonical** serializer (`packaging.ts`), not plain `JSON.stringify` (which is
key-order-dependent — two semantically identical objects can differ, and the CST
idempotency keys today use non-canonical concatenation). Canonicalization is therefore
a **hard prerequisite** for safe parameter binding.

## 16. Tenant Boundary

`tenantId` is bound into the token and re-checked at B against the runtime tenant
(`executeEngine` stamps tenant, `:107`). A token minted under tenant X fails
verification under tenant Y (digest + explicit tenant field). Cross-tenant reuse →
**DENY**.

## 17. Actor Semantics

Boundary B does **not** reconstruct the actor. It verifies (a) token integrity
(by-reference construction *or* Ed25519/HMAC), (b) `bindingDigest` matches the actual
binding, (c) tenant/expiry/consumption. This is sound **iff** the token was minted with
an **authoritative actor at Boundary A**. **It was not** (`decidedBy='user'`).
Therefore, as of today, **the design is BLOCKED at this exact step**: verifying an
integrity-bound token that binds a non-authoritative actor would give a *technically
valid* token for a *governance-empty* decision.

## 18. Boundary B Verification Contract

| Result | Condition |
|---|---|
| VALID | integrity ok ∧ digest matches ∧ tenant matches ∧ not expired ∧ not consumed ∧ not revoked |
| MISSING | no token accompanies the binding |
| INVALID | integrity check fails |
| EXPIRED | `now > expiresAt` |
| REVOKED | decision state revoked |
| MISMATCHED | digest / action / target / account / tenant / executor ≠ binding |
| REPLAYED | nonce already consumed |
| UNKNOWN | consumption/revocation state unavailable (e.g. post-restart) — HOLD, never assume valid |

## 19. Effect Gate

```
runBinding case 'm365' (mail.send):
   token = decision accompanying the binding
   if verify(token, binding, tenant, clock) != VALID:  return DENY  (no executor call)
   consume(token.nonce)   // atomic, single-use
   → M365Executor pure send (frozen)
```
`NO VALID MATCHING GOVERNANCE TOKEN ⇒ executor is never invoked.`

## 20. Failure Mapping (preserves Phase H discipline)

- MISSING / INVALID / MISMATCHED / EXPIRED / REVOKED / REPLAYED → **DENY / HOLD**
  (governance refusal, **no effect**, `effectCalls 0`) — never `EXECUTION_FAILED`.
- UNKNOWN (consumption/revocation unavailable) → **HOLD for reconciliation** (mirrors
  H-FINDING-2), never assumed valid, never blind-retried.
- Only *after* a VALID token and an executed send do the Phase-H transport outcomes
  apply: `202 → ACKNOWLEDGED (≠ verified)`, `NetworkError → UNKNOWN (≠ failure)`.

## 21. Phase H Compatibility

Unchanged and not rewritten: **H-CONTRACT PASS**, **H-APP SCOPED PASS**, **H-EXTERNAL
NOT ESTABLISHED**, **H-FINDING-1 RESOLVED**, **H-FINDING-2 ACCEPTED**, **H-FINDING-3
DEFERRED** (this design is the *plan* to eventually close it for the worker ingress, not
a closure). No universal-governance claim. The IPC path and `governedSend` are
untouched.

## 22. Security / Assurance Analysis (kept separate)

- **Control correctness** — the verification contract (§18) is definable and testable.
- **Path completeness** — this closes *one* additional ingress (worker→`runBinding`
  `'m365'`); `mail.send` remains not-universally-governed until all ingresses cross a
  boundary.
- **Authority correctness** — **FAILING today**: Boundary A binds `'user'`, not a
  principal. This is the gating defect.
- **Token integrity** — achievable (Ed25519/HMAC exist) or unnecessary (in-process
  by-reference).
- **Binding completeness** — achievable with canonical digest (E/F) **iff**
  canonicalization is applied.
- **Replay protection** — achievable in-process; cross-restart needs persisted
  consumption (gap).
- **Outcome verification** — unchanged Profile-A ceiling (ACKNOWLEDGED ≠ VERIFIED).

## 23. Negative Controls (DESIGN TEST REQUIREMENTS — not implemented)

Must FAIL (→ DENY/HOLD, `effectCalls 0`): no token · fake/forged token · token for
another action · another target · another account · another tenant · modified params
(canonical digest mismatch) · expired token · revoked token · replayed/consumed token ·
wrong executor. Plus the **Governance Bypass Reachability** class: the worker ingress
and the IPC ingress for `mail.send` must both cross a governance boundary; the raw
executor must not be a public consequential door.

## 24. Remaining Gaps (prerequisites — not silently solved)

1. **Boundary-A authority (BLOCKING).** No authoritative approver identity at the
   workforce approval seam (`'user'`); secure bridge doesn't thread the principal. The
   authoritative source (`authService`) exists in-process but must be wired into the
   approval boundary (as dataPlane/connectors already do via `deps.actor()`).
2. **Authoritative issuance time (BLOCKING).** Issuance/expiry must use the main-process
   clock, not renderer `r.now`.
3. **Canonical parameter commitment (BLOCKING for safe param binding).** Reuse
   `packaging.ts` `canonicalize`; do not commit params with plain `JSON.stringify`.
4. **Persisted single-use consumption (REQUIRED for cross-restart).** In-memory only
   today (Node-20 limit); a restarted worker must not replay.
5. **Revocation store (REQUIRED for REVOKED semantics).** None exists.
6. **causationId (MINOR / OPTIONAL).** Absent; correlationId exists.
7. **Trust-model decision (DESIGN).** In-process by-reference (no crypto) vs
   persisted signed token (Ed25519) — determined by whether the decision must survive
   restart.

## 25. Proposed I-A Implementation Boundary (smallest future surface)

*If and only if the §24 blockers are cleared*, the future implementation surface is:
- Boundary A: capture the authoritative actor (+ authoritative clock) at
  `approveProposal`; mint the bound decision from the existing `GovernanceVerdict` +
  `ExecutionBinding`.
- Transport: attach the bound decision to the `ExecutionRequest`/binding (in-process
  reference, or signed if persisted).
- Boundary B: in `runBinding` case `'m365'`, verify before invoking the executor;
  route the verified send through `governedSend` (Phase H adapter, reused).

**Explicitly excluded:** kernel, `executor.ts`, `mail.ts`, Data Import, the Phase H
IPC path, egress (webhooks/cloud), other capabilities, `UniversalTransition<T>`, any
global governance framework, new cryptography.

## 26. Certification Claims (post-implementation, NOT now)

- **CONTRACT** — the worker-path token verification behaves correctly (once built).
- **APPLICATION** — scoped to what the launched app can exercise (auth boundary as in
  Phase H).
- **EXTERNAL** — remains NOT ESTABLISHED unless a real M365 send is independently
  proven.
- **BOUNDARY COMPLETENESS** — `mail.send` governed at IPC **and** worker ingress; still
  not universal until every ingress is inventoried and crossed.

## 27. Decision Gate

**BLOCK.** Option 2 is architecturally sound and buildable from **existing** primitives
(Ed25519/HMAC integrity, `canonicalize`, the CST-`Approval`-shaped bound decision, the
`AuditChain`), **but the following must be true before any implementation begins:**

1. **Boundary A binds an authoritative actor** (thread `authService` identity into the
   workforce approval seam — no `'user'`, no fabricated/session/tenant fallback).
2. **Authoritative issuance clock** (not renderer `r.now`).
3. **Canonical parameter commitment** applied to the binding digest.
4. **Persisted single-use consumption** (for cross-restart replay) — or an explicit
   decision to scope I-A to same-session, non-persisted dispatch only.
5. **Trust model chosen** (in-process by-reference vs signed persisted token).
6. Revocation semantics decided (or REVOKED explicitly out of scope for v1).

Recorded per the Phase-I rule: **"Option 2 cannot be safely realized until the approval
authority is strengthened."** Identity is not to be invented to unblock this.

### DIAGRAM 3
```
             CAPABILITY × INGRESS

                     mail.send
                        |
         +--------------+--------------+
         |                             |
   M365 IPC ingress             Worker ingress
         |                             |
      governed                    I-FINDING-1  (Boundary A lacks authoritative actor)
         |                             |
         +-------------+---------------+
                       |
                same capability
                       |
               boundary must hold
```
