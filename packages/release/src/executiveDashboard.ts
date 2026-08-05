/**
 * EPIC 17 — Executive Dashboard. A single operational snapshot: release status, deployment status,
 * platform health, customer health, reliability, support queue, AI runtime, and license summary. It
 * shows LIVE metrics only where a real source exists (reused platforms + in-process registries); every
 * other tile is reported as pending, never fabricated.
 */
import { NO_RELEASE_DATA, GA_VERSION_TARGET } from './constants';
import type { ReleaseContext } from './types';
import type { ReleaseRuntime } from './runtime';
import type { LicenseManagement } from './licenseManagement';
import type { SupportOperations } from './supportOperations';

export interface DashboardTile {
  tile: string;
  live: boolean;
  value: string;
}

export interface ExecutiveDashboardDeps {
  releaseRuntime: ReleaseRuntime;
  license: LicenseManagement;
  support: SupportOperations;
}

export class ExecutiveDashboard {
  constructor(
    private readonly ctx: ReleaseContext,
    private readonly deps: ExecutiveDashboardDeps,
  ) {}

  snapshot(): DashboardTile[] {
    const gaRelease = this.deps.releaseRuntime.byVersionId(GA_VERSION_TARGET);
    return [
      { tile: 'release-status', live: Boolean(gaRelease), value: gaRelease ? `${GA_VERSION_TARGET}: ${gaRelease.status}` : 'v1.0.0 not registered' },
      { tile: 'deployment-status', live: Boolean(this.ctx.customerDeployment), value: this.ctx.customerDeployment ? `${this.ctx.customerDeployment.runtime().listDeployments().length} deployments` : NO_RELEASE_DATA },
      { tile: 'platform-health', live: Boolean(this.ctx.operations), value: this.ctx.operations ? this.ctx.operations.operations().overview().health.status : NO_RELEASE_DATA },
      { tile: 'customer-health', live: false, value: NO_RELEASE_DATA },
      { tile: 'reliability', live: Boolean(this.ctx.reliability), value: this.ctx.reliability ? 'reused reliability platform' : NO_RELEASE_DATA },
      { tile: 'support-queue', live: true, value: `${this.deps.support.queue().length} open` },
      { tile: 'ai-runtime', live: Boolean(this.ctx.workforce), value: this.ctx.workforce ? 'workforce present' : NO_RELEASE_DATA },
      { tile: 'license-summary', live: true, value: `${this.deps.license.count()} licenses` },
    ];
  }

  liveTiles(): number {
    return this.snapshot().filter((t) => t.live).length;
  }
}
