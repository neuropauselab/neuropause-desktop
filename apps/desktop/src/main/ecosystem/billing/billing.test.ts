import { describe, expect, it } from 'vitest';
import { PLAN_CATALOG, planFor, computeInvoice, billingSummary } from './billing';
import type { MarketplacePurchase, Subscription } from '@neuropause/shared';

function purchase(amount: number, period: string): MarketplacePurchase {
  return {
    id: `pur_${amount}`,
    orgId: 'org-default',
    listingId: 'lst_1',
    listingName: 'Thing',
    versionId: 'ver_1',
    model: 'one_time',
    amount,
    currency: 'USD',
    feeAmount: 0,
    purchasedAt: `${period}-15T00:00:00.000Z`,
  };
}

describe('plan catalog', () => {
  it('has three tiers with ascending price + included requests', () => {
    expect(planFor('free').priceMonthly).toBe(0);
    expect(planFor('pro').priceMonthly).toBeGreaterThan(0);
    expect(PLAN_CATALOG.enterprise.includedRequests).toBeGreaterThan(PLAN_CATALOG.pro.includedRequests);
    expect(PLAN_CATALOG.pro.includedRequests).toBeGreaterThan(PLAN_CATALOG.free.includedRequests);
  });
});

describe('computeInvoice', () => {
  it('bills only the base subscription when under the included limit', () => {
    const inv = computeInvoice('org-default', planFor('pro'), 50_000, [], '2026-06');
    expect(inv.lines).toHaveLength(1);
    expect(inv.total).toBe(49);
  });

  it('adds a usage overage line when over the included limit', () => {
    const inv = computeInvoice('org-default', planFor('pro'), 102_500, [], '2026-06');
    const usage = inv.lines.find((l) => l.kind === 'usage');
    expect(usage).toBeDefined();
    // 2,500 over → ceil(2500/1000) = 3 units × $0.50 = $1.50
    expect(usage?.quantity).toBe(3);
    expect(usage?.amount).toBe(1.5);
    expect(inv.total).toBe(50.5);
  });

  it('includes marketplace purchases from the period only', () => {
    const inv = computeInvoice('org-default', planFor('free'), 0, [purchase(19, '2026-06'), purchase(99, '2026-05')], '2026-06');
    const mkt = inv.lines.filter((l) => l.kind === 'marketplace');
    expect(mkt).toHaveLength(1);
    expect(mkt[0].amount).toBe(19);
  });
});

describe('billingSummary', () => {
  it('summarizes plan, overage, and spend', () => {
    const sub: Subscription = {
      id: 'sub_1',
      orgId: 'org-default',
      planTier: 'pro',
      seats: 5,
      seatsUsed: 2,
      status: 'active',
      startedAt: '2026-06-01T00:00:00.000Z',
      renewsAt: '2026-07-01T00:00:00.000Z',
    };
    const s = billingSummary(planFor('pro'), sub, 101_000, [], [purchase(19, '2026-06')], '2026-06');
    expect(s.overageRequests).toBe(1_000);
    expect(s.marketplaceSpend).toBe(19);
    expect(s.estimatedCost).toBe(49 + 0.5 + 19);
    expect(s.seatsUsed).toBe(2);
  });
});
