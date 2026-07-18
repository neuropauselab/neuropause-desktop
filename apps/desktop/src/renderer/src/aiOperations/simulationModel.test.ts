import { describe, it, expect } from 'vitest';
import {
  summarizeSimulation,
  ILLUSTRATIVE_LABEL,
  CURRENT_ACTUALS_LABEL,
  BASELINE_REAL_NOTE,
  type SimulationInput,
} from './simulationModel';

const WHATIF_TITLE = 'What-if (illustrative only)';

/** A fully-populated real-ish input exercising all three groups. */
function populatedInput(): SimulationInput {
  return {
    validationSummary: {
      totalRuns: 42,
      latestCertification: 'pass',
      pipelines: [
        { kind: 'smoke', name: 'Smoke', stages: 4, certifies: false },
        { kind: 'certification', name: 'Certification', stages: 9, certifies: true },
      ],
      // 9 passed of 10 stages -> 0.9 pass rate (green).
      recent: [
        { passed: 5, failed: 0, status: 'passed', pipeline: 'smoke' },
        { passed: 4, failed: 1, status: 'warning', pipeline: 'certification' },
      ],
    },
    validationDashboard: {
      queueDepth: 2,
      certificationStatus: 'pass',
      latest: { passed: 4, failed: 1 },
      history: [],
    },
    strategySimulation: {
      baseline: { id: 'baseline', name: 'Baseline', focus: 'baseline', projected: { costUsd: 1000 } },
      scenarios: [
        { id: 'a', name: 'Aggressive growth', focus: 'revenue', deltaVsBaseline: { costUsd: 500, probabilityPct: 12 } },
        { id: 'b', name: 'Cost control', focus: 'cost', deltaVsBaseline: { costUsd: -300, probabilityPct: -5 } },
      ],
      note: 'Advisory only.',
    },
    metering: {
      monthlySpend: 12500,
      aiCostUsd: 3400,
      requests30d: 987654,
      currency: 'USD',
    },
  };
}

describe('summarizeSimulation — authenticity contract (highest fabrication-risk tab)', () => {
  it('(a) populated input surfaces REAL validation stats derived from real fields', () => {
    const lens = summarizeSimulation(populatedInput());

    // Real pass-rate stat (9 of 10 stages -> 90%).
    const passStat = lens.stats.find((s) => s.label === 'Validation pass rate');
    expect(passStat).toBeDefined();
    expect(passStat?.value).toBe('90%');
    expect(passStat?.tone).toBe('green');
    expect(passStat?.hint).toContain('real');

    // Real runs stat, straight from validationSummary.totalRuns.
    const runsStat = lens.stats.find((s) => s.label === 'Validation runs');
    expect(runsStat?.value).toBe('42');

    // The real validation group exists with real rows.
    const valGroup = lens.groups.find((g) => g.title === 'Platform validation (real)');
    expect(valGroup).toBeDefined();
    expect(valGroup!.rows.length).toBeGreaterThan(0);
    expect(valGroup!.rows.some((r) => r.label === 'Validation runs recorded' && r.value === '42')).toBe(true);
    const passRow = valGroup!.rows.find((r) => r.label === 'Stage pass rate (recorded runs)');
    expect(passRow?.value).toBe('90%');
    expect(passRow?.sub).toBe('9 of 10 stages passed');
  });

  it('(a) every what-if row is labeled illustrative; the real baseline is distinct', () => {
    const lens = summarizeSimulation(populatedInput());
    const whatIf = lens.groups.find((g) => g.title === WHATIF_TITLE);
    expect(whatIf).toBeDefined();

    // The single non-illustrative row is the real baseline anchor.
    const baselineRow = whatIf!.rows.find((r) => r.label === 'Baseline');
    expect(baselineRow).toBeDefined();
    expect(baselineRow!.sub).toBe(BASELINE_REAL_NOTE);
    expect(baselineRow!.sub).not.toContain('illustrative');

    // Every scenario (non-baseline) row carries the illustrative label.
    const scenarioRows = whatIf!.rows.filter((r) => r.label !== 'Baseline');
    expect(scenarioRows.length).toBe(2);
    for (const r of scenarioRows) {
      expect(r.sub).toBe(ILLUSTRATIVE_LABEL);
    }

    // The group note itself carries the honest framing.
    expect(whatIf!.note).toContain('illustrative');
  });

  it('(a) NO scenario/what-if value is ever presented without the illustrative label', () => {
    const lens = summarizeSimulation(populatedInput());
    const whatIf = lens.groups.find((g) => g.title === WHATIF_TITLE)!;

    // Structural guarantee: for EVERY row in the illustrative group, the row is either the
    // clearly-marked real baseline, or it carries the exact illustrative label. There is no
    // third case in which a scenario value could leak out unlabeled.
    for (const row of whatIf.rows) {
      const isBaseline = row.sub === BASELINE_REAL_NOTE;
      const isIllustrative = row.sub === ILLUSTRATIVE_LABEL;
      expect(isBaseline || isIllustrative).toBe(true);
    }

    // And at least one illustrative row actually exists (non-vacuous).
    expect(whatIf.rows.some((r) => r.sub === ILLUSTRATIVE_LABEL)).toBe(true);

    // No what-if row's value embeds a raw coefficient delta (e.g. the hardcoded 12 / -300 above).
    const scenarioRows = whatIf.rows.filter((r) => r.sub === ILLUSTRATIVE_LABEL);
    for (const r of scenarioRows) {
      expect(/[0-9]/.test(r.value)).toBe(false);
    }

    // The "What-if scenarios" stat, if present, is flagged as illustrative — never a prediction.
    const whatIfStat = lens.stats.find((s) => s.label === 'What-if scenarios');
    expect(whatIfStat?.hint).toContain('not predictions');
  });

  it('(a) cost rows are labeled current actuals, never a per-action forecast', () => {
    const lens = summarizeSimulation(populatedInput());
    const cost = lens.groups.find((g) => g.title === 'Cost context (current actuals)');
    expect(cost).toBeDefined();
    expect(cost!.rows.length).toBeGreaterThan(0);
    for (const r of cost!.rows) {
      expect(r.sub).toBe(CURRENT_ACTUALS_LABEL);
    }
    // Real actuals, straight from metering fields.
    expect(cost!.rows.find((r) => r.label === 'Monthly spend')?.value).toBe('$12,500');
    expect(cost!.rows.find((r) => r.label === 'Requests (30d)')?.value).toBe('987654');
    expect(cost!.note).toMatch(/NOT a per-action/i);
  });

  it('(b) empty input yields an honest empty state — no fabricated stats/groups — but all gaps + links present', () => {
    const lens = summarizeSimulation({});

    // Nothing invented.
    expect(lens.stats).toEqual([]);
    expect(lens.groups).toEqual([]);

    // The four genuine capability absences are always surfaced.
    const caps = lens.gaps.map((g) => g.capability);
    expect(caps).toContain('Generic pre-execution simulator');
    expect(caps).toContain('Per-action cost & resource forecast');
    expect(caps).toContain('Calibrated confidence');
    expect(caps).toContain('Policy-violation prediction from a hypothetical action');
    expect(lens.gaps.length).toBe(4);

    // Every gap states what it would REQUIRE (never a fabricated value).
    for (const g of lens.gaps) {
      expect(typeof g.requires).toBe('string');
      expect(g.requires.length).toBeGreaterThan(0);
    }

    // Deep-links to the real surfaces (blast-radius/change-impact lives in the twin center).
    const sections = (lens.links ?? []).map((l) => l.section);
    expect(sections).toContain('sandbox');
    expect(sections).toContain('twin-center');
  });

  it('(b) gaps are constant — present even when real signals ARE available', () => {
    const lens = summarizeSimulation(populatedInput());
    expect(lens.gaps.length).toBe(4);
    expect(lens.gaps.map((g) => g.capability)).toContain('Generic pre-execution simulator');
  });

  it('(c) pass-rate stat tone respects the healthTone boundaries', () => {
    // 0.8 boundary -> green (>= 0.8).
    const green = summarizeSimulation({
      validationSummary: { recent: [{ passed: 4, failed: 1 }] },
    });
    expect(green.stats.find((s) => s.label === 'Validation pass rate')?.tone).toBe('green');

    // 0.5 boundary -> orange (>= 0.5, < 0.8).
    const orange = summarizeSimulation({
      validationSummary: { recent: [{ passed: 1, failed: 1 }] },
    });
    expect(orange.stats.find((s) => s.label === 'Validation pass rate')?.tone).toBe('orange');

    // 0.4 -> red (< 0.5).
    const red = summarizeSimulation({
      validationSummary: { recent: [{ passed: 2, failed: 3 }] },
    });
    expect(red.stats.find((s) => s.label === 'Validation pass rate')?.tone).toBe('red');
  });

  it('does not fabricate a pass rate when there is no real pass/fail data', () => {
    // Runs exist but no per-stage pass/fail counts -> no pass-rate stat is invented.
    const lens = summarizeSimulation({ validationSummary: { totalRuns: 7, recent: [] } });
    expect(lens.stats.find((s) => s.label === 'Validation pass rate')).toBeUndefined();
    // The real runs count still shows honestly.
    expect(lens.stats.find((s) => s.label === 'Validation runs')?.value).toBe('7');
  });

  it('what-if group is omitted entirely when no strategy simulation is provided (no empty scaffold)', () => {
    const lens = summarizeSimulation({ metering: { monthlySpend: 100, currency: 'USD' } });
    expect(lens.groups.find((g) => g.title === WHATIF_TITLE)).toBeUndefined();
  });
});
