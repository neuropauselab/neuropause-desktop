/**
 * P14 — Autonomous Enterprise Intelligence model tests. Pure projections over a composed platform
 * snapshot: goals, long-horizon planning, reasoning, optimization, deterministic simulation, and the
 * advisory decision queue — plus the load-bearing SAFETY invariants (never-execute, approval-aware,
 * evidence-backed, deterministic).
 */
import { describe, expect, it } from 'vitest';
import {
  approvalFor,
  buildDecisionQueue,
  buildGoalManager,
  buildOptimizationEngine,
  buildPlanningEngine,
  buildReasoningReport,
  buildSimulationReport,
  buildStrategyKpis,
  buildStrategyOverview,
  type StrategyState,
} from './strategyModel';

function state(over: Partial<StrategyState> = {}): StrategyState {
  return {
    generatedAt: '2026-07-16T00:00:00.000Z',
    health: {
      overall: 72,
      band: 'watch',
      scores: [
        { key: 'availability', label: 'Availability', score: 85, band: 'healthy' },
        { key: 'security', label: 'Security', score: 45, band: 'at-risk' },
        { key: 'compliance', label: 'Compliance', score: 68, band: 'watch' },
      ],
    },
    risk: {
      overall: 55,
      band: 'at-risk',
      byCategory: { operational: 60, security: 70, business: 40 },
      topRisks: [
        { id: 'res:db-1', label: 'Primary DB', risk: 82, reason: 'High blast radius single node' },
        { id: 'res:api-1', label: 'API gateway', risk: 65, reason: 'Elevated error rate' },
      ],
      confidence: 0.8,
    },
    dependencies: {
      spofs: 3,
      cycles: 1,
      bottlenecks: 2,
      criticalCount: 4,
      topSpofs: [
        { id: 'res:db-1', label: 'Primary DB', blastRadius: 22 },
        { id: 'res:lb-1', label: 'Load balancer', blastRadius: 15 },
      ],
    },
    capacity: { utilizationAvg: 62, costTotal: 1200, pressureScore: 48, costOutliers: [{ id: 'res:gpu-1', label: 'GPU node', cost: 400 }] },
    incidents: { open: 2, total: 9 },
    recommendations: [{ id: 'rec-1', category: 'risk', title: 'Add DB replica', detail: 'Reduce SPOF', priority: 'high', confidence: 0.8, evidence: ['res:db-1'] }],
    cloud: {
      monthlySpend: 499,
      currency: 'USD',
      quotas: [
        { resource: 'Workers', used: 8, limit: 25, utilizationPct: 32 },
        { resource: 'API requests (30d)', used: 2_000_000, limit: 5_000_000, utilizationPct: 40 },
      ],
      fleetStatus: 'healthy',
      deployments: 6,
      healthyDeployments: 5,
      regions: 3,
    },
    workforce: {
      totalWorkers: 27,
      overallSuccessRate: 0.82,
      bottlenecks: [{ scope: 'worker', key: 'worker:sales', kind: 'high_failure', reason: 'Failure rate 0.5 over 6 jobs' }],
      healthy: 20,
      degraded: 5,
      unhealthy: 2,
    },
    connectors: { total: 22, connected: 6, healthy: 4, degraded: 1, down: 1 },
    industry: { ready: 2, partial: 6, planned: 4, averageActivation: 0.35, entries: [{ id: 'finance', name: 'Finance Suite', status: 'partial', activation: 0.5 }] },
    marketplace: { published: 5, certified: 3, byKind: { ai_worker: 1, connector: 1 } },
    compliance: { score: 68, band: 'watch', frameworks: 20, failing: 4, passing: 16 },
    approvalChains: [
      { id: 'chain-side-effect', appliesTo: 'workforce_side_effect', name: 'Side-effect approval', enabled: true, steps: [{ roleId: 'role-manager', order: 1 }] },
      { id: 'chain-spend', appliesTo: 'spend', name: 'Spend approval', enabled: true, steps: [{ roleId: 'role-owner', order: 2 }, { roleId: 'role-manager', order: 1 }] },
      { id: 'chain-governance', appliesTo: 'governance_change', name: 'Governance approval', enabled: true, steps: [{ roleId: 'role-admin', order: 1 }] },
    ],
    collaboration: [
      { peerOrg: 'org-partner', peerOrgName: 'Partner Inc', trustLevel: 'verified', decision: 'allow', reason: 'Trusted peer' },
      { peerOrg: 'org-untrusted', peerOrgName: 'Unknown', trustLevel: 'none', decision: 'deny', reason: 'No trust policy allows this' },
    ],
    ...over,
  };
}

function emptyState(): StrategyState {
  return {
    generatedAt: '2026-07-16T00:00:00.000Z',
    health: { overall: 0, band: 'critical', scores: [] },
    risk: { overall: 0, band: 'healthy', byCategory: {}, topRisks: [], confidence: 0 },
    dependencies: { spofs: 0, cycles: 0, bottlenecks: 0, criticalCount: 0, topSpofs: [] },
    capacity: { utilizationAvg: null, costTotal: 0, pressureScore: 0, costOutliers: [] },
    incidents: { open: 0, total: 0 },
    recommendations: [],
    cloud: { monthlySpend: 0, currency: 'USD', quotas: [], fleetStatus: 'healthy', deployments: 0, healthyDeployments: 0, regions: 0 },
    workforce: { totalWorkers: 0, overallSuccessRate: 0, bottlenecks: [], healthy: 0, degraded: 0, unhealthy: 0 },
    connectors: { total: 0, connected: 0, healthy: 0, degraded: 0, down: 0 },
    industry: { ready: 0, partial: 0, planned: 0, averageActivation: 0, entries: [] },
    marketplace: { published: 0, certified: 0, byKind: {} },
    compliance: { score: 100, band: 'healthy', frameworks: 0, failing: 0, passing: 0 },
    approvalChains: [],
    collaboration: [],
  };
}

describe('approvalFor — references the real governance approval chains', () => {
  it('resolves a governed action to its chain + step count (no raw approver role graph leaked)', () => {
    const a = approvalFor('scale_workforce', state().approvalChains);
    expect(a.trigger).toBe('workforce_side_effect');
    expect(a.governed).toBe(true);
    expect(a.chainName).toBe('Side-effect approval');
    expect(a.steps).toBe(1);
    expect(a).not.toHaveProperty('approverRoleIds'); // governance-internal role graph redacted
  });

  it('reports the step count of a multi-step chain', () => {
    const a = approvalFor('optimize_budget', state().approvalChains);
    expect(a.trigger).toBe('spend');
    expect(a.governed).toBe(true);
    expect(a.steps).toBe(2);
  });

  it('reports ungoverned (no fabricated approvers) when no chain covers the trigger', () => {
    const a = approvalFor('export_data', state().approvalChains); // data_export has no seeded chain
    expect(a.trigger).toBe('data_export');
    expect(a.governed).toBe(false);
    expect(a.chainName).toBeNull();
    expect(a.steps).toBe(0);
    expect(a.note).toMatch(/no enabled approval chain/i);
  });
});

describe('buildGoalManager', () => {
  it('resolves 9 strategic goals with direction-aware progress + status', () => {
    const g = buildGoalManager(state());
    expect(g.goals).toHaveLength(9);
    const byId = new Map(g.goals.map((x) => [x.id, x]));
    expect(byId.get('goal-health')!.status).toBe('on_track'); // 72/80 = 0.9
    expect(byId.get('goal-risk')!.status).toBe('at_risk'); // 40/55 = 0.73
    expect(byId.get('goal-compliance')!.status).toBe('off_track'); // 4 control gaps, target 0
    expect(byId.get('goal-cloud-cost')!.status).toBe('at_risk'); // util 36/70 — measurable, not permanently off-track
    expect(byId.get('goal-cloud-cost')!.progress).toBeGreaterThan(0);
    expect(byId.get('goal-risk')!.evidence).toContain('res:db-1'); // evidence-backed
    expect(g.onTrack + g.atRisk + g.offTrack).toBe(9);
    expect(g.overallProgress).toBeGreaterThan(0);
    expect(g.overallProgress).toBeLessThanOrEqual(1);
  });

  it('meets the "nothing wrong" goals on an empty/healthy estate (risk/incidents/compliance met)', () => {
    const g = buildGoalManager(emptyState());
    const byId = new Map(g.goals.map((x) => [x.id, x]));
    expect(byId.get('goal-risk')!.status).toBe('on_track'); // risk 0 ≤ 40
    expect(byId.get('goal-incidents')!.status).toBe('on_track'); // 0 open
    expect(byId.get('goal-compliance')!.status).toBe('on_track'); // 0 failing
  });
});

describe('buildPlanningEngine', () => {
  it('buckets goals across the five horizons with approval-gated steps for off-track goals', () => {
    const p = buildPlanningEngine(state());
    expect(p.horizons).toHaveLength(5);
    expect(p.horizons.map((h) => h.horizon)).toEqual(['30d', '90d', '180d', '365d', 'multi_year']);
    expect(p.totalGoals).toBe(9);
    // Every plan step carries a required approval (never a bare action).
    const allSteps = p.horizons.flatMap((h) => h.steps);
    expect(allSteps.length).toBeGreaterThan(0);
    for (const step of allSteps) expect(step.requiredApproval).toBeDefined();
    // On-track goals get no step.
    const h90 = p.horizons.find((h) => h.horizon === '90d')!;
    expect(h90.goalIds).toContain('goal-health'); // on_track
    expect(h90.steps.some((s) => s.id === 'plan-goal-health')).toBe(false);
  });
});

describe('buildReasoningReport', () => {
  it('reasons across dimensions and orders by severity', () => {
    const r = buildReasoningReport(state());
    const dims = new Set(r.findings.map((f) => f.dimension));
    expect(dims.has('dependencies')).toBe(true); // 3 spofs
    expect(dims.has('risks')).toBe(true);
    expect(dims.has('compliance')).toBe(true); // 4 failing
    expect(dims.has('performance')).toBe(true); // security at-risk + bottleneck
    // Priority order is severity-desc and only includes dimensions with findings.
    expect(r.priorityOrder.length).toBe(r.byDimension.length);
    expect(r.findings.every((f) => f.evidence.length > 0)).toBe(true); // evidence-backed
  });
});

describe('buildOptimizationEngine', () => {
  it('derives opportunities from real signals with monetary savings and required approvals', () => {
    const o = buildOptimizationEngine(state());
    expect(o.count).toBe(5); // cloud + workforce + connector + resource + execution
    expect(o.totalPotentialSavingUsd).toBe(195); // cloud 75 + resource 120
    for (const opp of o.opportunities) {
      expect(opp.requiredApproval).toBeDefined();
      expect(opp.evidence.length).toBeGreaterThan(0);
    }
    // Ranked by priority (critical/high first).
    const rank: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };
    for (let i = 1; i < o.opportunities.length; i++) {
      expect(rank[o.opportunities[i - 1].priority]).toBeGreaterThanOrEqual(rank[o.opportunities[i].priority]);
    }
  });
});

describe('buildSimulationReport — SAFETY: deterministic what-if, never applied', () => {
  it('produces a baseline + 3 scenarios and picks the best per metric', () => {
    const sim = buildSimulationReport(state());
    expect(sim.scenarios).toHaveLength(3);
    const cost = sim.comparison.find((c) => c.metric === 'costUsd')!;
    expect(cost.bestScenarioId).toBe('scenario-cost'); // 0.8x baseline is cheapest
    const risk = sim.comparison.find((c) => c.metric === 'riskScore')!;
    expect(risk.bestScenarioId).toBe('scenario-risk'); // -20 is lowest risk
  });

  it('NEVER marks a scenario as applied/executed', () => {
    const sim = buildSimulationReport(state());
    expect(sim.baseline.applied).toBe(false);
    for (const sc of sim.scenarios) expect(sc.applied).toBe(false);
    expect(sim.note).toMatch(/never applied or executed/i);
  });

  it('is deterministic — identical input yields identical output', () => {
    expect(buildSimulationReport(state())).toEqual(buildSimulationReport(state()));
  });
});

describe('buildDecisionQueue — SAFETY: advisory candidates only', () => {
  it('emits approval-aware, evidence-backed candidates and NEVER an executed/approved decision', () => {
    const q = buildDecisionQueue(state());
    expect(q.count).toBeGreaterThan(0);
    for (const d of q.decisions) {
      expect(d.status).toBe('candidate'); // never approved/executed
      expect(d.requiredApprovals.length).toBeGreaterThan(0); // approval-aware
      expect(d.evidence.length).toBeGreaterThan(0); // evidence-backed
      expect(d.tradeOffs.length).toBeGreaterThan(0); // trade-offs surfaced
      expect(d.sourceSystems.length).toBeGreaterThan(0); // traceable
    }
    expect(q.note).toMatch(/never advances, approves, or executes/i);
    // The top risk becomes a mitigation candidate.
    expect(q.decisions.some((d) => d.id.includes('res:db-1'))).toBe(true);
    // C1: an off-track down-goal decision reports a DECREASE impact (not always 'increase').
    const goalDecision = q.decisions.find((d) => d.id.startsWith('decision-goal-'));
    expect(goalDecision).toBeDefined();
    expect(goalDecision!.expectedImpact.direction).toBe('decrease'); // most off-track is a down-goal
  });
});

describe('buildStrategyKpis', () => {
  it('emits strategic KPIs reusing ExecutiveKpi', () => {
    const kpis = buildStrategyKpis(state());
    const byKey = new Map(kpis.map((k) => [k.key, k]));
    expect(byKey.get('strategy.goals.onTrack')).toBeDefined();
    expect(byKey.get('strategy.health')!.value).toBe(72);
    expect(byKey.get('strategy.risk')!.value).toBe(55);
    expect(byKey.get('strategy.savings')!.display).toContain('195');
  });
});

describe('buildStrategyOverview', () => {
  it('bundles summary, goals, planning, reasoning, optimization, simulation, decisions', () => {
    const o = buildStrategyOverview(state());
    expect(o.summary.goalsTotal).toBe(9);
    expect(o.goals.goals).toHaveLength(9);
    expect(o.planning.horizons).toHaveLength(5);
    expect(o.optimization.count).toBe(5);
    expect(o.simulation.scenarios).toHaveLength(3);
    expect(o.decisions.count).toBeGreaterThan(0);
    expect(o.recommendations).toHaveLength(1); // reused, unmodified intel recs
    expect(o.collaboration).toHaveLength(2);
    expect(o.collaboration.find((c) => c.peerOrg === 'org-partner')!.allowed).toBe(true);
    expect(o.collaboration.find((c) => c.peerOrg === 'org-untrusted')!.allowed).toBe(false);
  });

  it('never throws on an empty estate and stays deterministic', () => {
    expect(() => buildStrategyOverview(emptyState())).not.toThrow();
    expect(buildStrategyOverview(state())).toEqual(buildStrategyOverview(state()));
    // Every simulation scenario is advisory even on the empty estate.
    expect(buildStrategyOverview(emptyState()).simulation.scenarios.every((s) => s.applied === false)).toBe(true);
  });
});
