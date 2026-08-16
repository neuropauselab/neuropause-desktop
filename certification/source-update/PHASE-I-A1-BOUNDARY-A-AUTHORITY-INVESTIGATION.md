# Phase I-A.1 — Boundary-A Authority Investigation

## 1. Status
**READ-ONLY / DESIGN / INVESTIGATION.** No implementation, no source/test changes, no
commit of code, no push. Kernel, `executor.ts`, `mail.ts`, CST, `secureBridge`, and the
workforce runtime are untouched. Ends at a decision gate.

## 2. Trigger
**I-FINDING-1** (Phase I-A): the worker path lacks an authoritative actor; Boundary A
(the workforce approval seam) records `decidedBy = 'user'` (a role marker) and a
renderer-supplied time (`r.now`). Option 2 (bound governance token) is therefore
**BLOCKED** until Boundary A can mint an *authoritative* governance decision.

## 3. Objective
Determine the **smallest architecturally correct** way to make the workforce approval
boundary authoritative for **identity + time** (and confirm tenant/workspace), so a
future Option-2 token can truthfully represent a real decision. Not "how to
authenticate" — *what authoritative identity, authority scope, and time must exist at
approval*.

Frozen: `NO AUTHORITATIVE ACTOR ⇒ NO AUTHORITATIVE DECISION ⇒ NO BOUND TOKEN ⇒ NO
CONSEQUENTIAL EFFECT.`

## 4. Current Boundary-A Trace (grounded)
```
IPC WorkforceProposalApprove (workforce/index.ts:371-376)
  — withWorkforceAuthz stamps requireAuth:true + permission 'workforce:approve' + audit (authzGate.ts:86-96, map :40)
  → runSecureHandler (secureBridge.ts:143-166): checks isAuthenticated() (:148) + authorize(perm) (:155),
      then calls def.handler(parsed.data)  — PAYLOAD ONLY, no principal (:163)
  → handler: runtime.approveProposal(jobId, proposalId, 'user', note, r.now)  (index.ts:375)
  → proposal.approval = { decision, decidedBy:'user', decidedAt: r.now } (workerRuntime.ts:246)
  → GovernanceVerdict (machine decision) lives on the proposal (workforceGovernance.ts:92)
```

### DIAGRAM — CURRENT
```
Renderer
   |
   | payload only  (r.now, ids)
   v
Secure Bridge  (knows isAuthenticated + authorize; does NOT pass principal)
   |
   v
Workforce Approval
   |
   +--> decidedBy = "user"   (role marker, not a principal)
   |
   v
GovernanceVerdict  (no bound actor, no authoritative time)
```

## 5. Authentication Source
`authService` (`auth/authService.ts`). `getStatus(): AuthStatus`; authenticated =
`{ state:'authenticated', session:{ user: User, accessTokenExpiresAt } }` (`:86,:100-101`).
The canonical principal is **`User`** (`packages/shared/src/types/user.ts:5`) =
`{ id: string, email: string, displayName: string|null }` — a **stable `user.id`**.
Set only from backend auth results (`applyAuthResult` `:97`, `restoreSession` `:152`);
main-process state; the renderer cannot set or mutate it. Immutable for the session
until re-auth/logout.

## 6. requireAuth Semantics
`requireAuth:true` causes `runSecureHandler` to reject when `!deps.isAuthenticated()`
(`secureBridge.ts:148`). It **authenticates (gate) but does not expose the principal**:
the handler signature is `(payload) => …` (`secureBridge.ts:76-82`), and the bridge
calls `def.handler(parsed.data)` (`:163`). So requireAuth proves *a session exists*; it
does **not** propagate *who*. Identity is discarded at `secureBridge.ts:163`.

## 7. Authorization Source
`deps.authorize(permission)` (`secureBridge.ts:155`) → the enterprise authorizer
(`enterprise.authorize`), evaluated against the **currently authenticated principal**
(the same `authService` session). `workforce:approve` (`authzGate.ts:40`) proves *this
authenticated principal may approve*. It returns void (throws on deny); it does **not**
return or record a principal id, and the handler does not receive one.

## 8. Secure Bridge Identity Flow
The bridge is **deliberately identity-blind toward handlers**: it consults
`isAuthenticated()`/`authorize()` (which internally know the principal) but passes only
the validated payload. This is *safe by design* — it prevents handlers from trusting
renderer-supplied identity. The lesson: **identity must not be threaded via the
payload**; it must come from a trusted in-process source injected into the subsystem.

## 9. Current Actor Representation
Literal string `'user'` (`index.ts:375`) → `proposal.approval.decidedBy = 'user'`
(`workerRuntime.ts:246`). A **role marker**, not a principal. No `user.id`, no email,
no session linkage.

## 10. Actor Authority Gap
The authoritative principal (`authService…session.user`) **exists in-process and is
already consumed** by 6+ subsystems via a `deps.actor()` accessor in `runtimeCore.ts`
(`:480, :778, :870, :1102, :1197, :1331`; e.g. dataPlane `:778` uses
`session.user.displayName ?? session.user.email`). **Workforce is the outlier**: it has
no `requireAuth` history (Phase-H era), never imports `authService`, and injects
`'user'`. The gap is purely **authority propagation into the workforce seam** — not a
missing identity system.

## 11. Tenant Authority
Authoritative and unambiguous: the tenant/workspace boundary is resolved from
`workspaceStore` / `activeTenantScope` / `currentPrincipal()` (`runtimeCore.ts:471-474`
for connectors) and stamped by `ExecuteEngine.execute` (`executeEngine.ts:107`). Not
renderer-supplied. `tenantId ≠ actor`.

## 12. Workspace Authority
`workspaceId()` accessor (`runtimeCore.ts:471`) from `currentPrincipal()?.workspaceId`
or `workspaceStore.activeWorkspaceIdOrNull()`. Authoritative; distinct from actor.

## 13. Time Authority
Current approval uses **renderer `r.now`** — NOT authoritative. Authoritative clocks
already exist and are injected as `now: () => new Date().toISOString()`
(`runtimeCore.ts:555,793,874,1106`) and CST `SystemTime` (`importTransition.ts`). The
authoritative issuance clock is a **main-process `now()`**; `r.now` may be retained only
as informational metadata. No distributed clock sync is in scope.

## 14. Approval Record
`proposal.approval = { decision, decidedBy, decidedAt, note }` (`workerRuntime.ts:246`)
and `GovernanceVerdict = { requestId, workerId, skillId, decision, reasons, checks,
evaluations, trustScore, risk, decidedAt }` (`workforceGovernance.ts:92`). Conceptually
the approval record *could* carry actor(id)/authority/authoritative-time/scope/policy —
none of which it binds authoritatively today. WHAT EXISTS: decision, risk, ids, (weak)
decidedBy/time. REQUIRED (for a future authoritative decision): actor(id) + authoritative
time. DEFERRED: on-behalf-of/delegation/agent chain, expiry/single-use (token-phase).

## 15. GovernanceVerdict Provenance
The verdict is the *machine* governance decision (allow/deny/require_approval + risk +
policy signals). It is authoritative as a *policy evaluation* but carries **no
authoritative human/approver identity** and no authoritative issuance time. It is the
natural object to *reference* (by requestId) from a future decision, but it is not by
itself the authority record for *who admitted this action*.

## 16. Minimum Authority Contract (derived)
Boundary A can mint an **authoritative governance decision** iff, at approval time:
```
Authenticated principal (authService session User.id)      [REQUIRED — missing today]
+ Authorized approval capability ('workforce:approve')     [EXISTS]
+ Authoritative tenant + workspace                         [EXISTS]
+ Authoritative issuance time (main-process now())         [REQUIRED — missing today]
+ Specific proposal / job / action binding                 [EXISTS: jobId/proposalId/binding]
+ Referenced GovernanceVerdict (decision provenance)       [EXISTS]
= AUTHORITATIVE GOVERNANCE DECISION
```
Two elements are missing (actor, authoritative time); both have existing authoritative
sources not yet wired into workforce.

## 17. Threat Model
| # | Threat | Current defense | Remaining gap | Future control |
|---|---|---|---|---|
| 1 | Renderer claims `actor=admin` | payload actor is ignored (not read) | actor not captured at all | actor from `authService` DI, never payload |
| 2 | Renderer claims another user | same | same | same |
| 3 | Renderer modifies timestamp | none (uses `r.now`) | time non-authoritative | main-process `now()` |
| 4 | Renderer modifies tenant | tenant from `activeTenantScope`, not payload | — | unchanged |
| 5 | Renderer modifies workspace | `workspaceId()` authoritative | — | unchanged |
| 6 | Unauthorized user approves | `requireAuth` + `workforce:approve` (authzGate) | — | unchanged |
| 7 | Approve a different proposal than UI showed | jobId/proposalId bound in request | UI/consent binding is out of scope | future consent-binding (defer) |
| 8–12 | Worker substitutes actor/tenant/action/target/params | (token phase) | not yet enforced at B | Option-2 bound token (later gate) |
| 13 | Worker reuses old approval | (token phase) | — | single-use/expiry (later) |
| 14 | Worker fabricates "approved" | in-process trust; `confirmed:true` set only by trusted dispatcher | no integrity if persisted | bound token integrity (later) |

I-A.1 closes threats **1–3** at Boundary A; 7–14 belong to the later token gate.

## 18. Option A — Dependency Actor Propagation
Inject `actor: () => string | null` (and `now: () => string`) into the workforce
subsystem deps, sourced in `runtimeCore.ts` from `authService` (and the main-process
clock) — the **exact pattern already used by dataPlane/connectors/6+ subsystems**. The
approve handler captures `deps.actor()` at approval, replacing `'user'`; captures
`deps.now()`, replacing `r.now`. Single identity source; renderer never trusted;
workforce stays testable (injected accessors).

## 19. Option B — Trusted Approval Context
Construct a trusted `ApprovalContext { principalId, tenantId, workspaceId, at }` at the
IPC boundary and inject it into workforce. More structure than A; essentially A plus a
context object. Useful later (carries more fields) but heavier now.

## 20. Option C — Workforce Auth Lookup
Workforce imports `authService` directly and calls `getStatus()` at approval. Works, but
**couples workforce to authService** and breaks the DI/testability pattern the rest of
the codebase follows. Inferior to A.

## 21. Option D — Secure Bridge Context
Change `runSecureHandler`/`AnySecureHandlerDef` so the bridge passes an authenticated
principal to *all* handlers. Foundational and broad (touches every handler's contract);
powerful but **out of scope** for a narrow I-A.1 and higher-risk. Deferrable.

## 22. Option E — Authorization Decision Provenance
Have `authorize()` return the principal (a decision record with principal id) and record
it as the approver. Sound provenance, but requires changing the authorizer contract
(broad) and still needs wiring into the approval record. Heavier than A; overlaps D.

## 23. Option F — Combined Model
A now (DI actor + now), with the door open to B/E later when the token needs richer
provenance (policyVersion, authorization decision id). Recommended framing: **A is the
minimal correct step; B/E/D are later, larger gates if needed.**

## 24. Comparison
| Option | Authority | Security | Coupling | Testability | Existing pattern | Risk | Recommendation |
|---|---|---|---|---|---|---|---|
| A — DI actor()/now() | authoritative (authService, main clock) | high (no renderer trust) | low | high (injected) | **YES (6+ subsystems)** | low | **RECOMMENDED** |
| B — approval context obj | authoritative | high | low-med | high | partial | low-med | later (richer fields) |
| C — workforce queries authService | authoritative | high | **high** (import) | lower | no | med | reject |
| D — bridge passes principal | authoritative | high | **high** (all handlers) | med | no | high (broad) | defer |
| E — authz returns principal | authoritative | high | med-high | med | no | med-high | defer |
| F — A + (B/E later) | authoritative | high | low→ | high | yes | low | direction |

## 25. Recommended Architecture
**Option A (Option F direction).** Inject an authoritative `actor()` (from
`authService.getStatus().session.user` — bind the stable **`user.id`**, keep
`displayName/email` for legibility) and an authoritative `now()` into the workforce
subsystem deps in `runtimeCore.ts`, mirroring dataPlane/connectors. At `approveProposal`,
capture `actor()` (→ replace `'user'`) and `now()` (→ replace `r.now`, retained as
informational). `actor() === null ⇒` the approval is **non-authoritative ⇒ no
authoritative decision** (fail-closed; the future token cannot be minted; no worker
effect). Renderer-supplied identity is never read. Tenant/workspace remain from their
existing authoritative sources.

### DIAGRAM — AUTHORITY-CORRECTED CONCEPT
```
Authenticated Session (authService)
        |
        v
Authoritative Principal (User.id)
        |
        +--------------------+
        |                    |
        v                    v
Authorization         Approval Context
('workforce:approve') (actor + tenant + workspace + authoritative time)
        |                    |
        +---------+----------+
                  |
                  v
          Governance Decision  (references GovernanceVerdict)
                  |
                  v
          Future Bound Token   (Phase I-A, later gate)
```

### DIAGRAM — TRUST
```
Renderer-supplied actor            Trusted authService principal
        |                                   |
        X  (never read)                     v
        |                             Approval boundary
        v                                   |
   DENY / DO NOT TRUST                      v
                                     Authoritative actor
                                            |
                                            v
                                    Governance decision
```

## 26. Required Future Implementation Scope (a LATER gate, not now)
Smallest surface: add `actor()` + `now()` to the workforce subsystem deps interface;
wire them in `runtimeCore.ts` from `authService`/clock; capture both at
`approveProposal` (and `rejectProposal` for symmetry), replacing `'user'`/`r.now`; store
the authoritative approver (`user.id` + label) + authoritative time on the approval
record. **Explicitly excluded:** kernel, `executor.ts`, `mail.ts`, CST, `secureBridge`
(no bridge contract change — Option A avoids it), the bound token itself, canonical
serialization, signing, revocation, `runBinding`/`governedSend`/worker dispatch changes,
on-behalf-of/agent semantics, any universal abstraction.

## 27. Certification Impact
- **H-CONTRACT** — unaffected (PASS remains; IPC path unchanged).
- **H-APP** — unaffected (SCOPED PASS remains).
- **H-EXTERNAL** — unaffected (NOT ESTABLISHED).
- **H-FINDING-3** — still DEFERRED; this is a *prerequisite* toward eventually closing
  the worker ingress, not a closure.
- **I-FINDING-1** — a path to resolution is identified (authority is strengthenable);
  it remains OPEN until implemented + tested.

Distinguish clearly: **DESIGN CAPABILITY** (this doc) ≠ **IMPLEMENTED CONTROL** ≠
**TESTED CONTROL** ≠ **EXTERNALLY VERIFIED CONTROL**. Nothing here is a PASS; no gate is
marked passed because a design exists.

## 28. Remaining Questions
- **Who is the authoritative actor** for a worker-proposed, human-approved action — the
  **approver** (recommended: the human accountable for admitting it) vs an on-behalf-of
  chain (agent proposed / user approved)? Current model captures only the approver;
  **agent/delegation provenance is a declared future scope boundary** (do not invent).
- **Consent binding** (threat #7: approving the proposal the UI actually showed) — out
  of scope for I-A.1; note for later.
- **Cross-restart / autonomous approval** (no session ⇒ actor null ⇒ fail-closed) —
  confirm this fail-closed behavior is the intended policy for autonomous execution.

## 29. Decision Gate
**NOT BLOCKED.** A reliable authoritative principal exists (`authService`, stable
`user.id`), authorization is already tied to that principal, tenant/workspace are
authoritative, and an authoritative clock exists — all consumable via the **existing DI
pattern** without trusting the renderer, without a second identity source, and without
touching kernel/executor/mail/secureBridge.

**Recommended next gate:** a narrow **Boundary-A authority-strengthening implementation**
(Option A) — its own plan → accept → implement → verify cycle — *before* any bound-token
work. Only after Boundary A authoritatively binds actor + time may Phase I-A (the bound
token) proceed.

**Must be true before implementation begins:** (1) Option A confirmed as the approach;
(2) the authoritative actor decision confirmed = the **approver principal** (agent/OBO
deferred); (3) fail-closed on `actor()===null` confirmed as intended; (4) scope limited
to the workforce approval seam (no secureBridge/kernel/executor/mail change).
