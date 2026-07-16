/**
 * P15 — Enterprise Digital Twin model tests. Pure projections over a composed platform snapshot:
 * domain twins, domain topology, health map, blast-radius impact, executive command center, scenario
 * passthrough, and timeline replay — plus the load-bearing invariants (no execution, scenario passed
 * through unmodified, traceable, deterministic).
 */
import { describe, expect, it } from 'vitest';
import {
  buildEnterpriseTwinOverview,
  buildTwinCommandCenter,
  buildTwinDomains,
  buildTwinHealthMap,
  buildTwinImpact,
  buildTwinReplay,
  buildTwinScenarioCenter,
  buildTwinSummary,
  buildTwinTopology,
  projectReport,
  type TwinState,
} from './twinModel';

const PROJ = { costUsd: 500, riskScore: 55, timeDays: 30, resourceUtilizationPct: 50, complianceScore: 68, probabilityPct: 80 };

function state(over: Partial<TwinState> = {}): TwinState {
  return {
    generatedAt: '2026-07-16T00:00:00.000Z',
    org: { orgs: 1, units: 13, users: 30, humans: 3, workers: 27 },
    cloud: { deployments: 6, healthyDeployments: 5, regions: 3, fleetStatus: 'healthy', fleetScore: 88, monthlySpend: 499, currency: 'USD' },
    workforce: { total: 27, healthy: 20, degraded: 5, unhealthy: 2, state: 'degraded', successRate: 0.82 },
    application: { deployments: 6, healthy: 5, avgUptimePct: 99.2 },
    connectors: { total: 22, connected: 0, healthy: 0, degraded: 0, down: 0 },
    marketplace: { published: 5, certified: 3, total: 8 },
    federation: { peers: 2, activePeers: 1, trustedPeers: 1 },
    strategy: { goalsTotal: 9, goalsOnTrack: 3, overallProgress: 0.45, openDecisions: 3, requiresApproval: 3, healthBand: 'watch' },
    health: {
      overall: 72,
      band: 'watch',
      scores: [
        { key: 'availability', label: 'Availability', score: 85, band: 'healthy', factors: ['x'] },
        { key: 'security', label: 'Security', score: 45, band: 'at-risk', factors: ['y'] },
        { key: 'compliance', label: 'Compliance', score: 68, band: 'watch', factors: [] },
      ],
      byKey: { availability: 85, security: 45, compliance: 68 },
    },
    risk: { overall: 55, band: 'at-risk' },
    graph: { nodes: 1200, edges: 3400, byDomain: { infrastructure: 400, finance: 300, operations: 200, security: 100 }, crossDomainEdges: 220, truncated: false },
    dependencies: {
      criticalCount: 4,
      cyclic: true,
      spofs: [
        { domain: 'infrastructure', blastRadius: 22, dependents: 8, risk: 82 },
        { domain: 'infrastructure', blastRadius: 15, dependents: 5, risk: 60 },
        { domain: 'operations', blastRadius: 3, dependents: 2, risk: 40 },
      ],
      failureChains: [{ domains: ['infrastructure', 'operations'] }, { domains: ['finance', 'operations'] }],
      cycles: [{ domains: ['infrastructure', 'security'] }],
    },
    reportKpis: [
      { key: 'enterprise.health.overall', label: 'Health', value: 72, display: '72/100', band: 'watch' },
      { key: 'enterprise.risk.overall', label: 'Risk', value: 55, display: '55/100', band: 'at-risk' },
      { key: 'enterprise.health.compliance', label: 'Compliance', value: 68, display: '68/100', band: 'watch' },
    ],
    strategyKpis: [
      { key: 'strategy.goals.onTrack', label: 'Goals on track', value: 33, display: '3/9', band: 'at-risk' },
      { key: 'strategy.savings', label: 'Savings', value: null, display: 'USD 195' },
    ],
    simulation: {
      baseline: { id: 'baseline', name: 'Baseline', description: 'x', focus: 'baseline', projected: PROJ, deltaVsBaseline: PROJ, evidence: [], applied: false },
      scenarios: [{ id: 'scenario-cost', name: 'A — Cost', description: 'x', focus: 'budget', projected: PROJ, deltaVsBaseline: PROJ, evidence: ['e'], applied: false }],
      comparison: [{ metric: 'costUsd', label: 'Lowest cost', bestScenarioId: 'scenario-cost', bestValue: 400 }],
      note: 'strategy sim note',
    },
    replay: [
      {
        kind: 'worker',
        label: 'Workers',
        since: 'S',
        until: 'U',
        total: 2,
        note: 'worker note',
        frames: [
          { id: 'e1', at: '2026-07-15T10:00:00Z', type: 'worker.job_failed', category: 'automation', priority: 'high', source: 'workforce', resource: 'Worker A' },
          { id: 'e2', at: '2026-07-15T11:00:00Z', type: 'worker.job_succeeded', category: 'automation', priority: 'normal', source: 'workforce', resource: null },
        ],
      },
      {
        kind: 'incident',
        label: 'Incidents',
        since: 'S',
        until: 'U',
        total: 1,
        note: 'incident note',
        frames: [{ id: 'e3', at: '2026-07-16T09:00:00Z', type: 'connector.error', category: 'connector', priority: 'critical', source: 'connectors', resource: 'GitHub' }],
      },
    ],
    ...over,
  };
}

function emptyState(): TwinState {
  return {
    generatedAt: '2026-07-16T00:00:00.000Z',
    org: { orgs: 0, units: 0, users: 0, humans: 0, workers: 0 },
    cloud: { deployments: 0, healthyDeployments: 0, regions: 0, fleetStatus: 'healthy', fleetScore: 0, monthlySpend: 0, currency: 'USD' },
    workforce: { total: 0, healthy: 0, degraded: 0, unhealthy: 0, state: 'unknown', successRate: 0 },
    application: { deployments: 0, healthy: 0, avgUptimePct: 0 },
    connectors: { total: 0, connected: 0, healthy: 0, degraded: 0, down: 0 },
    marketplace: { published: 0, certified: 0, total: 0 },
    federation: { peers: 0, activePeers: 0, trustedPeers: 0 },
    strategy: { goalsTotal: 0, goalsOnTrack: 0, overallProgress: 0, openDecisions: 0, requiresApproval: 0, healthBand: 'watch' },
    health: { overall: 0, band: 'critical', scores: [], byKey: {} },
    risk: { overall: 0, band: 'watch' },
    graph: { nodes: 0, edges: 0, byDomain: {}, crossDomainEdges: 0, truncated: false },
    dependencies: { criticalCount: 0, cyclic: false, spofs: [], failureChains: [], cycles: [] },
    reportKpis: [],
    strategyKpis: [],
    simulation: { baseline: { id: 'baseline', name: 'Baseline', description: '', focus: 'baseline', projected: PROJ, deltaVsBaseline: PROJ, evidence: [], applied: false }, scenarios: [], comparison: [], note: '' },
    replay: [],
  };
}

describe('buildTwinDomains', () => {
  it('projects nine twins (enterprise + eight domains) from the existing systems', () => {
    const d = buildTwinDomains(state());
    expect(d.domains).toHaveLength(9);
    const byId = new Map(d.domains.map((x) => [x.id, x]));
    expect([...byId.keys()].sort()).toEqual(['application', 'connector', 'enterprise', 'federation', 'infrastructure', 'marketplace', 'organization', 'strategy', 'workforce']);
    expect(byId.get('infrastructure')!.band).toBe('healthy'); // fleetStatus healthy
    expect(byId.get('infrastructure')!.entityCount).toBe(6);
    expect(byId.get('workforce')!.band).toBe('watch'); // state degraded
    expect(byId.get('strategy')!.entityCount).toBe(9);
    // Every twin is traceable to a real source.
    for (const t of d.domains) expect(t.source.length).toBeGreaterThan(0);
  });

  it('honestly flags a not-yet-populated domain (0 connectors) as live:false', () => {
    const d = buildTwinDomains(state());
    const conn = d.domains.find((x) => x.id === 'connector')!;
    expect(conn.live).toBe(false);
    expect(conn.band).toBe('watch'); // not "critical" — just not connected yet
    const wf = d.domains.find((x) => x.id === 'workforce')!;
    expect(wf.live).toBe(true);
  });
});

describe('buildTwinTopology', () => {
  it('projects domain nodes from the graph summary and links from dependency findings', () => {
    const t = buildTwinTopology(state());
    expect(t.nodes).toHaveLength(4); // 4 domains in byDomain
    expect(t.nodes[0].domain).toBe('infrastructure'); // sorted by node count desc (400)
    expect(t.nodes[0].nodeCount).toBe(400);
    // Links derived from failure chains + cycles co-occurrence: inf|ops, fin|ops, inf|sec.
    expect(t.links).toHaveLength(3);
    expect(t.links.some((l) => l.from === 'domain:infrastructure' && l.to === 'domain:operations')).toBe(true);
    // Six topology layers (3 graph-derived + workforce/connector/federation).
    expect(t.layers).toHaveLength(6);
    expect(t.layers.find((l) => l.id === 'business')!.nodeCount).toBe(500); // finance 300 + operations 200
    expect(t.layers.find((l) => l.id === 'workforce')!.nodeCount).toBe(27);
    expect(t.totalNodes).toBe(1200);
    expect(t.crossDomainEdges).toBe(220);
    expect(t.note).toMatch(/domain-level topology/i); // honest about being a projection
  });
});

describe('buildTwinHealthMap', () => {
  it('maps the 7 health-score entries and per-domain twin health', () => {
    const h = buildTwinHealthMap(state());
    expect(h.overall).toBe(72);
    expect(h.band).toBe('watch');
    expect(h.entries).toHaveLength(3); // fixture has 3 scores
    expect(h.domains).toHaveLength(8); // the 8 domain twins (excl. enterprise rollup)
  });
});

describe('buildTwinImpact', () => {
  it('ranks top blast-radius nodes from the dependency analysis (no per-node engine calls)', () => {
    const i = buildTwinImpact(state());
    expect(i.nodes).toHaveLength(3);
    expect(i.nodes[0].blastRadius).toBe(22); // highest blast radius first
    expect(i.nodes[0].domain).toBe('infrastructure');
    expect(i.criticalCount).toBe(4);
    expect(i.cyclic).toBe(true);
    expect(i.note).toMatch(/change-impact engine/i); // points at the existing engine for drill-down
  });

  it('SECURITY: redacts entity identities — synthetic rank only, never the raw graph id/name', () => {
    const i = buildTwinImpact(state());
    expect(i.nodes[0].id).toBe('twin-spof-1');
    expect(i.nodes[0].label).toBe('Infrastructure · SPOF #1');
    for (const n of i.nodes) {
      expect(n.id).toMatch(/^twin-spof-\d+$/); // synthetic, non-identifying id
      expect(n.label).not.toMatch(/Primary DB|Load balancer/); // no upstream entity names
    }
    expect(i.note).toMatch(/redacted/i);
  });
});

describe('buildTwinCommandCenter', () => {
  it('groups existing KPIs into six executive twins (recomputes nothing)', () => {
    const c = buildTwinCommandCenter(state());
    expect(c.twins).toHaveLength(6);
    const byId = new Map(c.twins.map((t) => [t.id, t]));
    expect([...byId.keys()].sort()).toEqual(['business', 'compliance', 'executive', 'operations', 'risk', 'strategy']);
    expect(byId.get('strategy')!.kpis).toHaveLength(2); // all strategy KPIs
    expect(byId.get('risk')!.kpis).toHaveLength(1); // filtered to 'risk'
    expect(byId.get('risk')!.band).toBe('at-risk');
  });
});

describe('buildTwinScenarioCenter — SAFETY: passthrough, never executed', () => {
  it('passes the P14 SimulationReport through UNMODIFIED with applied:false intact', () => {
    const s = state();
    const sc = buildTwinScenarioCenter(s);
    expect(sc.simulation).toBe(s.simulation); // reference-identical passthrough — the twin adds nothing
    expect(sc.simulation.baseline.applied).toBe(false);
    for (const scen of sc.simulation.scenarios) expect(scen.applied).toBe(false);
    expect(sc.note).toMatch(/never applied or executed/i);
  });
});

describe('buildTwinReplay', () => {
  it('formats filtered timeline windows with humanized labels and per-day counts', () => {
    const r = buildTwinReplay(state());
    expect(r.windows).toHaveLength(2);
    const worker = r.windows.find((w) => w.kind === 'worker')!;
    expect(worker.frames[0].label).toBe('Worker job failed'); // humanized from 'worker.job_failed'
    expect(worker.byDay).toEqual([{ day: '2026-07-15', count: 2 }]);
    expect(worker.note).toBe('worker note'); // note preserved (traceable/honest)
  });
});

describe('buildTwinSummary + overview', () => {
  it('summarizes the twin and bundles every projection', () => {
    const o = buildEnterpriseTwinOverview(state());
    expect(o.summary.domainCount).toBe(8);
    expect(o.summary.overallHealth).toBe(72);
    expect(o.summary.criticalImpactNodes).toBe(2); // spofs with blastRadius >= 5 (db-1, lb-1)
    expect(o.summary.liveDomains).toBe(7); // all live except connector
    expect(o.domains.domains).toHaveLength(9);
    expect(o.topology.nodes).toHaveLength(4);
    expect(o.health.entries).toHaveLength(3);
    expect(o.impact.nodes).toHaveLength(3);
    expect(o.commandCenter.twins).toHaveLength(6);
  });

  it('never throws on an empty enterprise and stays deterministic', () => {
    expect(() => buildEnterpriseTwinOverview(emptyState())).not.toThrow();
    expect(() => buildTwinReplay(emptyState())).not.toThrow();
    expect(buildEnterpriseTwinOverview(state())).toEqual(buildEnterpriseTwinOverview(state()));
    expect(buildTwinSummary(emptyState()).domainCount).toBe(8);
  });
});

describe('honest bands + determinism (adversarial hardening)', () => {
  it('Organization twin degrades to watch (not a false healthy) when there are zero orgs', () => {
    const withOrgs = buildTwinDomains(state()).domains.find((d) => d.id === 'organization')!;
    expect(withOrgs.band).toBe('healthy'); // 1 org
    const noOrgs = buildTwinDomains(state({ org: { orgs: 0, units: 0, users: 0, humans: 0, workers: 0 } })).domains.find((d) => d.id === 'organization')!;
    expect(noOrgs.band).toBe('watch');
    expect(noOrgs.live).toBe(false);
  });

  it('Infrastructure twin is not "live" without deployments (no hardcoded live:true)', () => {
    expect(buildTwinDomains(emptyState()).domains.find((d) => d.id === 'infrastructure')!.live).toBe(false);
    expect(buildTwinDomains(state()).domains.find((d) => d.id === 'infrastructure')!.live).toBe(true); // 6 deployments
  });

  it('topology node ordering is deterministic on equal node counts (stable alphabetical tiebreak)', () => {
    const t = buildTwinTopology(state({ graph: { nodes: 400, edges: 0, byDomain: { operations: 200, finance: 200 }, crossDomainEdges: 0, truncated: false } }));
    expect(t.nodes.map((n) => n.domain)).toEqual(['finance', 'operations']); // alphabetical, not insertion order
  });
});

describe('projectReport — assume-worst on an unavailable report', () => {
  it('a null report yields critical health AND maxed risk (never falsely healthy or low-risk)', () => {
    const p = projectReport(null);
    expect(p.health.overall).toBe(0);
    expect(p.health.band).toBe('critical');
    expect(p.risk.overall).toBe(100); // low risk is the good direction → unavailable assumes MAX risk
    expect(p.risk.band).toBe('critical');
    expect(p.graph.nodes).toBe(0);
    expect(p.dependencies.spofs).toEqual([]);
    expect(p.generatedAt).toBeNull();
  });
});
