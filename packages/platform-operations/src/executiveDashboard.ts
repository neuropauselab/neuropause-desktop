/**
 * EPIC 17 — Executive Operations Dashboard. Platform / customer / AI / infrastructure / deployment /
 * release / incident status. It shows LIVE tiles only where a real source exists (reused platforms +
 * in-process registries); infrastructure status is honestly 'infrastructure-pending' until real running
 * nodes exist, and the target domain is reported NOT live. Nothing is fabricated.
 */
import { TARGET_DOMAIN } from './constants';
import type { PlatformOpsContext } from './types';
import type { CloudEnvironmentRuntime } from './cloudEnvironment';
import type { OperationsCenter } from './operationsCenter';

export interface OpsTile {
  tile: string;
  live: boolean;
  value: string;
}

export interface ExecDashboardDeps {
  cloud: CloudEnvironmentRuntime;
  center: OperationsCenter;
}

export class ExecutiveOperationsDashboard {
  constructor(
    private readonly ctx: PlatformOpsContext,
    private readonly deps: ExecDashboardDeps,
  ) {}

  snapshot(): OpsTile[] {
    const health = this.deps.cloud.health();
    const opsLive = Boolean(this.ctx.operations);
    return [
      { tile: 'platform-status', live: false, value: `${TARGET_DOMAIN}: not live (infrastructure-pending)` },
      { tile: 'infrastructure-status', live: health.runningNodes > 0, value: health.status },
      { tile: 'customer-status', live: Boolean(this.ctx.customerDeployment), value: this.ctx.customerDeployment ? `${this.ctx.customerDeployment.runtime().listDeployments().length} deployments` : 'no data' },
      { tile: 'ai-status', live: Boolean(this.ctx.aiRuntime), value: this.ctx.aiRuntime ? 'ai runtime present' : 'no data' },
      { tile: 'deployment-status', live: Boolean(this.ctx.release), value: this.ctx.release ? 'release platform present' : 'no data' },
      { tile: 'release-status', live: Boolean(this.ctx.release), value: this.ctx.release ? this.ctx.release.version : 'no data' },
      { tile: 'incident-status', live: opsLive, value: `${this.deps.center.alertCenter().openIncidents} open` },
    ];
  }

  liveTiles(): number {
    return this.snapshot().filter((t) => t.live).length;
  }
}
