/**
 * Module 8 — Observability Platform. Metrics, logs, traces, alerts, health checks, dashboards,
 * service maps, and error analytics. REUSES the operations base observability (dashboard) and health
 * registry when connected. The observability RUNTIME is live-verified; the production METRICS it
 * would carry are business-data-pending — with no deployed environment emitting telemetry, counters
 * read 0, never a fabricated value.
 */
import { type Clock } from '@neuropause/cloud-core';
import type { ProductionGovernance } from './governance';
import type { ProductionContext } from './types';
import { NO_PRODUCTION_DATA } from './constants';

export interface LogEntry { at: number; level: 'info' | 'warn' | 'error'; message: string }

export class ObservabilityPlatform {
  private readonly metrics = new Map<string, number>();
  private readonly logs: LogEntry[] = [];
  private readonly alerts: Array<{ id: string; rule: string; firing: boolean }> = [];
  private traces = 0;

  constructor(
    private readonly clock: Clock,
    private readonly governance: ProductionGovernance,
    private readonly ctx: ProductionContext = {},
  ) {}

  async recordMetric(input: { name: string; value: number; org?: string }): Promise<number> {
    const next = (this.metrics.get(input.name) ?? 0) + input.value;
    this.metrics.set(input.name, next);
    await this.governance.record({ operator: 'system', org: input.org ?? '_ops', environment: '_platform', operation: 'observability.metric', targetId: input.name, evidence: 'business-data-pending', decision: `${input.name}+=${input.value}` });
    return next;
  }
  log(level: LogEntry['level'], message: string): void { this.logs.push({ at: this.clock.now(), level, message }); }
  trace(): number { return ++this.traces; }
  defineAlert(rule: string): { id: string; rule: string; firing: boolean } {
    const a = { id: `alert:${this.alerts.length + 1}`, rule, firing: false };
    this.alerts.push(a);
    return a;
  }

  metric(name: string): number { return this.metrics.get(name) ?? 0; }
  errorAnalytics(): { errors: number; total: number } {
    return { errors: this.logs.filter((l) => l.level === 'error').length, total: this.logs.length };
  }

  /** Dashboard REUSES the operations observability dashboard when present; honest absence otherwise. */
  dashboard(): { connected: boolean; metrics: number; note: string } {
    const ops = this.ctx.operations;
    if (ops) {
      const d = ops.observability().dashboard();
      return { connected: true, metrics: this.metrics.size, note: `reused operations dashboard (${Object.keys(d.subsystems).length} subsystems)` };
    }
    return { connected: false, metrics: this.metrics.size, note: this.metrics.size > 0 ? 'local production metrics only' : NO_PRODUCTION_DATA };
  }

  /** Service health REUSES the operations health registry liveness when present. */
  serviceHealth(): { status: string; note: string } {
    const ops = this.ctx.operations;
    if (!ops) return { status: NO_PRODUCTION_DATA, note: 'no operations platform connected' };
    return { status: ops.health().liveness().status, note: 'reused operations health registry' };
  }

  metricCount(): number { return this.metrics.size; }
}
