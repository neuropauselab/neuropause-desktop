/**
 * Module 15 — Connector Analytics. Success/error rate, outcome breakdown, per-connector
 * call/error counts, and latency (avg + p95) over the REAL execution history, plus the
 * dead-letter count. No synthetic numbers — everything derives from executions that ran.
 */
import type { ConnectorExecutionEngine } from './engine';
import type { RetryRecoveryEngine } from './reliability';
import type { ExecutionOutcome } from './constants';

export interface AnalyticsReport {
  tenantId: string;
  totalExecutions: number;
  successRate: number;
  errorRate: number;
  byOutcome: Partial<Record<ExecutionOutcome, number>>;
  byConnector: Record<string, { calls: number; errors: number }>;
  avgLatencyMs: number;
  p95LatencyMs: number;
  deadLetters: number;
}

export class ConnectorAnalytics {
  constructor(
    private readonly engine: ConnectorExecutionEngine,
    private readonly recovery: RetryRecoveryEngine,
  ) {}

  report(tenantId: string): AnalyticsReport {
    const execs = this.engine.history(tenantId);
    const total = execs.length;
    const byOutcome: Partial<Record<ExecutionOutcome, number>> = {};
    const byConnector: Record<string, { calls: number; errors: number }> = {};
    for (const e of execs) {
      byOutcome[e.outcome] = (byOutcome[e.outcome] ?? 0) + 1;
      const c = byConnector[e.connectorId] ?? { calls: 0, errors: 0 };
      c.calls += 1;
      if (e.outcome !== 'success') c.errors += 1;
      byConnector[e.connectorId] = c;
    }
    const successes = byOutcome.success ?? 0;
    const latencies = execs.map((e) => e.latencyMs).sort((a, b) => a - b);
    const avg = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
    const p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : 0;
    return {
      tenantId,
      totalExecutions: total,
      successRate: total ? Math.round((successes / total) * 100) / 100 : 0,
      errorRate: total ? Math.round(((total - successes) / total) * 100) / 100 : 0,
      byOutcome,
      byConnector,
      avgLatencyMs: avg,
      p95LatencyMs: p95,
      deadLetters: this.recovery.deadLetters(tenantId).length,
    };
  }
}
