# Phase I-A.1 — Boundary-A Authority Strengthening
## Implementation Plan

### 1. Status
**READ-ONLY / PLAN ONLY.** No source or test changes, no implementation, no commit, no
push. Kernel, `executor.ts`, `mail.ts`, `runBinding`, `governedSend`, `secureBridge`,
and CST are untouched. Ends at a decision gate.

### 2. Decision Being Implemented
**Option A** — inject an authoritative `actor()` into the workforce subsystem
dependencies from `authService`, and use the runtime's already-authoritative clock;
capture both at the approval seam, replacing the literal `'user'` and the renderer
`r.now`. No bound token in this phase.

### 3. Architectural Objective
Make Boundary A (the workforce proposal-approval seam) able to record a **truthful,
authoritative governance decision** — a stable approver principal and an authoritative
issuance time — so a future Option-2 bound token can transport *evidence of a real
decision*. Frozen: `NO AUTHORITATIVE ACTOR ⇒ NO AUTHORITATIVE DECISION ⇒ NO BOUND
TOKEN ⇒ NO CONSEQUENTIAL EFFECT.`

### 4. Existing Authority Sources
- **Actor:** `authService.getStatus().session.user` (`auth/authService.ts:86,100-101`);
  canonical principal `User` (`packages/shared/src/types/user.ts:5`) with stable
  **`user.id`**. Main-process; renderer-immutable.
- **Clock:** `WorkerRuntime` already defaults to `() => new Date().toISOString()`
  (`workerRuntime.ts:58`) — an authoritative main-process clock. CST `SystemTime`
  exists as the parallel abstraction.
- **DI pattern:** `actor: () => …` is already injected into 6+ subsystems in
  `runtimeCore.ts` (`:480,:778,:870,:1102,:1197,:1331`); `now: () => new
  Date().toISOString()` at `:555,:793,:874,:1106`.

### 5. Existing Workforce Dependency Contract
`WorkforceSubsystemDeps` (`workforce/index.ts:81`) = `{ broadcast: IpcBroadcaster;
publish?: (e)=>void; appVersion: string }`. Constructed via `initWorkforce(deps)`
(`:118`); the runtime is `new WorkerRuntime({…})` (`:169`) whose `clock` defaults to
the authoritative main-process clock. **Workforce never imports `authService`** — it is
the outlier among subsystems.

### 6. Current Identity Loss
```
requireAuth + 'workforce:approve' (authzGate.ts:86-96)
  → runSecureHandler: isAuthenticated()+authorize(), then handler(parsed.data)  [payload only; secureBridge.ts:163]
  → approveProposal(jobId, proposalId, 'user', note, r.now)  [workforce/index.ts:375]
  → proposal.approval = { decision, decidedBy:'user', decidedAt:r.now } [workerRuntime.ts:246]
```
Identity is authenticated for the bridge's checks but **not propagated** to the handler;
the approver is the literal `'user'`, and the timestamp is renderer `r.now`.

### 7. Target Identity Flow
```
Authenticated session (authService)
        └─ actor() ─┐
                    v
   WorkforceSubsystemDeps.actor(): ()=>string|null   (stable user.id)
                    v
   WorkforceProposalApprove handler
        ├─ approver = deps.actor();  if null → FAIL CLOSED (throw, no approval)
        └─ approveProposal(jobId, proposalId, approver, note)   [omit r.now ⇒ runtime authoritative clock]
                    v
   proposal.approval = { decision, decidedBy: user.id, decidedAt: authoritative, note }
                    v
   (future) Governance decision → bound token   [LATER GATE]
```
Renderer supplies neither the actor nor the authoritative time.

### 8. Actor Contract
`actor: () => string | null` on `WorkforceSubsystemDeps`. In `runtimeCore.ts` it returns
`authService.getStatus().state === 'authenticated' ? session.user.id : null` — the
**stable `user.id`** (chosen over `displayName/email` for governance attribution;
documented divergence from the audit-legibility accessors that use `displayName ??
email`). Scope for THIS phase: **actor = the authenticated approver principal.** Agent /
delegated / on-behalf-of / service / autonomous identities are **explicitly deferred**
(not invented).

### 9. Time Contract
No new dependency required. The `WorkerRuntime` default clock (`workerRuntime.ts:58`) is
already authoritative. The fix: the approval handler **stops passing `r.now`**, so
`approveProposal`'s default `now = this.clock()` applies. `r.now` may be retained only as
*informational request metadata*, never as governance issuance time. (Optional
consistency alternative: inject `now: () => string` into the deps and pass `deps.now()`
explicitly — evaluated as slightly larger surface; the drop-`r.now` form is minimal and
preferred.)

### 10. Null-Actor Fail-Closed Contract
- **Where detected:** in the `WorkforceProposalApprove` (and `…Reject`) handler, before
  calling `approveProposal`.
- **What happens:** throw `IpcError` (e.g. "Sign in to continue." / "Approval requires
  an authenticated principal.") — the approval is **not** recorded; no `proposal.approval`
  is written; the decision does not become authoritative.
- **No fallback:** never `'user'`, `'unknown'`, `'system'`, workspace/tenant owner,
  renderer actor, or any inferred identity.
- **Note:** the channel is already `requireAuth`; `isAuthenticated()===true` implies a
  session, so `actor()` is non-null in practice. The null branch is defense-in-depth and
  the declared policy for any divergence / autonomous (session-less) approval.
- **Evidence:** the existing `audit:true` on the handler records the refusal; no
  approval event is emitted.

### 11. Approval-Seam Changes
`workforce/index.ts` handlers `WorkforceProposalApprove` (`:371-376`) and
`WorkforceProposalReject` (`:378-385`): compute `deps.actor()`, fail-closed on null,
pass the resulting **`user.id`** as `by`, and **omit `r.now`** (use the runtime clock).
No change to `approveProposal`'s signature or the `ProposalApproval` type.

### 12. Runtime Dependency Wiring
`runtimeCore.ts` `initWorkforce({…})` call: add
`actor: () => { const st = authService.getStatus(); return st.state === 'authenticated'
? st.session.user.id : null; }` — mirroring the dataPlane/connectors wiring. No other
runtime change.

### 13. Secure Bridge Impact
**UNCHANGED.** The bridge stays deliberately identity-blind; identity reaches workforce
via the trusted DI accessor, never via the payload. This was the investigation's
conclusion and is confirmed by `secureBridge.ts:76-82,143-166`.

### 14. GovernanceVerdict Impact
**UNCHANGED.** `ProposalApproval.decidedBy: string` and `decidedAt: string`
(`workforceJobs.ts:22-24`) already hold arbitrary strings, so binding `user.id` and an
ISO timestamp needs **no type change**, no `GovernanceVerdict` change, and **no CST
contract change** (Conclusion **A: existing fields sufficient**).

### 15. Renderer Trust Boundary
Renderer-supplied actor is **never read** (no actor field is consumed from the payload).
Renderer `r.now` is demoted to informational (or dropped). The only authoritative
identity/time come from `authService` and the runtime clock.

### 16. Tenant/Workspace Separation
Unchanged and independent. Tenant/workspace remain sourced from
`activeTenantScope`/`workspaceStore`/`ExecuteEngine` (`executeEngine.ts:107`). `tenantId
≠ workspaceId ≠ actorId`; no conflation, no inference.

### 17. Exact File Impact
| File | Change |
|---|---|
| `apps/desktop/src/main/workforce/index.ts` | add `actor` to `WorkforceSubsystemDeps`; capture actor + fail-closed + drop `r.now` in the 2 approve/reject handlers |
| `apps/desktop/src/main/runtimeCore.ts` | wire `actor: () => authService…user.id` into `initWorkforce({…})` |
| workforce test factory/helpers | supply a stub `actor()` where `WorkforceSubsystemDeps` is constructed |
**Untouched:** kernel, `executor.ts`, `mail.ts`, `runBinding`, `governedSend`,
`secureBridge.ts`, CST, `workforceJobs.ts` types, `workerRuntime.ts` (signature).

### 18. Exact Symbol/Function Impact
- `WorkforceSubsystemDeps` (interface) — +1 field `actor`.
- `WorkforceProposalApprove` / `WorkforceProposalReject` handlers — capture actor, fail
  closed, pass `user.id`, omit `r.now`.
- `initWorkforce` call site in `runtimeCore.ts` — +1 wired dependency.
- **Not changed:** `WorkerRuntime.approveProposal`/`rejectProposal` signatures,
  `ProposalApproval`, `GovernanceVerdict`.

### 19. Test Impact (design only — not written here)
1. Approver receives stable `user.id` → `proposal.approval.decidedBy === user.id`.
2. Approval records the correct actor.
3. Renderer cannot override actor (no payload actor path exists).
4. Renderer-supplied actor field (if present) is ignored.
5. `actor()===null` → handler throws; **no** `proposal.approval` created (fail-closed).
6. Authorized principal still approves (permission unchanged).
7. Unauthorized principal still denied (`requireAuth`/`workforce:approve` unchanged).
8. `decidedAt` comes from the runtime authoritative clock, not `r.now`.
9. A renderer `r.now` cannot become the governance timestamp.
10–13. Existing approval / CST / workforce / Phase-H tests remain intact & pass.
14. No worker-execution behavior changes.
15. No token is created.
Fixture change: workforce `WorkforceSubsystemDeps` factories add a stub `actor()`.
Layers: unit (runtime/handler) + integration (approval seam); **certification evidence**
separate. No runtime-success claim before implementation.

### 20. Security Impact
| Threat | Expected after I-A.1 |
|---|---|
| renderer impersonates actor | impossible — actor from `authService` DI, payload actor never read |
| handler defaults to `'user'` | removed |
| session-less / autonomous approval | `actor()===null` → **DENY** (fail-closed) |
| renderer malicious timestamp | authoritative runtime clock used; `r.now` non-authoritative |
| workspace substituted | independent authoritative source (unchanged) |
| tenant substituted | independent authoritative source (unchanged) |
| future token fabricated | still blocked until the I-A token gate |

### 21. Certification Impact
- **H-CONTRACT / H-APP / H-EXTERNAL** — unaffected (IPC path, app scope, external
  boundary unchanged).
- **H-FINDING-3** — **REMAINS OPEN**: `runBinding` still has no consequential-effect
  enforcement; this phase only makes Boundary A authoritative.
- **I-FINDING-1** — **RESOLVED after implementation + verification** (not before): the
  approval boundary then binds an authoritative principal + time.
- **Claim allowed after this lands:** *"Boundary A can produce an authoritative
  governance decision containing a trusted approver identity and authoritative issuance
  time."* **Not** "the worker path is governed"; **not** any universal-governance claim.
  Distinguish DESIGN CAPABILITY (this plan) ≠ IMPLEMENTED ≠ TESTED ≠ EXTERNALLY VERIFIED.

### 22. Frozen-Surface Verification
- **kernel** — UNCHANGED (no governance-verdict/approval type touched).
- **`executor.ts`** — UNCHANGED (no execution path touched).
- **`mail.ts`** — UNCHANGED.
- **`runBinding`** — UNCHANGED (enforcement is a later gate).
- **`governedSend`** — UNCHANGED.
- **`secureBridge.ts`** — UNCHANGED (Option A avoids a bridge contract change).
- **CST contract** — UNCHANGED (`decidedBy`/`decidedAt` strings suffice → no type change).
If any step required touching these, the plan would STOP; none does.

### 23. Implementation Sequence (validated)
The proposed STEP 1–17 sequence is **correct**, with one refinement: **Step 2/4 (add a
`now()` dependency) is NOT required** — the runtime clock is already authoritative, so
Step 5/9 reduce to "capture actor; omit `r.now`". Adjusted sequence: (1) add `actor()`
to `WorkforceSubsystemDeps`; (2) wire `actor()` from `authService` in `runtimeCore.ts`;
(3) capture actor at approve/reject, fail-closed on null; (4) drop `r.now` (use runtime
clock); (5) replace `'user'` provenance; (6) update focused tests + fixtures; (7)
typecheck; (8) workforce tests; (9) relevant CST tests; (10) full declared regression;
(11) `git diff` review; (12) verify frozen files untouched; (13) produce evidence.

### 24. Verification Sequence
typecheck (node) → workforce suite → CST/dataPlane suite → **full main suite** (declared
793/8267 baseline, expect no regression) → `git diff --stat` scoped to the 2–3 files →
explicit frozen-file check (`git diff HEAD -- kernel/executor.ts/mail.ts/runBinding/
governedSend/secureBridge` empty) → evidence doc. No PASS claimed before this runs.

### 25. Risks
- **Test-fixture breadth:** making `actor` required forces every `WorkforceSubsystemDeps`
  construction (incl. tests) to supply it — bounded, typecheck-surfaced. Mitigation:
  update the shared workforce test factory once.
- **actor id vs label:** `user.id` is stable but less human-legible than `displayName`;
  audit legibility is preserved elsewhere. Documented choice.
- **`this.clock` assumption:** verified authoritative (`workerRuntime.ts:58`); if a test
  injects a `clock`, that is test-controlled, not renderer-controlled — acceptable.
- **Divergence isAuthenticated vs session.user:** covered by the fail-closed null branch.

### 26. Non-Goals
No bound token; no signing/hashing; no canonical serialization; no `runBinding`/
`governedSend`/worker-dispatch change; no `secureBridge`/kernel/executor/mail change; no
GovernanceVerdict/CST contract change; no agent/on-behalf-of/delegation identity; no
consent-binding (threat #7); no universal-governance claim; no push.

### 27. Decision Gate
**READY FOR IMPLEMENTATION.**

Why: a reliable authoritative principal exists (`authService`, stable `user.id`); the
runtime already has an authoritative clock; authorization is already tied to the
authenticated principal; tenant/workspace are authoritative; the change reuses the
existing DI pattern; **no frozen file, no shared/CST type, and no secure bridge changes
are required**; and the null-actor path fails closed. The surface is 2 production files
(`workforce/index.ts`, `runtimeCore.ts`) + workforce test fixtures.

**Confirm before coding:** (1) actor = the **approver principal** via stable `user.id`
(agent/OBO deferred); (2) authoritative time via the **runtime clock** (drop `r.now`),
not a new `now()` dep; (3) `actor()===null` fails closed (throw, no approval); (4)
`actor` is a **required** dep (test factories updated); (5) scope limited to the two
approval/reject handlers + the one wiring site.
```
CURRENT
Renderer → secureBridge (authn/authz) → Workforce handler → decidedBy="user", r.now → GovernanceVerdict

TARGET
authService → actor() → WorkforceSubsystemDeps → approveProposal(actor.id, <runtime clock>) → authoritative decision → (future) bound token
```
