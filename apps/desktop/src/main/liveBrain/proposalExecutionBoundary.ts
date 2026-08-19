/**
 * L6 · S5.1 · EXECUTION BOUNDARY — the certified-executor-only projection.
 *
 * `admitForExecution(proposal, deps)` decides whether a CERTIFIED proposal may enter the EXISTING
 * governed path (proposal → confirm → CST → admission → governedSend), for the ONE certified
 * consequential capability. It projects the proposal onto the existing producer's input as DATA; it
 * builds no executor and imports no executor/CST/governedSend value (single-path — §2#7). S5 wires the
 * projection into the existing chain behind its own hard stops.
 *
 * ASK-ONLY IS STRUCTURAL (the S13 pattern): for a consequential action there is NO ALLOW branch in this
 * code — the only disposition is 'ASK' (a human MUST confirm). ALLOW is not configured off; it is ABSENT.
 * It becomes reachable only through a future S28 compiled policy + S38 conditions, each behind its own gate.
 *
 * EXECUTION-TIME RE-DERIVATION: the proposal's OWN words are NEVER re-trusted at execution time. Authority
 * (RBAC/CST), the verification plan (oracle registry), the tenant, the state hash, and expiry are all
 * re-derived/re-checked from the REAL substrate at confirm time and compared to the proposal's claims;
 * ANY mismatch → REFUSED. Deterministic, zero-runtime-import — TYPES only.
 */
import type { Proposal } from './proposal';

/** The re-derivation substrate at CONFIRM time — the runtime supplies these from the REAL sources. */
export interface ExecutionDeps {
  readonly nowMs: number;
  readonly currentTenantId: string;
  readonly currentStateHash: string;
  /** The state hash captured when the proposal was built (tracked with the proposal by the runtime). */
  readonly stateHashAtProposal: string;
  /** RE-DERIVED authority (RBAC/CST) — compared to the proposal's claim; never taken from the proposal. */
  readonly authorityFor: (capabilityId: string, target: Proposal['target']) => Proposal['authorityRequired'];
  /** RE-DERIVED verification plan (oracle registry) — compared to the proposal's claim. */
  readonly oracleFor: (capabilityId: string, params: Proposal['proposedAction']['params']) => Proposal['verificationPlan'];
  /** Is this a currently-certified consequential capability (the ONE: mail.send today)? */
  readonly isCertifiedConsequential: (capabilityId: string) => boolean;
}

/** The projection onto the EXISTING capability:m365.propose producer input — DATA only, no callable. */
export interface ExecuteProjection {
  readonly capabilityId: string;
  readonly params: Proposal['proposedAction']['params'];
  readonly target: Proposal['target'];
  /** The ONLY disposition — a human MUST confirm; there is no ALLOW branch (ASK-only is structural). */
  readonly disposition: 'ASK';
}

export type AdmissionOutcome =
  | { readonly status: 'ADMIT_FOR_ASK'; readonly projection: ExecuteProjection }
  | { readonly status: 'REFUSED'; readonly reason: string };

/** Deterministic canonical serialization for a re-derivation equality check (no crypto import). */
function canon(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canon((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

export function admitForExecution(proposal: Proposal, deps: ExecutionDeps): AdmissionOutcome {
  const cap = proposal.proposedAction.capabilityId;

  // Certified-executor-only: only a certified consequential capability may project to execution.
  if (!deps.isCertifiedConsequential(cap)) {
    return { status: 'REFUSED', reason: 'not a certified consequential capability' };
  }
  // Tenant must still be the current tenant.
  if (proposal.tenantId !== deps.currentTenantId) {
    return { status: 'REFUSED', reason: 'tenant drifted since the proposal was formed' };
  }
  // Expiry enforced AT CONFIRM TIME — an expired proposal is not admissible.
  if (deps.nowMs > proposal.expiry.expiresAtMs) {
    return { status: 'REFUSED', reason: 'proposal expired' };
  }
  // State must not have drifted since reasoning.
  if (deps.stateHashAtProposal !== deps.currentStateHash) {
    return { status: 'REFUSED', reason: 'state changed since the proposal was formed' };
  }
  // RE-DERIVE authority from the real substrate and compare — the proposal's claim is never re-trusted.
  const reAuthority = deps.authorityFor(cap, proposal.target);
  if (canon(reAuthority) !== canon(proposal.authorityRequired)) {
    return { status: 'REFUSED', reason: 'authority re-derivation mismatch' };
  }
  if (!reAuthority.requiresApproval) {
    return { status: 'REFUSED', reason: 'a certified proposal must still require approval at execution time' };
  }
  // RE-DERIVE the verification plan and compare.
  const reOracle = deps.oracleFor(cap, proposal.proposedAction.params);
  if (canon(reOracle) !== canon(proposal.verificationPlan)) {
    return { status: 'REFUSED', reason: 'verification-plan re-derivation mismatch' };
  }

  // ASK-only: project onto the existing producer input. There is NO ALLOW branch — a human MUST confirm.
  return {
    status: 'ADMIT_FOR_ASK',
    projection: { capabilityId: cap, params: proposal.proposedAction.params, target: proposal.target, disposition: 'ASK' },
  };
}
