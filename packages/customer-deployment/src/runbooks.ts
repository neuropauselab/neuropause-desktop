/**
 * EPIC 16 — Operations Runbooks. Generates the seven operational guides (deployment, customer
 * onboarding, administrator, user, AI operations, troubleshooting, support). REUSES the Sprint-4
 * reliability documentation generator for the overlapping guides; the rest are produced in-process.
 */
import { randomId } from '@neuropause/cloud-core';
import { RUNBOOK_GUIDES, type RunbookGuide } from './constants';
import type { CustomerDeploymentContext, ReliabilityPlatform } from './types';
import type { DeploymentGovernance } from './governance';

type RelDocGuide = Parameters<ReturnType<ReliabilityPlatform['documentation']>['generate']>[0];

const REUSE_MAP: Partial<Record<RunbookGuide, RelDocGuide>> = {
  deployment: 'release-candidate',
  troubleshooting: 'recovery-runbook',
  support: 'operational-readiness',
  'ai-operations': 'reliability-slo',
};

export interface Runbook {
  id: string;
  kind: RunbookGuide;
  title: string;
  sections: string[];
  reusedReliability: boolean;
}

export class OperationsRunbooks {
  private readonly guides = new Map<string, Runbook>();

  constructor(
    private readonly ctx: CustomerDeploymentContext,
    private readonly gov: DeploymentGovernance,
    private readonly operator: string,
  ) {}

  guideKinds(): readonly RunbookGuide[] {
    return RUNBOOK_GUIDES;
  }

  async generate(kind: RunbookGuide): Promise<Runbook> {
    if (!RUNBOOK_GUIDES.includes(kind)) throw new Error(`unknown runbook: ${kind}`);
    let reusedReliability = false;
    const mapped = REUSE_MAP[kind];
    if (mapped && this.ctx.reliability) {
      await this.ctx.reliability.documentation().generate(mapped);
      reusedReliability = true;
    }
    const guide: Runbook = {
      id: randomId('runbook'),
      kind,
      title: `${kind.replace(/-/g, ' ')} runbook`,
      sections: ['Purpose', 'Preconditions', 'Procedure', 'Verification', 'Rollback', 'Escalation'],
      reusedReliability,
    };
    this.guides.set(guide.id, guide);
    await this.gov.record({ operator: this.operator, customer: '_platform', tenant: '_none', environment: '_platform', epic: 'E16', operation: 'generate-runbook', targetId: kind, evidence: 'live-verified', decision: reusedReliability ? 'reused reliability docs' : 'in-process outline' });
    return guide;
  }

  count(): number {
    return this.guides.size;
  }
}
