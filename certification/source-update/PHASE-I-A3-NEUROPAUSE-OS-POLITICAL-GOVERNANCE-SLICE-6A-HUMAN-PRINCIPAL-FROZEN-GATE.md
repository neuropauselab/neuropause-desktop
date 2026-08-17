# NeuroPause OS — Political-Governance / Slice 6A — Human Principal vs Worker Principal (Constitutional Decision Gate)

**STOP. Read-only analysis, no code. The canonical consequential pipeline is worker-principal: governance evaluates a
`Worker`, and the frozen proposal/governance contracts carry NO authoritative human principal — only a weak,
non-authoritative `requestedBy`. Preserving the human as the authoritative principal inside the EXISTING governance
system (Model C) requires a minimal additive FROZEN change; the synthetic-worker route (Model B) is rejected as
principal substitution. This gate recommends Model C and requests explicit authorization. Nothing is implemented.**
Status: `SOURCE-PROVEN` · `NOT-EXECUTED` · `FROZEN` · `DEFERRED`.

## Baseline `SOURCE-PROVEN`
HEAD `670b52e` (unchanged), branch `cert/data-import-cst-integration`, `git diff --check` clean. This slice added no
source — only this document. No commit, no push.

## Current authority model `SOURCE-PROVEN`
- **Governance principal = Worker.** `evaluateAction(req, {worker: Worker})` (`workforce/governance/policyEngine.ts:157`);
  every check reads the worker (`checkPermission` scopes `:36-52`, `checkTrust` `worker.trustScore` `:54-68`). No
  human-subject governance entry exists.
- **No authoritative principal on the proposal/governance contracts.** `ActionRequest`
  (`packages/shared/src/types/workforceGovernance.ts:56-70`) = `{id, workerId, workerRole, skillId, title, summary,
  sideEffects, permissions, risk, evidence, payload, requestedAt}` — NO actor/subject/principal. `JobProposal`
  (`packages/shared/src/types/workforceJobs.ts:51`) — NO subject. The only requester field is `Job.requestedBy: string`
  (`:94`) / `JobSpec.requestedBy?` (`:117`).
- **`requestedBy` is weak (non-authoritative) at every set-site:** `workforce/index.ts:408` `?? 'user'`,
  `index.ts:577` `'user'`, `workerRuntime.ts:102/126/198` `?? 'system'`, `orchestrator.ts:212` `workflow:<id>`. It is
  NEVER bound from `authService`.
- **The authoritative human enters ONLY at approval:** `resolveAuthoritativeApprover(actor, action)`
  (`workforce/approverAuthority.ts:13`) binds the trusted `authService` session `user.id`, fail-closed, never `'user'`
  — written to `ProposalApproval.decidedBy`. Evidence `DecisionRecord.actor` exists but is `?? null`
  (`decisions/decisionService.ts:96-100`).
∴ For an ALLOW (non-approval) action, **no authoritative human is recorded as the requester** anywhere on the governed
proposal. The human principal is authoritative only when a human approves.

## The missing principal carrier `SOURCE-PROVEN`
There is no authoritative, fail-closed human-principal field on the proposal or governance-input contract. The
existing `requestedBy` is a weak string on the Job (not on `ActionRequest`/`JobProposal`), so governance never sees a
requester at all, and it defaults to `'user'`/`'system'`.

## Prove/disprove: "a Worker can be substituted for the human principal without changing authorization" — DISPROVEN
Governance's verdict is a function of the WORKER's granted scopes + trust (`policyEngine.ts:36-68,94,116`). A synthetic
worker's trust/scopes — not the human's authority — would determine the verdict. The human's identity would not be the
authoritative subject of the governance decision, and (absent an approval step) would not be recorded as requester.
Substituting a worker therefore CHANGES the meaning of "who is authorized and on what basis." **Not substitutable.**

## Option analysis / decision matrix `SOURCE-PROVEN`
| Model | Principal preserved | AI authority | One governance | Frozen change | Cert impact | Evidence "who asked" | Verdict |
|---|---|---|---|---|---|---|---|
| **B — synthetic worker** | ✗ (governance evals worker; requester weak `'user'`) | no | yes | none | low | synthetic worker + `'user'` | **REJECT — principal substitution** |
| **A — frozen `executeJob` extension** | partial (submits human binding, but still no principal field; governance still worker) | no | yes | `runtime/executor.ts` | high (stamping core) | still weak requester | insufficient alone |
| **D — authoritative `requestedBy` (non-frozen)** | partial (Job.requestedBy = authService id at `index.ts:408`, reusing the `resolveAuthoritativeApprover` pattern) | no | yes | none | low | authoritative on Job, but NOT on ActionRequest/governance | partial; moot without submission (Slice-6 blocker) |
| **C — authoritative principal on the proposal + governance record** | ✓ (human is the authoritative subject/requester; worker = mechanism) | no | yes | minimal additive `packages/shared` | medium | authoritative human on the governed proposal | **RECOMMENDED** |

## Why the synthetic worker is insufficient `SOURCE-PROVEN`
Model B makes the governed record answer "who requested / on whose authority" with a fabricated worker and a weak
`'user'`. The real human principal is absent from governance and (for allow-path actions) from the requester record —
exactly the principal substitution the constitution forbids. Rejected.

## Third option (Option D) — discovered, honest `SOURCE-PROVEN`
`workforce/index.ts:408` (the `requestedBy` set-site) is NON-FROZEN, and `resolveAuthoritativeApprover`
(`approverAuthority.ts:13`) is a reusable fail-closed authService binder. So `requestedBy` COULD be bound
authoritatively to the human without a frozen change — a genuine improvement. BUT: (a) it lives on the `Job`, not on
`ActionRequest`/`JobProposal`, so governance still never sees the human; (b) it does not solve the Slice-6 submission
blocker (an arbitrary validated binding still cannot reach `executeJob` without a frozen change or a new worker/skill
architecture). Option D is a partial principal improvement, not a complete Model C.

## Recommended minimum correct change (Model C) — for authorization, NOT implemented
1. **Frozen, additive:** an authoritative, optional `principal` (or `subject`) on `ActionRequest` (and surfaced on
   `JobProposal`) in `packages/shared` — the authenticated human `user.id` (+ tenant), bound fail-closed from
   `authService` at the submission seam via the existing `resolveAuthoritativeApprover`-style binder. Optional field →
   backward compatible; absent = today's behavior.
2. **Submission (composes with Slice 6):** the AI-capability path submits the validated `ProposalBindingDraft` +
   authoritative principal; governance RECORDS the human principal (and may consider it) — the worker, if present, is
   explicitly the MECHANISM, not the principal.
3. **Governance/approval/admission/execution/evidence:** unchanged engines; the human is now the authoritative subject
   of the governed proposal and reconstructable in evidence for allow-path actions too.

## Impact `SOURCE-PROVEN`
- **Identity/digest:** the `principal` is descriptive of authority, distinct from the action identity
  `{executor,target,accountId,actionId}` that forms `bindingDigest`/`decisionId` (Slice-5). Decision whether `principal`
  participates in the digest is part of the gate; default recommendation: NO (it is the requester, not the action).
- **Tenant:** unchanged — `Job.tenantId` store-stamped; principal carries the authoritative tenant from `tenantContext`.
- **Approval:** unchanged and authoritative (`decidedBy`); now the requester is equally authoritative.
- **Admission/execution:** unchanged (Boundary-B, durable admission, certified M365).
- **Evidence:** improved — "who requested" becomes authoritative on the proposal, not `'user'`.
- **Certification:** MEDIUM — additive optional shared field + a bound value; requires proposal-path re-cert + tests,
  but no change to governance verdict logic, admission, or effect boundary.
- **Frozen surfaces implicated:** `packages/shared` (`workforceGovernance.ts` ActionRequest, `workforceJobs.ts`
  JobProposal). NOT `runtime/executor.ts` verdict logic, NOT CST, NOT Boundary-B, NOT executionStore.

## Tests required (when authorized)
human principal preserved authoritatively; AI ≠ principal; AI ≠ authority; principal fail-closed (null → refusal, never
`'user'`); capability identity preserved; account/tenant isolation; cross-tenant rejection; purpose preserved; approval
cannot be lowered; governance cannot be bypassed; proposal cannot execute/self-approve/mint admission; connector not
called at proposal time; replay protection; bindingDigest stability; evidence names the human requester; and — if a
worker mechanism is used — it CANNOT erase the human principal identity.

## Rollback
Report only — nothing to roll back. If Model C is later implemented, the additive optional field is removable and
defaults to current behavior.

## STOP conditions triggered (this gate)
"Frozen modification is required but not authorized" and "Human principal cannot be preserved [without it]." Per
Phase 15, implementation halts pending an explicit constitutional decision authorizing Model C's minimal frozen field.

## Recommendation
Adopt **Model C**. Reject **Model B** (synthetic worker — principal substitution). Treat **Option D** as an optional
non-frozen hardening (authoritative `requestedBy`) that does not by itself satisfy the constitution. Do NOT implement
until the minimal frozen `principal`/`subject` field is explicitly authorized.

## STOP
Traced, not built. The correct principal-preserving architecture (Model C) needs a minimal additive frozen principal
carrier on the canonical proposal/governance contract; the synthetic-worker route is unconstitutional. No frozen
surface modified, no code written, no live claim, certification impact NONE (nothing changed). HEAD `670b52e`; changes
unstaged. No commit. No push. STOP — do NOT start Slice 7.
