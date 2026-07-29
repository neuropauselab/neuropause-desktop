/**
 * Module 13 — Enterprise Policy Enforcement. Allow / deny / require-approval rules per
 * tenant, connector, and operation, plus a default that forces approval on high-risk
 * mutating operations. Evaluated before every execution; a deny blocks it (and is
 * governed). This is the policy layer; the HITL gate (Wave 4, reused) governs AI-initiated
 * high-risk actions on top.
 */
import type { PolicyEffect, RiskTier } from './constants';

export interface PolicyRule {
  id: string;
  effect: PolicyEffect;
  tenant?: string;
  connector?: string;
  operation?: string;
  /** deny/require-approval when the operation's risk tier is at or above this. */
  minRiskTier?: RiskTier;
}

export interface PolicyDecision {
  effect: PolicyEffect;
  reason: string;
  policyId?: string;
}

const TIER_RANK: Record<RiskTier, number> = { low: 0, medium: 1, high: 2, restricted: 3 };
const EFFECT_RANK: Record<PolicyEffect, number> = { allow: 0, 'require-approval': 1, deny: 2 };

export class PolicyEngine {
  private readonly rules: PolicyRule[] = [];

  define(rule: PolicyRule): void {
    this.rules.push(rule);
  }
  rulesFor(tenant: string): PolicyRule[] {
    return this.rules.filter((r) => r.tenant === undefined || r.tenant === tenant);
  }

  evaluate(input: { tenantId: string; connectorId: string; operation: string; riskTier?: RiskTier; mutating?: boolean }): PolicyDecision {
    const tier = input.riskTier ?? 'low';
    let decision: PolicyDecision = { effect: 'allow', reason: 'no policy matched (default allow)' };

    // default guardrail: high/restricted mutating operations require approval
    if (input.mutating && (tier === 'high' || tier === 'restricted')) {
      decision = { effect: 'require-approval', reason: `${tier}-risk mutating operation requires approval (default guardrail)` };
    }

    for (const r of this.rules) {
      if (r.tenant !== undefined && r.tenant !== input.tenantId) continue;
      if (r.connector !== undefined && r.connector !== input.connectorId) continue;
      if (r.operation !== undefined && r.operation !== input.operation) continue;
      if (r.minRiskTier !== undefined && TIER_RANK[tier] < TIER_RANK[r.minRiskTier]) continue;
      // strongest effect wins
      if (EFFECT_RANK[r.effect] >= EFFECT_RANK[decision.effect]) {
        decision = { effect: r.effect, reason: `policy '${r.id}'`, policyId: r.id };
      }
    }
    return decision;
  }
}
