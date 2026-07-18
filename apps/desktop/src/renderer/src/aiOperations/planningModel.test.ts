import { describe, it, expect } from 'vitest';
import { summarizePlanning, type PlanningInput } from './planningModel';

type Lens = ReturnType<typeof summarizePlanning>;
const stat = (lens: Lens, label: string) => lens.stats.find((s) => s.label === label);
const group = (lens: Lens, title: string) => lens.groups.find((g) => g.title === title);
const row = (lens: Lens, title: string, label: string) =>
  group(lens, title)?.rows.find((r) => r.label === label);

/** A fully-populated input mirroring the shape of every real ipc source. */
const FULL: PlanningInput = {
  planning: {
    totalSteps: 3,
    totalMilestones: 5,
    horizons: [
      {
        horizon: '30d',
        milestones: [{ status: 'on_track' }, { status: 'on_track' }, { status: 'off_track' }],
        steps: [{ requiredApproval: { governed: true } }, { requiredApproval: { governed: false } }],
      },
      {
        horizon: '90d',
        milestones: [{ status: 'on_track' }, { status: 'at_risk' }],
        steps: [{ requiredApproval: { governed: true } }],
      },
    ],
  },
  autoOps: {
    plans: [
      { risk: 'critical', approvalStatus: 'awaiting_approval' },
      { risk: 'high', approvalStatus: 'candidate' },
      { risk: 'low', approvalStatus: 'approved' },
      { risk: 'medium', approvalStatus: 'candidate' },
    ],
    approvalRequiredCount: 2,
    autoExecutableCount: 1,
  },
  governance: { approvalChains: [{ enabled: true }, { enabled: true }, { enabled: false }] },
  execution: {
    sessions: [{ state: 'completed' }, { state: 'failed' }, { state: 'running' }],
    stats: { active: 1, completed: 8, failed: 2, successRate: 0.8 },
  },
};

describe('summarizePlanning — populated (real fields → real stats/rows)', () => {
  const lens = summarizePlanning(FULL);

  it('emits 2–4 headline stats and 1–3 groups (the shared contract bounds)', () => {
    expect(lens.stats.length).toBeGreaterThanOrEqual(2);
    expect(lens.stats.length).toBeLessThanOrEqual(4);
    expect(lens.groups.length).toBeGreaterThanOrEqual(1);
    expect(lens.groups.length).toBeLessThanOrEqual(3);
  });

  it('strategy plan-steps stat reads PlanningEngine.totalSteps + horizon/milestone counts', () => {
    const s = stat(lens, 'Strategy plan steps');
    expect(s?.value).toBe('3');
    expect(s?.hint).toBe('2 horizons · 5 milestones');
    expect(s?.icon).toBe('sparkles');
  });

  it('operational-plans stat reads AutoOpsPlans.plans with categorical risk share', () => {
    const s = stat(lens, 'Operational plans');
    expect(s?.value).toBe('4');
    expect(s?.hint).toBe('2 high/critical risk');
    // 2 high/critical of 4 → 0.5 → riskTone → orange
    expect(s?.tone).toBe('orange');
  });

  it('approval-chains stat reads GovernanceConfig.approvalChains enabled/total', () => {
    const s = stat(lens, 'Approval chains');
    expect(s?.value).toBe('2/3');
    expect(s?.tone).toBe('orange'); // 2/3 ≈ 0.67 → healthTone → orange
  });

  it('execution stat reads ExecutionStats.successRate + session count', () => {
    const s = stat(lens, 'Execution success');
    expect(s?.value).toBe('80%');
    expect(s?.tone).toBe('green'); // 0.8 → healthTone → green
    expect(s?.hint).toBe('3 sessions');
  });

  it("'Plans in flight' group carries real strategy + autoOps rows", () => {
    expect(row(lens, 'Plans in flight', 'Strategy horizons')?.value).toBe('2');
    expect(row(lens, 'Plans in flight', 'Strategy horizons')?.sub).toBe('3 steps · 5 milestones');
    expect(row(lens, 'Plans in flight', 'Milestones on track')?.value).toBe('3/5');
    expect(row(lens, 'Plans in flight', 'Milestones off track')?.value).toBe('1');
    expect(row(lens, 'Plans in flight', 'By risk')?.value).toBe('1 critical · 1 high');
    expect(row(lens, 'Plans in flight', 'By risk')?.sub).toBe('1 medium · 1 low');
  });

  it("'Approval plans' group ties governance chains to both planners", () => {
    expect(row(lens, 'Approval plans', 'Approval chains')?.value).toBe('2/3');
    // governedSteps 2 / stepTotal 3 → the real requiredApproval.governed signal
    expect(row(lens, 'Approval plans', 'Steps under governed approval')?.value).toBe('2/3');
    const awaiting = row(lens, 'Approval plans', 'Plans awaiting approval');
    expect(awaiting?.value).toBe('2');
    expect(awaiting?.sub).toBe('1 policy auto-exec');
  });

  it("'Execution' group reads ExecutionStats counts, red on failures", () => {
    expect(row(lens, 'Execution', 'Active')?.value).toBe('1');
    expect(row(lens, 'Execution', 'Completed')?.value).toBe('8');
    const failed = row(lens, 'Execution', 'Failed');
    expect(failed?.value).toBe('2');
    expect(failed?.tone).toBe('red');
    expect(group(lens, 'Execution')?.note).toBe('3 recorded sessions');
  });

  it('always encodes the three honest gaps and the three deep-links', () => {
    expect(lens.gaps.map((g) => g.capability)).toEqual([
      'Cost planning',
      'Predictive risk scoring',
      'Wall-clock timeline',
    ]);
    expect(lens.links?.map((l) => l.section)).toEqual([
      'workforce-center',
      'strategy-center',
      'auto-ops-center',
    ]);
  });
});

describe('summarizePlanning — honest empty state', () => {
  it('empty object → no stats, no groups, but gaps + links still present', () => {
    const lens = summarizePlanning({});
    expect(lens.stats).toEqual([]);
    expect(lens.groups).toEqual([]);
    expect(lens.gaps).toHaveLength(3);
    expect(lens.links).toHaveLength(3);
    expect(lens.gaps[0].requires).toContain('commercial.metering');
  });

  it('unpopulated (all-empty-array) sources degrade to empty — no placeholders', () => {
    const lens = summarizePlanning({
      planning: { horizons: [] },
      autoOps: { plans: [] },
      governance: { approvalChains: [] },
      execution: { sessions: [] },
    });
    expect(lens.stats).toEqual([]);
    expect(lens.groups).toEqual([]);
    expect(lens.gaps).toHaveLength(3);
  });

  it('undefined input does not throw and still lists the gaps', () => {
    const lens = summarizePlanning(undefined as unknown as PlanningInput);
    expect(lens.stats).toEqual([]);
    expect(lens.gaps).toHaveLength(3);
  });
});

describe('summarizePlanning — tone / threshold boundaries', () => {
  it('milestone health ≥0.8 → green and no off-track row when none are off track', () => {
    const lens = summarizePlanning({
      planning: {
        horizons: [
          {
            horizon: '30d',
            milestones: [
              { status: 'on_track' },
              { status: 'on_track' },
              { status: 'on_track' },
              { status: 'on_track' },
              { status: 'at_risk' },
            ],
          },
        ],
      },
    });
    expect(row(lens, 'Plans in flight', 'Milestones on track')?.value).toBe('4/5');
    expect(row(lens, 'Plans in flight', 'Milestones on track')?.tone).toBe('green'); // 0.8
    expect(row(lens, 'Plans in flight', 'Milestones off track')).toBeUndefined();
  });

  it('milestone health at 0.5 → orange and an off-track row appears in red', () => {
    const lens = summarizePlanning({
      planning: {
        horizons: [{ horizon: '30d', milestones: [{ status: 'on_track' }, { status: 'off_track' }] }],
      },
    });
    expect(row(lens, 'Plans in flight', 'Milestones on track')?.tone).toBe('orange'); // 0.5
    const off = row(lens, 'Plans in flight', 'Milestones off track');
    expect(off?.value).toBe('1');
    expect(off?.tone).toBe('red');
  });

  it('risk share ≥0.66 → red on the operational-plans stat', () => {
    const lens = summarizePlanning({
      autoOps: { plans: [{ risk: 'high' }, { risk: 'high' }, { risk: 'low' }] },
    });
    // 2 high of 3 → 0.667 → riskTone → red
    expect(stat(lens, 'Operational plans')?.tone).toBe('red');
    expect(row(lens, 'Plans in flight', 'By risk')?.tone).toBe('red');
  });
});
