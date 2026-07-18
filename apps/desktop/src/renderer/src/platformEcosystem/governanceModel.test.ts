import { describe, it, expect } from 'vitest';
import { summarizeGovernance, type GovernanceInput } from './governanceModel';

type Lens = ReturnType<typeof summarizeGovernance>;

const stat = (lens: Lens, label: string) => lens.stats.find((s) => s.label === label);
const group = (lens: Lens, title: string) => lens.groups.find((g) => g.title === title);
const row = (g: Lens['groups'][number] | undefined, label: string) =>
  g?.rows.find((r) => r.label === label);

/** A fully-populated, realistically-shaped input across every real signal. */
const populated: GovernanceInput = {
  // ipc.marketplace.policy() — both hard gates on, tier gate + a type/publisher block.
  marketplacePolicy: {
    requireApproval: true,
    requireSignature: true,
    minPublisherTier: 'verified',
    blockedTypes: ['prompt_pack', 'blueprint'],
    blockedPublishers: ['pub-x'],
    allowedPublishers: [],
  },
  // ipc.workforce.policies()
  workforcePolicies: [
    { id: 'w1', title: 'Block side effects', effect: 'deny', enabled: true },
    { id: 'w2', title: 'Approve spend', effect: 'require_approval', enabled: true, minTrust: 0.7 },
    { id: 'w3', title: 'Allow reads', effect: 'allow', enabled: true },
    { id: 'w4', title: 'Legacy', effect: 'deny', enabled: false },
  ],
  // ipc.enterprise.governanceConfig()
  governance: {
    approvalChains: [
      { id: 'c1', name: 'Spend', enabled: true },
      { id: 'c2', name: 'Data export', enabled: true },
      { id: 'c3', name: 'Legacy chain', enabled: false },
    ],
    complianceRules: [
      { id: 'r1', name: 'Audit trail', enabled: true },
      { id: 'r2', name: 'No unhealthy workers', enabled: false },
    ],
  },
  // ipc.workforce.workers()
  workers: [
    { name: 'CTO', trustScore: 0.9 },
    { name: 'Research', trustScore: 0.7 },
    { name: 'Intern', trustScore: 0.3 },
  ],
  // ipc.marketplace.publishers()
  publishers: [
    { id: 'p1', name: 'Acme', tier: 'official', trustScore: 0.95 },
    { id: 'p2', name: 'Beta', tier: 'verified', trustScore: 0.6 },
    { id: 'p3', name: 'Gamma', tier: 'unverified', trustScore: 0.2 },
  ],
  // ipc.marketplace.catalog()
  packages: [
    { id: 'k1', trustScore: 0.9, certified: true, signed: true },
    { id: 'k2', trustScore: 0.5, certified: false, signed: true },
    { id: 'k3', trustScore: 0.2, certified: false, signed: false },
  ],
};

describe('summarizeGovernance — populated (real posture stats + rows)', () => {
  const lens = summarizeGovernance(populated);

  it('derives marketplace policy posture from the real org policy toggles', () => {
    const s = stat(lens, 'Marketplace policy');
    expect(s?.value).toBe('5'); // approval+signature+tier gate+type block+publisher block
    expect(s?.tone).toBe('green'); // both hard install gates enforced
    expect(s?.hint).toBe('approval + signature required');

    const g = group(lens, 'Ecosystem policy (real)');
    expect(g).toBeDefined();
    expect(row(g, 'Install approval')?.value).toBe('Required');
    expect(row(g, 'Package signature')?.value).toBe('Required');
    expect(row(g, 'Min publisher tier')?.value).toBe('Verified');
    expect(row(g, 'Min publisher tier')?.tone).toBe('orange'); // 'verified' == rank 1
    const blocked = row(g, 'Blocked package types');
    expect(blocked?.value).toBe('2');
    expect(blocked?.sub).toBe('prompt_pack, blueprint');
    expect(row(g, 'Blocked publishers')?.value).toBe('1');
    expect(row(g, 'Publisher allowlist')?.value).toBe('Open'); // empty allowlist
  });

  it('derives agent-policy enforcement from real workforce policies', () => {
    const s = stat(lens, 'Agent policies');
    expect(s?.value).toBe('4');
    expect(s?.tone).toBe('orange'); // 3 of 4 enabled -> healthTone(0.75)
    expect(s?.hint).toBe('3 enabled');

    const g = group(lens, 'Ecosystem policy (real)');
    expect(row(g, 'Agent policies')?.value).toBe('3 of 4');
    expect(row(g, 'Agent policies')?.sub).toBe('75% enabled');
    expect(row(g, 'Deny rules')?.value).toBe('2');
    expect(row(g, 'Require approval')?.value).toBe('1');
  });

  it('derives approval chains + compliance rules from the real governance config', () => {
    const s = stat(lens, 'Approval chains');
    expect(s?.value).toBe('3');
    expect(s?.hint).toBe('2 enabled');

    const g = group(lens, 'Ecosystem policy (real)');
    expect(row(g, 'Approval chains')?.value).toBe('2 of 3');
    expect(row(g, 'Compliance rules')?.value).toBe('1 of 2');
  });

  it('derives publisher / package / worker trust rows (all real)', () => {
    const g = group(lens, 'Trust (real)');
    expect(g).toBeDefined();

    // Publisher trust (ipc.marketplace.publishers())
    expect(row(g, 'Publishers')?.value).toBe('3');
    expect(row(g, 'Mean publisher trust')?.value).toBe('0.58'); // (0.95+0.6+0.2)/3
    expect(row(g, 'Official / trusted tier')?.value).toBe('1 of 3');

    // Package trust (ipc.marketplace.catalog())
    expect(row(g, 'Catalog packages')?.value).toBe('3');
    expect(row(g, 'Mean package trust')?.value).toBe('0.53'); // (0.9+0.5+0.2)/3
    expect(row(g, 'Certified')?.value).toBe('1 of 3');
    expect(row(g, 'Signed')?.value).toBe('2 of 3');

    // Worker trust (ipc.workforce.workers()) — earned reliability, never "safety".
    expect(row(g, 'Workers')?.value).toBe('3');
    const meanTrust = row(g, 'Mean worker trust');
    expect(meanTrust?.value).toBe('0.63'); // (0.9+0.7+0.3)/3
    expect(meanTrust?.sub).toBe('earned reliability, evolves per job');
    expect(row(g, 'Below trust floor')?.value).toBe('1'); // only the 0.3 worker
  });

  it('surfaces all three honest gaps and both links even when fully populated', () => {
    expect(lens.gaps).toHaveLength(3);
    expect(lens.links).toHaveLength(2);
    expect(lens.links?.map((l) => l.section)).toEqual(['administration', 'marketplace']);
  });

  it('presents trust, never mislabels it as safety or certification of workers', () => {
    const surface = JSON.stringify({ stats: lens.stats, groups: lens.groups });
    expect(surface).toMatch(/trust/i);
    // "certified" appears only as a real package coverage row, not a worker guarantee.
    expect(surface).not.toMatch(/safety/i);
  });
});

describe('summarizeGovernance — empty (honest empty + gaps present)', () => {
  it('no signals -> no stats/groups, but all three gaps + both links', () => {
    const lens = summarizeGovernance({});
    expect(lens.stats).toEqual([]);
    expect(lens.groups).toEqual([]);

    expect(lens.gaps).toHaveLength(3);
    const caps = lens.gaps.map((g) => g.capability);
    expect(caps).toContain('Third-party certification workflow');
    expect(caps).toContain('Extension-specific policy engine');
    expect(caps).toContain('Partner / SDK trust scoring');

    // Every gap states the real architecture it would require (never a fake value),
    // and the genuine absences are named precisely.
    expect(lens.gaps.every((g) => g.requires.length > 0)).toBe(true);
    const certify = lens.gaps.find((g) => g.capability === 'Third-party certification workflow');
    expect(certify?.requires).toMatch(/set once at listing creation/i);
    const partner = lens.gaps.find((g) => g.capability === 'Partner / SDK trust scoring');
    expect(partner?.requires).toMatch(/demo-only/i);

    expect(lens.links).toHaveLength(2);
  });

  it('loaded-but-zero collections also show the honest empty state (no fabricated rows)', () => {
    const lens = summarizeGovernance({
      workforcePolicies: [],
      governance: { approvalChains: [], complianceRules: [] },
      workers: [],
      publishers: [],
      packages: [],
    });
    expect(lens.stats).toEqual([]);
    expect(lens.groups).toEqual([]);
    expect(lens.gaps).toHaveLength(3);
  });
});

describe('summarizeGovernance — marketplace posture boundary', () => {
  it('both hard gates -> green, one -> orange, none -> red', () => {
    const both = summarizeGovernance({
      marketplacePolicy: { requireApproval: true, requireSignature: true },
    });
    expect(stat(both, 'Marketplace policy')?.tone).toBe('green');
    expect(stat(both, 'Marketplace policy')?.value).toBe('2');

    const one = summarizeGovernance({ marketplacePolicy: { requireApproval: true } });
    expect(stat(one, 'Marketplace policy')?.tone).toBe('orange');
    expect(stat(one, 'Marketplace policy')?.hint).toBe('approval required');

    const none = summarizeGovernance({
      marketplacePolicy: { requireApproval: false, requireSignature: false },
    });
    expect(stat(none, 'Marketplace policy')?.tone).toBe('red');
    expect(stat(none, 'Marketplace policy')?.value).toBe('0');
    expect(stat(none, 'Marketplace policy')?.hint).toBe('no install gate enforced');
  });

  it('a present-but-permissive policy is still shown honestly (posture is a real fact, not hidden)', () => {
    const lens = summarizeGovernance({
      marketplacePolicy: { requireApproval: false, requireSignature: false },
    });
    const g = group(lens, 'Ecosystem policy (real)');
    expect(g).toBeDefined();
    expect(row(g, 'Install approval')?.value).toBe('Not required');
    expect(row(g, 'Install approval')?.tone).toBe('gray');
  });
});

describe('summarizeGovernance — trust tone boundaries', () => {
  it('mean-worker-trust tone sits on the healthTone bands', () => {
    const green = summarizeGovernance({ workers: [{ trustScore: 0.8 }, { trustScore: 0.8 }] });
    expect(row(group(green, 'Trust (real)'), 'Mean worker trust')?.tone).toBe('green');

    const orange = summarizeGovernance({ workers: [{ trustScore: 0.5 }, { trustScore: 0.5 }] });
    expect(row(group(orange, 'Trust (real)'), 'Mean worker trust')?.tone).toBe('orange');
  });

  it('below-trust-floor row tone follows riskTone (a higher share is worse)', () => {
    const lens = summarizeGovernance({ workers: [{ trustScore: 0.2 }, { trustScore: 0.2 }] });
    const g = group(lens, 'Trust (real)');
    expect(row(g, 'Below trust floor')?.value).toBe('2');
    expect(row(g, 'Below trust floor')?.tone).toBe('red'); // 100% below floor
  });
});
