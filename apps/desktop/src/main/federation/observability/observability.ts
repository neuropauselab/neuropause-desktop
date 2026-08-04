/**
 * Enterprise observability (pure). Rolls live counts from every subsystem into a
 * single operational view — organizations, AI workers, connectors,
 * synchronization, the API platform, the federation runtime, and security — each
 * with a health status and a headline metric. No I/O.
 */
import type { LiveSyncStatus, ObservabilityOverview, ObsSubsystem, ObsSubsystemHealth, SecurityEvent, UsagePoint } from '@neuropause/shared';

export interface ObsInput {
  orgs: number;
  activePeers: number;
  workers: number;
  workersDegraded: number;
  connectorsTotal: number;
  connectorsHealthy: number;
  connectorsDegraded: number;
  connectorsDown: number;
  /** Records reconciled into the local sync mirror for the active org. */
  syncRecords: number;
  /** Outbound changes still queued on this device. */
  syncPending: number;
  /** The live-sync engine's cycle state (a user pause reads as `offline`). */
  syncState: LiveSyncStatus['state'];
  apiReplicas: number;
  apiHealthy: number;
  apiUptimePct: number;
  fedPeers: number;
  fedTrusted: number;
  security: SecurityEvent[];
  usage: UsagePoint[];
}

function worst(a: ObsSubsystemHealth, b: ObsSubsystemHealth): ObsSubsystemHealth {
  const rank: Record<ObsSubsystemHealth, number> = { healthy: 0, degraded: 1, down: 2 };
  return rank[a] >= rank[b] ? a : b;
}

export function buildObservability(input: ObsInput): ObservabilityOverview {
  const criticalEvents = input.security.filter((e) => e.severity === 'critical').length;
  const warningEvents = input.security.filter((e) => e.severity === 'warning').length;

  const connectorsHealth: ObsSubsystemHealth = input.connectorsDown > 0 ? 'down' : input.connectorsDegraded > 0 ? 'degraded' : 'healthy';
  // A failing engine or a paused one both mean state is not reaching the cloud;
  // a healthy engine with a backlog is merely behind.
  const syncHealth: ObsSubsystemHealth =
    input.syncState === 'error' || input.syncState === 'offline'
      ? 'down'
      : input.syncPending > 0
        ? 'degraded'
        : 'healthy';
  const syncDetail =
    input.syncState === 'error'
      ? `Sync failing · ${input.syncPending} changes queued`
      : input.syncState === 'offline'
        ? `Paused · ${input.syncPending} changes queued locally`
        : `${input.syncPending} changes pending`;
  const apiHealth: ObsSubsystemHealth = input.apiReplicas > 0 && input.apiHealthy === input.apiReplicas ? 'healthy' : input.apiHealthy === 0 ? 'down' : 'degraded';
  const workersHealth: ObsSubsystemHealth = input.workersDegraded > 0 ? 'degraded' : 'healthy';
  const securityHealth: ObsSubsystemHealth = criticalEvents > 0 ? 'down' : warningEvents > 0 ? 'degraded' : 'healthy';

  const subsystems: ObsSubsystem[] = [
    { id: 'organizations', label: 'Organizations', status: 'healthy', metric: input.orgs, unit: 'orgs', detail: `${input.activePeers} active peers federated` },
    { id: 'workers', label: 'AI Workers', status: workersHealth, metric: input.workers, unit: 'workers', detail: input.workersDegraded > 0 ? `${input.workersDegraded} degraded` : 'All workers healthy' },
    { id: 'connectors', label: 'Connectors', status: connectorsHealth, metric: input.connectorsTotal, unit: 'connectors', detail: `${input.connectorsHealthy} healthy · ${input.connectorsDegraded} degraded · ${input.connectorsDown} down` },
    { id: 'sync', label: 'Synchronization', status: syncHealth, metric: input.syncRecords, unit: 'records', detail: syncDetail },
    { id: 'api', label: 'API Platform', status: apiHealth, metric: input.apiReplicas, unit: 'replicas', detail: `${input.apiHealthy}/${input.apiReplicas} healthy · ${input.apiUptimePct}% uptime` },
    { id: 'federation', label: 'Federation Runtime', status: 'healthy', metric: input.fedPeers, unit: 'peers', detail: `${input.fedTrusted} trusted` },
    { id: 'security', label: 'Security', status: securityHealth, metric: criticalEvents + warningEvents, unit: 'open events', detail: `${criticalEvents} critical · ${warningEvents} warning` },
  ];

  const healthy = subsystems.filter((s) => s.status === 'healthy').length;
  const degraded = subsystems.reduce((acc, s) => worst(acc, s.status), 'healthy' as ObsSubsystemHealth);
  void degraded;

  return {
    subsystems,
    security: input.security.slice(0, 50),
    usage: input.usage,
    healthy,
    degraded: subsystems.filter((s) => s.status === 'degraded').length,
    criticalEvents,
  };
}
