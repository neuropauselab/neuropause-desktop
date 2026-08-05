/**
 * EPIC 12 — Production Monitoring Activation. Prometheus, Grafana, Loki, OpenTelemetry, Alertmanager,
 * and node/redis/postgres/qdrant/container/cluster exporters. Components are ACTIVATED as
 * configuration (status 'configured') — a component is not marked 'running' until a real endpoint
 * responds, which does not happen here. REUSES the Sprint-1 deploy monitoring config and the
 * operations observability dashboard when connected.
 */
import { randomId } from '@neuropause/cloud-core';
import type { InfraGovernance } from './governance';
import type { InfraContext } from './types';
import { NO_INFRA_DATA } from './constants';

export const MONITORING_COMPONENTS = ['prometheus', 'grafana', 'loki', 'opentelemetry', 'alertmanager', 'node-exporter', 'redis-exporter', 'postgres-exporter', 'qdrant-metrics', 'container-metrics', 'cluster-metrics'] as const;
export type MonitoringComponent = (typeof MONITORING_COMPONENTS)[number];

export interface ComponentActivation { id: string; component: MonitoringComponent; status: 'configured' | 'running'; note: string }

export class MonitoringActivation {
  private readonly components = new Map<string, ComponentActivation>();

  constructor(
    private readonly governance: InfraGovernance,
    private readonly ctx: InfraContext = {},
  ) {}

  async activate(component: MonitoringComponent, org?: string): Promise<ComponentActivation> {
    if (!MONITORING_COMPONENTS.includes(component)) throw new Error(`unknown monitoring component: ${component}`);
    const c: ComponentActivation = { id: randomId('mon'), component, status: 'configured', note: 'component configured — not marked running until a real endpoint responds' };
    this.components.set(c.id, c);
    await this.governance.record({ operator: 'system', org: org ?? '_platform', environment: '_platform', epic: 'E12', operation: `monitoring.activate.${component}`, targetId: c.id, evidence: 'infrastructure-pending' });
    return c;
  }

  /** Monitoring stack config REUSED from the Sprint-1 deploy foundation. */
  configuredComponents(): string[] {
    return this.ctx.deploy ? this.ctx.deploy.monitoring().components() : [];
  }

  /** Dashboard REUSES the operations observability dashboard when connected; honest otherwise. */
  dashboard(): { connected: boolean; note: string } {
    if (this.ctx.operations) return { connected: true, note: 'reused operations observability dashboard' };
    return { connected: false, note: NO_INFRA_DATA };
  }

  runningCount(): number { return [...this.components.values()].filter((c) => c.status === 'running').length; }
  list(): ComponentActivation[] { return [...this.components.values()]; }
  count(): number { return this.components.size; }
}
