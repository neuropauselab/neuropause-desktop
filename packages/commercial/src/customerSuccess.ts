/**
 * Module 13 — Customer Success Platform. Health scores, adoption, product usage, support history,
 * renewal tracking, and expansion opportunities. REUSES the Wave 8 business customer-success runtime
 * (churn risk) when a business account is linked; otherwise it derives adoption from REAL usage and
 * subscription records. With no real signal it returns 'No commercial data available' — a health
 * score is never fabricated.
 */
import { NO_COMMERCIAL_DATA } from './constants';
import type { CommercialContext } from './types';
import type { SubscriptionPlatform } from './subscriptions';
import type { UsageMetering } from './usage';
import type { LicensingPlatform } from './licensing';

export interface CustomerHealth {
  tenantId: string;
  risk: string | null;
  adoptionScore: number | null;
  source: string;
  note: string;
}

export interface SuccessDeps {
  subscriptions: SubscriptionPlatform;
  usage: UsageMetering;
  licensing: LicensingPlatform;
}

export class CustomerSuccessPlatform {
  constructor(
    private readonly ctx: CommercialContext,
    private readonly deps: SuccessDeps,
  ) {}

  /** Health from real signals only. Reuses Wave 8 churn risk when a business account is linked. */
  health(input: { tenantId: string; accountId?: string }): CustomerHealth {
    const adoption = this.adoptionScore(input.tenantId);
    if (this.ctx.business && input.accountId) {
      const risk = this.ctx.business.customerSuccess().churnRisk(input.accountId);
      return { tenantId: input.tenantId, risk, adoptionScore: adoption, source: 'reused Wave 8 business customer-success', note: 'churn risk from the reused business platform; adoption from real usage' };
    }
    if (adoption === null) return { tenantId: input.tenantId, risk: null, adoptionScore: null, source: 'none', note: NO_COMMERCIAL_DATA };
    return { tenantId: input.tenantId, risk: null, adoptionScore: adoption, source: 'commercial usage', note: 'adoption derived from real usage; no business account linked for churn risk' };
  }

  /** Adoption = number of usage meters with real activity (0..7); null when nothing recorded. */
  adoptionScore(tenantId: string): number | null {
    const b = this.deps.usage.breakdown(tenantId);
    const active = Object.values(b).filter((v) => v > 0).length;
    const total = this.deps.usage.total(tenantId);
    return total === 0 ? null : active;
  }

  /** Renewal tracking from REAL subscription state. */
  renewalTracking(tenantId: string): { active: number; suspended: number; cancelled: number } {
    const subs = this.deps.subscriptions.list(tenantId);
    return {
      active: subs.filter((s) => s.state === 'active' || s.state === 'trialing').length,
      suspended: subs.filter((s) => s.state === 'suspended' || s.state === 'past-due').length,
      cancelled: subs.filter((s) => s.state === 'cancelled').length,
    };
  }

  /** Expansion opportunity = real seat utilization (used / issued) — null when nothing licensed. */
  expansion(tenantId: string): { seatsIssued: number; seatsUsed: number; utilizationPct: number | null; note: string } {
    const licenses = this.deps.licensing.list(tenantId);
    const seatsIssued = licenses.reduce((s, l) => s + l.seats, 0);
    const seatsUsed = licenses.reduce((s, l) => s + l.used, 0);
    if (seatsIssued === 0) return { seatsIssued: 0, seatsUsed: 0, utilizationPct: null, note: 'no licenses issued — no expansion signal, not fabricated' };
    return { seatsIssued, seatsUsed, utilizationPct: Math.round((seatsUsed / seatsIssued) * 100), note: seatsUsed >= seatsIssued ? 'at capacity — expansion opportunity' : 'seats available' };
  }
}
