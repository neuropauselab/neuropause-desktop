/**
 * P19 — Autonomous Enterprise Operations model tests. Pure projections over a composed snapshot:
 * operational plans, execution coordination, recovery, optimization, incidents, approval coordination,
 * monitoring, analytics, and governance — PLUS the CARDINAL invariants (no autonomous bypass: an operation
 * is auto-executable ONLY when a policy explicitly permits it AND no chain governs it; and every operation
 * exposes reason / evidence / risk / expected-outcome / rollback / required-approvals), deterministic and
 * never-throws-on-empty.
 */
import { describe, expect, it } from 'vitest';
import {
  bandFor,
  buildAutoOpsAnalytics,
  buildAutoOpsApprovals,
  buildAutoOpsExecution,
  buildAutoOpsGovernance,
  buildAutoOpsIncidents,
  buildAutoOpsMonitoring,
  buildAutoOpsOptimization,
  buildAutoOpsOverview,
  buildAutoOpsPlans,
  buildAutoOpsRecovery,
  buildAutoOpsSummary,
  buildOpsModules,
  computeAutoExecutable,
  confBand,
  deriveAutoAllowedTriggers,
  isIncidentOpen,
  requiredApprovalsFor,
  riskBand,
  severityBand,
  type AutoOpsState,
} from './autoOpsModel';

function state(over: Partial<AutoOpsState> = {}): AutoOpsState {
  return {
    generatedAt: '2026-07-16T00:00:00.000Z',
    health: { overall: 72, band: 'watch' },
    planSeeds: [
      // A — 'spend', explicitly allowed BUT governed by a chain → must NOT be auto-executable (governance wins).
      { id: 'plan:a', category: 'capacity', title: 'Scale node', reason: 'high pressure', risk: 'high', confidence: 0.8, evidenceKinds: ['capacity'], evidenceCount: 1, expectedOutcome: 'Relieve pressure', sources: ['Enterprise Intelligence'], approvalTrigger: 'spend' },
      // B — 'policy', explicitly allowed and ungoverned → auto-executable.
      { id: 'plan:b', category: 'operational', title: 'Rotate key', reason: 'policy hygiene', risk: 'low', confidence: 0.9, evidenceKinds: ['risk'], evidenceCount: 2, expectedOutcome: 'Reduce exposure', sources: ['Enterprise Intelligence'], approvalTrigger: 'policy' },
      // C — 'workforce_side_effect', NOT in the allow-list → approval-required.
      { id: 'plan:c', category: 'recovery', title: 'Remediate incident', reason: 'root cause X', risk: 'critical', confidence: 0.7, evidenceKinds: ['incident'], evidenceCount: 1, expectedOutcome: 'Contain incident', sources: ['Enterprise Intelligence'], approvalTrigger: 'workforce_side_effect' },
    ],
    execution: {
      active: [{ id: 'exec:1', label: 'Run task', kind: 'task', state: 'running', worker: null, awaitingApproval: false, correlationId: 'c1', startedAt: '2026-07-16T00:00:00Z', durationMs: null, success: null }],
      awaiting: [{ id: 'job:1', label: 'Send email', kind: 'job', state: 'awaiting_approval', worker: 'w1', awaitingApproval: true, correlationId: 'c2', startedAt: null, durationMs: null, success: null }],
      history: [
        { id: 'exec:h1', label: 'Done', kind: 'task', state: 'completed', worker: null, awaitingApproval: false, correlationId: null, startedAt: '2026-07-15T00:00:00Z', durationMs: 1200, success: true },
        { id: 'exec:h2', label: 'Broke', kind: 'automation', state: 'failed', worker: null, awaitingApproval: false, correlationId: null, startedAt: '2026-07-15T00:00:00Z', durationMs: 900, success: false },
      ],
      total: 20,
      completed: 15,
      failed: 5,
    },
    supervisorRecoveries: [
      { subsystem: 'backend', reason: 'probe failed', ok: false, at: '2026-07-16T00:00:00Z', durationMs: 1300 },
      { subsystem: 'runtime', reason: 'restart', ok: true, at: '2026-07-16T00:00:00Z', durationMs: 5 },
    ],
    escalations: ['backend'],
    recoveryCount: 12,
    recentFailures: 3,
    recoverySeeds: [
      { id: 'rec:1', kind: 'escalation', target: 'backend', reason: 'auto recovery failed', risk: 'high', confidence: 0.7, sources: ['RuntimeSupervisor'], approvalTrigger: 'workforce_side_effect' },
      { id: 'rec:2', kind: 'retry', target: 'sync.skill', reason: 'transient failure', risk: 'medium', confidence: 0.6, sources: ['Workforce Runtime'], approvalTrigger: 'workforce_side_effect' },
    ],
    optSeeds: [
      { id: 'opt:1', area: 'cloud', title: 'Right-size fleet', detail: 'Idle replicas', potentialSavingUsd: 4200, confidence: 0.82, risk: 'medium', evidenceKinds: ['optimization'], recommendedAction: 'Reduce replica count', approvalTrigger: 'spend' },
      { id: 'opt:2', area: 'workforce', title: 'Consolidate workers', detail: 'Overlap', potentialSavingUsd: 800, confidence: 0.6, risk: 'low', evidenceKinds: ['optimization'], recommendedAction: 'Merge two workers', approvalTrigger: 'workforce_side_effect' },
    ],
    incidents: [
      { id: 'inc:1', title: 'DB latency spike', severity: 'critical', blastRadius: 12, confidence: 0.9, rootCause: 'connection pool exhausted', recommendedActions: ['Increase pool', 'Failover to replica'], open: true },
      { id: 'inc:2', title: 'Minor drift', severity: 'info', blastRadius: 1, confidence: 0.5, rootCause: null, recommendedActions: ['Reconcile'], open: false },
    ],
    pendingApprovals: [
      { id: 'appr:1', source: 'workforce', title: 'Send email', risk: 'medium', requestedBy: 'user-1', status: 'awaiting_approval', approvalTrigger: 'workforce_side_effect' },
      { id: 'appr:2', source: 'federation', title: 'Share benchmark', risk: 'critical', requestedBy: 'Acme', status: 'pending', approvalTrigger: 'data_export' },
    ],
    chains: [
      { name: 'Spend approval', appliesTo: 'spend', steps: 2, enabled: true },
      { name: 'Side-effect approval', appliesTo: 'workforce_side_effect', steps: 1, enabled: true },
    ],
    monitorSignals: [
      { dimension: 'execution', label: 'Execution success', value: 75, display: '75%', detail: 'ok', source: 'ExecuteEngine' },
      { dimension: 'health', label: 'Operational health', value: 72, display: '72/100', detail: 'ok', source: 'P7 + Twin' },
      { dimension: 'security', label: 'Security posture', value: 40, display: '60 risk', detail: 'elevated', source: 'P7 risk' },
    ],
    autoAllowedTriggers: ['spend', 'policy'],
    auditSources: ['Workforce audit (10)', 'Enterprise governance audit (4)'],
    redactions: ['Evidence reduced to reference kinds'],
    kpis: [{ key: 'ops.health', label: 'Health', value: 72, display: '72/100', band: 'watch' }],
    ...over,
  };
}

function emptyState(): AutoOpsState {
  return {
    generatedAt: '2026-07-16T00:00:00.000Z',
    health: { overall: 0, band: 'critical' },
    planSeeds: [],
    execution: { active: [], awaiting: [], history: [], total: 0, completed: 0, failed: 0 },
    supervisorRecoveries: [],
    escalations: [],
    recoveryCount: 0,
    recentFailures: 0,
    recoverySeeds: [],
    optSeeds: [],
    incidents: [],
    pendingApprovals: [],
    chains: [],
    monitorSignals: [],
    autoAllowedTriggers: [],
    auditSources: [],
    redactions: [],
    kpis: [],
  };
}

describe('band + risk helpers', () => {
  it('maps scores / confidence / risk / severity to bands', () => {
    expect(bandFor(80)).toBe('healthy');
    expect(bandFor(60)).toBe('watch');
    expect(bandFor(30)).toBe('at-risk');
    expect(bandFor(10)).toBe('critical');
    expect(confBand(0.9)).toBe('healthy');
    expect(riskBand('critical')).toBe('critical');
    expect(riskBand('high')).toBe('at-risk');
    expect(riskBand('low')).toBe('healthy');
    expect(severityBand('critical')).toBe('critical');
    expect(severityBand('warning')).toBe('at-risk');
    expect(severityBand('info')).toBe('healthy');
  });
});

describe('CARDINAL: computeAutoExecutable — no autonomous bypass', () => {
  it('defaults to false when no policy explicitly permits the trigger', () => {
    const req = requiredApprovalsFor('workforce_side_effect', []);
    expect(computeAutoExecutable('workforce_side_effect', req, [])).toBe(false);
  });

  it('is true ONLY when explicitly allowed AND no chain governs the trigger', () => {
    const ungoverned = requiredApprovalsFor('policy', []); // no chain for 'policy'
    expect(computeAutoExecutable('policy', ungoverned, ['policy'])).toBe(true);
  });

  it('a governing approval chain ALWAYS overrides an explicit allow (governance wins)', () => {
    const governed = requiredApprovalsFor('spend', [{ name: 'Spend approval', appliesTo: 'spend', steps: 2, enabled: true }]);
    expect(governed[0].governed).toBe(true);
    // even though 'spend' is explicitly allowed, the governing chain forces approval.
    expect(computeAutoExecutable('spend', governed, ['spend'])).toBe(false);
  });

  it('requiredApprovalsFor always returns at least one requirement (governed chain or ungoverned marker)', () => {
    expect(requiredApprovalsFor('spend', [{ name: 'S', appliesTo: 'spend', steps: 2, enabled: true }])[0]).toMatchObject({ governed: true, chainName: 'S', steps: 2 });
    expect(requiredApprovalsFor('unknown', [])[0]).toMatchObject({ governed: false, chainName: null, steps: 0 });
  });
});

describe('CARDINAL: deriveAutoAllowedTriggers — explicit, precise auto-execution opt-in', () => {
  it('is empty unless a policy EXPLICITLY names autonomous:<trigger>', () => {
    expect(deriveAutoAllowedTriggers([])).toEqual([]);
    // a normal allow-policy is NOT an auto-exec opt-in.
    expect(deriveAutoAllowedTriggers([{ effect: 'allow', enabled: true, action: 'share_data' }])).toEqual([]);
    // a loose 'auto' substring is deliberately ignored (precise convention, not keyword match).
    expect(deriveAutoAllowedTriggers([{ effect: 'allow', enabled: true, action: 'auto_sync' }])).toEqual([]);
  });

  it('opts in ONLY an enabled allow-policy with an exact autonomous:<known-trigger> action', () => {
    expect(deriveAutoAllowedTriggers([{ effect: 'allow', enabled: true, action: 'autonomous:spend' }])).toEqual(['spend']);
    expect(deriveAutoAllowedTriggers([{ effect: 'allow', enabled: false, action: 'autonomous:spend' }])).toEqual([]);
    expect(deriveAutoAllowedTriggers([{ effect: 'deny', enabled: true, action: 'autonomous:spend' }])).toEqual([]);
    expect(deriveAutoAllowedTriggers([{ effect: 'allow', enabled: true, action: 'autonomous:bogus' }])).toEqual([]); // unknown trigger rejected
  });

  it('feeds computeAutoExecutable end-to-end: opted-in + ungoverned → auto; opted-in + governed → not', () => {
    const allowed = deriveAutoAllowedTriggers([{ effect: 'allow', enabled: true, action: 'autonomous:spend' }]);
    expect(computeAutoExecutable('spend', requiredApprovalsFor('spend', []), allowed)).toBe(true);
    const governed = requiredApprovalsFor('spend', [{ name: 'Spend', appliesTo: 'spend', steps: 1, enabled: true }]);
    expect(computeAutoExecutable('spend', governed, allowed)).toBe(false); // governance still wins
  });
});

describe('isIncidentOpen — matches the P7 open criterion (severity !== info)', () => {
  it('is open for any non-informational severity', () => {
    expect(isIncidentOpen('critical')).toBe(true);
    expect(isIncidentOpen('warning')).toBe(true);
    expect(isIncidentOpen('info')).toBe(false);
  });
});

describe('buildAutoOpsPlans — advisory, approval-aware plans', () => {
  it('every plan exposes reason, evidence, risk, expected outcome, rollback plan, and required approvals', () => {
    const p = buildAutoOpsPlans(state());
    expect(p.plans).toHaveLength(3);
    for (const plan of p.plans) {
      expect(plan.reason.length).toBeGreaterThan(0);
      expect(plan.expectedOutcome.length).toBeGreaterThan(0);
      expect(plan.rollbackPlan.length).toBeGreaterThan(0);
      expect(plan.requiredApprovals.length).toBeGreaterThanOrEqual(1);
      expect(['low', 'medium', 'high', 'critical']).toContain(plan.risk);
      // evidence kinds are lowercase ref tokens only.
      for (const k of plan.evidenceKinds) expect(k).toMatch(/^[a-z]+$/);
    }
    // the split is exhaustive.
    expect(p.autoExecutableCount + p.approvalRequiredCount).toBe(p.plans.length);
  });

  it('CARDINAL: only the explicitly-allowed + ungoverned plan is auto-executable; a governed allow is not', () => {
    const p = buildAutoOpsPlans(state());
    const a = p.plans.find((x) => x.id === 'plan:a')!; // spend, allowed but governed
    const b = p.plans.find((x) => x.id === 'plan:b')!; // policy, allowed + ungoverned
    const c = p.plans.find((x) => x.id === 'plan:c')!; // side-effect, not allowed
    expect(a.autoExecutable).toBe(false); // governance overrides the allow
    expect(b.autoExecutable).toBe(true);
    expect(c.autoExecutable).toBe(false);
    expect(p.autoExecutableCount).toBe(1);
    // every generated plan is an advisory candidate — it never advances itself.
    for (const plan of p.plans) expect(plan.approvalStatus).toBe('candidate');
  });

  it('CARDINAL: with no explicit allow policy, NOTHING is auto-executable', () => {
    const p = buildAutoOpsPlans(state({ autoAllowedTriggers: [] }));
    expect(p.autoExecutableCount).toBe(0);
    for (const plan of p.plans) expect(plan.autoExecutable).toBe(false);
  });
});

describe('execution / recovery / optimization / incidents / approvals', () => {
  it('projects execution coordination with a success rate', () => {
    const e = buildAutoOpsExecution(state());
    expect(e.activeCount).toBe(1);
    expect(e.awaitingCount).toBe(1);
    expect(e.successRate).toBe(0.75); // 15 / (15+5)
    expect(e.throughput).toBe(20);
  });

  it('projects recovery recommendations, each with its own rollback note + approvals', () => {
    const r = buildAutoOpsRecovery(state());
    expect(r.recommendations).toHaveLength(2);
    for (const rec of r.recommendations) {
      expect(rec.rollbackPlan.length).toBeGreaterThan(0);
      expect(rec.requiredApprovals.length).toBeGreaterThanOrEqual(1);
      expect(rec.autoExecutable).toBe(false); // side-effect trigger, not in allow-list
    }
    expect(r.escalations).toContain('backend');
  });

  it('projects optimization opportunities sorted by saving', () => {
    const o = buildAutoOpsOptimization(state());
    expect(o.opportunities[0].id).toBe('opt:1'); // 4200 > 800
    expect(o.totalPotentialSavingUsd).toBe(5000);
    expect(o.count).toBe(2);
  });

  it('projects incidents with open + critical rollups', () => {
    const i = buildAutoOpsIncidents(state());
    expect(i.total).toBe(2);
    expect(i.open).toBe(1);
    expect(i.critical).toBe(1);
    expect(i.incidents[0].id).toBe('inc:1'); // open + biggest blast radius first
    expect(i.band).toBe('critical');
  });

  it('projects the approval coordinator; it surfaces but never resolves', () => {
    const a = buildAutoOpsApprovals(state());
    expect(a.pendingCount).toBe(2);
    expect(a.pending[0].risk).toBe('critical'); // sorted risk desc
    expect(a.chains).toHaveLength(2);
    expect(a.autoExecutablePlans).toBe(1);
    expect(a.approvalRequiredPlans).toBe(2);
  });
});

describe('monitoring / analytics / governance / overview', () => {
  it('bands every monitored dimension and computes an overall', () => {
    const m = buildAutoOpsMonitoring(state());
    expect(m.signals).toHaveLength(3);
    expect(m.signals[0].dimension).toBe('security'); // lowest value first (40)
    expect(m.criticalCount + m.atRiskCount + m.watchCount + m.healthyCount).toBe(3);
    expect(m.overall).toBe(62); // (75+72+40)/3 rounded
  });

  it('aggregates operational analytics from the projections', () => {
    const a = buildAutoOpsAnalytics(state());
    expect(a.planCount).toBe(3);
    expect(a.autoExecutable).toBe(1);
    expect(a.approvalRequired).toBe(2);
    expect(a.incidentCount).toBe(2);
  });

  it('governance asserts no-autonomous-bypass and reuses the existing scopes', () => {
    const g = buildAutoOpsGovernance(state());
    expect(g.opsScope).toBe('autonomousops:read');
    expect(g.neverBypass).toMatch(/no autonomous bypass/i);
    expect(g.autoExecutionPolicy).toMatch(/never the default/i);
    expect(g.scopes.length).toBe(6);
  });

  it('projects seven modules and a summary + overview bundle', () => {
    const modules = buildOpsModules(state());
    expect(modules).toHaveLength(7);
    expect(modules.map((m) => m.id).sort()).toEqual(['approval-coordinator', 'execution-coordinator', 'incident-manager', 'monitoring', 'operational-analytics', 'optimization-manager', 'recovery-manager']);
    for (const m of modules) expect(m.source.length).toBeGreaterThan(0);
    const o = buildAutoOpsOverview(state());
    expect(o.summary.modules).toBe(7);
    expect(o.summary.operationalPlans).toBe(3);
    expect(o.summary.openIncidents).toBe(1);
    expect(o.kpis).toHaveLength(1);
  });
});

describe('determinism + never-throws-on-empty', () => {
  it('is deterministic — same state yields deep-equal output', () => {
    expect(buildAutoOpsOverview(state())).toEqual(buildAutoOpsOverview(state()));
    expect(buildAutoOpsPlans(state())).toEqual(buildAutoOpsPlans(state()));
  });

  it('never throws on an empty operations snapshot', () => {
    expect(() => buildAutoOpsOverview(emptyState())).not.toThrow();
    expect(() => buildAutoOpsPlans(emptyState())).not.toThrow();
    expect(() => buildAutoOpsExecution(emptyState())).not.toThrow();
    expect(() => buildAutoOpsMonitoring(emptyState())).not.toThrow();
    expect(() => buildAutoOpsAnalytics(emptyState())).not.toThrow();
    expect(buildAutoOpsExecution(emptyState()).successRate).toBeNull();
    expect(buildAutoOpsSummary(emptyState()).operationalPlans).toBe(0);
    expect(buildAutoOpsMonitoring(emptyState()).overallBand).toBe('watch');
  });
});
