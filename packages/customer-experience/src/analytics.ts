/**
 * EPIC 13 — Customer Analytics. Dashboards for signups, downloads, active organizations, license counts,
 * installations, and onboarding completion. It reports ONLY measured data: counts come from the real
 * in-process registries. Real desktop installations cannot be observed from here (that needs the
 * deployed client + telemetry) and are reported as business-data-pending — never fabricated. These are
 * pre-launch, in-process figures, not production customer metrics.
 */
import { NO_CUSTOMER_DATA } from './constants';
import type { AuthenticationRuntime } from './auth';
import type { LicensingRuntime } from './licensing';
import type { DownloadCenter } from './downloads';

export interface AnalyticsDeps {
  auth: AuthenticationRuntime;
  licensing: LicensingRuntime;
  downloads: DownloadCenter;
}

export interface Metric {
  metric: string;
  live: boolean;
  value: string;
}

export class CustomerAnalytics {
  constructor(private readonly deps: AnalyticsDeps) {}

  dashboard(): Metric[] {
    return [
      { metric: 'signups', live: true, value: String(this.deps.auth.accountCount()) },
      { metric: 'active-organizations', live: true, value: String(this.deps.auth.organizationCount()) },
      { metric: 'downloads', live: true, value: String(this.deps.downloads.releaseHistory().versions.length) },
      { metric: 'license-counts', live: true, value: String(this.deps.licensing.tiers().length) },
      { metric: 'installations', live: false, value: NO_CUSTOMER_DATA }, // real desktop installs require the deployed client
      { metric: 'onboarding-completion', live: false, value: NO_CUSTOMER_DATA }, // requires real production usage
    ];
  }

  /** Metrics that require real production data — always reported pending here. */
  pendingMetrics(): string[] {
    return ['installations', 'onboarding-completion', 'revenue', 'active-customers', 'customer-adoption'];
  }
}
