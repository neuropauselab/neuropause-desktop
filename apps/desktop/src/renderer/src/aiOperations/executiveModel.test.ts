import { describe, it, expect } from 'vitest';
import { summarizeExecutive, type ExecutiveInput } from './executiveModel';
import type { OpLens, OpGroup, OpRow, OpStat } from './aiOperationsModel';

/* Local helpers — locate stats/rows/groups by their stable labels/titles. */
const stat = (lens: OpLens, label: string): OpStat | undefined =>
  lens.stats.find((s) => s.label === label);
const group = (lens: OpLens, title: string): OpGroup | undefined =>
  lens.groups.find((g) => g.title === title);
const row = (g: OpGroup | undefined, label: string): OpRow | undefined =>
  g?.rows.find((r) => r.label === label);

const ORG_HEALTH_GROUP = 'Org health & KPIs (real)';
const BRIEFING_GROUP = 'Daily briefing';
const RECS_GROUP = 'Strategic recommendations (real, evidence-backed)';

describe('summarizeExecutive — Executive AI derivation', () => {
  it('(a) populated input + grounded briefing → real KPI/health/recommendation stats & rows', () => {
    const input: ExecutiveInput = {
      center: {
        orgHealth: { overall: 82 },
        kpis: [{}, {}, {}, {}], // 4 real KPIs
        recommendations: [{}, {}, {}], // 3 ranked recs
        founderRecommendations: { items: [{}, {}] }, // 2 founder recs
        executiveSummary: {
          topRecommendation: 'Renew the enterprise license before runway ends',
          topRisk: 'License expires in 12 days',
          topOpportunity: 'Adoption climbing in engineering',
          executiveScore: 76,
        },
        attentionCounts: { critical: 1, high: 2, normal: 5 },
      },
      briefing: {
        grounded: true,
        period: 'morning',
        headline: 'Two deliveries shipped; one PR needs review',
        evidenceCount: 12,
        sections: [{ empty: false }, { empty: true }, { empty: false }],
      },
      dashboard: {
        workforce: { total: 3, jobsRun: 10 },
        intelligence: { recommendationCount: 4, grounded: true },
        risk: { level: 'elevated', openFindings: 2, criticalFindings: 0 },
      },
    };

    const lens = summarizeExecutive(input);

    // Org-health stat: 0..100 score rendered as a percentage with a real tone.
    const health = stat(lens, 'Org health');
    expect(health?.value).toBe('82%');
    expect(health?.tone).toBe('green');

    // KPI + recommendation counts come straight from real array lengths.
    expect(stat(lens, 'KPIs tracked')?.value).toBe('4');
    expect(stat(lens, 'Recommendations')?.value).toBe('3');
    expect(stat(lens, 'AI workers')?.value).toBe('3');
    expect(stat(lens, 'Briefing evidence')?.value).toBe('12');

    // Org health & KPIs group.
    const og = group(lens, ORG_HEALTH_GROUP);
    expect(og).toBeDefined();
    expect(row(og, 'Overall org health')?.value).toBe('82%');
    expect(row(og, 'KPIs tracked')?.value).toBe('4');
    expect(row(og, 'Executive score')?.value).toBe('76%');
    expect(row(og, 'Open risk findings')?.value).toBe('2');

    // Briefing group reflects grounded evidence, not a fabricated status.
    const bg = group(lens, BRIEFING_GROUP);
    expect(bg).toBeDefined();
    expect(row(bg, 'Headline')?.value).toBe('Two deliveries shipped; one PR needs review');
    expect(row(bg, 'Evidence cited')?.value).toBe('12');
    // Only 2 of 3 sections have content (one is empty).
    expect(row(bg, 'Sections with content')?.value).toBe('2');
    expect(row(bg, 'Status')).toBeUndefined(); // not the insufficient-data state

    // Strategic recommendations group.
    const rg = group(lens, RECS_GROUP);
    expect(rg).toBeDefined();
    expect(row(rg, 'Ranked recommendations')?.value).toBe('3');
    expect(row(rg, 'Founder recommendations')?.value).toBe('2');
    expect(row(rg, 'Top recommendation')?.value).toBe(
      'Renew the enterprise license before runway ends',
    );
    expect(row(rg, 'Enterprise recommendations')?.value).toBe('4');

    // Gaps + links are always present.
    expect(lens.gaps).toHaveLength(2);
    expect(lens.links).toHaveLength(3);
  });

  it('(b) briefing.grounded === false → honest insufficient-data state, NO fabricated content', () => {
    const input: ExecutiveInput = {
      briefing: {
        grounded: false,
        // These MUST NOT surface anywhere in the lens when grounded is false.
        headline: 'FABRICATED-HEADLINE-SHOULD-NOT-APPEAR',
        evidenceCount: 99,
        period: 'morning',
        sections: [{ empty: false }, { empty: false }],
      },
    };

    const lens = summarizeExecutive(input);

    // The briefing group exists and shows the honest status.
    const bg = group(lens, BRIEFING_GROUP);
    expect(bg).toBeDefined();
    expect(row(bg, 'Status')?.value).toBe('Insufficient data');
    expect(row(bg, 'Status')?.tone).toBe('gray');

    // None of the grounded-only rows are present.
    expect(row(bg, 'Headline')).toBeUndefined();
    expect(row(bg, 'Evidence cited')).toBeUndefined();
    expect(row(bg, 'Sections with content')).toBeUndefined();

    // The stat honors the flag too.
    expect(stat(lens, 'Daily briefing')?.value).toBe('Insufficient data');
    expect(stat(lens, 'Briefing evidence')).toBeUndefined();

    // Strongest guarantee: no fabricated briefing content leaks into the lens at all.
    const serialized = JSON.stringify(lens);
    expect(serialized).not.toContain('FABRICATED-HEADLINE-SHOULD-NOT-APPEAR');
    expect(serialized).not.toContain('99');

    // Still a valid lens with honest gaps + links.
    expect(lens.gaps).toHaveLength(2);
    expect(lens.links).toHaveLength(3);
  });

  it('(c) empty / undefined input → honest empty state with gaps + links present', () => {
    for (const lens of [summarizeExecutive({}), summarizeExecutive(undefined)]) {
      // Honest empty: nothing fabricated from absent sources.
      expect(lens.stats).toHaveLength(0);
      expect(lens.groups).toHaveLength(0);

      // Gaps are genuine absences and are ALWAYS surfaced.
      expect(lens.gaps).toHaveLength(2);
      const capabilities = lens.gaps.map((g) => g.capability);
      expect(capabilities).toContain('Business forecasting (ML)');
      expect(capabilities).toContain('Calibrated confidence');
      // Every gap states the architecture it would require (never a fake value).
      for (const gap of lens.gaps) {
        expect(gap.requires.length).toBeGreaterThan(0);
      }
      // The forecasting gap must warn against calling projections a "forecast".
      const forecast = lens.gaps.find((g) => g.capability === 'Business forecasting (ML)');
      expect(forecast?.requires).toContain('forecast');

      // Deep-links to canonical surfaces are always offered.
      expect(lens.links?.map((l) => l.section)).toEqual([
        'enterprise',
        'intelligence',
        'strategy-center',
      ]);
    }
  });

  it('(d) org-health tone tracks the healthTone boundary (0..100 → 0..1)', () => {
    const toneAt = (overall: number): OpsToneValue | undefined =>
      stat(summarizeExecutive({ center: { orgHealth: { overall } } }), 'Org health')?.tone;

    expect(toneAt(80)).toBe('green'); // 0.80 → green (boundary)
    expect(toneAt(79)).toBe('orange'); // 0.79 → orange (just below)
    expect(toneAt(50)).toBe('orange'); // 0.50 → orange (boundary)
    expect(toneAt(49)).toBe('red'); // 0.49 → red (just below)
    expect(toneAt(100)).toBe('green');
    expect(toneAt(0)).toBe('red');

    // The percentage rendering matches the raw 0..100 score.
    expect(
      stat(summarizeExecutive({ center: { orgHealth: { overall: 80 } } }), 'Org health')?.value,
    ).toBe('80%');
  });
});

// Minimal local alias so the boundary test reads clearly without importing the
// tone union by name (it is exported from the shared contract as `OpsTone`).
type OpsToneValue = NonNullable<OpStat['tone']>;
