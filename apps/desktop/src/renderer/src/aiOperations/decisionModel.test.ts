import { describe, it, expect } from 'vitest';
import { summarizeDecisions } from './decisionModel';

// Minimal REAL-shaped fixtures. Field names mirror ExecutiveDecision; every value
// below is a genuine populated field, so the derivation has real signal to report.
const evidence = ['ev-1'];
const history = [{ at: '2026-01-01T00:00:00Z', actor: 'system', kind: 'created' }];

describe('summarizeDecisions — Decision Intelligence lens', () => {
  it('(a) derives coverage stats + a 9-field group from real, populated decisions', () => {
    const lens = summarizeDecisions({
      decisions: [
        // Fully-carried decision: all five real fields present.
        {
          id: 'd1',
          status: 'accepted',
          confidence: 0.9,
          evidence,
          fromRecommendationId: 'rec-1',
          history,
          expectedOutcome: 'cycle time down 20%',
        },
        // Bare draft: no evidence, no reco, no history, no expected outcome, still pending.
        { id: 'd2', status: 'draft', confidence: 0.4, evidence: [] },
      ],
    });

    // Field-coverage stat: (1 evidence + 1 reco + 1 decided + 1 history + 1 outcome)
    // over the 5 real fields × 2 records = 5/10 = 50% → orange band.
    const coverage = lens.stats.find((s) => s.label === 'Field coverage');
    expect(coverage).toBeDefined();
    expect(coverage?.value).toBe('50%');
    expect(coverage?.tone).toBe('orange');

    // Mean model/heuristic confidence over the two records = (0.9 + 0.4) / 2 = 65%.
    const confidence = lens.stats.find((s) => s.label === 'Model confidence');
    expect(confidence?.value).toBe('65%');

    // All nine ideal fields are rendered as coverage rows.
    const group = lens.groups.find((g) => g.title.includes('9-field'));
    expect(group).toBeDefined();
    expect(group?.rows).toHaveLength(9);

    // Populated fields carry a real "<n> of <total>" derived from the records...
    expect(group?.rows.find((r) => r.label === 'Evidence')?.value).toBe('1 of 2');
    expect(group?.rows.find((r) => r.label === 'Recommendations')?.value).toBe('1 of 2');
    // Approvals lifecycle: only d1 (accepted) has been ruled on; d2 is still a draft.
    expect(group?.rows.find((r) => r.label === 'Approvals')?.value).toBe('1 of 2');
    expect(group?.rows.find((r) => r.label === 'Execution history')?.value).toBe('1 of 2');
    expect(group?.rows.find((r) => r.label === 'Outcome')?.value).toBe('1 of 2');

    // ...while the four genuine absences never fabricate a number.
    for (const gapLabel of ['Alternatives', 'Policies', 'Risks', 'Lessons learned']) {
      const row = group?.rows.find((r) => r.label === gapLabel);
      expect(row?.value).toBe('Gap');
      expect(row?.tone).toBe('gray');
    }

    // Lifecycle-status group reflects the real statuses only (no invented buckets).
    const status = lens.groups.find((g) => g.title === 'Lifecycle status');
    expect(status?.rows.map((r) => r.label).sort()).toEqual(['Accepted', 'Draft']);

    // The four architectural gaps and the three deep-links are always present.
    expect(lens.gaps).toHaveLength(4);
    expect(lens.links).toHaveLength(3);
  });

  it('(b) empty or undefined input -> honest empty state with all four gaps', () => {
    const cases = [
      summarizeDecisions(undefined),
      summarizeDecisions({}),
      summarizeDecisions({ decisions: [] }),
      summarizeDecisions({ decisions: null }),
    ];

    for (const lens of cases) {
      // Nothing is fabricated when there is nothing to derive.
      expect(lens.stats).toEqual([]);
      expect(lens.groups).toEqual([]);

      // The gaps are architectural truths — present regardless of data volume.
      expect(lens.gaps).toHaveLength(4);
      const caps = lens.gaps.map((g) => g.capability);
      expect(caps).toContain('Alternatives considered');
      expect(caps).toContain('Lessons learned');
      expect(caps).toContain('Measured outcome (actual vs expected)');
      expect(caps).toContain('Policy & approver trail on general decisions');
      // Each gap names the architecture it would REQUIRE — never a fake value.
      expect(lens.gaps.every((g) => g.requires.length > 0)).toBe(true);

      // Deep-links to the canonical governance surfaces survive the empty state.
      expect(lens.links?.map((l) => l.section).sort()).toEqual([
        'administration',
        'decision-center',
        'workforce',
      ]);
    }
  });

  it('(c) coverage ratio drives the health-tone boundary (0.8 green / 0.6 orange / 0.2 red)', () => {
    const toneOf = (lens: ReturnType<typeof summarizeDecisions>) =>
      lens.stats.find((s) => s.label === 'Field coverage')?.tone;

    // 4 of 5 fields populated = 0.8 → exactly on the green boundary.
    const green = summarizeDecisions({
      decisions: [{ status: 'accepted', evidence, fromRecommendationId: 'rec-1', history }],
    });
    // 3 of 5 = 0.6 → orange band.
    const orange = summarizeDecisions({
      decisions: [{ status: 'accepted', evidence, fromRecommendationId: 'rec-1' }],
    });
    // 1 of 5 = 0.2 (a draft is not "decided", so approvals does not count) → red band.
    const red = summarizeDecisions({ decisions: [{ status: 'draft', evidence }] });

    expect(toneOf(green)).toBe('green');
    expect(toneOf(orange)).toBe('orange');
    expect(toneOf(red)).toBe('red');
  });
});
