/**
 * EPIC 12 — Customer Monitoring. Configures customer dashboards and health / usage / error / AI /
 * integration monitoring. Health REUSES the operations overview when wired in (real platform state);
 * usage/error/AI/business metrics require real customer production traffic and are reported as
 * business-data-pending until then — this NEVER fabricates a live metric.
 */
import { NO_CUSTOMER_DATA } from './constants';
import type { CustomerDeploymentContext } from './types';
import type { DeploymentGovernance } from './governance';
import type { CustomerDeploymentRuntime } from './runtime';

export const MONITOR_CATEGORIES = ['health', 'usage', 'error', 'ai', 'integration'] as const;
export type MonitorCategory = (typeof MONITOR_CATEGORIES)[number];

export interface MonitoringConfig {
  deploymentId: string;
  dashboards: string[];
  categories: MonitorCategory[];
  reusedOperations: boolean;
}

export class CustomerMonitoring {
  constructor(
    private readonly ctx: CustomerDeploymentContext,
    private readonly runtime: CustomerDeploymentRuntime,
    private readonly gov: DeploymentGovernance,
    private readonly operator: string,
  ) {}

  categories(): readonly MonitorCategory[] {
    return MONITOR_CATEGORIES;
  }

  async configure(input: { deploymentId: string; dashboards?: string[] }): Promise<MonitoringConfig> {
    const deployment = this.require(input.deploymentId);
    const config: MonitoringConfig = {
      deploymentId: input.deploymentId,
      dashboards: input.dashboards ?? ['overview', 'health', 'usage', 'integrations'],
      categories: [...MONITOR_CATEGORIES],
      reusedOperations: Boolean(this.ctx.operations),
    };
    await this.gov.record({
      operator: this.operator,
      customer: deployment.customerId,
      tenant: deployment.tenantId,
      environment: deployment.environmentId,
      epic: 'E12',
      operation: 'configure-monitoring',
      targetId: input.deploymentId,
      evidence: 'live-verified',
      decision: `${config.dashboards.length} dashboards`,
    });
    return config;
  }

  /** Health reuses the real operations overview when wired; otherwise reports no data honestly. */
  health(): { available: boolean; status: string } {
    if (this.ctx.operations) {
      const overview = this.ctx.operations.operations().overview();
      return { available: true, status: overview.health.status };
    }
    return { available: false, status: NO_CUSTOMER_DATA };
  }

  /** Usage/error/AI metrics require real customer production traffic — never fabricated. */
  metric(category: MonitorCategory): { category: MonitorCategory; live: boolean; value: string } {
    if (category === 'health') {
      const h = this.health();
      return { category, live: h.available, value: h.status };
    }
    return { category, live: false, value: NO_CUSTOMER_DATA };
  }

  private require(deploymentId: string): { customerId: string; tenantId: string; environmentId: string } {
    const d = this.runtime.deployment(deploymentId);
    if (!d) throw new Error(`unknown deployment: ${deploymentId}`);
    return d;
  }
}
