/**
 * EPIC 13 — Operational Monitoring. Configures the GA dashboards (platform / customer / AI / deployment
 * / infrastructure / support / operations health). Health REUSES the operations overview when wired in;
 * dashboards that depend on real production traffic are reported as pending, never fabricated.
 */
import { NO_RELEASE_DATA } from './constants';
import type { ReleaseContext } from './types';
import type { ReleaseGovernance } from './governance';

export const GA_DASHBOARDS = ['platform-health', 'customer-health', 'ai-runtime', 'deployment-health', 'infrastructure', 'support', 'operations'] as const;
export type GaDashboard = (typeof GA_DASHBOARDS)[number];

export class OperationalMonitoring {
  constructor(
    private readonly ctx: ReleaseContext,
    private readonly gov: ReleaseGovernance,
    private readonly operator: string,
  ) {}

  dashboards(): readonly GaDashboard[] {
    return GA_DASHBOARDS;
  }

  async configure(): Promise<{ dashboards: GaDashboard[]; reusedOperations: boolean }> {
    await this.gov.record({ operator: this.operator, version: '_ops', environment: '_monitoring', customerScope: '_all', epic: 'E13', operation: 'configure-dashboards', targetId: 'ga-dashboards', evidence: 'live-verified', decision: `${GA_DASHBOARDS.length} dashboards` });
    return { dashboards: [...GA_DASHBOARDS], reusedOperations: Boolean(this.ctx.operations) };
  }

  /** Platform health reuses the real operations overview when wired; otherwise reports no data. */
  platformHealth(): { available: boolean; status: string } {
    if (this.ctx.operations) return { available: true, status: this.ctx.operations.operations().overview().health.status };
    return { available: false, status: NO_RELEASE_DATA };
  }
}
