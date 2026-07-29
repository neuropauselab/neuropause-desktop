/**
 * Connector observability (NCEA 10.4, Phase 9). Aggregates connector execution
 * metrics — calls, error rate, retries, average latency, throughput — derived
 * from the `connector.execution` event stream (audit-correlated), plus queue
 * depth. Feeds the SINGLE runtime metrics registry; no separate metrics stack.
 */
import type { EnterpriseRuntime } from '@neuropause/runtime';

interface ConnectorStats {
  calls: number;
  errors: number;
  retries: number;
  totalLatencyMs: number;
}

export interface ConnectorMetrics {
  calls: number;
  errors: number;
  errorRate: number;
  retries: number;
  avgLatencyMs: number;
}

export class ConnectorObservability {
  private readonly stats = new Map<string, ConnectorStats>();
  private queueDepthValue = 0;

  constructor(private readonly runtime: EnterpriseRuntime) {}

  /** Record one execution sample (typically fed from the event stream). */
  observe(connectorId: string, sample: { ok: boolean; retries: number; latencyMs: number }): void {
    const s = this.stats.get(connectorId) ?? { calls: 0, errors: 0, retries: 0, totalLatencyMs: 0 };
    s.calls += 1;
    if (!sample.ok) s.errors += 1;
    s.retries += sample.retries;
    s.totalLatencyMs += sample.latencyMs;
    this.stats.set(connectorId, s);
    this.runtime.observability().metrics.inc(`connector.${connectorId}.calls`);
    if (!sample.ok) this.runtime.observability().metrics.inc(`connector.${connectorId}.errors`);
  }

  setQueueDepth(depth: number): void {
    this.queueDepthValue = depth;
    this.runtime.observability().metrics.set('connector.queue.depth', depth);
  }
  queueDepth(): number {
    return this.queueDepthValue;
  }

  metrics(connectorId: string): ConnectorMetrics {
    const s = this.stats.get(connectorId) ?? { calls: 0, errors: 0, retries: 0, totalLatencyMs: 0 };
    return {
      calls: s.calls,
      errors: s.errors,
      errorRate: s.calls > 0 ? s.errors / s.calls : 0,
      retries: s.retries,
      avgLatencyMs: s.calls > 0 ? s.totalLatencyMs / s.calls : 0,
    };
  }

  all(): Record<string, ConnectorMetrics> {
    const out: Record<string, ConnectorMetrics> = {};
    for (const id of this.stats.keys()) out[id] = this.metrics(id);
    return out;
  }
}
