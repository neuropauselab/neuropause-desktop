/**
 * EPIC 13 — Integration Monitoring. Dashboards for connector health, sync status, API errors,
 * authentication status, and AI-provider status. Connector + sync + AI status are real in-process
 * signals from the sibling runtimes; platform health REUSES the Launch-Workstream-1 platform operations
 * when wired in. API errors from real customer traffic are business-data-pending (no production traffic
 * flows here) and reported as such.
 */
import { NO_ENTERPRISE_DATA } from './constants';
import type { EcContext } from './types';
import type { ConnectorRuntime } from './connectorRuntime';
import type { SynchronizationEngine } from './synchronization';
import type { AiProviderPlatform } from './aiProviders';

export const MONITOR_DASHBOARDS = ['connector-health', 'sync-status', 'api-errors', 'authentication-status', 'ai-provider-status'] as const;
export type MonitorDashboard = (typeof MONITOR_DASHBOARDS)[number];

export interface MonitorDeps {
  connectors: ConnectorRuntime;
  sync: SynchronizationEngine;
  ai: AiProviderPlatform;
}

export interface DashboardTile {
  dashboard: MonitorDashboard;
  live: boolean;
  value: string;
}

export class IntegrationMonitoring {
  constructor(
    private readonly ctx: EcContext,
    private readonly deps: MonitorDeps,
  ) {}

  dashboards(): readonly MonitorDashboard[] {
    return MONITOR_DASHBOARDS;
  }

  snapshot(): DashboardTile[] {
    return [
      { dashboard: 'connector-health', live: true, value: `${this.deps.connectors.activeCount()} active / ${this.deps.connectors.list().length} total` },
      { dashboard: 'sync-status', live: true, value: `${this.deps.sync.count()} sync runs` },
      { dashboard: 'ai-provider-status', live: true, value: `${this.deps.ai.registeredCount()} providers registered` },
      { dashboard: 'authentication-status', live: false, value: NO_ENTERPRISE_DATA }, // real OAuth status requires configured credentials
      { dashboard: 'api-errors', live: false, value: NO_ENTERPRISE_DATA }, // requires real production API traffic
    ];
  }

  /** Platform health reuses the Launch-Workstream-1 platform operations overview when wired in. */
  platformHealth(): { reusedPlatformOperations: boolean; note: string } {
    return { reusedPlatformOperations: Boolean(this.ctx.platformOperations), note: this.ctx.platformOperations ? 'reused platform-operations control plane' : NO_ENTERPRISE_DATA };
  }
}
