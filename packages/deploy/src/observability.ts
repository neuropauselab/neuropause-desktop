/**
 * EPIC 9 — Observability Bootstrap. OpenTelemetry, metrics, tracing, structured logs, and the
 * health endpoints (liveness / readiness / startup). REUSES the Wave 12 operations health registry
 * and the Wave 14 production observability when connected. NO FABRICATED TELEMETRY: with no
 * connected operations platform, service health reads 'No deployment data available'.
 */
import { NO_DEPLOY_DATA } from './constants';
import type { DeployContext } from './types';

export class ObservabilityBootstrap {
  constructor(private readonly ctx: DeployContext = {}) {}

  healthEndpoints(): string[] { return ['/health/live', '/health/ready', '/health/startup']; }

  otel(): { signals: string[]; note: string } {
    return { signals: ['metrics', 'traces', 'logs'], note: 'OpenTelemetry configuration represented; a real collector is wired at deploy time' };
  }

  /** Service health REUSES the operations health registry — honest absence otherwise. */
  serviceHealth(): { status: string; source: string } {
    if (this.ctx.operations) return { status: this.ctx.operations.health().liveness().status, source: 'reused operations health registry' };
    if (this.ctx.production) return { status: this.ctx.production.monitoring().serviceHealth().status, source: 'reused production monitoring' };
    return { status: NO_DEPLOY_DATA, source: 'none' };
  }

  /** Readiness REUSES the operations readiness probe when connected. */
  readiness(): { ready: boolean | string; source: string } {
    if (this.ctx.operations) return { ready: this.ctx.operations.health().readiness().ready, source: 'reused operations readiness' };
    return { ready: NO_DEPLOY_DATA, source: 'none' };
  }
}
