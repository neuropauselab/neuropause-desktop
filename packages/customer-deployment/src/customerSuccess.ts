/**
 * EPIC 14 — Customer Success Platform. Adoption score, feature usage, health score, success
 * milestones, renewal readiness, and expansion opportunities. Every score is computed from REAL
 * supplied usage numbers; with no data the honest answer is "no customer data available" and a null
 * score. Customer behavior is NEVER fabricated — an empty deployment scores null, not a flattering
 * default.
 */
import { NO_CUSTOMER_DATA } from './constants';
import type { DeploymentGovernance } from './governance';
import type { CustomerDeploymentRuntime } from './runtime';

export interface SuccessInput {
  activeUsers: number;
  provisionedUsers: number;
  featuresUsed: number;
  featuresAvailable: number;
  milestonesHit: number;
  milestonesTotal: number;
}

export interface SuccessScore {
  adoptionScore: number | null; // 0..100
  healthScore: number | null; // 0..100
  renewalReady: boolean | null;
  expansionSignal: boolean | null;
  hasData: boolean;
  note: string;
}

export class CustomerSuccess {
  constructor(
    private readonly runtime: CustomerDeploymentRuntime,
    private readonly gov: DeploymentGovernance,
    private readonly operator: string,
  ) {}

  async score(input: { deploymentId: string; usage?: SuccessInput }): Promise<SuccessScore> {
    const deployment = this.require(input.deploymentId);
    const u = input.usage;
    // No real usage → no score. We do not invent customer behavior.
    if (!u || u.provisionedUsers <= 0) {
      await this.recordScore(deployment, input.deploymentId, 'no-data');
      return { adoptionScore: null, healthScore: null, renewalReady: null, expansionSignal: null, hasData: false, note: NO_CUSTOMER_DATA };
    }
    const adoption = Math.round(Math.max(0, Math.min(1, u.activeUsers / u.provisionedUsers)) * 100);
    const featureUse = u.featuresAvailable > 0 ? Math.max(0, Math.min(1, u.featuresUsed / u.featuresAvailable)) : 0;
    const milestone = u.milestonesTotal > 0 ? Math.max(0, Math.min(1, u.milestonesHit / u.milestonesTotal)) : 0;
    const health = Math.round((adoption / 100) * 50 + featureUse * 30 + milestone * 20);
    const renewalReady = health >= 70;
    const expansionSignal = adoption >= 80 && featureUse >= 0.7;
    await this.recordScore(deployment, input.deploymentId, `adoption ${adoption} / health ${health}`);
    return {
      adoptionScore: adoption,
      healthScore: health,
      renewalReady,
      expansionSignal,
      hasData: true,
      note: `computed from real usage: ${u.activeUsers}/${u.provisionedUsers} active users, ${u.featuresUsed}/${u.featuresAvailable} features.`,
    };
  }

  private async recordScore(deployment: { customerId: string; tenantId: string; environmentId: string }, targetId: string, decision: string): Promise<void> {
    await this.gov.record({ operator: this.operator, customer: deployment.customerId, tenant: deployment.tenantId, environment: deployment.environmentId, epic: 'E14', operation: 'success-score', targetId, evidence: 'business-data-pending', decision });
  }
  private require(deploymentId: string): { customerId: string; tenantId: string; environmentId: string } {
    const d = this.runtime.deployment(deploymentId);
    if (!d) throw new Error(`unknown deployment: ${deploymentId}`);
    return d;
  }
}
