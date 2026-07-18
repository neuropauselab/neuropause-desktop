import { describe, it, expect } from 'vitest';
import { summarizeAnalytics, type AnalyticsInput } from './analyticsModel';
import { healthTone, type OpLens, type OpGroup, type OpRow, type OpStat } from '@renderer/aiOperations/aiOperationsModel';
import { computeMaturity } from '@renderer/capability/capabilityRegistry';

/* Local helpers — locate stats/rows/groups by their stable labels/titles. */
const stat = (lens: OpLens, label: string): OpStat | undefined =>
  lens.stats.find((s) => s.label === label);
const group = (lens: OpLens, title: string): OpGroup | undefined =>
  lens.groups.find((g) => g.title === title);
const row = (g: OpGroup | undefined, label: string): OpRow | undefined =>
  g?.rows.find((r) => r.label === label);

/** Every rendered value string in the lens (stat + row values). */
const allValues = (lens: OpLens): string[] => [
  ...lens.stats.map((s) => s.value),
  ...lens.groups.flatMap((g) => g.rows.map((r) => r.value)),
];

const REAL_GROUP = 'Real platform analytics';
const ECO_GROUP = 'Ecosystem rollup (real fields only)';

describe('summarizeAnalytics — Platform Analytics derivation', () => {
  it('(a) populated real analytics → real gateway/marketplace/maturity stats & rows', () => {
    const m = computeMaturity(); // REAL deterministic capability maturity source
    const input: AnalyticsInput = {
      developer: {
        windowDays: 30,
        requests: 1000,
        allowed: 900,
        denied: 100,
        rateLimited: 20,
        unauthorized: 15,
        p95LatencyMs: 220,
      },
      marketplace: {
        totalPackages: 48,
        totalPublishers: 12,
        totalInstalls: 320,
        updatesAvailable: 5,
        adoption: 0.5,
      },
      ecosystem: {
        totalListings: 60,
        publishedListings: 40,
        certifiedListings: 9,
        totalInstalls: 500,
        activeDevelopers: 25,
        activeOrganizations: 7,
        downloads30d: 130,
        usage: { requests30d: 20000, computeUnits30d: 4096, p95LatencyMs: 275 },
      },
      maturity: m,
    };

    const lens = summarizeAnalytics(input);

    // Headline stats — each read straight from a real field.
    expect(stat(lens, 'Gateway requests')?.value).toBe('1000');
    expect(stat(lens, 'Gateway requests')?.hint).toBe('30-day window');
    expect(stat(lens, 'Gateway p95')?.value).toBe('220 ms');
    expect(stat(lens, 'Gateway p95')?.tone).toBe('green'); // 220ms ≤ 300 → green
    expect(stat(lens, 'Marketplace adoption')?.value).toBe('50%');
    expect(stat(lens, 'Marketplace adoption')?.tone).toBe('orange'); // 0.5 → orange
    expect(stat(lens, 'Capability maturity')?.value).toBe(`${m.maturityPct}%`);
    expect(stat(lens, 'Capability maturity')?.tone).toBe(healthTone(m.maturityPct / 100));

    // Real platform analytics group — usage/latency · marketplace · maturity.
    const rg = group(lens, REAL_GROUP);
    expect(rg).toBeDefined();
    expect(row(rg, 'Gateway requests')?.value).toBe('1000');
    expect(row(rg, 'Allowed / denied')?.value).toBe('900 / 100');
    expect(row(rg, 'Allowed / denied')?.tone).toBe('green'); // 0.9 success → green
    expect(row(rg, 'Rate limited')?.value).toBe('20');
    expect(row(rg, 'Rate limited')?.sub).toBe('15 unauthorized');
    expect(row(rg, 'Gateway p95 latency')?.value).toBe('220 ms');
    expect(row(rg, 'Marketplace adoption')?.value).toBe('50%');
    expect(row(rg, 'Marketplace installs')?.value).toBe('320');
    expect(row(rg, 'Marketplace packages')?.value).toBe('48');
    expect(row(rg, 'Marketplace packages')?.sub).toBe('12 publishers');
    expect(row(rg, 'Updates available')?.value).toBe('5');
    expect(row(rg, 'Capability maturity')?.value).toBe(`${m.maturityPct}%`);
    expect(row(rg, 'Capability maturity')?.sub).toBe(`${m.real}/${m.total} capabilities real`);
    expect(row(rg, 'Production-complete')?.value).toBe(`${m.completionPct}%`);

    // Ecosystem rollup group — real, non-demo fields only.
    const eg = group(lens, ECO_GROUP);
    expect(eg).toBeDefined();
    expect(row(eg, 'Listings')?.value).toBe('60');
    expect(row(eg, 'Listings')?.sub).toBe('40 published · 9 certified');
    expect(row(eg, 'Active developers')?.value).toBe('25');
    expect(row(eg, 'Downloads (30d)')?.value).toBe('130');
    expect(row(eg, 'Gateway requests (30d)')?.value).toBe('20000');
    expect(row(eg, 'Gateway p95 (30d)')?.value).toBe('275 ms');

    // Gaps + links are always present and structural.
    expect(lens.gaps).toHaveLength(2);
    expect(lens.links?.map((l) => l.section)).toEqual(['intelligence', 'developer']);
  });

  it('(b) demo-seeded analytics (partners/packs) are NEVER surfaced as numbers — only as gaps', () => {
    // Non-zero sentinel counts simulate a dev build with demo seeds ON. In production these
    // stores are empty; either way they must NOT surface as earned numbers.
    const input: AnalyticsInput = {
      ecosystem: {
        totalListings: 3,
        activeDevelopers: 2,
        downloads30d: 11,
        partners: 4242, // DEMO sentinel — must not leak
        packs: 7777, // DEMO sentinel — must not leak
      },
    };

    const lens = summarizeAnalytics(input);

    // The real ecosystem fields still surface honestly.
    const eg = group(lens, ECO_GROUP);
    expect(eg).toBeDefined();
    expect(row(eg, 'Listings')?.value).toBe('3');
    expect(row(eg, 'Active developers')?.value).toBe('2');

    // No stat or row anywhere surfaces the demo-seeded partner/pack counts.
    const values = allValues(lens);
    expect(values).not.toContain('4242');
    expect(values).not.toContain('7777');
    // Strongest guarantee: the demo counts do not leak anywhere in the lens.
    const serialized = JSON.stringify(lens);
    expect(serialized).not.toContain('4242');
    expect(serialized).not.toContain('7777');
    // No row is labelled as partner/pack analytics (those are honest gaps, not data rows).
    const rowLabels = lens.groups.flatMap((g) => g.rows.map((r) => r.label));
    expect(rowLabels.some((l) => /partner|pack/i.test(l))).toBe(false);

    // The demo capabilities are surfaced as honest, labeled gaps instead.
    const caps = lens.gaps.map((g) => g.capability);
    expect(caps).toContain('Partner analytics');
    expect(caps).toContain('Pack / exchange analytics');
    const partnerGap = lens.gaps.find((g) => g.capability === 'Partner analytics');
    expect(partnerGap?.requires).toContain('partner directory');
    const packGap = lens.gaps.find((g) => g.capability === 'Pack / exchange analytics');
    expect(packGap?.requires).toContain('demo-seeded');
  });

  it('(c) empty / undefined input → honest empty state with gaps + links present', () => {
    for (const lens of [summarizeAnalytics({}), summarizeAnalytics(undefined)]) {
      // Honest empty: nothing fabricated from absent sources.
      expect(lens.stats).toHaveLength(0);
      expect(lens.groups).toHaveLength(0);

      // Gaps are genuine absences and are ALWAYS surfaced with a real "requires".
      expect(lens.gaps).toHaveLength(2);
      const caps = lens.gaps.map((g) => g.capability);
      expect(caps).toContain('Partner analytics');
      expect(caps).toContain('Pack / exchange analytics');
      for (const gap of lens.gaps) {
        expect(gap.requires.length).toBeGreaterThan(0);
      }

      // Deep-links to canonical surfaces are always offered.
      expect(lens.links?.map((l) => l.section)).toEqual(['intelligence', 'developer']);
    }
  });

  it('(d) partial sources surface only their real rows (no cross-source fabrication)', () => {
    // Developer only → gateway stats/rows, but NO marketplace/maturity/ecosystem content.
    const devOnly = summarizeAnalytics({ developer: { requests: 500, p95LatencyMs: 1500 } });
    expect(stat(devOnly, 'Gateway requests')?.value).toBe('500');
    expect(stat(devOnly, 'Gateway p95')?.tone).toBe('red'); // 1500ms > 1200 → red
    expect(stat(devOnly, 'Marketplace adoption')).toBeUndefined();
    expect(stat(devOnly, 'Capability maturity')).toBeUndefined();
    expect(group(devOnly, ECO_GROUP)).toBeUndefined();

    // Maturity only → the maturity stat + a Real-analytics group with only maturity rows.
    const m = computeMaturity();
    const matOnly = summarizeAnalytics({ maturity: m });
    expect(matOnly.stats).toHaveLength(1);
    expect(stat(matOnly, 'Capability maturity')?.value).toBe(`${m.maturityPct}%`);
    const rg = group(matOnly, REAL_GROUP);
    expect(rg).toBeDefined();
    expect(row(rg, 'Capability maturity')?.value).toBe(`${m.maturityPct}%`);
    expect(row(rg, 'Gateway requests')).toBeUndefined();
    expect(row(rg, 'Marketplace adoption')).toBeUndefined();

    // Gaps stay structural even when a real source is present.
    expect(matOnly.gaps).toHaveLength(2);
  });

  it('(e) latency tone bands the p95 boundaries (presentation only, value stays real)', () => {
    const toneAt = (p95LatencyMs: number): OpStat['tone'] =>
      stat(summarizeAnalytics({ developer: { p95LatencyMs } }), 'Gateway p95')?.tone;
    expect(toneAt(0)).toBe('green');
    expect(toneAt(300)).toBe('green'); // boundary
    expect(toneAt(301)).toBe('orange');
    expect(toneAt(1200)).toBe('orange'); // boundary
    expect(toneAt(1201)).toBe('red');
    // The millisecond value itself is always the real, source-derived signal.
    expect(stat(summarizeAnalytics({ developer: { p95LatencyMs: 842 } }), 'Gateway p95')?.value).toBe(
      '842 ms',
    );
  });
});
