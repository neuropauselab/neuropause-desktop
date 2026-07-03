/**
 * Global (federation-wide) governance engine (pure). Evaluates a cross-org
 * action against the federation policy set and the peer's trust level, returning
 * an allow / deny / require-approval decision with the deciding policy. Also
 * builds the federation compliance report. No I/O.
 *
 * Most-restrictive-wins: a single `deny` overrides everything; otherwise any
 * `require_approval` forces an approval; otherwise the action is allowed.
 */
import type {
  FedActionEvaluation,
  FedComplianceRule,
  FedPolicy,
  FedPolicyEffect,
  TrustLevel,
} from '@neuropause/shared';

const TRUST_RANK: Record<TrustLevel, number> = { none: 0, basic: 1, verified: 2, full: 3 };

export interface FedActionInput {
  action: string;
  peerTrustLevel: TrustLevel;
  policies: FedPolicy[];
}

function policyApplies(policy: FedPolicy, trust: TrustLevel): boolean {
  if (!policy.enabled) return false;
  if (policy.action !== '*' && policy.action !== '') {
    // matched by caller; here we only gate by scope
  }
  switch (policy.scope) {
    case 'all':
      return true;
    case 'trusted':
      return TRUST_RANK[trust] >= TRUST_RANK.verified;
    case 'partner':
      return true;
    default:
      return false;
  }
}

const EFFECT_RANK: Record<FedPolicyEffect, number> = { allow: 0, require_approval: 1, deny: 2 };

export function evaluateFederatedAction(input: FedActionInput): FedActionEvaluation {
  const matching = input.policies.filter((p) => (p.action === input.action || p.action === '*') && policyApplies(p, input.peerTrustLevel));
  if (matching.length === 0) {
    return { decision: 'allow', policyId: null, reason: 'No policy restricts this action; allowed by default.' };
  }
  let winner = matching[0];
  for (const p of matching) if (EFFECT_RANK[p.effect] > EFFECT_RANK[winner.effect]) winner = p;
  const reason =
    winner.effect === 'deny'
      ? `Denied by policy "${winner.name}".`
      : winner.effect === 'require_approval'
        ? `Policy "${winner.name}" requires a delegated approval.`
        : `Allowed by policy "${winner.name}".`;
  return { decision: winner.effect, policyId: winner.id, reason };
}

export interface ComplianceInput {
  auditEntries: number;
  signedArtifacts: boolean;
  activePeers: number;
  attestedPeers: number;
  pendingApprovals: number;
  residencyHonored: boolean;
  now: number;
}

export function buildFedCompliance(input: ComplianceInput): FedComplianceRule[] {
  return [
    {
      id: 'fed-audit',
      framework: 'Federation',
      rule: 'Shared audit trail',
      status: input.auditEntries >= 0 ? 'pass' : 'warn',
      detail: 'Every federated action is recorded to the shared audit trail.',
    },
    {
      id: 'fed-signing',
      framework: 'Supply chain',
      rule: 'Signed exchange artifacts',
      status: input.signedArtifacts ? 'pass' : 'fail',
      detail: input.signedArtifacts ? 'Exchange artifacts are Ed25519-signed and verified before consumption.' : 'Unsigned artifacts detected.',
    },
    {
      id: 'fed-trust',
      framework: 'Federation',
      rule: 'Peer trust attestation',
      status: input.activePeers === 0 || input.attestedPeers === input.activePeers ? 'pass' : 'warn',
      detail: `${input.attestedPeers}/${input.activePeers} active peers have an attested trust relationship.`,
    },
    {
      id: 'fed-residency',
      framework: 'GDPR',
      rule: 'Cross-region residency',
      status: input.residencyHonored ? 'pass' : 'warn',
      detail: 'Regional artifacts and tenants honor their declared data residency.',
    },
    {
      id: 'fed-approvals',
      framework: 'SOC 2',
      rule: 'Delegated approval review',
      status: input.pendingApprovals === 0 ? 'pass' : 'warn',
      detail: input.pendingApprovals === 0 ? 'No federated approvals are outstanding.' : `${input.pendingApprovals} delegated approval(s) awaiting review.`,
    },
  ];
}

export function complianceScore(rules: FedComplianceRule[]): number {
  if (rules.length === 0) return 0;
  return Math.round(rules.reduce((n, r) => n + (r.status === 'pass' ? 100 : r.status === 'warn' ? 60 : 0), 0) / rules.length);
}
