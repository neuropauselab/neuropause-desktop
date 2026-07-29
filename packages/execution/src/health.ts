/**
 * Module 6 — Connector Health Monitoring. Active health probes: run a lightweight
 * non-mutating operation through the execution engine and derive a health state from the
 * real outcome. Against the local server the probe genuinely executes (live-verified);
 * against a real SaaS it is infra-pending until credentials exist.
 */
import type { Clock } from '@neuropause/cloud-core';
import type { ConnectorExecutionEngine } from './engine';
import type { UniversalConnectorRuntime } from './runtime';

export type HealthState = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface HealthCheck {
  connectorId: string;
  state: HealthState;
  lastCheckedAt: number;
  latencyMs?: number;
  detail?: string;
}

export class ConnectorHealthMonitor {
  private readonly health = new Map<string, HealthCheck>();

  constructor(
    private readonly engine: ConnectorExecutionEngine,
    private readonly connectors: UniversalConnectorRuntime,
    private readonly clock: Clock,
  ) {}

  async probe(tenantId: string, connectorId: string, opts: { operation?: string; baseUrl?: string; token?: string } = {}): Promise<HealthCheck> {
    const connector = this.connectors.get(connectorId);
    const operation = opts.operation ?? connector?.operations.find((o) => !o.mutating)?.name;
    if (!connector || !operation) {
      const check: HealthCheck = { connectorId, state: 'unknown', lastCheckedAt: this.clock.now(), detail: 'no probe operation' };
      this.health.set(connectorId, check);
      return check;
    }
    const result = await this.engine.execute({ tenantId, actor: 'health-monitor', connectorId, operation, ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}), ...(opts.token ? { token: opts.token } : {}) });
    const state: HealthState = result.outcome === 'success' ? 'healthy' : result.outcome === 'dead-lettered' || result.outcome === 'circuit-open' ? 'down' : 'degraded';
    const check: HealthCheck = { connectorId, state, lastCheckedAt: this.clock.now(), latencyMs: result.latencyMs, ...(result.error ? { detail: result.error } : {}) };
    this.health.set(connectorId, check);
    return check;
  }

  get(connectorId: string): HealthCheck | undefined {
    return this.health.get(connectorId);
  }
  all(): HealthCheck[] {
    return [...this.health.values()];
  }
  summary(): { healthy: number; degraded: number; down: number; unknown: number } {
    const s = { healthy: 0, degraded: 0, down: 0, unknown: 0 };
    for (const h of this.health.values()) s[h.state] += 1;
    return s;
  }
}
