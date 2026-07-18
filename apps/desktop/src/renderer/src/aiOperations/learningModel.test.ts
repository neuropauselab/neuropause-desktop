import { describe, it, expect } from 'vitest';
import { summarizeLearning, type LearningInput } from './learningModel';

/**
 * A fully-populated input mirroring the REAL payload shapes:
 *   workforce  ← ipc.workforce.intelligence()  (WorkforceIntelligence)
 *   autoOps    ← ipc.autoOps.analytics()        (AutoOpsAnalytics)
 *   execution  ← ipc.execute.history().records  (ExecutionSession[])
 *   feedback   ← ipc.feedback.list()            (FeedbackEntry[])
 */
function populatedInput(overrides: Partial<LearningInput> = {}): LearningInput {
  return {
    workforce: {
      totalJobs: 20,
      activeWorkers: 3,
      overallSuccessRate: 0.9,
      inFlight: 1,
      execution: {
        bySkill: [
          { key: 'summarize', total: 10, succeeded: 9, failed: 1, successRate: 0.9, avgDurationMs: 1200 },
          { key: 'classify', total: 6, succeeded: 3, failed: 3, successRate: 0.5, avgDurationMs: 800 },
        ],
        byRole: [{ key: 'analyst', total: 12, succeeded: 10, failed: 2, successRate: 0.83, avgDurationMs: 1000 }],
        totals: {
          key: 'all',
          total: 20,
          succeeded: 17,
          failed: 2,
          cancelled: 1,
          inFlight: 1,
          successRate: 0.9,
          avgDurationMs: 1100,
        },
      },
      bottlenecks: [
        { scope: 'skill', key: 'classify', kind: 'high_failure', reason: '50% failure over 6 runs' },
      ],
    },
    autoOps: {
      metrics: [{ key: 'success', label: 'Success rate', value: 0.95, display: '95%', band: 'healthy' }],
      planCount: 4,
      recoveryCount: 1,
      optimizationCount: 2,
      incidentCount: 0,
      approvalRequired: 1,
      autoExecutable: 3,
      note: 'ops analytics note',
    },
    execution: [
      { state: 'completed', durationMs: 900 },
      { state: 'completed', durationMs: 1100 },
      { state: 'failed', durationMs: 500 },
      { state: 'cancelled', durationMs: null },
    ],
    feedback: [{ category: 'bug' }, { category: 'idea' }, { category: 'praise' }],
    ...overrides,
  };
}

const findStat = (lens: ReturnType<typeof summarizeLearning>, label: string) =>
  lens.stats.find((s) => s.label === label);
const findGroup = (lens: ReturnType<typeof summarizeLearning>, title: string) =>
  lens.groups.find((g) => g.title === title);

describe('summarizeLearning — populated (real outcomes)', () => {
  it('surfaces the workforce success-rate headline from the real field', () => {
    const lens = summarizeLearning(populatedInput());
    const sr = findStat(lens, 'Execution success rate');
    expect(sr).toBeDefined();
    expect(sr?.value).toBe('90%'); // pctText(0.9)
    expect(sr?.tone).toBe('green'); // healthTone(0.9)
    expect(sr?.hint).toBe('20 jobs');
  });

  it('reports outcome stats: failures + bottlenecks from real aggregates', () => {
    const lens = summarizeLearning(populatedInput());
    expect(findStat(lens, 'Failed executions')?.value).toBe('2');
    expect(findStat(lens, 'Bottlenecks detected')?.value).toBe('1');
  });

  it('builds an execution-outcomes group with success/failure/duration rows', () => {
    const lens = summarizeLearning(populatedInput());
    const g = findGroup(lens, 'Goal execution outcomes (real)');
    expect(g).toBeDefined();
    const byLabel = Object.fromEntries((g?.rows ?? []).map((r) => [r.label, r.value]));
    expect(byLabel['Success rate']).toBe('90%');
    expect(byLabel['Jobs executed']).toBe('20');
    expect(byLabel['Succeeded']).toBe('17');
    expect(byLabel['Failed']).toBe('2');
    expect(byLabel['Average duration']).toBe('1.1s'); // formatDurationMs(1100)
  });

  it('breaks outcomes down by skill & role with per-dimension success rates', () => {
    const lens = summarizeLearning(populatedInput());
    const g = findGroup(lens, 'Outcomes by skill & role (real)');
    expect(g).toBeDefined();
    const summarize = g?.rows.find((r) => r.label === 'Skill · summarize');
    expect(summarize?.value).toBe('90%');
    expect(summarize?.tone).toBe('green');
    const classify = g?.rows.find((r) => r.label === 'Skill · classify');
    expect(classify?.value).toBe('50%');
    expect(classify?.tone).toBe('orange'); // healthTone(0.5)
    expect(g?.rows.some((r) => r.label === 'Role · analyst')).toBe(true);
  });

  it('lists detected bottlenecks as real constraints', () => {
    const lens = summarizeLearning(populatedInput());
    const g = findGroup(lens, 'Bottlenecks detected (real)');
    expect(g?.rows[0]?.label).toBe('Skill · classify');
    expect(g?.rows[0]?.value).toBe('High failure');
  });

  it('derives engine-session counts and success from real run records', () => {
    const lens = summarizeLearning(populatedInput());
    const g = findGroup(lens, 'Execution engine sessions (real)');
    const byLabel = Object.fromEntries((g?.rows ?? []).map((r) => [r.label, r.value]));
    expect(byLabel['Sessions recorded']).toBe('4');
    expect(byLabel['Completed']).toBe('2');
    expect(byLabel['Failed']).toBe('1');
    expect(byLabel['Cancelled']).toBe('1');
    expect(byLabel['Session success rate']).toBe('67%'); // 2/(2+1)
    expect(findStat(lens, 'Engine sessions')?.hint).toBe('67% success');
  });

  it('labels feedback as user-submitted, never as execution-outcome feedback', () => {
    const lens = summarizeLearning(populatedInput());
    const g = findGroup(lens, 'Feedback (user-submitted)');
    expect(g).toBeDefined();
    expect(g?.note).toMatch(/user-submitted/i);
    expect(g?.note).toMatch(/NOT execution-outcome feedback/i);
    expect(findStat(lens, 'Feedback (user-submitted)')?.value).toBe('3');
  });

  it('links out to the canonical workforce & autonomous-operations surfaces', () => {
    const lens = summarizeLearning(populatedInput());
    const sections = (lens.links ?? []).map((l) => l.section);
    expect(sections).toContain('workforce');
    expect(sections).toContain('auto-ops-center');
  });
});

describe('summarizeLearning — honest empty state', () => {
  it('empty input yields no stats/groups but keeps gaps + links', () => {
    const lens = summarizeLearning({});
    expect(lens.stats).toEqual([]);
    expect(lens.groups).toEqual([]);
    expect(lens.gaps.length).toBeGreaterThanOrEqual(3);
    expect(lens.links?.length).toBe(2);
  });

  it('all-null signals behave the same as empty (defensive)', () => {
    const lens = summarizeLearning({
      workforce: null,
      autoOps: null,
      execution: null,
      feedback: null,
    });
    expect(lens.stats).toEqual([]);
    expect(lens.groups).toEqual([]);
    expect(lens.gaps.length).toBeGreaterThanOrEqual(3);
  });

  it('workforce present but zero jobs shows through as empty (no placeholder)', () => {
    const lens = summarizeLearning({ workforce: { totalJobs: 0, overallSuccessRate: 0 } });
    expect(findStat(lens, 'Execution success rate')).toBeUndefined();
    expect(findGroup(lens, 'Goal execution outcomes (real)')).toBeUndefined();
    expect(lens.gaps.length).toBeGreaterThanOrEqual(3);
  });
});

describe('summarizeLearning — success-rate tone boundaries (healthTone)', () => {
  const toneFor = (rate: number): string | undefined =>
    findStat(summarizeLearning({ workforce: { totalJobs: 5, overallSuccessRate: rate } }), 'Execution success rate')?.tone;

  it('>= 0.8 is green', () => {
    expect(toneFor(0.8)).toBe('green');
    expect(toneFor(0.95)).toBe('green');
  });
  it('0.5..0.8 is orange (boundary at 0.5)', () => {
    expect(toneFor(0.5)).toBe('orange');
    expect(toneFor(0.79)).toBe('orange');
  });
  it('< 0.5 is red', () => {
    expect(toneFor(0.4)).toBe('red');
    expect(toneFor(0)).toBe('red');
  });
});

describe('summarizeLearning — descriptive, NOT a retraining loop', () => {
  it('discloses the missing self-improving loop as an honest gap', () => {
    const lens = summarizeLearning(populatedInput());
    expect(lens.gaps.some((g) => /retrain/i.test(g.capability))).toBe(true);
    expect(
      lens.gaps.some((g) => /self-improving|training loop|learning pipeline/i.test(`${g.capability} ${g.requires}`)),
    ).toBe(true);
    // The execution-outcome-feedback absence is disclosed too.
    expect(lens.gaps.some((g) => /execution-outcome feedback/i.test(g.capability))).toBe(true);
  });

  it('never presents a retraining / self-learning capability as delivered', () => {
    const lens = summarizeLearning(populatedInput());
    // Everything the tab actually renders as a result (excluding the honest gaps).
    const claimSurface = [
      ...lens.stats.map((s) => `${s.label} ${s.value} ${s.hint ?? ''}`),
      ...lens.groups.flatMap((g) => [
        g.title,
        g.note ?? '',
        ...g.rows.map((r) => `${r.label} ${r.value} ${r.sub ?? ''}`),
      ]),
    ].join(' \n ');
    expect(claimSurface).not.toMatch(/retrain/i);
    expect(claimSurface).not.toMatch(/self-learning|self-improving/i);
  });
});
