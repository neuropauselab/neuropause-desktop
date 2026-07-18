import { describe, it, expect } from 'vitest';
import { summarizeMarketplace, type MarketplaceInput } from './marketplaceModel';

/**
 * A fully-populated input mirroring the REAL payload shapes:
 *   listings  ← ipc.marketplace.catalog()   (MarketplaceEntry[], incl. "(Example)" seeds)
 *   analytics ← ipc.marketplace.analytics()  (MarketplaceAnalytics — byChannel/rollbackRate caveats)
 *   metering  ← ipc.commercial.metering()    (CommercialMetering — honest zero-until-real ledger)
 *
 * The catalog carries ONE honestly-labeled "(Example)" seed plus two earned rows so
 * both the example-labeling and real-count branches are exercised.
 */
function populatedInput(overrides: Partial<MarketplaceInput> = {}): MarketplaceInput {
  return {
    listings: [
      {
        id: 'l1',
        name: 'Research Analyst (Example)',
        packageType: 'worker',
        channel: 'stable',
        publisher: { id: 'neuropause-labs', name: 'NeuroPause Labs', tier: 'official', trustScore: 0.9 },
        signed: true,
        certified: true,
        installs: 40,
        installState: 'installed',
        version: '1.0.0',
      },
      {
        id: 'l2',
        name: 'Acme Data Sync',
        packageType: 'connector',
        channel: 'stable',
        publisher: { id: 'neuropause-labs', name: 'NeuroPause Labs', tier: 'official', trustScore: 0.9 },
        signed: true,
        certified: false,
        installs: 12,
        installState: 'not_installed',
        version: '0.9.0',
      },
      {
        id: 'l3',
        name: 'Ops Copilot',
        packageType: 'worker',
        channel: 'stable',
        publisher: { id: 'neuropause-labs', name: 'NeuroPause Labs', tier: 'official', trustScore: 0.9 },
        signed: true,
        certified: true,
        installs: 8,
        installState: 'update_available',
        version: '2.1.0',
      },
    ],
    analytics: {
      totalPackages: 3,
      totalPublishers: 1,
      totalInstalls: 60,
      updatesAvailable: 1,
      rollbackRate: 0, // stubbed 0 — no rollback telemetry
      byType: [
        { type: 'worker', count: 2, installs: 48 },
        { type: 'connector', count: 1, installs: 12 },
      ],
      byChannel: [{ channel: 'stable', count: 3 }], // collapses to stable
      topPublishers: [{ id: 'neuropause-labs', name: 'NeuroPause Labs', installs: 60, tier: 'official' }],
      adoption: 2 / 3, // 2 of 3 installed
    },
    metering: {
      monthlySpend: 0, // honest zero — nothing billed yet
      requests30d: 0,
      aiCostUsd: 0,
      currency: 'USD',
      note: 'No metered usage yet.',
    },
    ...overrides,
  };
}

const findStat = (lens: ReturnType<typeof summarizeMarketplace>, label: string) =>
  lens.stats.find((s) => s.label === label);
const findGroup = (lens: ReturnType<typeof summarizeMarketplace>, title: string) =>
  lens.groups.find((g) => g.title === title);

describe('summarizeMarketplace — populated (real catalog with an "(Example)" seed)', () => {
  it('labels the example seed and reports real earned vs example counts', () => {
    const lens = summarizeMarketplace(populatedInput());
    const listings = findStat(lens, 'Marketplace listings');
    expect(listings?.value).toBe('3');
    // The example is called out, and the earned (non-example) count is real.
    expect(listings?.hint).toMatch(/\(Example\)/);
    expect(listings?.hint).toContain('1 "(Example)" seed');
    expect(listings?.hint).toContain('2 earned');
  });

  it('surfaces distinct package types with the top type from real analytics', () => {
    const lens = summarizeMarketplace(populatedInput());
    const types = findStat(lens, 'Package types');
    expect(types?.value).toBe('2'); // worker + connector
    expect(types?.hint).toBe('top: Worker');
  });

  it('reports adoption as a real-computed ratio (installed / catalog)', () => {
    const lens = summarizeMarketplace(populatedInput());
    const adoption = findStat(lens, 'Adoption');
    expect(adoption?.value).toBe('67%'); // pctText(2/3)
    expect(adoption?.tone).toBe('orange'); // healthTone(0.667)
  });

  it('builds a Listings & trust group with example note + real signed/certified/publisher counts', () => {
    const lens = summarizeMarketplace(populatedInput());
    const g = findGroup(lens, 'Listings & trust');
    expect(g).toBeDefined();
    const byLabel = Object.fromEntries((g?.rows ?? []).map((r) => [r.label, r.value]));
    expect(byLabel['Total listings']).toBe('3');
    expect(byLabel['Earned (non-example)']).toBe('2');
    expect(byLabel['Signed (Ed25519)']).toBe('3');
    expect(byLabel['Certified']).toBe('2');
    expect(byLabel['Publishers']).toBe('1');
    // The example seed is disclosed on the Total-listings row.
    const total = g?.rows.find((r) => r.label === 'Total listings');
    expect(total?.sub).toContain('1 "(Example)" seed');
    // Publisher row honestly notes the single self-publisher.
    const pub = g?.rows.find((r) => r.label === 'Publishers');
    expect(pub?.sub).toMatch(/single self-publisher/i);
  });

  it('references the REAL submission pipeline (scan → Ed25519 → review → publish → rollback) incl. self-review', () => {
    const lens = summarizeMarketplace(populatedInput());
    const note = findGroup(lens, 'Listings & trust')?.note ?? '';
    expect(note).toMatch(/scan/i);
    expect(note).toMatch(/Ed25519/i);
    expect(note).toMatch(/review/i);
    expect(note).toMatch(/publish/i);
    expect(note).toMatch(/rollback/i);
    expect(note).toMatch(/self-review/i);
  });

  it('builds an Analytics group that states the byChannel + rollbackRate caveats openly', () => {
    const lens = summarizeMarketplace(populatedInput());
    const g = findGroup(lens, 'Analytics (real-computed)');
    expect(g).toBeDefined();
    const byLabel = Object.fromEntries((g?.rows ?? []).map((r) => [r.label, r.value]));
    expect(byLabel['Total installs']).toBe('60');
    expect(byLabel['Updates available']).toBe('1');

    const rollback = g?.rows.find((r) => r.label === 'Rollback rate');
    expect(rollback?.value).toBe('0%');
    expect(rollback?.sub).toMatch(/stubbed 0/i);

    const channels = g?.rows.find((r) => r.label === 'Release channels');
    expect(channels?.value).toBe('stable (3)');
    expect(channels?.sub).toMatch(/collapses to "stable"/i);

    expect(g?.note).toMatch(/byChannel/i);
    expect(g?.note).toMatch(/rollbackRate/i);
    expect(g?.note).toMatch(/do not transact/i);
  });

  it('deep-links to the marketplace and ecosystem storefront surfaces', () => {
    const lens = summarizeMarketplace(populatedInput());
    const sections = (lens.links ?? []).map((l) => l.section);
    expect(sections).toContain('marketplace');
    expect(sections).toContain('ecosystem');
  });

  it('always discloses the four genuine ecosystem gaps', () => {
    const lens = summarizeMarketplace(populatedInput());
    const surface = lens.gaps.map((g) => `${g.capability} :: ${g.requires}`);
    expect(lens.gaps).toHaveLength(4);
    expect(surface.some((s) => /separation of duties/i.test(s) && /self-review/i.test(s))).toBe(true);
    expect(surface.some((s) => /multi-publisher/i.test(s) && /self-publisher/i.test(s))).toBe(true);
    expect(surface.some((s) => /channel promotion/i.test(s) && /byChannel collapses to stable/i.test(s))).toBe(true);
    expect(surface.some((s) => /rollback-rate/i.test(s) && /stubbed 0/i.test(s))).toBe(true);
  });
});

describe('summarizeMarketplace — revenue is an honest zero, never a seeded number', () => {
  it('defaults revenue to $0 from the real (zero) metering ledger, not a fabricated figure', () => {
    const lens = summarizeMarketplace(populatedInput());
    const rev = findStat(lens, 'Revenue (metered)');
    expect(rev).toBeDefined();
    expect(rev?.value).toBe('$0'); // honest zero
    expect(rev?.tone).toBe('gray'); // zero is not "good", just honest
    expect(rev?.hint).toMatch(/zero until real/i);

    // The Analytics group echoes the same honest zero.
    const g = findGroup(lens, 'Analytics (real-computed)');
    const revRow = g?.rows.find((r) => r.label === 'Revenue (monthly, metered)');
    expect(revRow?.value).toBe('$0');
    expect(revRow?.sub).toMatch(/zero until real/i);
  });

  it('never derives revenue from listing prices (a priced example seed stays $0 revenue)', () => {
    // Even with a paid "(Example)" listing present, revenue is driven ONLY by the
    // metering ledger — the entry shape carries no price to leak.
    const lens = summarizeMarketplace({
      listings: [{ id: 'p', name: 'SOC 2 Governance Pack (Example)', packageType: 'policy_pack', signed: true }],
      metering: { monthlySpend: 0, requests30d: 0, currency: 'USD' },
    });
    expect(findStat(lens, 'Revenue (metered)')?.value).toBe('$0');
    // No fabricated marketplace revenue anywhere in the rendered surface.
    const claimSurface = [
      ...lens.stats.map((s) => `${s.label} ${s.value} ${s.hint ?? ''}`),
      ...lens.groups.flatMap((g) => [
        g.title,
        g.note ?? '',
        ...g.rows.map((r) => `${r.label} ${r.value} ${r.sub ?? ''}`),
      ]),
    ].join(' \n ');
    expect(claimSurface).not.toContain('$99');
    expect(claimSurface).not.toContain('$19');
  });

  it('reflects a real non-zero ledger when one exists (proving it is not hardcoded to zero)', () => {
    const lens = summarizeMarketplace(populatedInput({ metering: { monthlySpend: 4200, requests30d: 1500, currency: 'USD' } }));
    const rev = findStat(lens, 'Revenue (metered)');
    expect(rev?.value).toBe('$4200');
    expect(rev?.tone).toBe('green');
    expect(rev?.hint).toBe('1500 req · 30d');
  });
});

describe('summarizeMarketplace — the catalog today is example seeds only', () => {
  it('reports 0 earned when every listing is an "(Example)" seed', () => {
    const lens = summarizeMarketplace({
      listings: [
        { id: 'a', name: 'Research Analyst (Example)', packageType: 'worker', signed: true, certified: true },
        { id: 'b', name: 'GitHub Connector (Example)', packageType: 'connector', signed: true, certified: true },
      ],
    });
    const listings = findStat(lens, 'Marketplace listings');
    expect(listings?.value).toBe('2');
    expect(listings?.hint).toContain('0 earned');
    expect(listings?.tone).toBe('gray');
    const earned = findGroup(lens, 'Listings & trust')?.rows.find((r) => r.label === 'Earned (non-example)');
    expect(earned?.value).toBe('0');
    expect(earned?.sub).toMatch(/seed examples only/i);
  });
});

describe('summarizeMarketplace — honest empty state', () => {
  it('empty input yields no stats/groups but keeps all four gaps + both links', () => {
    const lens = summarizeMarketplace({});
    expect(lens.stats).toEqual([]);
    expect(lens.groups).toEqual([]);
    expect(lens.gaps).toHaveLength(4);
    expect(lens.links).toHaveLength(2);
  });

  it('all-null signals behave the same as empty (defensive)', () => {
    const lens = summarizeMarketplace({ listings: null, analytics: null, metering: null });
    expect(lens.stats).toEqual([]);
    expect(lens.groups).toEqual([]);
    expect(lens.gaps).toHaveLength(4);
  });

  it('an empty catalog + empty analytics shows through as empty, never a placeholder', () => {
    const lens = summarizeMarketplace({
      listings: [],
      analytics: { totalPackages: 0, totalInstalls: 0, rollbackRate: 0, adoption: 0 },
    });
    expect(findStat(lens, 'Marketplace listings')).toBeUndefined();
    expect(findGroup(lens, 'Analytics (real-computed)')).toBeUndefined();
    expect(lens.gaps).toHaveLength(4);
  });
});
