/**
 * P17 — Global AI Orchestration model tests. Pure projections over a composed platform snapshot: goal
 * routing (reusing the shipped delegation matcher), workforce/cloud/knowledge/cross-system coordination,
 * flows, the nine orchestrators, and governance — plus the load-bearing invariants (routes are advisory
 * PLANS that reuse scoreCandidate and never execute, worker identities are redacted, deterministic,
 * never throws on empty).
 */
import { describe, expect, it } from 'vitest';
import { scoreCandidate, type DelegationCandidate } from '@neuropause/shared';
import {
  actionToRole,
  buildOrchestrationCloud,
  buildOrchestrationCoordination,
  buildOrchestrationFlowReport,
  buildOrchestrationGoals,
  buildOrchestrationGovernance,
  buildOrchestrationKnowledge,
  buildOrchestrationOverview,
  buildOrchestrationWorkforce,
  buildOrchestrators,
  buildOrchestrationSummary,
  confBand,
  ratioBand,
  type OrchestrationState,
} from './orchestrationModel';

const cand = (over: Partial<DelegationCandidate>): DelegationCandidate => ({
  id: 'w', name: '', role: 'operations', trustScore: 0.7, healthState: 'healthy', lifecycle: 'idle', grantedScopes: [], ...over,
});

function state(over: Partial<OrchestrationState> = {}): OrchestrationState {
  return {
    generatedAt: '2026-07-16T00:00:00.000Z',
    health: { overall: 72, band: 'watch' },
    routeSteps: [
      { id: 'step-1', label: 'Scale the workforce', action: 'scale_workforce', approvalGoverned: true, approvalChain: 'Workforce Change', approvalSteps: 2, evidenceCount: 3 },
      { id: 'step-2', label: 'Adjust cloud spend', action: 'adjust_cloud_spend', approvalGoverned: false, approvalChain: null, approvalSteps: 0, evidenceCount: 1 },
    ],
    candidates: [
      cand({ id: 'w1', role: 'hr', trustScore: 0.9, healthState: 'healthy', lifecycle: 'idle' }),
      cand({ id: 'w2', role: 'hr', trustScore: 0.6, healthState: 'degraded', lifecycle: 'running' }),
      cand({ id: 'w3', role: 'infrastructure', trustScore: 0.8, healthState: 'healthy', lifecycle: 'idle' }),
      cand({ id: 'w4', role: 'finance', trustScore: 0.5, healthState: 'healthy', lifecycle: 'stopped' }), // ineligible
    ],
    workforce: {
      summaries: [
        { role: 'hr', lifecycle: 'idle', trustScore: 0.9 },
        { role: 'hr', lifecycle: 'running', trustScore: 0.6 },
        { role: 'infrastructure', lifecycle: 'idle', trustScore: 0.8 },
        { role: 'finance', lifecycle: 'stopped', trustScore: 0.5 },
      ],
      activeWorkers: 2,
      inFlight: 5,
      overallSuccessRate: 0.82,
      bottlenecks: [{ scope: 'worker', kind: 'backlog', reason: 'in-flight >= 5', value: 6, sampleSize: 6 }],
      orgs: [{ orgId: 'org-1', orgName: 'NeuroPause', units: 12, workers: 27 }],
    },
    cloud: {
      fleetStatus: 'healthy',
      fleetScore: 88,
      regions: [
        { id: 'us-east', name: 'US East', available: true, deployments: 4, healthyDeployments: 4, replication: 'in_sync', health: 'healthy' },
        { id: 'eu-west', name: 'EU West', available: false, deployments: 2, healthyDeployments: 0, replication: 'failed', health: 'down' },
      ],
      deployments: [
        { service: 'api', region: 'us-east', status: 'healthy', gate: 'ok', uptimePct: 99.9 },
        { service: 'sync', region: 'eu-west', status: 'degraded', gate: 'blocked', uptimePct: 92.1 },
      ],
      quotas: [{ resource: 'compute', utilizationPct: 95 }, { resource: 'storage', utilizationPct: 40 }],
      monthlySpend: 499,
      currency: 'USD',
    },
    knowledge: {
      explanations: 40,
      evidenceCoverage: 85,
      avgConfidence: 0.72,
      byKind: [{ kind: 'decision', count: 10, avgConfidence: 0.8 }, { kind: 'goal', count: 20, avgConfidence: 0.6 }],
      lineageStages: [{ stage: 'origin', count: 12 }, { stage: 'usage', count: 30 }],
    },
    marketplace: { published: 5, certified: 3, total: 8, installs: 120 },
    federation: { peers: 2, activePeers: 1, trustedPeers: 1, canShareWorkers: 1, sharedOut: 3, sharedIn: 2 },
    industry: { live: true },
    developer: { live: false },
    kpis: [{ key: 'enterprise.health.overall', label: 'Health', value: 72, display: '72/100', band: 'watch' }],
    ...over,
  };
}

function emptyState(): OrchestrationState {
  return {
    generatedAt: '2026-07-16T00:00:00.000Z',
    health: { overall: 0, band: 'critical' },
    routeSteps: [],
    candidates: [],
    workforce: { summaries: [], activeWorkers: 0, inFlight: 0, overallSuccessRate: 0, bottlenecks: [], orgs: [] },
    cloud: { fleetStatus: 'unavailable', fleetScore: 0, regions: [], deployments: [], quotas: [], monthlySpend: 0, currency: 'USD' },
    knowledge: { explanations: 0, evidenceCoverage: 0, avgConfidence: 0, byKind: [], lineageStages: [] },
    marketplace: { published: 0, certified: 0, total: 0, installs: 0 },
    federation: { peers: 0, activePeers: 0, trustedPeers: 0, canShareWorkers: 0, sharedOut: 0, sharedIn: 0 },
    industry: { live: false },
    developer: { live: false },
    kpis: [],
  };
}

describe('actionToRole (capability routing key)', () => {
  it('maps plan actions to worker capability pools', () => {
    expect(actionToRole('scale_workforce')).toBe('hr');
    expect(actionToRole('adjust_cloud_spend')).toBe('infrastructure'); // cloud wins
    expect(actionToRole('update_governance')).toBe('legal');
    expect(actionToRole('mitigate_risk')).toBe('engineering');
    expect(actionToRole('optimize_budget')).toBe('finance');
    expect(actionToRole('optimize_workflow')).toBe('operations');
    expect(actionToRole('something_unknown')).toBe('operations'); // safe default
  });
});

describe('buildOrchestrationGoals — routes goals to workers via the SHIPPED matcher (a plan, not execution)', () => {
  it('routes each plan step to its capability pool with a reused match score, respecting approval', () => {
    const g = buildOrchestrationGoals(state());
    expect(g.total).toBe(2);
    const s1 = g.routes.find((r) => r.id === 'step-1')!;
    expect(s1.targetRole).toBe('hr');
    expect(s1.poolSize).toBe(2); // w1 + w2 are hr
    expect(s1.eligibleCount).toBe(2); // scoped to the hr pool — never exceeds poolSize
    expect(s1.eligibleCount).toBeLessThanOrEqual(s1.poolSize);
    expect(s1.routable).toBe(true);
    expect(s1.approvalGoverned).toBe(true);
    expect(s1.approvalChain).toBe('Workforce Change');
    // The match score is the EXISTING scoreCandidate output — not a new formula.
    const expected = Number(scoreCandidate({ id: 'step-1', title: 'x', role: 'hr' }, state().candidates[0]).total.toFixed(2));
    expect(s1.topMatchScore).toBe(expected);
    expect(s1.band).toBe(confBand(s1.topMatchScore));
  });

  it('surfaces ungoverned routes (never hides a governance gap) and counts governance', () => {
    const g = buildOrchestrationGoals(state());
    const s2 = g.routes.find((r) => r.id === 'step-2')!;
    expect(s2.approvalGoverned).toBe(false);
    expect(s2.note).toMatch(/ungoverned/i);
    expect(g.governed).toBe(1);
    expect(g.ungoverned).toBe(1);
    expect(g.note).toMatch(/executes nothing/i); // advisory plan
  });

  it('SAFETY: a route is a plan — it carries no execution/dispatch identity', () => {
    const g = buildOrchestrationGoals(state());
    for (const r of g.routes) {
      expect(Object.keys(r)).not.toContain('jobId');
      expect(Object.keys(r)).not.toContain('executed');
      expect(Object.keys(r)).not.toContain('workerId'); // routes to a POOL, not a named worker
    }
  });

  it('routes to an empty pool honestly — routable=false, eligibleCount never exceeds poolSize', () => {
    const g = buildOrchestrationGoals(
      state({
        routeSteps: [{ id: 'sx', label: 'Grow sales', action: 'grow_sales', approvalGoverned: false, approvalChain: null, approvalSteps: 0, evidenceCount: 0 }],
        candidates: [cand({ id: 'w1', role: 'hr', lifecycle: 'idle' })], // no sales worker
      }),
    );
    const r = g.routes[0];
    expect(r.targetRole).toBe('sales');
    expect(r.poolSize).toBe(0);
    expect(r.eligibleCount).toBe(0); // scoped to the (empty) sales pool, not the alive hr worker
    expect(r.routable).toBe(false);
    expect(r.band).toBe('at-risk');
  });
});

describe('buildOrchestrationWorkforce', () => {
  it('projects capability pools + load, redacting worker identity', () => {
    const w = buildOrchestrationWorkforce(state());
    const hr = w.pools.find((p) => p.role === 'hr')!;
    expect(hr.workers).toBe(2);
    expect(hr.eligible).toBe(2); // idle + running
    expect(hr.avgTrust).toBe(0.75);
    const fin = w.pools.find((p) => p.role === 'finance')!;
    expect(fin.eligible).toBe(0); // stopped
    expect(fin.band).toBe('critical'); // 0/1 eligible
    expect(w.load.totalWorkers).toBe(4);
    expect(w.load.inFlight).toBe(5);
    expect(w.load.bottleneckCount).toBe(1);
    // SECURITY: pools expose only aggregate metrics, never a worker id/name.
    expect(Object.keys(w.pools[0]).sort()).toEqual(['avgTrust', 'band', 'eligible', 'role', 'workers']);
  });
});

describe('buildOrchestrationCloud', () => {
  it('projects regions/deployments/capacity with honest bands', () => {
    const c = buildOrchestrationCloud(state());
    expect(c.band).toBe('healthy'); // fleet healthy
    expect(c.regions.find((r) => r.id === 'eu-west')!.band).toBe('critical'); // unavailable
    expect(c.deployments[0].service).toBe('sync'); // lowest uptime first
    expect(c.deployments[0].band).toBe('critical'); // gate blocked
    expect(c.capacity[0].resource).toBe('compute'); // highest utilization first
    expect(c.capacity[0].band).toBe('critical'); // 95%
  });
});

describe('buildOrchestrationKnowledge', () => {
  it('projects knowledge delivered to decisions with per-kind confidence', () => {
    const k = buildOrchestrationKnowledge(state());
    expect(k.explanations).toBe(40);
    expect(k.confidenceBand).toBe('watch'); // 0.72
    expect(k.delivered[0].decisionKind).toBe('goal'); // sorted by count desc
    expect(k.delivered.find((d) => d.decisionKind === 'decision')!.band).toBe('healthy'); // 0.8
    expect(k.lineageStages).toHaveLength(2);
  });
});

describe('buildOrchestrationCoordination + flows + orchestrators', () => {
  it('coordinates marketplace/federation/industry/developer', () => {
    const c = buildOrchestrationCoordination(state());
    expect(c.systems).toHaveLength(4);
    expect(c.marketplace.installs).toBe(120);
    expect(c.federation.canShareWorkers).toBe(1);
    expect(c.systems.find((s) => s.id === 'developer')!.live).toBe(false);
  });

  it('projects the six flows and the nine orchestrators', () => {
    expect(buildOrchestrationFlowReport(state()).flows.map((f) => f.id)).toEqual(['goal', 'worker', 'knowledge', 'cloud', 'marketplace', 'federation']);
    const orch = buildOrchestrators(state());
    expect(orch).toHaveLength(9);
    expect(orch.map((o) => o.id).sort()).toEqual(['cloud', 'deployment', 'federation', 'global', 'goal', 'knowledge', 'marketplace', 'operations', 'workforce']);
    for (const o of orch) expect(o.source.length).toBeGreaterThan(0); // every orchestrator is traceable
  });
});

describe('buildOrchestrationGovernance — never bypass', () => {
  it('projects approval gates, scopes, and the never-bypass assertion', () => {
    const gov = buildOrchestrationGovernance(state());
    expect(gov.orchestrationScope).toBe('orchestration:read');
    expect(gov.neverBypass).toMatch(/never/i);
    expect(gov.approvalGates).toHaveLength(2); // scale_workforce (governed) + adjust_cloud_spend (ungoverned)
    expect(gov.governedRoutes).toBe(1);
    expect(gov.ungovernedRoutes).toBe(1);
    expect(gov.redactions.length).toBeGreaterThanOrEqual(3);
    expect(gov.scopes.length).toBe(6);
  });
});

describe('buildOrchestrationSummary + overview', () => {
  it('summarizes the orchestration and bundles the projections', () => {
    const o = buildOrchestrationOverview(state());
    expect(o.summary.orchestrators).toBe(9);
    expect(o.summary.routableGoals).toBe(2);
    expect(o.summary.governedRoutes).toBe(1);
    expect(o.summary.totalWorkers).toBe(4);
    expect(o.orchestrators).toHaveLength(9);
    expect(o.flows).toHaveLength(6);
    expect(o.kpis).toHaveLength(1);
  });

  it('never throws on an empty enterprise and stays deterministic', () => {
    expect(() => buildOrchestrationOverview(emptyState())).not.toThrow();
    expect(() => buildOrchestrationGoals(emptyState())).not.toThrow();
    expect(() => buildOrchestrationGovernance(emptyState())).not.toThrow();
    expect(buildOrchestrationSummary(emptyState()).routableGoals).toBe(0);
    expect(buildOrchestrationOverview(state())).toEqual(buildOrchestrationOverview(state()));
    expect(ratioBand(0, 0)).toBe('watch'); // empty reads watch, not critical
  });
});

describe('band honesty (adversarial hardening)', () => {
  it('deployment health uses the deployment list (consistent population — no false-green from region sums)', () => {
    const orch = buildOrchestrators(state()); // 2 deployments: api healthy, sync degraded → 1/2 = 0.5 → at-risk
    expect(orch.find((o) => o.id === 'deployment')!.band).toBe('at-risk'); // NOT healthy (region sum would give 4/2)
  });

  it('empty dimensions read watch, not a false-red critical', () => {
    const orch = buildOrchestrators(state({ cloud: { ...state().cloud, deployments: [] } }));
    expect(orch.find((o) => o.id === 'deployment')!.band).toBe('watch'); // 0 deployments → watch, not critical
  });

  it('clamps active-over-total so a stale population never yields a ratio > 1', () => {
    // activeWorkers (job history) = 5 exceeds the 1 registered worker → clamped to 1/1, never 5/1.
    const orch = buildOrchestrators(state({ workforce: { ...state().workforce, summaries: [{ role: 'hr', lifecycle: 'idle', trustScore: 0.8 }], activeWorkers: 5 } }));
    expect(orch.find((o) => o.id === 'workforce')!.band).toBe('healthy'); // clamped 1/1, a valid ratio
  });

  it('governance gate downgrades to ungoverned when any route for a capability is ungoverned', () => {
    const gov = buildOrchestrationGovernance(
      state({
        routeSteps: [
          { id: 'a', label: 'Spend A', action: 'adjust_cloud_spend', approvalGoverned: true, approvalChain: 'Finance', approvalSteps: 2, evidenceCount: 0 },
          { id: 'b', label: 'Spend B', action: 'adjust_cloud_spend', approvalGoverned: false, approvalChain: null, approvalSteps: 0, evidenceCount: 0 },
        ],
        candidates: [cand({ id: 'w', role: 'infrastructure', lifecycle: 'idle' })],
      }),
    );
    const gate = gov.approvalGates.find((g) => g.capability === 'adjust_cloud_spend')!;
    expect(gov.approvalGates).toHaveLength(1); // one row per capability
    expect(gate.governed).toBe(false); // the ungoverned instance is surfaced, never hidden as governed
  });
});
