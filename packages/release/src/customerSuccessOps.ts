/**
 * EPIC 8 — Customer Success Operations. Health score, adoption dashboard, success playbooks, renewal
 * dashboard, expansion tracking, and executive business reviews. Scores are computed from REAL supplied
 * usage only; with no data the honest answer is null / "no data". Customer behavior is NEVER fabricated.
 * Success-scoring REUSES the Sprint-5 customer-success engine when wired in.
 */
import { NO_RELEASE_DATA, type LicenseTier } from './constants';
import type { ReleaseContext } from './types';
import type { ReleaseGovernance } from './governance';

export interface SuccessSnapshot {
  hasData: boolean;
  healthScore: number | null;
  adoptionScore: number | null;
  renewalReady: boolean | null;
  expansionSignal: boolean | null;
  note: string;
}

export const SUCCESS_PLAYBOOKS: Record<LicenseTier, string[]> = {
  trial: ['activation checklist', 'first-value milestone', 'conversion review'],
  community: ['self-serve onboarding', 'community resources'],
  professional: ['onboarding plan', 'quarterly review', 'adoption plan'],
  enterprise: ['executive sponsor', 'success plan', 'QBR + EBR', 'expansion review'],
};

export class CustomerSuccessOperations {
  constructor(
    private readonly ctx: ReleaseContext,
    private readonly gov: ReleaseGovernance,
    private readonly operator: string,
  ) {}

  playbooks(tier: LicenseTier): string[] {
    return SUCCESS_PLAYBOOKS[tier];
  }

  /** Health/adoption from REAL usage; null with no data. Reuses the Sprint-5 customer-success math. */
  async snapshot(input: { deploymentId?: string; usage?: { activeUsers: number; provisionedUsers: number; featuresUsed: number; featuresAvailable: number; milestonesHit: number; milestonesTotal: number } }): Promise<SuccessSnapshot> {
    if (this.ctx.customerDeployment && input.deploymentId) {
      const score = await this.ctx.customerDeployment.customerSuccess().score({ deploymentId: input.deploymentId, ...(input.usage ? { usage: input.usage } : {}) });
      await this.record('success-snapshot', input.deploymentId, score.hasData ? `health ${score.healthScore}` : 'no-data');
      return {
        hasData: score.hasData,
        healthScore: score.healthScore,
        adoptionScore: score.adoptionScore,
        renewalReady: score.renewalReady,
        expansionSignal: score.expansionSignal,
        note: score.note,
      };
    }
    await this.record('success-snapshot', input.deploymentId ?? '_none', 'no-data');
    return { hasData: false, healthScore: null, adoptionScore: null, renewalReady: null, expansionSignal: null, note: NO_RELEASE_DATA };
  }

  /** Executive business review — represented as a template; real content requires real usage. */
  executiveBusinessReview(): { sections: string[]; live: boolean } {
    return { sections: ['adoption trend', 'value realized', 'open risks', 'renewal + expansion outlook'], live: false };
  }

  private async record(operation: string, targetId: string, decision: string): Promise<void> {
    await this.gov.record({ operator: this.operator, version: '_ops', environment: '_success', customerScope: '_all', epic: 'E8', operation, targetId, evidence: 'business-data-pending', decision });
  }
}
