/**
 * S5.4 Phase 0 · FG-10 · the L6 EXECUTION-TIME GATE — the non-frozen logic behind the one gated call
 * inside `connectors/index.ts` (before `governedSend`).
 *
 * For an L6-proposal-driven `mail.send`, it RE-DERIVES admissibility from the runtime substrate and
 * refuses on any mismatch (deny-by-default); the proposal's own words are never re-trusted. A refusal
 * returns an OBSERVABLE `DENIED` `ConnectorWriteResult` — the SAME shape the FG-4 guard denial returns,
 * never a silent drop (condition 3). Non-`mail.send`, or a `mail.send` with no stashed L6 proposal, →
 * `{ ok: true }` (SKIP): the existing assistant/deterministic path is behaviorally IDENTICAL (condition 2).
 *
 * GATE ≠ OBSERVER: the FG-5 ActionRecord observer stays best-effort and never blocks; THIS gate MAY
 * refuse — but only L6-proposal-driven executions, never the non-L6 path. Execution order in the handler:
 * FG-10 (this) runs FIRST, then the FG-4 first-real-send guard, then `governedSend` — so a refused
 * proposal never touches the latch.
 */
import type { ConnectorWriteResult } from '@neuropause/shared';
import { gateL6Execution } from './proposalStore';
import type { ExecutionDeps } from './proposalExecutionBoundary';
import type { AuthorityRequirement, VerificationPlan, ProposalTarget } from './proposal';
import { mutationAssuranceFor } from '../capabilities/liveCapabilitySources';
import { createLogger } from '../logger';

const log = createLogger('l6-gate');

export type L6GateResult = { readonly ok: true } | { readonly ok: false; readonly refusal: ConnectorWriteResult };

/**
 * Shared authority derivation (RBAC/CST via L4) — the SINGLE source both propose and execute use.
 * EXPORTED so the propose lane (`brainProposeLane`) builds with LITERALLY these functions — a proposal formed from any
 * other derivation would fail the execution-time re-derivation comparison (deny-by-default), which is the point.
 */
export function deriveAuthority(capabilityId: string, target: ProposalTarget): AuthorityRequirement {
  return {
    requiresApproval: true,
    governanceStatus: mutationAssuranceFor(target.connector),
    requiredGate: 'human-confirm + CST admission',
    policyVersion: capabilityId === 'mail.send' ? 'm365-send-policy-1' : null,
  };
}

/** Shared oracle-registry derivation — mail.send → the S16 plan; else honestly UNVERIFIABLE. */
export function deriveOracle(capabilityId: string): VerificationPlan {
  return capabilityId === 'mail.send'
    ? { verifiable: 'send-corroboration', oracleId: 'verifyEffect', note: 'send-corroboration, not delivery', needs: null, productionWired: false }
    : { verifiable: false, oracleId: null, note: 'no oracle for this capability', needs: 'a per-capability oracle', productionWired: false };
}

export interface RuntimeExecuteDeps {
  workspaceId(): string | null;
}
export interface ExecuteRequestLike {
  readonly actionId: string;
  readonly accountId: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export function l6ExecutionGate(deps: RuntimeExecuteDeps, r: ExecuteRequestLike, nowMs?: number): L6GateResult {
  if (r.actionId !== 'mail.send') return { ok: true }; // only the certified consequential capability is gated
  const tenantId = deps.workspaceId() ?? '';
  // Phase-0 placeholder state hash (stable per tenant → no false drift); the propose seam supplies the real one.
  const stateHash = tenantId;
  const execDeps: ExecutionDeps = {
    nowMs: nowMs ?? Date.now(),
    currentTenantId: tenantId,
    currentStateHash: stateHash,
    stateHashAtProposal: stateHash,
    authorityFor: deriveAuthority,
    oracleFor: deriveOracle,
    isCertifiedConsequential: (c) => c === 'mail.send',
  };
  const gate = gateL6Execution({ tenantId, capabilityId: r.actionId, account: r.accountId, params: r.params }, execDeps);
  if (gate.gate === 'refuse') {
    log.warn(`L6-GATE REFUSE capability=${r.actionId} tenant=${tenantId} — ${gate.reason}`);
    return { ok: false, refusal: { ok: false, message: 'L6 execution gate refused', data: { outcome: 'DENIED', reason: gate.reason } } };
  }
  // Observability: ADMIT (a stashed L6 proposal re-derived clean and was consumed) is distinguishable from SKIP in the
  // main log — the running-app proof that a send was Brain-PROPOSED, not merely governed. Never alters the outcome.
  if (gate.gate === 'admit') log.info(`L6-GATE ADMIT capability=${gate.capabilityId} tenant=${tenantId}`);
  return { ok: true }; // 'admit' (proceed) or 'skip' (non-L6 / no stashed proposal — unchanged)
}
