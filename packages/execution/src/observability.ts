/**
 * Module 12 — Connector Observability. Per-connector latency, error rate, and throughput
 * metrics from REAL executions (no synthetic numbers). Bounded latency samples feed a p95.
 */
export interface ConnectorMetrics {
  connectorId: string;
  calls: number;
  errors: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
}

interface Agg {
  calls: number;
  errors: number;
  latencies: number[];
}

const SAMPLE_CAP = 1000;

export class ConnectorObservability {
  private readonly stats = new Map<string, Agg>();

  record(connectorId: string, ok: boolean, latencyMs: number): void {
    const a = this.stats.get(connectorId) ?? { calls: 0, errors: 0, latencies: [] };
    a.calls += 1;
    if (!ok) a.errors += 1;
    a.latencies.push(latencyMs);
    if (a.latencies.length > SAMPLE_CAP) a.latencies.shift();
    this.stats.set(connectorId, a);
  }

  private compute(connectorId: string, a: Agg): ConnectorMetrics {
    const sorted = [...a.latencies].sort((x, y) => x - y);
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
    const avg = sorted.length ? Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length) : 0;
    return { connectorId, calls: a.calls, errors: a.errors, errorRate: a.calls ? Math.round((a.errors / a.calls) * 100) / 100 : 0, avgLatencyMs: avg, p95LatencyMs: p95 };
  }

  metrics(connectorId: string): ConnectorMetrics {
    return this.compute(connectorId, this.stats.get(connectorId) ?? { calls: 0, errors: 0, latencies: [] });
  }
  snapshot(): ConnectorMetrics[] {
    return [...this.stats.entries()].map(([id, a]) => this.compute(id, a));
  }
}
