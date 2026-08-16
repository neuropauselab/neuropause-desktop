/**
 * P13C Phase I-A.3 (Step 2) — Boundary-A claim minting.
 *
 * A PURE function that produces a BoundDecisionClaim from an APPROVED consequential
 * proposal and the authoritative approver/tenant/time context. It only READS the
 * authoritative Boundary-A structures; it does not authorize, transport, consume, or
 * execute. Minting is not enforcement — a minted claim represents "this exact execution
 * binding was admitted by this exact governance decision, under this authoritative actor
 * and tenant"; it is NOT execution authority, an AuthorityLease, an ExecutionClaim, a
 * credential, or proof of effect success.
 *
 * Fail-closed: NO claim is produced unless every authoritative input is present and the
 * binding is canonicalizable. A rejected/advisory proposal, a null actor, a null tenant,
 * an incomplete binding, or non-canonicalizable params each yields no claim.
 *
 * v1 binding = EXACTLY eight fields (I-A3-STEP2-FINDING-1): executor, target, accountId,
 * actionId, params, actor, tenantId, decisionId — no policyVersion (no authoritative
 * per-decision policy version exists at Boundary A). Time is the authoritative runtime
 * clock supplied by the (future) caller; this function reads no clock and no renderer
 * input.
 */
import type { JobProposal } from '@neuropause/shared';
import { CanonicalizationError } from '../util/canonicalJson';
import { mintBoundDecisionClaim, type BoundDecisionClaim, type EffectBinding } from './boundDecisionClaim';

export type MintRejectReason =
  | 'NOT_APPROVED'
  | 'NO_EXECUTION_BINDING'
  | 'INCOMPLETE_BINDING'
  | 'NO_ACTOR'
  | 'NO_TENANT'
  | 'NON_CANONICAL_PARAMS';

export type MintResult =
  | { readonly minted: true; readonly claim: BoundDecisionClaim }
  | { readonly minted: false; readonly reason: MintRejectReason };

export interface MintContext {
  /** The APPROVED consequential proposal (must carry an execution binding). */
  readonly proposal: JobProposal;
  /** The authoritative approver principal (deps.actor() = user.id). Never the renderer. */
  readonly actor: string | null;
  /** The authoritative tenant (activeTenantScope()?.tenantId). Never workspaceId, never renderer. */
  readonly tenantId: string | null;
  /** Authoritative main-process/runtime time (I-A.1 clock). Never a renderer timestamp. */
  readonly nowMs: number;
  readonly ttlMs: number;
  readonly nonce: string;
}

/**
 * Mint a claim for an APPROVED consequential proposal, or fail closed. `decisionId` is
 * the governance decision's own id (`verdict.requestId`) — an existing authoritative,
 * approval-lifecycle-stable identifier; no new identity is created. Reject never mints.
 */
export function mintClaimForApprovedProposal(ctx: MintContext): MintResult {
  const { proposal, actor, tenantId, nowMs, ttlMs, nonce } = ctx;

  // Only an APPROVED proposal can mint; a rejected/undecided proposal never does.
  if (proposal.approval?.decision !== 'approved') return { minted: false, reason: 'NOT_APPROVED' };

  // Only a consequential proposal (carrying an execution binding) mints; advisory ones do not.
  const execution = proposal.execution;
  if (execution === undefined) return { minted: false, reason: 'NO_EXECUTION_BINDING' };

  // The effect identity fields must be present — no silent coercion of a missing value.
  if (execution.accountId === undefined || execution.actionId === undefined || execution.params === undefined) {
    return { minted: false, reason: 'INCOMPLETE_BINDING' };
  }

  // Authoritative identity/tenant must exist (fail closed; no fallback identity).
  if (actor === null || actor.trim() === '') return { minted: false, reason: 'NO_ACTOR' };
  if (tenantId === null || tenantId.trim() === '') return { minted: false, reason: 'NO_TENANT' };

  const binding: EffectBinding = {
    executor: execution.executor,
    target: execution.target,
    accountId: execution.accountId,
    actionId: execution.actionId,
    params: execution.params,
    actor,
    tenantId,
    decisionId: proposal.verdict.requestId,
  };

  try {
    return { minted: true, claim: mintBoundDecisionClaim({ binding, nonce, issuedAt: nowMs, ttlMs }) };
  } catch (err) {
    if (err instanceof CanonicalizationError) return { minted: false, reason: 'NON_CANONICAL_PARAMS' };
    throw err;
  }
}
