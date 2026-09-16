# Phase I-A.3 Step 2 — Boundary-A Claim Minting: Evidence

**Status: IMPLEMENTED + VERIFIED — AWAITING REVIEW. Not committed.** Baseline: Step-1
primitive committed at `c34465a`. Pure mint function only; no transport, no Boundary-B
enforcement, no durable consumption, no crypto.

## 1. Exact minting seam
`mintClaimForApprovedProposal` (`cst/boundDecisionClaimMint.ts`) — a **pure** function
intended to be called by the `WorkforceProposalApprove` handler (Boundary A) in the later
transport step. It is NOT yet wired into the live handler (wiring = transport = Step 3),
so no frozen surface changed and there is no dead code in the request path.

## 2. Exact decisionId source
`proposal.verdict.requestId` (`GovernanceVerdict.requestId`, `workforceGovernance.ts:93`)
— the governance decision's own id, authoritative and stable across the approval
lifecycle. **No new identifier created.** Two decisions with identical effect params
remain distinguishable by this id.

## 3. Exact actor source
`MintContext.actor` — supplied as the authoritative `deps.actor()` (= `user.id`, I-A.1).
Null/empty ⇒ `NO_ACTOR` (fail closed). Never `'user'`/`'system'`/email/displayName/
workspaceId/renderer/fallback.

## 4. Exact tenant source
`MintContext.tenantId` — supplied as `activeTenantScope()?.tenantId`. Null/empty ⇒
`NO_TENANT` (fail closed). Never workspaceId-as-tenant, never renderer.

## 5. Exact execution-binding source
`proposal.execution` (the approved `ExecutionBinding`). Missing ⇒ `NO_EXECUTION_BINDING`
(advisory proposal). Missing `accountId`/`actionId`/`params` ⇒ `INCOMPLETE_BINDING` (no
silent coercion of a missing effect-identity field). This is the same object that reaches
Boundary B (`bindingToRequest` → `request.params.binding` → `runBinding`).

## 6. Exact trusted clock
`MintContext.nowMs` — supplied as the authoritative main-process/runtime clock (I-A.1).
The mint reads no clock and no renderer timestamp; `issuedAt = nowMs`, `expiresAt = nowMs
+ ttlMs`. Verified: `claim.issuedAt === NOW`.

## 7. Exact v1 binding fields (EIGHT)
`executor, target, accountId, actionId, params, actor, tenantId, decisionId`. Digest =
`sha256(canonicalize(binding))` (Step-1 primitive; never `JSON.stringify`).

## 8. Explicit policyVersion omission (I-A3-STEP2-FINDING-1)
`policyVersion` is **excluded**. The workforce `GovernanceVerdict` records no
authoritative per-decision policy version, and the policy set (`DEFAULT_POLICIES`,
`policyEngine.ts:187`) is unversioned; a static policy-contract constant would misrepresent
weaker provenance as stronger. Test `I-A3-STEP2-FINDING-1` proves an extra `policyVersion`
property on the binding input does not change the digest (it is not in the binding view).
Per-decision policy provenance is a separate future architectural gate.

## 9. Claim lifecycle (this step)
mint (approve only) → returns `{minted:true, claim}` or `{minted:false, reason}`. **No**
transport, reservation, consumption, or enforcement. Reject/undecided never mints.
`claim validity ≠ consumption ≠ effect success ≠ verification` remains frozen.

## 10. Negative + positive controls (10 mint tests, all pass)
Positive: approved+valid ⇒ minted (bound to exact effect + authoritative actor/tenant +
`verdict.requestId`, `issuedAt=NOW`); claim binds the AUTHORITATIVE actor/tenant not the
proposal payload; changing any governed field breaks verification. Negative (fail closed):
rejected ⇒ `NOT_APPROVED`; undecided ⇒ `NOT_APPROVED`; advisory ⇒ `NO_EXECUTION_BINDING`;
incomplete binding ⇒ `INCOMPLETE_BINDING`; null/empty actor ⇒ `NO_ACTOR`; null/empty tenant
⇒ `NO_TENANT`; non-canonicalizable params ⇒ `NON_CANONICAL_PARAMS`. (Renderer cannot
influence actor or time — both are `MintContext` inputs the handler sets from authoritative
sources, never read from the proposal/renderer.)

## 11. Test results
`boundDecisionClaimMint.negative.test.ts`: **10/10**. Step-1 primitive (revised to 8
fields): **18/18**. Typecheck clean.

## 12. Frozen-surface verification (all UNCHANGED)
kernel (vendored tgz), `secureBridge.ts`, m365 `executor.ts`, `mail.ts`, infra
`executor.ts`, `sendTransition.ts`, `runtimeCore.ts`, `workforce/index.ts`,
`workerRuntime.ts`, `executeEngine.ts`, `executionStore.ts`, `workforceJobs.ts`
(`GovernanceVerdict`/`ProposalApproval`). Full main suite **8300 passed, 3 skipped** —
passes the declared automated test suite without detected regression.

## 13. Deviations
- Applied Option (c): the Step-1 primitive was revised from 9→8 binding fields
  (policyVersion removed) before committing Step 1 (`c34465a`), so the committed primitive
  matches the frozen v1 binding.
- Added `INCOMPLETE_BINDING` (not in the original control list) so a missing
  `accountId`/`actionId`/`params` fails closed rather than being coerced — honest, no
  silent coercion.
- The mint is a PURE function not yet wired into the live approve handler (transport is
  Step 3); this avoids modifying a frozen surface and avoids dead code in the request path.

## 14. Remaining limitations
No transport (Step 3), no Boundary-B enforcement (Step 4), no durable single-use/replay
(Step 5). No per-decision policy provenance (I-A3-STEP2-FINDING-1). The renderer-exclusion
and authoritative-source properties are enforced by construction here and will be
end-to-end verified when the mint is wired at Boundary A.

## 15. Status
- **I-A3-STEP2-FINDING-1:** RECORDED — policyVersion omitted from v1 (not fabricated).
- **H-FINDING-3:** REMAINS OPEN — no worker-path enforcement.

## Permitted certification claim
*"Boundary A can mint a Bound Decision Claim that deterministically corresponds an
approved consequential execution binding to its authoritative approver principal, tenant
context, and governance decision identifier."* And: *"The v1 claim does not carry
per-decision policy-version provenance because that information is not authoritative at
Boundary A."* NOT: worker-path governed · Boundary-B enforced · `mail.send` universally
governed · replay/cross-restart · effect/external success · AuthorityLease/ExecutionClaim
· policy-version provenance · universal governance.
