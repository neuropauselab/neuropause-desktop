/**
 * P9 — marketplace intelligence model tests. Taxonomy, publisher/package trust, channels,
 * discovery (filter/rank/collections), compatibility, dependency install plans (waves/
 * missing/conflict/cycle), org policy verdicts, trust report, and analytics.
 */
import { describe, expect, it } from 'vitest';
import type { MarketplaceEntry, OrgMarketplacePolicy } from '@neuropause/shared';
import {
  buildTrustReport,
  canInstall,
  capabilityFor,
  categories,
  channelFor,
  collections,
  computeAnalytics,
  evaluatePolicy,
  filterCatalog,
  isCompatible,
  packageTrust,
  packageTypeFor,
  publisherTier,
  publisherTrust,
  rankCatalog,
  resolveInstallPlan,
  tierRank,
  toEntry,
  type DepNode,
  type EntryInput,
} from './marketplaceModel';

const NOW = '2026-07-15T00:00:00.000Z';

function entryInput(over: Partial<EntryInput> = {}): EntryInput {
  return {
    id: 'lst-1',
    slug: 'acme-ops',
    name: 'Acme Ops',
    summary: 'Ops helper',
    kind: 'ai_worker',
    metadata: {},
    category: 'Operations',
    certified: false,
    version: '1.2.0',
    signed: true,
    scan: 'pass',
    rating: 4.5,
    ratingCount: 20,
    installs: 500,
    dependencies: [],
    updatedAt: NOW,
    publisher: { id: 'pub-1', name: 'Acme', verified: true, official: false, listings: 3, installs: 800, keyId: 'npsign_x', verifiedAt: NOW },
    installStatus: 'not_installed',
    ...over,
  };
}

describe('taxonomy', () => {
  it('maps listing kinds to package types, honoring explicit metadata', () => {
    expect(packageTypeFor('ai_worker')).toBe('worker');
    expect(packageTypeFor('connector')).toBe('connector');
    expect(packageTypeFor('enterprise_template')).toBe('blueprint');
    expect(packageTypeFor('ai_worker', { packageType: 'policy_pack' })).toBe('policy_pack');
    expect(packageTypeFor('ai_worker', { packageType: 'nonsense' })).toBe('worker');
  });
  it('reports install capability per type', () => {
    expect(capabilityFor('worker')).toBe('installable');
    expect(capabilityFor('connector')).toBe('connect');
    expect(capabilityFor('automation_pack')).toBe('import');
    expect(capabilityFor('dashboard_pack')).toBe('catalog');
  });
  it('reads the release channel from metadata with a stable default', () => {
    expect(channelFor({ channel: 'beta' })).toBe('beta');
    expect(channelFor({ channel: 'bogus' })).toBe('stable');
    expect(channelFor({})).toBe('stable');
  });
});

describe('trust', () => {
  it('derives publisher tier and trust', () => {
    expect(publisherTier({ verified: false, official: false, installs: 0, keyId: null })).toBe('unverified');
    expect(publisherTier({ verified: true, official: false, installs: 10, keyId: 'k' })).toBe('verified');
    expect(publisherTier({ verified: true, official: false, installs: 5000, keyId: 'k' })).toBe('trusted');
    expect(publisherTier({ verified: false, official: true, installs: 0, keyId: 'k' })).toBe('official');
    expect(publisherTrust({ verified: false, official: true, installs: 0, keyId: 'k' })).toBeGreaterThan(0.9);
    expect(publisherTrust({ verified: false, official: false, installs: 0, keyId: null })).toBeLessThan(0.3);
  });
  it('blends package signals with publisher trust; signed+certified beats unsigned', () => {
    const signed = packageTrust({ signed: true, certified: true, scan: 'pass', publisherTrust: 0.8 });
    const unsigned = packageTrust({ signed: false, certified: false, scan: 'fail', publisherTrust: 0.2 });
    expect(signed).toBeGreaterThan(unsigned);
    expect(signed).toBeLessThanOrEqual(1);
    expect(unsigned).toBeGreaterThanOrEqual(0);
  });
  it('tierRank orders tiers', () => {
    expect(tierRank('official')).toBeGreaterThan(tierRank('verified'));
    expect(tierRank('verified')).toBeGreaterThan(tierRank('unverified'));
  });
});

describe('toEntry', () => {
  it('projects a listing into a unified entry with derived type/tier/trust', () => {
    const e = toEntry(entryInput());
    expect(e.packageType).toBe('worker');
    expect(e.capability).toBe('installable');
    expect(e.publisher.tier).toBe('verified');
    expect(e.trustScore).toBeGreaterThan(0.5);
    expect(e.channel).toBe('stable');
    expect(e.installState).toBe('not_installed');
  });
});

function entry(over: Partial<MarketplaceEntry> = {}): MarketplaceEntry {
  return { ...toEntry(entryInput()), ...over };
}

describe('discovery', () => {
  const entries = [
    entry({ id: 'a', name: 'Alpha', installs: 100, trustScore: 0.5, rating: 3, ratingCount: 5, packageType: 'worker', category: 'Ops', channel: 'stable', publisher: { id: 'p1', name: 'P1', tier: 'unverified', trustScore: 0.2 } }),
    entry({ id: 'b', name: 'Bravo', installs: 900, trustScore: 0.9, rating: 5, ratingCount: 40, packageType: 'connector', category: 'Data', channel: 'beta', publisher: { id: 'p2', name: 'P2', tier: 'official', trustScore: 0.95 }, certified: true }),
    entry({ id: 'c', name: 'Charlie', installs: 300, trustScore: 0.7, rating: 4, ratingCount: 10, packageType: 'worker', category: 'Ops', channel: 'stable', publisher: { id: 'p3', name: 'P3', tier: 'verified', trustScore: 0.6 }, installState: 'update_available' }),
  ];
  it('ranks by installs/trust/trending', () => {
    expect(rankCatalog(entries, 'installs')[0].id).toBe('b');
    expect(rankCatalog(entries, 'trust')[0].id).toBe('b');
    expect(rankCatalog(entries, 'trending')[0].id).toBe('b');
  });
  it('filters by type/category/channel/verified/search', () => {
    expect(filterCatalog(entries, { type: 'worker' }).map((e) => e.id).sort()).toEqual(['a', 'c']);
    expect(filterCatalog(entries, { verifiedOnly: true }).map((e) => e.id).sort()).toEqual(['b', 'c']);
    expect(filterCatalog(entries, { channel: 'beta' }).map((e) => e.id)).toEqual(['b']);
    expect(filterCatalog(entries, { updatesOnly: true }).map((e) => e.id)).toEqual(['c']);
    expect(filterCatalog(entries, { q: 'bravo' }).map((e) => e.id)).toEqual(['b']);
  });
  it('buckets collections + categories', () => {
    const c = collections(entries);
    expect(c.featured.map((e) => e.id)).toContain('b'); // certified/official
    expect(c.verified.map((e) => e.id).sort()).toEqual(['b', 'c']);
    expect(c.updates.map((e) => e.id)).toEqual(['c']);
    expect(categories(entries)[0].category).toBe('Ops'); // 2 in Ops
  });
});

describe('compatibility + dependency resolution', () => {
  it('checks engine compatibility via satisfiesRange', () => {
    expect(isCompatible('^1.0.0', '1.4.0')).toBe(true);
    expect(isCompatible('^2.0.0', '1.4.0')).toBe(false);
    expect(isCompatible('*', '9.9.9')).toBe(true);
  });
  it('resolves a dependency graph into topological waves', () => {
    const nodes = new Map<string, DepNode>([
      ['app', { dependencies: ['base', 'util'], compatible: true }],
      ['base', { dependencies: [], compatible: true }],
      ['util', { dependencies: ['base'], compatible: true }],
    ]);
    const plan = resolveInstallPlan('app', nodes);
    expect(plan.ok).toBe(true);
    expect(plan.waves[0]).toEqual(['base']);
    expect(plan.waves[plan.waves.length - 1]).toEqual(['app']);
    expect(plan.missing).toEqual([]);
  });
  it('reports missing dependencies + incompatible conflicts', () => {
    const nodes = new Map<string, DepNode>([
      ['app', { dependencies: ['gone', 'bad'], compatible: true }],
      ['bad', { dependencies: [], compatible: false }],
    ]);
    const plan = resolveInstallPlan('app', nodes);
    expect(plan.ok).toBe(false);
    expect(plan.missing).toEqual(['gone']);
    expect(plan.conflicts.map((c) => c.id)).toContain('bad');
  });
  it('detects a dependency cycle', () => {
    const nodes = new Map<string, DepNode>([
      ['a', { dependencies: ['b'], compatible: true }],
      ['b', { dependencies: ['a'], compatible: true }],
    ]);
    expect(resolveInstallPlan('a', nodes).error).toBe('cycle');
  });
  it('rejects an unknown root package', () => {
    expect(resolveInstallPlan('missing', new Map()).error).toBe('unknown_package');
  });
});

describe('org governance', () => {
  function policy(over: Partial<OrgMarketplacePolicy> = {}): OrgMarketplacePolicy {
    return { requireApproval: false, allowedPublishers: [], blockedPublishers: [], blockedTypes: [], minPublisherTier: 'unverified', requireSignature: false, updatedAt: NOW, ...over };
  }
  const e = entry();
  it('allows by default', () => {
    expect(evaluatePolicy(e, policy()).decision).toBe('allow');
  });
  it('denies blocked publisher / type / unsigned / below-tier / non-allowlisted', () => {
    expect(evaluatePolicy(e, policy({ blockedPublishers: ['pub-1'] })).decision).toBe('deny');
    expect(evaluatePolicy(e, policy({ blockedTypes: ['worker'] })).decision).toBe('deny');
    expect(evaluatePolicy({ ...e, signed: false }, policy({ requireSignature: true })).decision).toBe('deny');
    expect(evaluatePolicy(e, policy({ minPublisherTier: 'official' })).decision).toBe('deny');
    expect(evaluatePolicy(e, policy({ allowedPublishers: ['other'] })).decision).toBe('deny');
  });
  it('requires approval when configured', () => {
    expect(evaluatePolicy(e, policy({ requireApproval: true })).decision).toBe('require_approval');
  });
});

describe('trust report + install decision', () => {
  const e = entry();
  it('builds a trust report with certificate status', () => {
    const r = buildTrustReport(e, { signatureValid: true, signatureKeyId: 'npsign_x', scan: 'pass', compatible: true, compatibilityNote: null, verdict: { decision: 'allow', reasons: [] } });
    expect(r.certificate).toBe('valid');
    expect(r.compatible).toBe(true);
    const unsigned = buildTrustReport({ ...e, signed: false }, { signatureValid: false, signatureKeyId: null, scan: 'none', compatible: true, compatibilityNote: null, verdict: { decision: 'allow', reasons: [] } });
    expect(unsigned.certificate).toBe('unsigned');
  });
  it('canInstall combines verdict + capability', () => {
    expect(canInstall(e, { decision: 'allow', reasons: [] })).toEqual({ allowed: true, decision: 'allow', routable: true });
    expect(canInstall(e, { decision: 'deny', reasons: [] }).allowed).toBe(false);
    expect(canInstall({ ...e, capability: 'catalog' }, { decision: 'allow', reasons: [] }).routable).toBe(false);
  });
});

describe('analytics', () => {
  it('computes totals, adoption, rollback rate, and breakdowns', () => {
    const entries = [
      entry({ id: 'a', installs: 100, installState: 'installed', packageType: 'worker', channel: 'stable' }),
      entry({ id: 'b', installs: 300, installState: 'update_available', packageType: 'connector', channel: 'beta' }),
      entry({ id: 'c', installs: 0, installState: 'not_installed', packageType: 'worker', channel: 'stable' }),
    ];
    const pubs = [{ id: 'p1', name: 'P1', installs: 400, tier: 'official' as const }];
    const a = computeAnalytics(entries, pubs, 40);
    expect(a.totalPackages).toBe(3);
    expect(a.totalInstalls).toBe(400);
    expect(a.updatesAvailable).toBe(1);
    expect(a.adoption).toBeCloseTo(2 / 3, 5);
    expect(a.rollbackRate).toBeCloseTo(0.1, 5);
    expect(a.byType.find((t) => t.type === 'worker')?.count).toBe(2);
  });
});
