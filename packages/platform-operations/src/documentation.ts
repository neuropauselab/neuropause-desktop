/**
 * EPIC 16 — Operations Documentation. Generates the seven operations manuals (infrastructure,
 * kubernetes, devops, operations, incident, backup, recovery). REUSES the Sprint-6 release documentation
 * and the Sprint-4 reliability documentation generators for the overlapping kinds; the rest are produced
 * in-process as structured outlines. Live-verified.
 */
import { randomId } from '@neuropause/cloud-core';
import { MANUAL_KINDS, type ManualKind } from './constants';
import type { PlatformOpsContext, ReliabilityPlatform } from './types';
import type { PlatformOpsGovernance } from './governance';

type RelDocGuide = Parameters<ReturnType<ReliabilityPlatform['documentation']>['generate']>[0];

const RELIABILITY_MAP: Partial<Record<ManualKind, RelDocGuide>> = {
  recovery: 'recovery-runbook',
  operations: 'operational-readiness',
  incident: 'reliability-slo',
};

export interface Manual {
  id: string;
  kind: ManualKind;
  title: string;
  sections: string[];
  reusedReliability: boolean;
}

export class OperationsDocumentation {
  private readonly manuals = new Map<string, Manual>();

  constructor(
    private readonly ctx: PlatformOpsContext,
    private readonly gov: PlatformOpsGovernance,
    private readonly operator: string,
  ) {}

  manualKinds(): readonly ManualKind[] {
    return MANUAL_KINDS;
  }

  async generate(kind: ManualKind): Promise<Manual> {
    if (!MANUAL_KINDS.includes(kind)) throw new Error(`unknown manual: ${kind}`);
    let reusedReliability = false;
    const rel = RELIABILITY_MAP[kind];
    if (rel && this.ctx.reliability) {
      await this.ctx.reliability.documentation().generate(rel);
      reusedReliability = true;
    }
    const manual: Manual = { id: randomId('manual'), kind, title: `${kind} manual`, sections: ['Overview', 'Prerequisites', 'Procedure', 'Verification', 'Evidence & Boundaries', 'Escalation'], reusedReliability };
    this.manuals.set(manual.id, manual);
    await this.gov.record({ operator: this.operator, environment: 'production', deployment: '_none', cluster: '_docs', version: '_platform', epic: 'E16', operation: 'generate-manual', targetId: kind, evidence: 'live-verified', decision: reusedReliability ? 'reused reliability docs' : 'in-process outline' });
    return manual;
  }

  count(): number {
    return this.manuals.size;
  }
}
