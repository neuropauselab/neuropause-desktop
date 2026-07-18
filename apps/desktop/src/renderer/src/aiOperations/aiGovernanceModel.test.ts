import { describe, it, expect } from 'vitest';
import { summarizeAiGovernance, type AiGovernanceInput } from './aiGovernanceModel';

type Lens = ReturnType<typeof summarizeAiGovernance>;

const stat = (lens: Lens, label: string) => lens.stats.find((s) => s.label === label);
const group = (lens: Lens, title: string) => lens.groups.find((g) => g.title === title);
const row = (g: Lens['groups'][number] | undefined, label: string) =>
  g?.rows.find((r) => r.label === label);
const rowStartsWith = (g: Lens['groups'][number] | undefined, prefix: string) =>
  g?.rows.find((r) => r.label.startsWith(prefix));

/** A fully-populated, realistically-shaped input across all four real signals. */
const populated: AiGovernanceInput = {
  policies: [
    { id: 'p1', title: 'Block high-risk writes', effect: 'deny', priority: 90, enabled: true },
    {
      id: 'p2',
      title: 'Approve side-effecting drafts',
      effect: 'require_approval',
      priority: 60,
      enabled: true,
      minTrust: 0.7,
    },
    { id: 'p3', title: 'Allow reads', effect: 'allow', priority: 10, enabled: true, minTrust: 0.4 },
    { id: 'p4', title: 'Legacy rule', effect: 'deny', priority: 5, enabled: false },
  ],
  audit: {
    total: 20,
    entries: [
      { decision: 'allow', risk: 'low' },
      { decision: 'allow', risk: 'low' },
      { decision: 'require_approval', risk: 'medium' },
      { decision: 'deny', risk: 'high' },
    ],
  },
  workers: [
    { name: 'CTO', role: 'executive', trustScore: 0.9, lifecycle: 'idle', healthState: 'healthy' },
    { name: 'Research', role: 'research', trustScore: 0.7, lifecycle: 'idle', healthState: 'healthy' },
    { name: 'Intern', role: 'support', trustScore: 0.3, lifecycle: 'idle', healthState: 'degraded' },
  ],
  compliance: [
    { ruleName: 'Data residency', category: 'privacy', severity: 'critical', status: 'fail' },
    { ruleName: 'Access review', category: 'security', severity: 'warning', status: 'warn' },
    { ruleName: 'Retention', category: 'privacy', severity: 'info', status: 'pass' },
  ],
};

describe('summarizeAiGovernance — populated (real stats + rows)', () => {
  const lens = summarizeAiGovernance(populated);

  it('derives policy stats and enforcement rows from real fields', () => {
    const s = stat(lens, 'AI policies');
    expect(s?.value).toBe('4'); // 4 real policies
    expect(s?.tone).toBe('orange'); // 3 of 4 enabled -> healthTone(0.75)

    const g = group(lens, 'Policies & enforcement (real)');
    expect(g).toBeDefined();
    expect(row(g, 'Enabled')?.value).toBe('3 of 4');
    expect(row(g, 'Deny rules')?.value).toBe('2');
    expect(row(g, 'Require approval')?.value).toBe('1');
    expect(row(g, 'Allow rules')?.value).toBe('1');
    const gated = row(g, 'Trust-gated');
    expect(gated?.value).toBe('2');
    expect(gated?.sub).toContain('min trust');
    expect(gated?.sub).toContain('0.40');
    expect(gated?.sub).toContain('0.70');
  });

  it('derives verdict distribution from real audit entries', () => {
    expect(stat(lens, 'Recent verdicts')?.value).toBe('4');

    const g = group(lens, 'Verdicts & approvals (real)');
    expect(g).toBeDefined();
    expect(row(g, 'Allowed')?.value).toBe('2 (50%)');
    expect(row(g, 'Required approval')?.value).toBe('1 (25%)');
    expect(row(g, 'Denied')?.value).toBe('1 (25%)');
    // total comes from the real page.total (20), not the visible window (4).
    expect(g?.note).toBe('4 of 20 recorded verdicts.');
  });

  it('derives worker TRUST (not safety) stats + risk-threshold rows', () => {
    const s = stat(lens, 'Mean worker trust');
    expect(s?.value).toBe('0.63'); // mean of 0.9/0.7/0.3
    expect(s?.tone).toBe('orange'); // healthTone(0.633)

    const g = group(lens, 'Worker trust & risk thresholds (real)');
    expect(g).toBeDefined();
    expect(row(g, 'Workers')?.value).toBe('3');
    expect(row(g, 'Mean trust')?.value).toBe('0.63');
    const below = rowStartsWith(g, 'Below risk floor');
    expect(below?.value).toBe('1'); // only the 0.3 worker is under the 0.5 floor
  });

  it('derives compliance stat + severity rows from real findings', () => {
    const s = stat(lens, 'Compliance findings');
    expect(s?.value).toBe('3');
    expect(s?.tone).toBe('red'); // a failing finding is present

    const g = group(lens, 'Compliance findings (real)');
    expect(row(g, 'Failing')?.value).toBe('1');
    expect(row(g, 'Warnings')?.value).toBe('1');
    expect(row(g, 'Critical severity')?.value).toBe('1');
  });

  it('still surfaces all four honest gaps even when fully populated', () => {
    expect(lens.gaps).toHaveLength(4);
    expect(lens.links).toHaveLength(2);
    expect(lens.links?.map((l) => l.section)).toEqual(['workforce', 'administration']);
  });
});

describe('summarizeAiGovernance — empty (honest empty + gaps)', () => {
  it('no signals -> no stats/groups, but all four gaps + both links', () => {
    const lens = summarizeAiGovernance({});
    expect(lens.stats).toEqual([]);
    expect(lens.groups).toEqual([]);

    expect(lens.gaps).toHaveLength(4);
    const caps = lens.gaps.map((g) => g.capability);
    expect(caps).toContain('Hallucination detection');
    expect(caps).toContain('Safety scoring');
    expect(caps).toContain('Semantic evidence validation');
    expect(caps).toContain('General AI-output verification');
    // every gap states the real architecture it would require (never a fake value).
    expect(lens.gaps.every((g) => g.requires.length > 0)).toBe(true);

    expect(lens.links).toHaveLength(2);
  });

  it('loaded-but-zero signals also show the honest empty state (no fabricated rows)', () => {
    const lens = summarizeAiGovernance({
      policies: [],
      audit: { entries: [], total: 0 },
      workers: [],
      compliance: [],
    });
    expect(lens.stats).toEqual([]);
    expect(lens.groups).toEqual([]);
    expect(lens.gaps).toHaveLength(4);
  });
});

describe('summarizeAiGovernance — tone boundaries', () => {
  it('mean-trust tone sits on the healthTone bands', () => {
    const green = summarizeAiGovernance({ workers: [{ trustScore: 0.8 }, { trustScore: 0.8 }] });
    expect(stat(green, 'Mean worker trust')?.tone).toBe('green'); // 0.8 -> green

    const orange = summarizeAiGovernance({ workers: [{ trustScore: 0.5 }, { trustScore: 0.5 }] });
    expect(stat(orange, 'Mean worker trust')?.tone).toBe('orange'); // 0.5 -> orange
  });

  it('below-risk-floor row tone follows riskTone (higher share is worse)', () => {
    const lens = summarizeAiGovernance({ workers: [{ trustScore: 0.2 }, { trustScore: 0.2 }] });
    const g = group(lens, 'Worker trust & risk thresholds (real)');
    expect(rowStartsWith(g, 'Below risk floor')?.tone).toBe('red'); // 100% below floor
  });

  it('verdict tone follows the denied share (riskTone bands)', () => {
    const red = summarizeAiGovernance({
      audit: { entries: [{ decision: 'deny' }, { decision: 'deny' }, { decision: 'allow' }] },
    });
    expect(stat(red, 'Recent verdicts')?.tone).toBe('red'); // 2/3 denied -> >=0.66
    expect(row(group(red, 'Verdicts & approvals (real)'), 'Denied')?.tone).toBe('red');

    const orange = summarizeAiGovernance({
      audit: { entries: [{ decision: 'deny' }, { decision: 'allow' }, { decision: 'allow' }] },
    });
    expect(stat(orange, 'Recent verdicts')?.tone).toBe('orange'); // 1/3 denied -> >=0.33
  });
});

describe('summarizeAiGovernance — trust is NEVER labeled safety', () => {
  it('no presented stat/row/group says "safety"; safety appears only as an honest gap', () => {
    const lens = summarizeAiGovernance(populated);

    // The visible surface (stats + groups) presents TRUST, and never mislabels it "safety".
    const surface = JSON.stringify({ stats: lens.stats, groups: lens.groups });
    expect(surface).toMatch(/trust/i);
    expect(surface).not.toMatch(/safety/i);

    // "Safety" is honestly confined to the capability gap that explains it is absent,
    // and that gap explicitly refuses to conflate trust with a safety score.
    const safetyGap = lens.gaps.find((g) => g.capability === 'Safety scoring');
    expect(safetyGap).toBeDefined();
    expect(safetyGap?.requires).toMatch(/earned reliability/i);
    expect(safetyGap?.requires).toMatch(/not a per-output safety score/i);
  });
});
