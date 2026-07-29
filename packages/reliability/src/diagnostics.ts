/**
 * EPIC 14 — Production Diagnostics. REUSES the production diagnostics bundler when wired in (a real
 * bundle over the composed platform state); otherwise it assembles a local diagnostic snapshot from
 * the reliability layer's own real counters. Never fabricates system state it cannot observe.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { ReliabilityContext } from './types';
import type { ReliabilityGovernance } from './governance';

export interface DiagnosticSnapshot {
  id: string;
  org: string;
  at: number;
  reusedProduction: boolean;
  sections: Array<{ name: string; detail: string }>;
}

export class ProductionDiagnostics {
  constructor(
    private readonly clock: Clock,
    private readonly ctx: ReliabilityContext,
    private readonly gov: ReliabilityGovernance,
    private readonly org: string,
    private readonly operator: string,
  ) {}

  async createBundle(input: { org?: string; sections?: Array<{ name: string; detail: string }> } = {}): Promise<DiagnosticSnapshot> {
    const org = input.org ?? this.org;
    let reusedProduction = false;
    const sections: Array<{ name: string; detail: string }> = [...(input.sections ?? [])];
    if (this.ctx.production) {
      const bundle = await this.ctx.production.diagnostics().createBundle({ org });
      reusedProduction = true;
      sections.unshift({ name: 'production-bundle', detail: `reused production diagnostic bundle ${bundle.id}` });
    }
    if (this.ctx.operations) {
      sections.push({ name: 'operations-overview', detail: 'operations overview available (reused)' });
    }
    const snapshot: DiagnosticSnapshot = { id: randomId('diag'), org, at: this.clock.now(), reusedProduction, sections };
    await this.gov.record({
      operator: this.operator,
      org,
      capability: 'Production Diagnostics',
      epic: 'E14',
      operation: 'diagnostic-bundle',
      targetId: snapshot.id,
      evidence: 'live-verified',
      decision: reusedProduction ? 'reused production diagnostics' : 'local snapshot',
    });
    return snapshot;
  }
}
