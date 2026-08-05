/**
 * EPIC 14 — Business Analytics. Dashboards for deployments, active customers, licenses, usage, adoption,
 * support, reliability, and releases. It shows ONLY real data: counts come from the real in-process
 * registries and reused platforms; usage / adoption / revenue require real production data and are
 * reported as business-data-pending — never invented.
 */
import { NO_RELEASE_DATA } from './constants';
import type { ReleaseContext } from './types';
import type { ReleaseRuntime } from './runtime';
import type { LicenseManagement } from './licenseManagement';
import type { SupportOperations } from './supportOperations';
import type { CustomerOperations } from './customerOperations';

export interface AnalyticsDeps {
  releaseRuntime: ReleaseRuntime;
  license: LicenseManagement;
  support: SupportOperations;
  customerOps: CustomerOperations;
}

export interface Metric {
  metric: string;
  live: boolean;
  value: string;
}

export class BusinessAnalytics {
  constructor(
    private readonly ctx: ReleaseContext,
    private readonly deps: AnalyticsDeps,
  ) {}

  dashboard(): Metric[] {
    return [
      { metric: 'releases', live: true, value: String(this.deps.releaseRuntime.list().length) },
      { metric: 'deployments', live: Boolean(this.ctx.customerDeployment), value: this.ctx.customerDeployment ? String(this.ctx.customerDeployment.runtime().listDeployments().length) : NO_RELEASE_DATA },
      { metric: 'active-customers', live: true, value: String(this.deps.customerOps.customerList().length) },
      { metric: 'licenses', live: true, value: String(this.deps.license.count()) },
      { metric: 'support', live: true, value: String(this.deps.support.queue().length) },
      { metric: 'reliability', live: Boolean(this.ctx.reliability), value: this.ctx.reliability ? 'reused reliability platform' : NO_RELEASE_DATA },
      { metric: 'usage', live: false, value: NO_RELEASE_DATA },
      { metric: 'adoption', live: false, value: NO_RELEASE_DATA },
    ];
  }

  /** Metrics that require real production data — always reported pending here. */
  pendingMetrics(): string[] {
    return ['usage', 'adoption', 'revenue', 'renewals', 'expansion', 'production-usage'];
  }
}
