import { describe, it, expect } from 'vitest';
import { summarizeAgents, toAgentsInput, type AgentsInput } from './agentsModel';

type Lens = ReturnType<typeof summarizeAgents>;

const stat = (lens: Lens, label: string) => lens.stats.find((s) => s.label === label);
const group = (lens: Lens, title: string) => lens.groups.find((g) => g.title === title);
const row = (g: Lens['groups'][number] | undefined, label: string) =>
  g?.rows.find((r) => r.label === label);
const rowStartsWith = (g: Lens['groups'][number] | undefined, prefix: string) =>
  g?.rows.find((r) => r.label.startsWith(prefix));

/**
 * A realistically-shaped roster: 4 built-in archetypes + 1 installed-package worker,
 * with a spread of trust and health — mirrors ipc.workforce.workers() (WorkerSummary[])
 * plus an ipc.workforce.intelligence() headline.
 */
const populated: AgentsInput = {
  workers: [
    { name: 'CEO', role: 'executive', trustScore: 0.92, lifecycle: 'idle', healthState: 'healthy', builtIn: true },
    { name: 'CTO', role: 'executive', trustScore: 0.8, lifecycle: 'running', healthState: 'healthy', builtIn: true },
    { name: 'Research Lead', role: 'research', trustScore: 0.6, lifecycle: 'idle', healthState: 'degraded', builtIn: true },
    { name: 'Support', role: 'support', trustScore: 0.3, lifecycle: 'idle', healthState: 'unhealthy', builtIn: true },
    { name: 'Acme Analyst', role: 'operations', trustScore: 0.7, lifecycle: 'idle', healthState: 'healthy', builtIn: false },
  ],
  intelligence: { totalJobs: 40, activeWorkers: 3, overallSuccessRate: 0.85, inFlight: 2 },
};

describe('summarizeAgents — populated (real agent + trust stats)', () => {
  const lens = summarizeAgents(populated);

  it('derives roster composition stats from real WorkerSummary fields', () => {
    const s = stat(lens, 'AI agents');
    expect(s?.value).toBe('5'); // 5 real workers in the roster
    expect(s?.tone).toBe('orange'); // 2/5 degraded-or-unhealthy -> riskTone(0.4)
    expect(s?.hint).toBe('2 degraded/unhealthy');

    const b = stat(lens, 'Built-in archetypes');
    expect(b?.value).toBe('4'); // 4 built-in
    expect(b?.hint).toBe('1 installed'); // 1 installed package worker
  });

  it('derives built-in vs installed + trust distribution rows', () => {
    const g = group(lens, 'Agent roster (real)');
    expect(g).toBeDefined();
    expect(row(g, 'Total agents')?.value).toBe('5');
    expect(row(g, 'Built-in archetypes')?.value).toBe('4');
    expect(row(g, 'Installed packages')?.value).toBe('1');
    expect(row(g, 'Healthy')?.value).toBe('3');
    expect(row(g, 'Degraded / unhealthy')?.value).toBe('2');
    expect(row(g, 'Running now')?.value).toBe('1');

    expect(rowStartsWith(g, 'Trusted')?.value).toBe('2'); // 0.92 & 0.80 are >= 0.80
    expect(rowStartsWith(g, 'Below trust floor')?.value).toBe('1'); // only 0.30 is < 0.50
  });

  it('derives MEAN TRUST (not safety) with healthTone', () => {
    const s = stat(lens, 'Mean agent trust');
    expect(s?.value).toBe('0.66'); // mean of 0.92/0.8/0.6/0.3/0.7 = 0.664
    expect(s?.tone).toBe('orange'); // healthTone(0.664) -> [0.5,0.8) orange
    expect(row(group(lens, 'Agent roster (real)'), 'Mean trust')?.value).toBe('0.66');
  });

  it('uses the optional intelligence headline (real success rate)', () => {
    const s = stat(lens, 'Roster success rate');
    expect(s?.value).toBe('85%');
    expect(s?.tone).toBe('green'); // healthTone(0.85)
    expect(s?.hint).toBe('40 jobs');

    const g = group(lens, 'Roster intelligence (real)');
    expect(row(g, 'Jobs run')?.value).toBe('40');
    expect(row(g, 'Active agents')?.value).toBe('3');
    expect(row(g, 'In flight')?.value).toBe('2');
  });

  it('presents the REAL P8.5 supply chain as capability rows — never fabricated counts', () => {
    const g = group(lens, 'Agent supply chain (real, reused)');
    expect(g).toBeDefined();
    expect(g?.rows).toHaveLength(4);

    const labels = g?.rows.map((r) => r.label) ?? [];
    expect(labels).toContain('Ed25519-signed packaging');
    expect(labels).toContain('Semver versioning + rollback');
    expect(labels).toContain('8-layer install validation');
    expect(labels).toContain('Runtime governance');

    // The value column is qualitative (a capability status), NEVER a fabricated metric:
    // no digit may appear in any supply-chain row value.
    for (const r of g?.rows ?? []) expect(r.value).not.toMatch(/\d/);
  });

  it('still surfaces all three honest gaps + three links even when fully populated', () => {
    expect(lens.gaps).toHaveLength(3);
    expect(lens.links).toHaveLength(3);
    expect(lens.links?.map((l) => l.section)).toEqual([
      'ai-operations',
      'workforce',
      'workforce-center',
    ]);
  });

  it('presents trust but never labels a metric "safety"', () => {
    // Trust IS presented as a first-class metric…
    const metricLabels = [
      ...lens.stats.map((s) => s.label),
      ...lens.groups.flatMap((g) => g.rows.map((r) => r.label)),
    ];
    expect(metricLabels.some((l) => /trust/i.test(l))).toBe(true);
    // …but no stat/row is ever MISLABELED as a safety score (the only mention of
    // "safety" is the roster note honestly clarifying trust is NOT a safety score).
    expect(metricLabels.every((l) => !/safety/i.test(l))).toBe(true);
  });
});

describe('summarizeAgents — empty (honest empty + gaps present)', () => {
  it('no signals -> no roster/intelligence stats, but supply chain + all gaps remain', () => {
    const lens = summarizeAgents({});

    // Honest empty: nothing is fabricated from an absent roster/intelligence signal.
    expect(lens.stats).toEqual([]);
    expect(group(lens, 'Agent roster (real)')).toBeUndefined();
    expect(group(lens, 'Roster intelligence (real)')).toBeUndefined();

    // The shipped P8.5 machinery is real regardless of the roster, so it stays visible…
    expect(group(lens, 'Agent supply chain (real, reused)')).toBeDefined();

    // …and the genuine ecosystem gaps are always surfaced with real requirements.
    expect(lens.gaps).toHaveLength(3);
    const caps = lens.gaps.map((g) => g.capability);
    expect(caps).toContain('Closed share→install loop');
    expect(caps).toContain('Installable agent-package catalog');
    expect(caps).toContain('Capability-exchange real transfer');
    expect(lens.gaps.every((g) => g.requires.length > 0)).toBe(true);

    expect(lens.links).toHaveLength(3);
  });

  it('loaded-but-zero signals also show the honest empty state (no fabricated rows)', () => {
    const lens = summarizeAgents({ workers: [], intelligence: { totalJobs: 0, overallSuccessRate: 0 } });
    expect(lens.stats).toEqual([]);
    expect(group(lens, 'Agent roster (real)')).toBeUndefined();
    expect(group(lens, 'Roster intelligence (real)')).toBeUndefined();
    expect(lens.gaps).toHaveLength(3);
  });

  it('the gaps state the real architecture they would require (verified against recon)', () => {
    const lens = summarizeAgents({});
    const req = (cap: string) => lens.gaps.find((g) => g.capability === cap)?.requires ?? '';
    expect(req('Closed share→install loop')).toMatch(/placeholder entry/i);
    expect(req('Installable agent-package catalog')).toMatch(/no production caller/i);
    expect(req('Capability-exchange real transfer')).toMatch(/increments a counter/i);
  });
});

describe('summarizeAgents — trust tone boundaries (healthTone bands)', () => {
  it('mean-trust tone sits on the healthTone band edges', () => {
    const green = summarizeAgents({ workers: [{ trustScore: 0.8 }, { trustScore: 0.8 }] });
    expect(stat(green, 'Mean agent trust')?.tone).toBe('green'); // 0.80 -> green

    const orange = summarizeAgents({ workers: [{ trustScore: 0.5 }, { trustScore: 0.5 }] });
    expect(stat(orange, 'Mean agent trust')?.tone).toBe('orange'); // 0.50 -> orange

    const red = summarizeAgents({ workers: [{ trustScore: 0.4 }, { trustScore: 0.4 }] });
    expect(stat(red, 'Mean agent trust')?.tone).toBe('red'); // 0.40 -> red
  });

  it('below-trust-floor row tone follows riskTone (higher share is worse)', () => {
    const lens = summarizeAgents({ workers: [{ trustScore: 0.2 }, { trustScore: 0.2 }] });
    const g = group(lens, 'Agent roster (real)');
    expect(rowStartsWith(g, 'Below trust floor')?.tone).toBe('red'); // 100% below floor
  });
});

describe('summarizeAgents — real-contract binding', () => {
  it('toAgentsInput passes ipc.* payloads through (nulls -> undefined)', () => {
    expect(toAgentsInput({})).toEqual({ workers: undefined, intelligence: undefined });
    expect(toAgentsInput({ workers: null, intelligence: null })).toEqual({
      workers: undefined,
      intelligence: undefined,
    });
  });
});
