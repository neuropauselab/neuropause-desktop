/**
 * EPIC 19 — Reliability Documentation. Generates nine structured guide outlines (validation strategy,
 * performance engineering, chaos engineering, recovery runbook, security hardening, compliance
 * readiness, reliability/SLO, operational readiness, release candidate). REUSES the production
 * documentation generator for the overlapping kinds (security → security, recovery → disaster-recovery,
 * operational → operations). Live-verified; the outlines are produced in-process.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import { DOC_GUIDES, type DocGuide } from './constants';
import type { ReliabilityContext } from './types';
import type { ReliabilityGovernance } from './governance';

export interface Guide {
  id: string;
  kind: DocGuide;
  title: string;
  sections: string[];
  reusedProduction: boolean;
  at: number;
}

const TITLES: Record<DocGuide, string> = {
  'validation-strategy': 'Production Validation Strategy',
  'performance-engineering': 'Performance Engineering Guide',
  'chaos-engineering': 'Chaos Engineering Handbook',
  'recovery-runbook': 'Backup & Recovery Runbook',
  'security-hardening': 'Security Hardening Guide',
  'compliance-readiness': 'Compliance Readiness Guide',
  'reliability-slo': 'Reliability & SLO Guide',
  'operational-readiness': 'Operational Readiness Guide',
  'release-candidate': 'Release Candidate Playbook',
};

export class ReliabilityDocumentation {
  private readonly guides = new Map<string, Guide>();

  constructor(
    private readonly clock: Clock,
    private readonly ctx: ReliabilityContext,
    private readonly gov: ReliabilityGovernance,
    private readonly org: string,
    private readonly operator: string,
  ) {}

  guideKinds(): readonly DocGuide[] {
    return DOC_GUIDES;
  }

  async generate(kind: DocGuide, org?: string): Promise<Guide> {
    if (!DOC_GUIDES.includes(kind)) throw new Error(`unknown guide kind: ${kind}`);
    let reusedProduction = false;
    if (this.ctx.production) {
      if (kind === 'security-hardening') {
        await this.ctx.production.documentation().generate({ kind: 'security' });
        reusedProduction = true;
      } else if (kind === 'recovery-runbook') {
        await this.ctx.production.documentation().generate({ kind: 'disaster-recovery' });
        reusedProduction = true;
      } else if (kind === 'operational-readiness') {
        await this.ctx.production.documentation().generate({ kind: 'operations' });
        reusedProduction = true;
      }
    }
    const guide: Guide = {
      id: randomId('guide'),
      kind,
      title: TITLES[kind],
      sections: ['Overview', 'Scope & Evidence Level', 'Procedure', 'Verification', 'Honesty Boundary', 'References'],
      reusedProduction,
      at: this.clock.now(),
    };
    this.guides.set(guide.id, guide);
    await this.gov.record({
      operator: this.operator,
      org: org ?? this.org,
      capability: 'Reliability Documentation',
      epic: 'E19',
      operation: 'generate-guide',
      targetId: kind,
      evidence: 'live-verified',
      decision: reusedProduction ? 'reused production docs' : 'in-process outline',
    });
    return guide;
  }

  list(): Guide[] {
    return [...this.guides.values()];
  }
  count(): number {
    return this.guides.size;
  }
}
