# NeuroPause OS — Political-Governance / Slice 6B — Human Principal Preservation (Model C)

**The authoritative HUMAN PRINCIPAL — derived only from the authenticated identity, fail-closed — is now composed with
the validated capability into a non-executing `PrincipalBoundProposal` (WHO + WHAT + MANDATE). Model C's principal
core, implemented purely and non-frozen. The synthetic-worker route stays rejected; no second governance/proposal
system; the AI/renderer can never supply the principal. Certification impact NONE. No frozen surface touched, no
execution, no packages imported. No commit, no push.**
Labels: `SOURCE-PROVEN` · `TEST-VERIFIED` · `NOT LIVE-VERIFIED` · `FROZEN` · `DEFERRED`.

## Baseline `SOURCE-PROVEN`
HEAD `670b52e` (unchanged), branch `cert/data-import-cst-integration`, `git diff --check` clean. Prior Wave-2 +
Slice-1..5 capability work preserved unstaged.

## Source trace (re-confirmed this slice) `SOURCE-PROVEN`
- Authoritative human identity: `auth/authService.ts:86 getStatus()` → `session.user.id` (authenticated variant only).
- Active jurisdiction: `TenantScope = {tenantId, workspaceId}` (`packages/shared/.../tenancy.ts:47`), from
  `tenantContext.scope()` (null when unresolved).
- Fail-closed binder pattern reused: `workforce/approverAuthority.ts:13 resolveAuthoritativeApprover` (never 'user').
- `requestedBy` weak at every set-site (`workforce/index.ts:408 ?? 'user'`, `workerRuntime.ts ?? 'system'`) — NOT
  authoritative human identity (confirmed).
- Slice-5 `ProposalBindingDraft` + `bindCapabilityToProposal` (validated capability identity) reused unchanged.

## Scope decision (why the frozen contract field is DEFERRED, not skipped) `SOURCE-PROVEN`
6B authorizes the minimum additive change to preserve the human principal. The principal only becomes part of the
CANONICAL `JobProposal` when a proposal is actually stamped — and the sole stamping site, `executeJob`
(`workforce/runtime/executor.ts`, FROZEN, the **certified** proposal core), cannot be fed an AI-capability binding
without the Slice-6 submission gate. Adding a `principal?` field to the frozen `JobProposal`/`ActionRequest` NOW would
be a **dead, unpopulatable** frozen surface (nothing could stamp it), and modifying `executeJob` would change a
certification claim — barred by STOP-condition #13 without a certification gate. Therefore the functional minimum is
the principal MODEL at the non-frozen capability layer; the frozen carrier + governance recording compose with the
Slice-6 submission gate and are DEFERRED to that authorized slice.

## Files changed `SOURCE-PROVEN`
- **A** `apps/desktop/src/main/capabilities/capabilityPrincipal.ts` — `Principal`, `PrincipalResolution`, fail-closed
  `resolvePrincipal(subjectId, scope)`. Pure; DI values from the trusted runtime; no store/Electron/IPC/credential.
- **A** `apps/desktop/src/main/capabilities/capabilityPrincipal.test.ts` — 11 tests.
- **M** `apps/desktop/src/main/capabilities/capabilityProposal.ts` (mine, NON-FROZEN) — `PrincipalBoundProposal`,
  `PrincipalBoundProposalResult`, `bindPrincipalToProposal({principal, selection})`.
No frozen file, no `packages/shared`, no `authService`, no governance, no `executeJob`, no IPC channel touched.

## Principal model `IMPLEMENTED / TEST-VERIFIED`
`resolvePrincipal` fails closed: no authenticated subject → `NOT_AUTHENTICATED`; no tenant → `NO_TENANT`; else an
authoritative `Principal {subjectId, tenantId, workspaceId}`. Inputs come from the trusted runtime (authService +
tenantContext) — the AI/renderer/request can NEVER supply them (structurally: `CapabilitySelectionRequest` has no
principal field). `bindPrincipalToProposal` composes an authoritative principal (WHO) + a SELECTED capability binding
(WHAT) + purpose (MANDATE) into a non-executing `PrincipalBoundProposal`; either half missing → fail-closed
(`PRINCIPAL_UNRESOLVED` / `CAPABILITY_NOT_SELECTED`).

## Authority / principal / capability / purpose flow `SOURCE-PROVEN`
- **WHO** = authoritative `subjectId` from `authService` (never 'user', never caller-supplied).
- **WHAT** = validated `ProposalBindingDraft` (`{executor, connectorId, accountId, actionId=capabilityId}`, Slice-5),
  only ever SELECTED (invented / cross-tenant / unavailable / governance-not-proven / ambiguous cannot bind).
- **MANDATE** = the user's purpose, carried as neutralized data; a hostile purpose cannot change identity or authority.
- **Jurisdiction** = the principal carries `{tenantId, workspaceId}`; the capability was resolved in the same active
  workspace (`resolveSelection` is tenant-scoped) — coupling by construction of the trusted runtime.

## Governance / approval / admission / execution / evidence `SOURCE-PROVEN` (UNCHANGED)
This slice adds no path into governance — those engines are untouched. When the Slice-6 submission gate is authorized,
the `PrincipalBoundProposal` feeds the EXISTING pipeline: governance evaluates (worker remains the mechanism, the
principal is recorded provenance), the HUMAN approves (separate, authoritative — the principal is NOT the approver),
admission authorizes, the connector executes, evidence reconstructs WHO/WHAT/mandate/verdict/approver/admission/
outcome. `bindingDigest`/`decisionId` are unaffected (the principal is provenance, distinct from the action identity
that forms the digest). ACKNOWLEDGED ≠ VERIFIED, UNKNOWN ≠ FAILED/SUCCESS — all preserved.

## Test matrix (Phase 16 at this layer) `TEST-VERIFIED`
`capabilityPrincipal.test.ts` **11/11**: authenticated human → authoritative principal; missing subject →
NOT_AUTHENTICATED (never 'user'); missing tenant → NO_TENANT; principal from resolver not request (hostile purpose
can't set identity); unresolved principal fails closed even for a valid capability; non-selectable capability cannot
bind; governance-not-proven cannot bind; proposal is plain data (no credential/callable, deep-walked) + carries tenant
+ principal ≠ approver (no approval field); deterministic. Slice-4/5 capability invariants
(invent/cross-tenant/substitute-account/ambiguous/unavailable) remain green upstream (75 tests). AI-boundary / CST /
governance suites untouched and green.

## Regression `SOURCE-PROVEN`
Capability dir **86/86** (21+11+15+12+14+13). Full main suite **8619 passed / 3 skipped / 816 files** (Slice-5
baseline 8608/3/815; +11/+1, no regression). Typecheck clean. Changed-file lint clean (`--max-warnings 0`).
`git diff --check` clean. (Pre-existing repo-wide lint error in `cst/sendTransition.negative.test.ts` untouched.)

## Frozen audit `SOURCE-PROVEN` — **CLEAN**
`git diff --stat` over `packages/shared`, `workforce/runtime/executor.ts`, `workforce/governance`, `cst/*`,
`executeEngine.ts`, `boundaryB.ts`, `runtimeCore.ts`, `connectors/m365`, `auth/authService.ts` = **empty**. No frozen
surface, no certified path, no identity system modified. `authService` is READ (via DI) at the future wiring point,
never changed.

## Certification impact `SOURCE-PROVEN` — **NONE**
No change to M365 IPC 29/29, CST, worker governance verdict logic, canonical identity, durable admission, Boundary-B,
execution sessions, evidence, tenant isolation, idempotency, or UNKNOWN handling. The principal model is a pure,
non-executing addition.

## Live status `NOT LIVE-VERIFIED` — proven over the real identity/tenant/capability shapes, not a live signed-in
session or execution. ## Pilot status — NOT PILOT-VALIDATED. No user-visible surface changed.

## Remaining gaps `DEFERRED`
1. **Live wiring:** a trusted instance binding `resolvePrincipal` to `authService.getStatus()` + `tenantContext.scope()`
   is not created (it would be dead until submission). Added at the submission slice.
2. **Frozen carrier + governance recording:** the additive optional `principal` on the canonical `ActionRequest`/
   `JobProposal` and its recording is specified but DEFERRED — it becomes functional only with the Slice-6 `executeJob`
   submission gate, which requires an explicit certification gate (STOP-condition #13).
3. **Submission into governance** remains the Slice-6 frozen gate (unchanged).

## STOP
Model C's human-principal core implemented purely and non-frozen: the authoritative human, fail-closed, composed with
the validated capability into a non-executing principal-bound proposal; AI/renderer can never supply the principal;
synthetic worker rejected; governance/approval/admission/execution/evidence and the certified paths all untouched.
HEAD `670b52e`; changes unstaged. No commit. No push. STOP — do NOT start Slice 7.
