/**
 * P8.3 — Workforce execution router (pure).
 *
 * Turns an approved, binding-carrying `JobProposal` into an `ExecutionRequest` for
 * the EXISTING ExecuteEngine, and aggregates the resulting `ExecutionSession`(s)
 * into a single job outcome. No execution logic lives here — it only shapes the
 * request (routing to the workforce action executor, carrying the binding + the
 * job's correlation id, and setting `confirmed: true` because the human approval
 * IS the confirmation) and reads the engine's terminal session state.
 */
import type { ExecutionRequest, ExecutionSession, Job, JobProposal } from '@neuropause/shared';
import type { BoundDecisionClaim } from '../../cst/boundDecisionClaim';
import { mintClaimForApprovedProposal, type MintRejectReason } from '../../cst/boundDecisionClaimMint';

/** The engine kind the workforce action executor is registered on. */
export const WORKFORCE_ACTION_KIND = 'connector' as const;

/**
 * P13C I-A.3 Step 3A — the authoritative governance context transported ALONGSIDE an
 * approved binding so a future Boundary B can independently reconstruct the exact eight-field
 * binding and re-verify `claim.bindingDigest`. `actor`/`tenantId` are the SAME authoritative
 * Boundary-A values (`deps.actor()` / `activeTenantScope()?.tenantId`) used to MINT `claim` —
 * NEVER renderer-supplied, and NOT added to the `ExecutionBinding` itself. The claim is
 * by-reference (not a serialized/bearer token). This gate only TRANSPORTS; it does not verify.
 */
export interface GovernanceContext {
  readonly claim: BoundDecisionClaim;
  readonly actor: string;
  readonly tenantId: string;
}

export interface WorkforceExecutionOutcome {
  ok: boolean;
  summary: string | null;
  error: string | null;
  /** ExecutionSession id (the last session), or '' when none ran. */
  executionId: string;
  /** Which executor ran the action (infra/m365/automation), or 'unknown'. */
  executor: string;
}

/**
 * Build the ExecutionRequest for an approved binding-carrying proposal, or null if
 * the proposal has no binding. `confirmed: true` + `params.binding` are IN-PROCESS
 * only (the public ExecuteRun IPC cannot supply them).
 */
export function bindingToRequest(job: Job, proposal: JobProposal, governance?: GovernanceContext): ExecutionRequest | null {
  const binding = proposal.execution;
  if (!binding) return null;
  // The approved ExecutionBinding is carried UNCHANGED. When present, the authoritative
  // governance context rides as SIBLINGS of the binding (never inside it) so Boundary B can
  // reconstruct the eight-field binding = { ...binding, actor, tenantId, claim.decisionId }.
  const params: Record<string, unknown> = { binding, jobId: job.id, proposalId: proposal.id };
  if (governance) {
    params.claim = governance.claim;
    params.actor = governance.actor;
    params.tenantId = governance.tenantId;
  }
  return {
    kind: WORKFORCE_ACTION_KIND,
    targetId: job.id,
    label: proposal.title,
    params,
    confirmed: true,
    correlationId: job.correlationId ?? job.id,
  };
}

/** The authoritative Boundary-A inputs a governed dispatch mints its claims from. Every value
 *  is trusted main-process context; none is renderer-supplied. `actor`/`tenantId` may be null
 *  (unauthenticated / no tenant scope) → the dispatch fails closed. */
export interface DispatchAuthority {
  readonly actor: string | null;
  readonly tenantId: string | null;
  readonly nowMs: number;
  readonly ttlMs: number;
  readonly nonce: () => string;
}

export type GovernedRequests =
  | { readonly ok: true; readonly requests: ExecutionRequest[] }
  | { readonly ok: false; readonly reason: MintRejectReason };

/**
 * P13C I-A.3 Step 3A — mint a BoundDecisionClaim for EACH approved consequential proposal and
 * attach it (with the same authoritative actor + tenant) to that proposal's ExecutionRequest.
 * This is the live governed-dispatch transport: the requests it returns are exactly what the
 * ExecuteEngine receives, so `params.claim` here IS the claim on the live path (closes D1), and
 * the attached `{ binding, actor, tenantId, claim.decisionId }` is exactly what Boundary B needs
 * to recompute `claim.bindingDigest` (closes D2 at the transport layer).
 *
 * Fail closed: the FIRST proposal that cannot be governed (no actor, no tenant, not approved, no
 * execution binding, incomplete/non-canonical binding) aborts the WHOLE batch with its reason —
 * a consequential effect is never dispatched without a valid claim. It performs NO Boundary-B
 * verification and NO consumption.
 */
export function governedRequests(job: Job, approved: JobProposal[], authority: DispatchAuthority): GovernedRequests {
  const requests: ExecutionRequest[] = [];
  for (const proposal of approved) {
    const minted = mintClaimForApprovedProposal({
      proposal,
      actor: authority.actor,
      tenantId: authority.tenantId,
      nowMs: authority.nowMs,
      ttlMs: authority.ttlMs,
      nonce: authority.nonce(),
    });
    if (!minted.minted) return { ok: false, reason: minted.reason };
    // A successful mint guarantees actor/tenantId are non-null (mint fails closed on either),
    // and that `proposal.execution` is present (else NO_EXECUTION_BINDING) → the request is non-null.
    requests.push(
      bindingToRequest(job, proposal, {
        claim: minted.claim,
        actor: authority.actor as string,
        tenantId: authority.tenantId as string,
      })!,
    );
  }
  return { ok: true, requests };
}

/** Aggregate one-or-more terminal sessions into a single job outcome (any failure fails the job). */
export function aggregateOutcome(sessions: ExecutionSession[], executor: string): WorkforceExecutionOutcome {
  if (sessions.length === 0) {
    return { ok: false, summary: null, error: 'No execution ran', executionId: '', executor };
  }
  const failed = sessions.find((s) => s.state !== 'completed');
  const last = sessions[sessions.length - 1];
  return {
    ok: !failed,
    summary: failed ? null : (last.resultSummary ?? 'Executed'),
    error: failed ? (failed.error ?? 'Execution failed') : null,
    executionId: last.id,
    executor,
  };
}
