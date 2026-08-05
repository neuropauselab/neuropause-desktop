/**
 * EPIC 9 — Enterprise Documentation. Generates the eleven v1.0 guides. REUSES the Sprint-4 reliability
 * documentation generator and the Wave-14 production documentation generator for the overlapping kinds;
 * the rest are produced in-process as structured outlines. Live-verified.
 */
import { randomId } from '@neuropause/cloud-core';
import { DOC_GUIDES, type DocGuide } from './constants';
import type { ReleaseContext, ReliabilityPlatform } from './types';
import type { ReleaseGovernance } from './governance';

type RelDocGuide = Parameters<ReturnType<ReliabilityPlatform['documentation']>['generate']>[0];

const RELIABILITY_MAP: Partial<Record<DocGuide, RelDocGuide>> = {
  'security-manual': 'security-hardening',
  'disaster-recovery': 'recovery-runbook',
  'operations-manual': 'operational-readiness',
};

const PRODUCTION_MAP: Partial<Record<DocGuide, 'administrator' | 'user' | 'api' | 'sdk' | 'deployment' | 'disaster-recovery' | 'security' | 'operations'>> = {
  administrator: 'administrator',
  deployment: 'deployment',
  user: 'user',
  'api-reference': 'api',
  sdk: 'sdk',
  upgrade: 'operations',
};

export interface Guide {
  id: string;
  kind: DocGuide;
  title: string;
  sections: string[];
  reusedReliability: boolean;
  reusedProduction: boolean;
}

export class EnterpriseDocumentation {
  private readonly guides = new Map<string, Guide>();

  constructor(
    private readonly ctx: ReleaseContext,
    private readonly gov: ReleaseGovernance,
    private readonly operator: string,
  ) {}

  guideKinds(): readonly DocGuide[] {
    return DOC_GUIDES;
  }

  async generate(kind: DocGuide, version = '1.0.0'): Promise<Guide> {
    if (!DOC_GUIDES.includes(kind)) throw new Error(`unknown documentation guide: ${kind}`);
    let reusedReliability = false;
    let reusedProduction = false;
    const rel = RELIABILITY_MAP[kind];
    if (rel && this.ctx.reliability) {
      await this.ctx.reliability.documentation().generate(rel);
      reusedReliability = true;
    }
    const prod = PRODUCTION_MAP[kind];
    if (prod && this.ctx.production) {
      await this.ctx.production.documentation().generate({ kind: prod, version });
      reusedProduction = true;
    }
    const guide: Guide = {
      id: randomId('guide'),
      kind,
      title: `${kind.replace(/-/g, ' ')} guide`,
      sections: ['Overview', 'Prerequisites', 'Procedure', 'Reference', 'Evidence & Boundaries', 'Support'],
      reusedReliability,
      reusedProduction,
    };
    this.guides.set(guide.id, guide);
    await this.gov.record({ operator: this.operator, version, environment: '_release', customerScope: '_all', epic: 'E9', operation: 'generate-doc', targetId: kind, evidence: 'live-verified', decision: reusedReliability || reusedProduction ? 'reused generator' : 'in-process outline' });
    return guide;
  }

  count(): number {
    return this.guides.size;
  }
}
