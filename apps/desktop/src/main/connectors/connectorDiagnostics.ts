/**
 * P4.1 — the connector health probe for the EXISTING diagnostics framework (no new diagnostics system).
 *
 * Reads the live `ConnectorSyncSnapshot[]` (from the sync subsystem), scores each account with the
 * existing `computeIntegrationHealth` engine, rolls them up with `aggregateIntegrationHealth`, and maps
 * the aggregate state onto a single `DiagnosticCheck` — so connector health rolls into `DiagnosticsGet`
 * and the Diagnostics Center automatically. Injected getters keep it unit-testable (aiHealthProbes mold).
 */
import {
  aggregateIntegrationHealth,
  computeIntegrationHealth,
  type ConnectorSyncSnapshot,
  type DiagnosticStatus,
  type IntegrationHealthState,
} from '@neuropause/shared';
import { makeCheck, type DiagnosticProbe } from '../platform/diagnostics';

function statusFor(overall: IntegrationHealthState): DiagnosticStatus {
  switch (overall) {
    case 'healthy':
    case 'idle':
      return 'ok';
    case 'degraded':
      return 'degraded';
    case 'unhealthy':
      return 'down';
  }
}

export interface ConnectorHealthProbeOptions {
  /**
   * Count of accounts needing operator attention that the sync snapshots don't cover — i.e. in
   * `reauth_required` / `error` (excluded from the connected-only snapshot set). When > 0 the check is at
   * least `degraded`, so a token-expired connector is never masked as `ok` in the Diagnostics Center.
   */
  attention?: () => number;
  now?: () => number;
}

export function connectorHealthProbe(
  getSnapshots: () => ConnectorSyncSnapshot[],
  opts: ConnectorHealthProbeOptions = {},
): DiagnosticProbe {
  const now = opts.now ?? Date.now;
  return () => {
    try {
      const nowMs = now();
      const healths = getSnapshots().map((s) => computeIntegrationHealth(s, nowMs));
      const agg = aggregateIntegrationHealth(healths);
      const needReauth = opts.attention?.() ?? 0;
      const attention = healths.filter((h) => h.state === 'unhealthy' || h.state === 'degraded').length + needReauth;
      let status = statusFor(agg.overall);
      if (needReauth > 0 && status === 'ok') status = 'degraded'; // reauth-needed accounts must surface
      return makeCheck('connectors', 'Connectors', status, {
        detail: `${agg.total} account(s) · ${agg.healthy} healthy · ${agg.degraded} degraded · ${agg.unhealthy} unhealthy${needReauth > 0 ? ` · ${needReauth} need reauth` : ''} · score ${agg.score}`,
        recommendation: attention > 0 ? `${attention} connector account(s) need attention — open the Connectors inspector.` : null,
      });
    } catch (err) {
      return makeCheck('connectors', 'Connectors', 'down', {
        detail: err instanceof Error ? err.message : 'Connector health unavailable',
        recommendation: 'The connector runtime failed to report health; check the main-process logs.',
      });
    }
  };
}
