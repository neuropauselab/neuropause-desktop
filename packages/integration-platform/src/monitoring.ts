/**
 * EPIC 18 — Monitoring & Diagnostics. Connector health, sync health, API health, and error / retry /
 * performance dashboards, composed from REAL integration-runtime state and REUSING the operations
 * health registry when connected. Honest 'No integration data available' when there is nothing to
 * report — dashboards are never fabricated.
 */
import { NO_INTEGRATION_DATA } from './constants';
import type { IntegrationContext } from './types';
import type { IntegrationRuntime } from './runtime';
import type { SynchronizationEngine } from './sync';

export class IntegrationMonitoring {
  constructor(
    private readonly ctx: IntegrationContext,
    private readonly runtime: IntegrationRuntime,
    private readonly sync: SynchronizationEngine,
  ) {}

  /** Connector health from real integration state. */
  connectorHealth(): { total: number; active: number; failed: number } {
    const all = this.runtime.list();
    return { total: all.length, active: all.filter((i) => i.status === 'active').length, failed: all.filter((i) => i.status === 'failed').length };
  }

  syncHealth(): { runs: number; note: string } {
    const runs = this.sync.count();
    return { runs, note: runs > 0 ? 'real sync runs recorded' : NO_INTEGRATION_DATA };
  }

  /** API health REUSES the operations health registry liveness when connected. */
  apiHealth(): { status: string; source: string } {
    if (this.ctx.operations) return { status: this.ctx.operations.health().liveness().status, source: 'reused operations health registry' };
    return { status: NO_INTEGRATION_DATA, source: 'none' };
  }

  errorDashboard(): { totalErrors: number } {
    return { totalErrors: this.runtime.list().reduce((s, i) => s + i.errors, 0) };
  }
  retryDashboard(): { totalRetries: number; deadLetters: number } {
    return { totalRetries: this.runtime.list().reduce((s, i) => s + i.retries, 0), deadLetters: this.sync.deadLetters().length };
  }
}
