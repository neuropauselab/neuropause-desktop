# NeuroPause OS — Political-Governance / Slice 6D — Human-Principal Governance Origin (Design Gate)

**READ-ONLY design gate. No code. Finding: a first-class HUMAN-PRINCIPAL certified consequential origin ALREADY
EXISTS — the M365 CST path — with the human bound authoritatively as `type:'HUMAN'`, human-consent (C3) governance,
durable admission, and evidence. The AI-validated capability selection can compose with it WITHOUT a synthetic worker,
WITHOUT a second governance engine, and WITHOUT a frozen change — the human's UI submits the pre-selected action
through the unchanged `M365ActionExecute` IPC after confirming. 6C's STOP was correct (the WORKER pipeline has no human
seat); the human seat lives on the M365 CST axis, not the worker axis. Recommended model + next authorization below.**
Status: `SOURCE-PROVEN` · `NOT-EXECUTED` · `DEFERRED`.

## Baseline `SOURCE-PROVEN`
HEAD `670b52e` (unchanged), branch `cert/data-import-cst-integration`, `git diff --check` clean; prior work preserved.
No file modified this slice; only this report.

## CURRENT MODEL — two parallel governed origins, different actor axes `SOURCE-PROVEN`
1. **Worker-trust origin:** Worker + Skill → `JobProposal` → `evaluateAction(req, {worker})` (permission scopes +
   evolving `trustScore` + policy) → approval → admission (`consumedDecisions`) → executor. Principal = a Worker.
   (`workforce/runtime/executor.ts`, `governance/policyEngine.ts:157`.)
2. **Human-consent origin (M365 CST):** `M365ActionExecute` IPC (`connectors/index.ts:582-662`) → `governedSend`
   (`cst/sendTransition.ts:147`) / `governedAction` (`cst/governedAction.ts:243`) → frozen `CstKernel` → durable
   idempotency admission → at-most-once Graph effect → CST outcome (+ post-outcome durable HOLD). Principal = an
   authenticated HUMAN.
These are fully parallel (shared only the CST kernel type and, post-outcome, the decisions `HoldStore`).

## MISSING CONSTITUTIONAL SEAT — resolved `SOURCE-PROVEN`
6C proved the WORKER pipeline has no seat for a human principal (STOP #3/#4/#15). But the human principal has its OWN
seat on the human-consent axis: the M365 CST path. So the seat is **NOT missing for M365** (the only mutating,
certified connector). It is missing only for non-M365 consequential capabilities (infra/worker), which are correctly
already `GOVERNANCE_NOT_PROVEN` and NOT AI-selectable (Slices 4–5) — honest, deferred.

## EXISTING REUSABLE AUTHORITY `SOURCE-PROVEN` — **CANONICAL**
`enterprise/authz.ts` — `effectivePermissions(member, roles): Set<EnterprisePermission>`, `can`/`requirePermission`
(`authz.ts:36-86`), over `EnterprisePermission` (`enterprise.ts:159`, incl. `workforce:read|operate|approve|manage`).
Wired via `tenantContext.resolveFull()` → `context.permissions` (`actorType:'human'`, `tenantContext.ts:473-486`) and
enforced live at IPC (`authzGate.ts`). The M365 write channel is gated `requireAuth:true` + `connectors:manage`
(`connectors/index.ts:713-719`). `OrgUser` already unifies humans and AI workers (`kind`, `workerId`). Human authority
is a DISJOINT model from worker-trust (no human `trustScore`) — exactly preserving human ≠ worker.

## EXISTING REUSABLE GOVERNANCE `SOURCE-PROVEN`
CST C3 human-consent: a mutating M365 action is unconditionally approval-bound (`sendTransition.ts:179`,
`governedAction.ts:275`); the human `confirmed` boolean mints the `Approval` (approver=HUMAN actor, 15-min TTL,
`sendTransition.ts:188-202`). Authorization is folded from connector facts (`hasActor && ownsAccount && scopesOk &&
token!==null`); missing human identity ⇒ kernel DENY. This is human-approval governance — the correct axis for a human
principal, distinct from worker-trust.

## EXISTING REUSABLE APPROVAL / ADMISSION / EXECUTION `SOURCE-PROVEN`
- **Approval:** the CST inline `Approval` (human confirmation) + `resolveAuthoritativeApprover` pattern; UNKNOWN →
  durable HOLD (`connectors/index.ts:427-446`) → decisions `HoldStore` reconciliation. Principal ≠ approver preserved.
- **Admission:** `DurableIdempotencyStore` (`cst/durableIdempotencyStore.ts:96-185`, check→reserve→persist→effect,
  tenant-scoped key, fail-closed).
- **Execution:** the certified M365 executor Graph write, at-most-once. Profile A (`VERIFIED_SUCCESS` structurally
  unreachable; ACKNOWLEDGED ≠ VERIFIED).

## RECOMMENDED MODEL — A via the EXISTING M365 CST seat (not a new build) `SOURCE-PROVEN`
`AUTHENTICATED HUMAN → HUMAN PRINCIPAL → AI REPRESENTATIVE (validate+select, non-executing) → PrincipalBoundProposal
→ RENDERER presents the concrete action → HUMAN CONFIRMS → existing M365ActionExecute IPC (actor+tenant server-
resolved) → CST C3 governance → durable admission → certified executor → effect → CST outcome + HOLD evidence.`
The AI selects WHICH capability the human is offered; the human confirms the concrete action; the certified,
human-consent path governs and executes. `ProposalBindingDraft.{executor,connectorId,accountId,actionId}` is the SAME
M365 action identity the executor resolves (`capabilityId===actionId`), so the selection maps exactly onto the IPC
`{connectorId, accountId, actionId}` — `params` + `confirmed` are supplied at confirmation, actor+tenant server-side.

## Phase-16 model matrix `SOURCE-PROVEN`
| Model | Human=principal | AI≠authority | One consequential control plane | Frozen change | Verdict |
|---|---|---|---|---|---|
| A — human first-class origin **via existing M365 CST seat** | ✓ (authoritative HUMAN actor) | ✓ (AI selects, human confirms, AI never calls IPC) | ✓ reuses CST/admission/executor/evidence | **none** | **RECOMMENDED** |
| B — human represented by a worker | ✗ (worker governs) | — | — | — | REJECT (6C #4) |
| C — synthetic user/delegate worker | ✗ (fiction) | — | — | — | REJECT (6C #3/#9) |
| D — generalize `evaluateAction` to a human | ✓ | ✓ | new human branch in worker engine | packages/shared + policyEngine | Deferred — unnecessary for M365 (CST already governs humans); only needed for a future non-M365 human-consent origin |

## WHY SYNTHETIC WORKER / SECOND GOVERNANCE REJECTED `SOURCE-PROVEN`
- Synthetic/domain worker: UNNECESSARY — a real, certified human-origin path (M365 CST) exists; fabricating a worker
  would falsely make the human's authority depend on a worker's trust score (category error), and is 6C STOP #3/#4.
- Second governance engine: UNNECESSARY — CST already governs human-consent M365 actions; the worker `policyEngine`
  stays for worker actions. Model A adds NO governance engine. (Model D's `evaluateAction` generalization is bounded
  but not needed for M365 and is deferred.)

## MINIMUM CONTRACT CHANGES `SOURCE-PROVEN`
- **Frozen:** NONE for M365. The IPC schema `M365ActionExecuteRequest` (`contracts.ts:465-471`) already omits
  actor/tenant (server-resolved) and accepts `{connectorId, accountId, actionId, params, confirmed}`; the CST kernel,
  CST contracts, `WriteAction` identity, and the handler body are unchanged.
- **Non-frozen (the actual work):** renderer/capability composition — turn a `ProposalBindingDraft` (identity, no
  params) into a human-confirmation UI that submits via the existing IPC; reconcile the actor-id field (the M365 path
  stamps actor as `session.user.displayName ?? email` at `runtimeCore.ts:481-484`, whereas
  `capabilityPrincipal` uses `session.user.id` — both authoritative from `authService`, choose one consistently for
  evidence correlation).

## Phase-14 digest / identity `SOURCE-PROVEN`
The M365 consequential identity (idempotency key) hashes `{tenantId, connectorId, accountId, actionId, params}`
(`sendTransition.ts:158-162`) — it does NOT include the principal/actor. So the PRINCIPAL is authority/evidence
provenance, NOT part of the effect-admission identity: two humans requesting the identical action dedup to the same
admission (correct — same external effect) while the CST `Approval` records each distinct human actor separately.
Consistent with Slice-5 (`actionId` = effect identity; principal = provenance). No digest change is needed or advised.

## CERTIFICATION IMPACT `SOURCE-PROVEN` — **NONE** (Model A)
Model A changes no frozen surface: CST 29/29 (send certified, cohorts governed additive), durable admission, executor,
Profile-A honesty all UNCHANGED. The AI-capability composition rides the certified path; it neither weakens nor
re-scopes any certification claim.

## SECURITY IMPACT `SOURCE-PROVEN`
- AI/renderer cannot impersonate a principal or cross tenant: actor + tenant are server-resolved from `authService`/
  workspace; the IPC schema omits them; `''` actor ⇒ DENY.
- AI never executes: the AI cannot call the IPC (AI boundary); the human's UI does, after confirmation. Not renderer
  AUTHORITY — the renderer is the human's UI, the human's confirmation is the consent, authority is bound in main.
- RBAC gate (`connectors:manage`) enforces the human's authority to write M365.
- Mandate integrity (Phase 9): the AI proposes the concrete `params` (e.g. recipient); the HUMAN reviews and confirms
  the exact action at C3 — human confirmation is the safeguard against AI mandate-enlargement. (Honest caveat: the
  human MUST see the concrete action before confirming; the UI must render it faithfully.)

## EVIDENCE IMPACT `SOURCE-PROVEN`
Reconstructable via authoritative ids: human actor (CST `Approval.approver`), capability/action (`actionId`),
account/connector, tenant (idempotency key), confirmation (C3 approval), admission (idempotency ledger), outcome (CST
`TransitionOutcome`), UNKNOWN → durable HOLD. Principal, approver, and (absent worker) mechanism stay distinct.

## IMPLEMENTATION SCOPE (for a FUTURE authorized slice) `DEFERRED`
Renderer-side, non-frozen: (1) present the AI-selected M365 capability as a concrete proposed action with its params;
(2) require explicit human confirmation; (3) submit via the existing `M365ActionExecute` IPC (`confirmed:true`); (4)
correlate evidence by authoritative ids in the operator surface. No new store/console/governance/executor.

## STOP CONDITIONS
None triggered for Model A on M365 (viable, non-frozen, non-executing, certified path reused). For non-M365 (infra/
worker) consequential capabilities there is no certified human-consent origin — they remain `GOVERNANCE_NOT_PROVEN` /
not-AI-selectable (honest), pending a separate future human-origin design. Model D (generalizing `evaluateAction`) is
bounded-additive but NOT required now.

## NEXT AUTHORIZATION REQUIRED
Authorize a **renderer composition slice**: AI-validated M365 capability → human-confirmation UI → existing
`M365ActionExecute` IPC — the first real vertical slice ("Send the approved report to finance") on the certified,
human-principal CST path. Non-frozen; no new architecture.

## STOP
Design gate only. The human-principal certified consequential seat already exists (M365 CST); the AI-capability work
composes with it via human confirmation, no synthetic worker, no second governance, no frozen change. No code, no
commit, no push. STOP after this report.
