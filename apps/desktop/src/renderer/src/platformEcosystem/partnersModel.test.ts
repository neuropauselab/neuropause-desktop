/**
 * Partner Platform tab-lens — authenticity tests (Phase 5, Sub-Agent 4).
 *
 * These assert the three contract-critical behaviours:
 *   (a) real adjacent signals (the 5-mode deployment catalog, developer OAuth apps)
 *       become real stats/rows,
 *   (b) empty/undefined input degrades to an HONEST empty state AND surfaces every
 *       honest gap, and
 *   (c) NO fabricated partner metric is ever emitted — the directory count defaults
 *       to 0 (never the demo seed) and certification/analytics stay gaps, not values.
 */
import { describe, it, expect } from 'vitest';
import { summarizePartners, type PartnersInput } from './partnersModel';
import type { OpLens } from '@renderer/aiOperations/aiOperationsModel';

/** The real production-authentic deployment catalog: 5 read-only modes, none partner-scoped. */
const REAL_DEPLOYMENT: NonNullable<PartnersInput['deployment']> = {
  currentMode: 'cloud_saas',
  modes: [
    { id: 'cloud_saas', name: 'Cloud SaaS', available: true, current: true },
    { id: 'private_cloud', name: 'Private Cloud', available: true },
    { id: 'hybrid', name: 'Hybrid', available: true },
    { id: 'on_premises', name: 'On-Premises', available: true },
    { id: 'air_gapped', name: 'Air-Gapped', available: true },
  ],
};

const stat = (lens: OpLens, re: RegExp) => lens.stats.find((s) => re.test(s.label));
const row = (lens: OpLens, re: RegExp) => lens.groups.flatMap((g) => g.rows).find((r) => re.test(r.label));

describe('summarizePartners — real adjacent signals (a)', () => {
  it('surfaces the real 5-mode deployment catalog as both a stat and a row', () => {
    const lens = summarizePartners({ deployment: REAL_DEPLOYMENT, oauthApps: 2 });
    expect(stat(lens, /deployment modes/i)?.value).toBe('5');

    const catalogRow = row(lens, /deployment mode catalog/i);
    expect(catalogRow?.value).toBe('5/5 available');
    expect(catalogRow?.sub).toContain('Cloud SaaS'); // real mode names, not invented

    expect(row(lens, /current deployment mode/i)?.value).toBe('cloud_saas');
    expect(stat(lens, /developer oauth apps/i)?.value).toBe('2'); // real integration primitive
  });

  it('names the real integration substrate group and the real federation partner scope', () => {
    const lens = summarizePartners({ deployment: REAL_DEPLOYMENT });
    expect(lens.groups.some((g) => /integration substrate/i.test(g.title))).toBe(true);
    expect(row(lens, /federation partner scope/i)?.value).toContain('partner');
  });

  it('reflects only a partially-available catalog honestly (does not assume all 5 are on)', () => {
    const lens = summarizePartners({
      deployment: { modes: [{ id: 'cloud_saas', available: true }, { id: 'air_gapped', available: false }] },
    });
    expect(stat(lens, /deployment modes/i)?.value).toBe('2');
    expect(row(lens, /deployment mode catalog/i)?.value).toBe('1/2 available');
  });
});

describe('summarizePartners — honest empty state + all gaps (b)', () => {
  const GAPS = [
    'Solution partner / SI / reseller model',
    'Partner certification',
    'Partner analytics',
    'Partner deployment profiles',
  ];

  for (const empty of [undefined, {}] as const) {
    it(`shows honest zeros, the empty-state note and ALL gaps for ${empty === undefined ? 'undefined' : 'empty'} input`, () => {
      const lens = summarizePartners(empty);

      // honest zeros — nothing is seeded when no signal is present
      expect(stat(lens, /partner directory/i)?.value).toBe('0');
      expect(stat(lens, /deployment modes/i)?.value).toBe('0');

      // the empty state is stated explicitly, not hidden
      expect(stat(lens, /partner directory/i)?.hint).toMatch(/empty in production/i);
      expect(lens.groups.some((g) => /demo fixture/i.test(g.title))).toBe(true);

      // every honest gap is present, in order, none dropped
      expect(lens.gaps.map((g) => g.capability)).toEqual(GAPS);
      expect(lens.gaps.every((g) => g.requires.length > 0)).toBe(true);

      // reuse deep-links to the canonical surfaces
      expect(lens.links?.map((l) => l.section)).toEqual(['ecosystem', 'federation']);
    });
  }
});

describe('summarizePartners — no fabricated partner metric (c)', () => {
  it('defaults the directory to 0 (never the demo seed) and keeps certs/analytics as gaps not stats', () => {
    const lens = summarizePartners({ deployment: REAL_DEPLOYMENT }); // deployment present, but NO directory
    expect(stat(lens, /partner directory/i)?.value).toBe('0');

    // no stat OR row exposes a fabricated tier / certification / premier / analytics metric
    const labels = [
      ...lens.stats.map((s) => s.label),
      ...lens.groups.flatMap((g) => g.rows.map((r) => r.label)),
    ];
    expect(labels.some((l) => /certif|premier|analytics/i.test(l))).toBe(false);

    // those live as honest gaps instead
    expect(lens.gaps.map((g) => g.capability)).toEqual(
      expect.arrayContaining(['Partner certification', 'Partner analytics']),
    );
  });

  it('reflects ONLY the real directory count passed in — array or number, never a seed', () => {
    expect(stat(summarizePartners({ partnerDirectory: 0 }), /partner directory/i)?.value).toBe('0');
    expect(stat(summarizePartners({ partnerDirectory: [] }), /partner directory/i)?.value).toBe('0');
    // demo mode (NP_DEMO_SEEDS on): genuinely-present fixtures are reflected, not invented
    expect(stat(summarizePartners({ partnerDirectory: 6 }), /partner directory/i)?.value).toBe('6');
    expect(stat(summarizePartners({ partnerDirectory: [{}, {}, {}] }), /partner directory/i)?.value).toBe('3');
    // a nonsense count never renders NaN — it floors to an honest 0
    expect(stat(summarizePartners({ partnerDirectory: Number.NaN }), /partner directory/i)?.value).toBe('0');
  });
});
