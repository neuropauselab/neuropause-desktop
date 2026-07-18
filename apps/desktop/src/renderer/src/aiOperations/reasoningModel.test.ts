import { describe, it, expect } from 'vitest';
import { summarizeReasoning, type ReasoningInput } from './reasoningModel';

/** Locate a stat/row by its label (stats/rows are order-independent this way). */
const stat = (lens: ReturnType<typeof summarizeReasoning>, label: string) =>
  lens.stats.find((s) => s.label === label);
const group = (lens: ReturnType<typeof summarizeReasoning>, title: string) =>
  lens.groups.find((g) => g.title === title);
const row = (g: ReturnType<typeof group>, label: string) =>
  g?.rows.find((r) => r.label === label);

describe('summarizeReasoning', () => {
  it('(a) populated input surfaces findings, cross-module counts, and evidence coverage', () => {
    // 4 findings (3 grounded), intel 2 recs (1 grounded), executive 1 rec (grounded).
    // grounded = 3 + 1 + 1 = 5, total = 4 + 2 + 1 = 7  ->  5/7 = 71% (orange band).
    const input: ReasoningInput = {
      reasoning: {
        confidence: 0.75,
        findings: [
          { dimension: 'risks', severity: 'critical', confidence: 0.6, evidence: ['risk:1'] },
          { dimension: 'compliance', severity: 'at-risk', confidence: 0.7, evidence: ['ctrl:2'] },
          { dimension: 'costs', severity: 'watch', confidence: 0.8, evidence: [] }, // ungrounded
          { dimension: 'performance', severity: 'healthy', confidence: 0.9, evidence: ['perf:3'] },
        ],
      },
      intel: {
        recommendations: [
          { priority: 'critical', evidence: ['node:9'] },
          { priority: 'high', evidence: [] }, // ungrounded
        ],
      },
      executive: {
        recommendations: [{ priority: 'medium', evidence: ['exec:5'] }],
      },
    };

    const lens = summarizeReasoning(input);

    // Findings headline reads the real count.
    expect(stat(lens, 'Reasoning findings')?.value).toBe('4');

    // Cross-module = intel(2) + executive(1).
    expect(stat(lens, 'Cross-module signals')?.value).toBe('3');

    // Evidence coverage is the dominant signal: 5/7 -> 71%, orange (>=0.5, <0.8).
    const cov = stat(lens, 'Evidence coverage');
    expect(cov?.value).toBe('71%');
    expect(cov?.tone).toBe('orange');
    expect(cov?.hint).toContain('5/7');

    // Confidence is surfaced but must be labeled heuristic (source is not calibrated).
    const conf = stat(lens, 'Confidence (heuristic)');
    expect(conf?.value).toBe('75%');
    expect(conf?.hint).toContain('heuristic');

    // Severity split group has one row per present band.
    const findingsGroup = group(lens, 'Reasoning findings');
    expect(row(findingsGroup, 'Critical')?.value).toBe('1');
    expect(row(findingsGroup, 'At risk')?.value).toBe('1');
    expect(row(findingsGroup, 'Watch')?.value).toBe('1');
    expect(row(findingsGroup, 'Healthy')?.value).toBe('1');

    // Evidence-coverage group breaks grounded/total down per source + overall.
    const covGroup = group(lens, 'Evidence coverage');
    expect(row(covGroup, 'Reasoning findings')?.value).toBe('75%'); // 3/4
    expect(row(covGroup, 'Intelligence recommendations')?.value).toBe('50%'); // 1/2
    expect(row(covGroup, 'Executive recommendations')?.value).toBe('100%'); // 1/1
    expect(row(covGroup, 'Overall')?.value).toBe('71%');
    expect(row(covGroup, 'Overall')?.sub).toBe('5 of 7 grounded');

    // Cross-module group carries the recommendation volume + priority split.
    const cross = group(lens, 'Cross-module signals');
    expect(row(cross, 'Enterprise intelligence')?.value).toBe('2 rec(s)');
    expect(row(cross, 'Executive center')?.value).toBe('1 rec(s)');

    // Honesty + reuse are always present.
    expect(lens.gaps.map((g) => g.capability)).toEqual([
      'LLM-narrated explanation',
      'Calibrated confidence',
    ]);
    expect(lens.links?.map((l) => l.section)).toEqual([
      'strategy-center',
      'operations',
      'intelligence',
    ]);
  });

  it('(b) empty input is an honest empty state — no stats/groups, gaps + links persist', () => {
    const empty = summarizeReasoning({});
    expect(empty.stats).toEqual([]);
    expect(empty.groups).toEqual([]);
    // Architectural gaps are truths independent of data.
    expect(empty.gaps).toHaveLength(2);
    expect(empty.gaps.map((g) => g.capability)).toContain('LLM-narrated explanation');
    expect(empty.gaps.map((g) => g.capability)).toContain('Calibrated confidence');
    // Reuse links persist so the operator can still reach the canonical surfaces.
    expect(empty.links).toHaveLength(3);

    // Present-but-empty sources are ALSO an honest empty state (never fabricated zeros/100%).
    const emptySources = summarizeReasoning({
      reasoning: { findings: [], confidence: 1 }, // source returns 1.0 when empty — must not surface it
      intel: { recommendations: [] },
      executive: {},
    });
    expect(emptySources.stats).toEqual([]);
    expect(emptySources.groups).toEqual([]);
    expect(emptySources.gaps).toHaveLength(2);
    // The empty-report confidence=1.0 artifact is never shown as a "100% confident" stat.
    expect(stat(emptySources, 'Confidence (heuristic)')).toBeUndefined();
  });

  it('(c) evidence-coverage tone follows the healthTone boundary (green/orange/red)', () => {
    const findings = (grounded: number, total: number): ReasoningInput => ({
      reasoning: {
        findings: Array.from({ length: total }, (_v, i) => ({
          dimension: 'risks',
          severity: 'watch',
          confidence: 0.5,
          evidence: i < grounded ? ['e:' + i] : [],
        })),
      },
    });

    // 4/5 = 0.80 -> green (>= 0.8).
    const green = stat(summarizeReasoning(findings(4, 5)), 'Evidence coverage');
    expect(green?.value).toBe('80%');
    expect(green?.tone).toBe('green');

    // 1/2 = 0.50 -> orange (>= 0.5, < 0.8) — the lower boundary.
    const orange = stat(summarizeReasoning(findings(1, 2)), 'Evidence coverage');
    expect(orange?.value).toBe('50%');
    expect(orange?.tone).toBe('orange');

    // 0/3 = 0.00 -> red (< 0.5).
    const red = stat(summarizeReasoning(findings(0, 3)), 'Evidence coverage');
    expect(red?.value).toBe('0%');
    expect(red?.tone).toBe('red');

    // The grouped "Reasoning findings" coverage row mirrors the same tone boundary.
    const covRow = row(group(summarizeReasoning(findings(4, 5)), 'Evidence coverage'), 'Reasoning findings');
    expect(covRow?.tone).toBe('green');
  });
});
