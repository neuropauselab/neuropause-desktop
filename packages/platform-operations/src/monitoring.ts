/**
 * EPIC 10 — Monitoring Platform. Prometheus / Grafana / Loki / OpenTelemetry descriptors + dashboards
 * for infrastructure / AI / API / database / customer platform. The stack components are represented
 * (adapter-verified) until real endpoints are configured; dashboards are declared in-process. Platform
 * health REUSES the operations overview when wired in. No live metric is fabricated.
 */
import { randomId } from '@neuropause/cloud-core';
import { MONITORING_STACK, NO_INFRA_DATA, type MonitoringComponent } from './constants';
import type { PlatformOpsContext } from './types';
import type { PlatformOpsGovernance } from './governance';

export const DASHBOARD_KINDS = ['infrastructure', 'ai', 'api', 'database', 'customer-platform'] as const;
export type DashboardKind = (typeof DASHBOARD_KINDS)[number];

export interface DashboardDescriptor {
  id: string;
  kind: DashboardKind;
  name: string;
  live: false; // descriptor only — real panels require a configured monitoring stack
}

export class MonitoringPlatform {
  private readonly dashboards = new Map<string, DashboardDescriptor>();

  constructor(
    private readonly ctx: PlatformOpsContext,
    private readonly gov: PlatformOpsGovernance,
    private readonly operator: string,
  ) {}

  stack(): readonly MonitoringComponent[] {
    return MONITORING_STACK;
  }
  dashboardKinds(): readonly DashboardKind[] {
    return DASHBOARD_KINDS;
  }

  async declareDashboard(input: { kind: DashboardKind; name: string }): Promise<DashboardDescriptor> {
    if (!DASHBOARD_KINDS.includes(input.kind)) throw new Error(`unknown dashboard kind: ${input.kind}`);
    const descriptor: DashboardDescriptor = { id: randomId('dash'), kind: input.kind, name: input.name, live: false };
    this.dashboards.set(descriptor.id, descriptor);
    await this.gov.record({ operator: this.operator, environment: 'production', deployment: '_none', cluster: '_monitoring', version: '_platform', epic: 'E10', operation: `dashboard.${input.kind}`, targetId: input.name, evidence: 'live-verified', decision: 'descriptor (not live)' });
    return descriptor;
  }

  /** Platform health reuses the real operations overview when wired; otherwise no data. */
  platformHealth(): { live: boolean; status: string } {
    if (this.ctx.operations) return { live: true, status: this.ctx.operations.operations().overview().health.status };
    return { live: false, status: NO_INFRA_DATA };
  }

  count(): number {
    return this.dashboards.size;
  }
}
