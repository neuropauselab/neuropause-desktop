import { describe, expect, it } from 'vitest';
import { computeEcosystemAnalytics, type EcosystemAnalyticsInput } from './analytics';
import type { ExchangePack, Installation, MarketplaceListing, MarketplacePurchase, Partner } from '@neuropause/shared';

function listing(id: string, kind: MarketplaceListing['kind'], status: MarketplaceListing['status'], installs: number, certified = false): MarketplaceListing {
  return {
    id,
    kind,
    slug: id,
    name: id,
    summary: '',
    developerId: 'dev',
    category: 'x',
    pricing: { model: 'free', amount: 0, currency: 'USD' },
    status,
    currentVersionId: 'v1',
    latestVersionId: 'v1',
    installs,
    ratingAvg: 0,
    ratingCount: 0,
    certified,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}

function purchase(amount: number, fee: number): MarketplacePurchase {
  return { id: `p_${amount}`, orgId: 'org-default', listingId: 'lst', listingName: 'X', versionId: 'v', model: 'one_time', amount, currency: 'USD', feeAmount: fee, purchasedAt: '2026-06-15T00:00:00.000Z' };
}

const partners: Partner[] = (['technology', 'consulting', 'system_integrator', 'msp'] as const).map((type, i) => ({
  id: `prt_${i}`,
  name: `P${i}`,
  type,
  tier: 'premier',
  description: '',
  website: '',
  regions: [],
  specializations: [],
  listings: 1,
  certified: true,
  joinedAt: '2026-01-01T00:00:00.000Z',
}));

function baseInput(overrides: Partial<EcosystemAnalyticsInput> = {}): EcosystemAnalyticsInput {
  return {
    listings: [listing('a', 'ai_worker', 'published', 10, true), listing('b', 'connector', 'published', 5), listing('c', 'plugin', 'draft', 0)],
    installs: [],
    purchases: [purchase(100, 20)],
    packs: [],
    partners,
    usage: { requests30d: 1200, computeUnits30d: 1100, p95LatencyMs: 42 },
    activeDevelopers: 1,
    localOrgId: 'org-default',
    now: Date.parse('2026-06-29T00:00:00.000Z'),
    ...overrides,
  };
}

describe('computeEcosystemAnalytics', () => {
  it('rolls up listings, revenue, usage, and growth', () => {
    const a = computeEcosystemAnalytics(baseInput());
    expect(a.totalListings).toBe(3);
    expect(a.publishedListings).toBe(2);
    expect(a.certifiedListings).toBe(1);
    expect(a.totalInstalls).toBe(15);
    expect(a.revenue.gross).toBe(100);
    expect(a.revenue.platformFees).toBe(20);
    expect(a.revenue.net).toBe(80);
    expect(a.usage.requests30d).toBe(1200);
    expect(a.growth).toHaveLength(6);
    expect(a.byKind.ai_worker).toBe(1);
  });

  it('counts active organizations from packs + installs + local', () => {
    const packs: ExchangePack[] = [{ id: 'pk', name: 'P', summary: '', kind: 'knowledge', publisherOrg: 'Other', publisherOrgId: 'org-other', isLocal: false, items: [], installs: 1, installed: false, createdAt: '2026-06-01T00:00:00.000Z' }];
    const a = computeEcosystemAnalytics(baseInput({ packs }));
    expect(a.activeOrganizations).toBe(2); // local + org-other
    expect(a.packs).toBe(1);
  });

  it('produces a health score with four signals', () => {
    const a = computeEcosystemAnalytics(baseInput());
    expect(a.health.signals).toHaveLength(4);
    expect(a.health.score).toBeGreaterThan(0);
    expect(a.health.score).toBeLessThanOrEqual(100);
    expect(['Healthy', 'Stable', 'Needs attention']).toContain(a.health.label);
  });

  it('flags update adoption when installs are stale', () => {
    const installs: Installation[] = [{ id: 'i1', orgId: 'org-default', listingId: 'a', listingName: 'a', kind: 'ai_worker', installedVersionId: 'old', installedVersion: '0.9.0', status: 'update_available', installedAt: '2026-06-20T00:00:00.000Z', updatedAt: '2026-06-20T00:00:00.000Z' }];
    const a = computeEcosystemAnalytics(baseInput({ installs }));
    const adoption = a.health.signals.find((s) => s.label === 'Update adoption');
    expect(adoption?.status).toBe('risk');
    expect(a.downloads30d).toBe(1);
  });
});
