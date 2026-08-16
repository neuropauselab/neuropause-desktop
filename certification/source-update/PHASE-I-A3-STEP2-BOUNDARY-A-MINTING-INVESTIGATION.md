# Phase I-A.3 Step 2 — Boundary-A Claim Minting Investigation

## 1. Status & exact Boundary-A seam
**READ-ONLY.** No code, no tests, no commit. Baseline HEAD `0d8b30d` (+ uncommitted
Step-1 primitive). Tags: `[PROVEN]`/`[INFERRED]`/`[DESIGN]`/`[OPEN]`.

Boundary A = `WorkforceProposalApprove` handler (`workforce/index.ts:385-406`) →
`runtime.approveProposal(jobId, proposalId, actor, note)` (`workerRuntime.ts:223`) →
`proposal.approval` (`workerRuntime.ts:246`). A claim may be minted **only on APPROVE**,
never on `WorkforceProposalReject`. `[PROVEN]`

## 2. Complete authority flow
```
authenticated principal (authService session user)      [authoritative]
  → deps.actor() = user.id  (I-A.1, runtimeCore.ts:762)  [authoritative]
  → requireAuth + 'workforce:approve' (authzGate.ts:86)  [authoritative gate]
  → WorkforceProposalApprove handler (workforce/index.ts:385)
  → approveProposal → proposal.approval {decidedBy=user.id, decidedAt=runtime clock}
  → the approved JobProposal carries: verdict (GovernanceVerdict) + execution (ExecutionBinding)
```
`[PROVEN]`

## 3. Binding-field inventory (executor/target/accountId/actionId/params/actor/tenantId/policyVersion/decisionId)
| Field | Source (file:symbol:line) | Authoritative? | At A? | Changes after approval? | Safe to source? |
|---|---|---|---|---|---|
| executor | `JobProposal.execution.executor` (`workforceJobs.ts:39,64`) | yes (approved binding) | ✓ | no `[INFERRED]` | yes |
| target | `execution.target` (connectorId) | yes | ✓ | no | yes |
| accountId | `execution.accountId` | yes | ✓ | no | yes |
| actionId | `execution.actionId` (`mail.send`) | yes | ✓ | no | yes |
| params | `execution.params` | yes | ✓ | no | yes (must be canonicalizable) |
| actor | `deps.actor()` = `user.id` (`workforce/index.ts` I-A.1) | **yes** | ✓ | no | yes |
| tenantId | `activeTenantScope()?.tenantId` (`workforce/index.ts:255,417`) | yes | ✓ (fail-closed on null) | no | yes |
| decisionId | `proposal.verdict.requestId` (`workforceGovernance.ts:93`) **or** `proposal.id` (`workforceJobs.ts:52`) | yes | ✓ | no | yes |
| **policyVersion** | **NONE on the decision** — see §5 | **NOT per-decision** | ✗ (per-decision) / ✓ (static constant) | — | see §5 |

## 4. Authoritative / untrusted classification
- **Authoritative, decision-carried:** executor, target, accountId, actionId, params
  (`proposal.execution`); decisionId (`verdict.requestId`/`proposal.id`).
- **Authoritative, main-process:** actor (`authService` via `deps.actor()`), tenantId
  (`activeTenantScope`).
- **Untrusted (must NOT be used):** renderer payload actor/time, `requestedBy` default
  `'user'` (the job-requester marker, `workforce/index.ts:359,528` — I-A1-NOTE-1, a
  *different* field), Graph OAuth credentials, workspaceId-as-actor.
- **Not per-decision authoritative:** policyVersion (§5).

## 5. policyVersion — the information-boundary finding `[PROVEN]`
`GovernanceVerdict` (`workforceGovernance.ts:92-103`) records `requestId, workerId,
skillId, decision, reasons, checks, evaluations (PolicyEvaluation[]), trustScore, risk,
decidedAt` — **no `policyVersion`/`policyHash`.** `DEFAULT_POLICIES` (`policyEngine.ts:187`)
and `BOUND_POLICIES` (`workers/common.ts:27`) are static id lists **with no version or
hash**. Therefore **no authoritative per-decision policy version exists.**

Two honest readings (a decision is required — not to be resolved silently):
- **(a) Static policy-contract-version constant** — exactly what the accepted CST
  adapters already do (`sendTransition`/`importTransition` pass a constant
  `'m365-send-policy-1'`/`'dp-import-policy-1'`). It is **authoritative-as-code** (a
  compile-time constant, never renderer-supplied) and binds against reuse across a
  policy-contract-version change (redeploy). It does **not** prove which policy *version*
  actually governed this specific decision (there is none recorded).
- **(b) Per-decision policy-version provenance** — would require the governance engine to
  record a policy version/hash on `GovernanceVerdict` — a change to a **frozen contract**,
  a separate authorized gate.

**This is NOT a fallback identity** (option (a) is a legitimate policy-contract tag, per
existing CST usage), but it is **not** decision-recorded provenance. The distinction must
be chosen explicitly.

## 6. decisionId analysis
Use an **existing authoritative id** — recommended `proposal.verdict.requestId`
(`workforceGovernance.ts:93`, the governance decision's own id) or `proposal.id`
(`workforceJobs.ts:52`). Two decisions with identical effect params remain distinguishable
by this id (each governance request/proposal has a distinct id). **No new competing
identifier is required.** `[PROVEN]`+`[DESIGN]`

## 7. Claim issuance point
Mint **inside the `WorkforceProposalApprove` handler**, after the authoritative approver
is resolved (I-A.1) and the proposal is approved, from `proposal.execution` +
`verdict.requestId` + `deps.actor()` + `activeTenantScope()?.tenantId` + issuance time
(runtime clock) + a nonce. **Never** on reject. `[DESIGN]`

## 8. Binding availability analysis
`proposal.execution` (the `ExecutionBinding`) is the exact object that flows to Boundary B:
`bindingToRequest` puts it on `ExecutionRequest.params.binding` (`router.ts:38`) →
`runBinding(binding, confirmed)` (`runtimeCore.ts:2482,2498`). So the minted claim's digest
and the Boundary-B actual binding are computed over the **same** structure. `[PROVEN]`

## 9. Claim transport analysis
In-process, by reference: attach the claim alongside the binding on
`ExecutionRequest.params` (Step 3, not now). Risk to record: the claim must travel with the
binding and not be detachable/replaceable by any renderer path — enforced by
`ExecuteRunRequest` being `.strict()` with no params (renderer cannot inject a binding or a
claim; `contracts.ts:113`). `[PROVEN]` (renderer exclusion) / `[DESIGN]` (attachment).

## 10. Lifecycle analysis
Mint on approve → attach to the request → carried in-process → verified at Boundary B →
(future) consumed. The binding is immutable on the proposal after creation; approval only
sets `proposal.approval`. Reject never mints. `[INFERRED]`+`[DESIGN]`

## 11. Replay-anchor analysis
`[PROVEN]` `ExecuteEngine.execute` **persists the session BEFORE the executor runs**
(`executeEngine.ts:110-111` then `:130`); `ExecutionStore` marks interrupted sessions and
**never reruns** them (`executionStore.ts:6`). So the durable single-use anchor (Step 5)
is the persisted `ExecutionSession` bearing the claim's `nonce`/`decisionId` — no new
store. Consumption is **NOT** implemented in Step 2.

## 12. Negative controls (for the eventual mint step)
- Reject → **no claim minted**.
- `actor()===null` → **no claim** (fail closed, per I-A.1).
- `activeTenantScope()?.tenantId===null` → **no claim** (fail closed).
- `proposal.execution` absent (advisory proposal) → **no claim** (nothing consequential).
- non-canonicalizable `params` → mint **throws** (`CanonicalizationError`) → **no claim**.
- renderer-supplied actor/tenant/time → **never read**.

## 13. Information-boundary findings
- **I-A3-STEP2-FINDING-1 (policyVersion):** no authoritative per-decision policy version
  exists at Boundary A (§5). Requires a decision: (a) static policy-contract constant
  (CST-consistent) vs (b) record a policy version on `GovernanceVerdict` (frozen-contract
  change, deferred) vs (c) drop `policyVersion` from the binding for v1.
- All other 8 fields are authoritatively available.

## 14. Deviations from I-A.3
- I-A.3 §5 listed `policyVersion` as a binding field assumed available; §5 here shows it is
  not decision-recorded. **Deviation to resolve**, not to paper over.
- `decisionId` is sourced from an existing id (`verdict.requestId`), not a new one — as
  I-A.3 §6 intended.
- `tenantId` comes from `activeTenantScope` (available in workforce today), so no new
  `tenantId()` dep is required (simpler than the I-A.1 actor wiring).

## 15. Implementation prerequisites
1. **Resolve I-A3-STEP2-FINDING-1 (policyVersion)** — pick (a)/(b)/(c) above.
2. Choose `decisionId` = `proposal.verdict.requestId` (recommended) or `proposal.id`.
3. Mint only on approve; fail closed on null actor/tenant/absent execution/non-canonical params.
4. Claim carries the binding **digest** (Step-1 primitive), not the binding.
5. Transport (Step 3), Boundary-B enforcement (Step 4), durable consumption (Step 5) remain
   separate authorized gates. `runBinding`/`ExecuteEngine`/`ExecutionStore` unchanged.

## Final verdict
**BLOCKED — pending one decision.** Eight of the nine binding fields are authoritatively
available at Boundary A and can be truthfully minted from the approved decision. The ninth,
**`policyVersion`, has no authoritative per-decision value** (`GovernanceVerdict` records
none; the policy set is unversioned). Per the critical rule, this is reported rather than
resolved silently. Choose one:
- **(a)** static policy-contract-version **constant** (consistent with the accepted CST
  adapters; authoritative-as-code; not per-decision provenance) — **recommended**, no
  frozen-contract change → then **IMPLEMENTABLE**;
- **(b)** record a policy version on `GovernanceVerdict` (frozen-contract change; separate
  gate) — stronger provenance, larger scope;
- **(c)** omit `policyVersion` from the v1 binding (the other eight fields still prevent
  effect substitution) — narrowest.

No implementation, no commit, no push. H-FINDING-3 remains OPEN.
