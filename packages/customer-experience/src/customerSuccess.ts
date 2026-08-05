/**
 * EPIC 10 — Customer Success. Health dashboard, adoption dashboard, success checklist, usage summary,
 * and renewal readiness. Health/adoption REUSE the Sprint-6 customer-success operations (which reuse the
 * Sprint-5 customer-success math) and are computed ONLY from real supplied usage; with no data the
 * honest answer is null / "no data". Customer behavior is never fabricated.
 */
import { NO_CUSTOMER_DATA } from './constants';
import type { CxContext } from './types';
import type { CustomerExperienceGovernance } from './governance';

export interface SuccessDashboard {
  hasData: boolean;
  healthScore: number | null;
  adoptionScore: number | null;
  renewalReady: boolean | null;
  reusedRelease: boolean;
  note: string;
}

export interface UsageInput {
  activeUsers: number;
  provisionedUsers: number;
  featuresUsed: number;
  featuresAvailable: number;
  milestonesHit: number;
  milestonesTotal: number;
}

export class CustomerSuccessCenter {
  constructor(
    private readonly ctx: CxContext,
    private readonly gov: CustomerExperienceGovernance,
    private readonly operator: string,
  ) {}

  successChecklist(): string[] {
    return ['account verified', 'workspace created', 'first project', 'team invited', 'AI provider configured'];
  }

  /** Reuses the Sprint-6 customer-success operations; null score with no real usage. */
  async dashboard(input: { deploymentId?: string; usage?: UsageInput } = {}): Promise<SuccessDashboard> {
    if (this.ctx.release && input.deploymentId) {
      const snap = await this.ctx.release.customerSuccess().snapshot({ deploymentId: input.deploymentId, ...(input.usage ? { usage: input.usage } : {}) });
      await this.record(input.deploymentId, snap.hasData ? `health ${snap.healthScore}` : 'no-data');
      return { hasData: snap.hasData, healthScore: snap.healthScore, adoptionScore: snap.adoptionScore, renewalReady: snap.renewalReady, reusedRelease: true, note: snap.note };
    }
    await this.record('_none', 'no-data');
    return { hasData: false, healthScore: null, adoptionScore: null, renewalReady: null, reusedRelease: false, note: NO_CUSTOMER_DATA };
  }

  private async record(targetId: string, decision: string): Promise<void> {
    await this.gov.record({ actor: this.operator, customer: '_success', organization: '_cx', epic: 'E10', operation: 'success-dashboard', targetId, evidence: 'business-data-pending', decision });
  }
}
