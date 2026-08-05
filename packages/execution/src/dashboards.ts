/**
 * Module 16 — Production Dashboards. A tenant-scoped operational view of the execution
 * platform, composed from analytics, health, and the dead-letter queue: execution health,
 * connector health, dead letters, top connectors, and the outcome breakdown. Pure read
 * model over live state.
 */
import type { ConnectorAnalytics } from './analytics';
import type { ConnectorHealthMonitor } from './health';
import type { RetryRecoveryEngine } from './reliability';
import type { ExecutionOutcome } from './constants';

export interface ProductionDashboard {
  tenantId: string;
  panels: {
    executionHealth: { total: number; successRate: number; errorRate: number; avgLatencyMs: number; p95LatencyMs: number };
    connectorHealth: { healthy: number; degraded: number; down: number; unknown: number };
    deadLetters: number;
    topConnectors: Array<{ connector: string; calls: number; errors: number }>;
    outcomes: Partial<Record<ExecutionOutcome, number>>;
  };
}

export class ProductionDashboards {
  constructor(
    private readonly analytics: ConnectorAnalytics,
    private readonly health: ConnectorHealthMonitor,
    private readonly recovery: RetryRecoveryEngine,
  ) {}

  build(tenantId: string): ProductionDashboard {
    const a = this.analytics.report(tenantId);
    return {
      tenantId,
      panels: {
        executionHealth: { total: a.totalExecutions, successRate: a.successRate, errorRate: a.errorRate, avgLatencyMs: a.avgLatencyMs, p95LatencyMs: a.p95LatencyMs },
        connectorHealth: this.health.summary(),
        deadLetters: this.recovery.deadLetters(tenantId).length,
        topConnectors: Object.entries(a.byConnector)
          .map(([connector, v]) => ({ connector, calls: v.calls, errors: v.errors }))
          .sort((x, y) => y.calls - x.calls)
          .slice(0, 5),
        outcomes: a.byOutcome,
      },
    };
  }
}
