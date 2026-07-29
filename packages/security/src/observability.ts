/**
 * Security Observability (NCEA 14.0, Phase 11). Aggregates authentication,
 * authorization, policy, failed-login, and threat metrics and feeds the EXISTING
 * runtime observability registry (real `metrics.inc()` — no parallel system). It
 * projects the security / risk / compliance / audit / identity dashboards as
 * read-only views over the same counters.
 */
import type { EnterpriseRuntime } from '@neuropause/runtime';

export interface SecurityMetricsSnapshot {
  authentication: { success: number; failure: number };
  authorization: { permit: number; deny: number };
  policy: { permit: number; deny: number; notApplicable: number };
  failedLogins: number;
  threats: { low: number; medium: number; high: number };
}

export class SecurityObservability {
  private m: SecurityMetricsSnapshot = {
    authentication: { success: 0, failure: 0 },
    authorization: { permit: 0, deny: 0 },
    policy: { permit: 0, deny: 0, notApplicable: 0 },
    failedLogins: 0,
    threats: { low: 0, medium: 0, high: 0 },
  };

  constructor(private readonly runtime?: EnterpriseRuntime) {}

  private inc(name: string): void {
    this.runtime?.observability().metrics.inc(`security.${name}`);
  }

  recordAuth(ok: boolean): void {
    if (ok) this.m.authentication.success += 1;
    else {
      this.m.authentication.failure += 1;
      this.m.failedLogins += 1;
      this.inc('auth.failure');
    }
    this.inc('auth');
  }
  recordAuthz(allowed: boolean): void {
    if (allowed) this.m.authorization.permit += 1;
    else this.m.authorization.deny += 1;
    this.inc(allowed ? 'authz.permit' : 'authz.deny');
  }
  recordPolicy(effect: 'permit' | 'deny' | 'not-applicable'): void {
    if (effect === 'permit') this.m.policy.permit += 1;
    else if (effect === 'deny') this.m.policy.deny += 1;
    else this.m.policy.notApplicable += 1;
  }
  recordThreat(severity: 'low' | 'medium' | 'high'): void {
    this.m.threats[severity] += 1;
    this.inc(`threat.${severity}`);
  }

  snapshot(): SecurityMetricsSnapshot {
    return JSON.parse(JSON.stringify(this.m)) as SecurityMetricsSnapshot;
  }

  /** Read-only dashboard projections over the same metrics. */
  dashboards(): { security: SecurityMetricsSnapshot; risk: { threats: number; deniedAccess: number }; audit: { failedLogins: number } } {
    const s = this.snapshot();
    return {
      security: s,
      risk: { threats: s.threats.low + s.threats.medium + s.threats.high, deniedAccess: s.authorization.deny },
      audit: { failedLogins: s.failedLogins },
    };
  }
}
