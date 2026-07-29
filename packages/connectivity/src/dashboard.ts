/**
 * Module 11 — Connector Dashboard. A tenant-scoped operational view assembled from the
 * lifecycle (health, connection status, last error) and the sync orchestrator (sync
 * history, failures, latency, retry queue, dead letters). Pure read model — it computes
 * from the live state the other modules already maintain; it stores nothing itself.
 */
import type { ConnectorLifecycle } from './lifecycle';
import type { SyncOrchestrator, SyncOutcome } from './sync';
import type { LifecycleState } from './constants';

export interface ConnectorDashboardRow {
  connectorId: string;
  state: LifecycleState;
  healthy: boolean;
  lastSyncAt?: number;
  lastError?: string;
  syncs: number;
  failures: number;
  avgLatencyMs: number;
  retryQueue: number;
}

export interface DashboardTotals {
  connectors: number;
  healthy: number;
  syncs: number;
  failures: number;
  deadLetters: number;
  retryQueue: number;
}

export interface DashboardOverview {
  tenantId: string;
  connectors: ConnectorDashboardRow[];
  totals: DashboardTotals;
}

export class ConnectorDashboard {
  constructor(
    private readonly lifecycle: ConnectorLifecycle,
    private readonly orchestrator: SyncOrchestrator,
  ) {}

  overview(tenantId: string): DashboardOverview {
    const conns = this.lifecycle.list(tenantId);
    const health = this.lifecycle.health(tenantId);
    const outcomes = this.orchestrator.history(tenantId);
    const retryQueue = this.orchestrator.retryQueue().filter((j) => j.tenantId === tenantId);
    const deadLetters = this.orchestrator.deadLetters().filter((d) => d.job.tenantId === tenantId);

    const rows: ConnectorDashboardRow[] = conns.map((c) => {
      const os = outcomes.filter((o) => o.connectorId === c.connectorId);
      const failures = os.filter((o) => !o.ok).length;
      const avgLatencyMs = os.length ? Math.round(os.reduce((a, o) => a + o.durationMs, 0) / os.length) : 0;
      return {
        connectorId: c.connectorId,
        state: c.state,
        healthy: health.find((h) => h.connectorId === c.connectorId)?.healthy ?? false,
        ...(c.lastSyncAt !== undefined ? { lastSyncAt: c.lastSyncAt } : {}),
        ...(c.lastError !== undefined ? { lastError: c.lastError } : {}),
        syncs: os.length,
        failures,
        avgLatencyMs,
        retryQueue: retryQueue.filter((j) => j.connectorId === c.connectorId).length,
      };
    });

    return {
      tenantId,
      connectors: rows,
      totals: {
        connectors: conns.length,
        healthy: rows.filter((r) => r.healthy).length,
        syncs: outcomes.length,
        failures: outcomes.filter((o) => !o.ok).length,
        deadLetters: deadLetters.length,
        retryQueue: retryQueue.length,
      },
    };
  }

  syncHistory(tenantId: string, connectorId?: string): SyncOutcome[] {
    const os = this.orchestrator.history(tenantId);
    return connectorId ? os.filter((o) => o.connectorId === connectorId) : os;
  }
}
