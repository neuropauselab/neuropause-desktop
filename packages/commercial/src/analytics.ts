/**
 * Module 16 — Commercial Analytics. ARR / MRR models, customer growth, seat growth, feature
 * adoption, and usage analytics — computed ONLY from real commercial records in this package
 * (subscriptions, customers, licenses, usage). Every figure is a real count/sum or
 * 'No commercial data available'; nothing is projected or fabricated.
 */
import { NO_COMMERCIAL_DATA } from './constants';
import type { CommercialRuntime } from './runtime';
import type { SubscriptionPlatform } from './subscriptions';
import type { LicensingPlatform } from './licensing';
import type { UsageMetering } from './usage';

export interface AnalyticsDeps {
  runtime: CommercialRuntime;
  subscriptions: SubscriptionPlatform;
  licensing: LicensingPlatform;
  usage: UsageMetering;
}

export class CommercialAnalytics {
  constructor(private readonly deps: AnalyticsDeps) {}

  /** MRR in cents from REAL active subscriptions — 'No commercial data available' when none. */
  mrr(): number | string {
    const mrr = this.deps.subscriptions.mrrCents();
    return mrr > 0 ? mrr : NO_COMMERCIAL_DATA;
  }
  /** ARR in cents from REAL active subscriptions — 'No commercial data available' when none. */
  arr(): number | string {
    const arr = this.deps.subscriptions.arrCents();
    return arr > 0 ? arr : NO_COMMERCIAL_DATA;
  }

  customerGrowth(): { customers: number; note: string } {
    const n = this.deps.runtime.customerCount();
    return { customers: n, note: n > 0 ? 'real customer count' : NO_COMMERCIAL_DATA };
  }

  seatGrowth(): { seatsIssued: number; note: string } {
    const n = this.deps.licensing.seatsIssued();
    return { seatsIssued: n, note: n > 0 ? 'real seats issued' : NO_COMMERCIAL_DATA };
  }

  /** Feature adoption = tenants with any real recorded usage. */
  featureAdoption(): { adoptingTenants: number; note: string } {
    const n = this.deps.usage.meteredTenants();
    return { adoptingTenants: n, note: n > 0 ? 'tenants with real usage' : NO_COMMERCIAL_DATA };
  }

  /** A snapshot combining the real commercial figures (or the honest absence of them). */
  snapshot(): { mrr: number | string; arr: number | string; customers: number; seatsIssued: number; hasData: boolean } {
    const customers = this.deps.runtime.customerCount();
    const seatsIssued = this.deps.licensing.seatsIssued();
    const mrr = this.deps.subscriptions.mrrCents();
    return { mrr: mrr > 0 ? mrr : NO_COMMERCIAL_DATA, arr: mrr > 0 ? mrr * 12 : NO_COMMERCIAL_DATA, customers, seatsIssued, hasData: customers > 0 || mrr > 0 };
  }
}
