/**
 * Phase 6 Stage 6 — the insight model: report confidence breakdown, outcome
 * lifecycle derivation (stages only from real records), recommendation
 * composition, the Intelligence Dependency Graph, and dashboard composition.
 */
import { describe, expect, it } from 'vitest';
import type {
  ConfidenceBreakdown,
  InsightPrediction,
  InsightRecommendation,
  IntelRecommendation,
  SignalRuntimeStatus,
} from '@neuropause/shared';
import {
  buildDependencyGraph,
  composeDashboard,
  composeRecommendations,
  deriveOutcome,
  reportConfidence,
  signalForEvidence,
  type OutcomeJoins,
} from './insightModel';

const NOW_ISO = '2026-07-31T12:00:00.000Z';

const sig = (id: string, available = true): SignalRuntimeStatus => ({
  id,
  available,
  itemCount: available ? 5 : null,
  latestAt: available ? NOW_ISO : null,
  freshness: available ? 'fresh' : 'unknown',
  completeness: available ? 1 : 0,
  note: available ? null : 'down',
});

const emptyJoins = (): OutcomeJoins => ({
  decisions: [],
  approvalEvents: [],
  executions: [],
  clearedRecommendationIds: new Set(),
  nowIso: NOW_ISO,
});

const BASE: ConfidenceBreakdown = {
  dataAvailability: 1,
  signalQuality: 0.9,
  historicalCoverage: 0.3,
  correlationStrength: 0.5,
  overall: 0.7,
};

describe('signalForEvidence', () => {
  it('maps projected + engine evidence ids onto registry signals', () => {
    expect(signalForEvidence('ops:connector:slack')).toBe('connector-health');
    expect(signalForEvidence('autorun:run1')).toBe('automation-runs');
    expect(signalForEvidence('job:j1')).toBe('workforce-jobs');
    expect(signalForEvidence('ops:project:p1')).toBe('work-entities');
    expect(signalForEvidence('exec:exec_1')).toBe('executions');
    expect(signalForEvidence('res:vm-1')).toBe('p7-intelligence');
    expect(signalForEvidence('health:2026-07-30')).toBe('org-health');
    expect(signalForEvidence('mystery')).toBeNull();
  });
});

describe('reportConfidence (enhancement #3)', () => {
  it('reflects availability, trust-weighted quality, history, and correlation', () => {
    const c = reportConfidence({
      signals: [sig('workforce-jobs'), sig('connector-health'), sig('org-health', false)],
      historyDays: 45,
      incidentConfidences: [0.8, 0.6],
      crossDomainEdges: 10,
      totalEdges: 40,
    });
    expect(c.dataAvailability).toBeCloseTo(2 / 3, 2);
    expect(c.historicalCoverage).toBe(0.5);
    expect(c.signalQuality).toBeGreaterThan(0.8); // both available signals are trust 0.9 × completeness 1
    expect(c.correlationStrength).toBeGreaterThan(0.5);
    expect(c.overall).toBeGreaterThan(0);
    expect(c.overall).toBeLessThanOrEqual(1);
  });

  it('zero signals → zero availability and quality (no fabricated confidence)', () => {
    const c = reportConfidence({ signals: [], historyDays: 0, incidentConfidences: [], crossDomainEdges: 0, totalEdges: 0 });
    expect(c.dataAvailability).toBe(0);
    expect(c.signalQuality).toBe(0);
    expect(c.historicalCoverage).toBe(0);
  });
});

describe('deriveOutcome (enhancement #3) — stages only from real records', () => {
  it('with no joins the lifecycle is exactly [recommended]', () => {
    const o = deriveOutcome('reco:x', 'ins_x', NOW_ISO, emptyJoins());
    expect(o.stage).toBe('recommended');
    expect(o.steps).toHaveLength(1);
    expect(o.steps[0].evidence).toEqual({ kind: 'recommendation', id: 'reco:x' });
  });

  it('a decision created from the recommendation advances to approved (evidence = decision id)', () => {
    const joins = emptyJoins();
    joins.decisions = [{ id: 'dec:1', fromRecommendationId: 'reco:x', status: 'accepted', updatedAt: NOW_ISO }];
    const o = deriveOutcome('reco:x', 'ins_x', NOW_ISO, joins);
    expect(o.stage).toBe('approved');
    expect(o.steps[1].evidence).toEqual({ kind: 'decision', id: 'dec:1' });
  });

  it('a rejected/suggested decision does NOT advance the lifecycle', () => {
    const joins = emptyJoins();
    joins.decisions = [
      { id: 'dec:1', fromRecommendationId: 'reco:x', status: 'rejected', updatedAt: NOW_ISO },
      { id: 'dec:2', fromRecommendationId: 'reco:x', status: 'suggested', updatedAt: NOW_ISO },
    ];
    expect(deriveOutcome('reco:x', 'ins_x', NOW_ISO, joins).stage).toBe('recommended');
  });

  it('an execution in the correlation chain counts only after an approval exists', () => {
    const joins = emptyJoins();
    joins.executions = [{ id: 'exec_1', state: 'completed', correlationId: 'ins_x', completedAt: NOW_ISO, startedAt: NOW_ISO }];
    // No approval → still recommended (an execution alone is not an approved outcome).
    expect(deriveOutcome('reco:x', 'ins_x', NOW_ISO, joins).stage).toBe('recommended');
    joins.approvalEvents = [{ id: 'evt-appr', correlationId: 'ins_x', at: NOW_ISO }];
    const o = deriveOutcome('reco:x', 'ins_x', NOW_ISO, joins);
    expect(o.stage).toBe('executed');
    expect(o.steps.map((s) => s.stage)).toEqual(['recommended', 'approved', 'executed']);
    expect(o.steps[2].evidence).toEqual({ kind: 'execution', id: 'exec_1' });
  });

  it('a cleared condition verifies with an observation evidence step', () => {
    const joins = emptyJoins();
    joins.clearedRecommendationIds = new Set(['reco:x']);
    const o = deriveOutcome('reco:x', 'ins_x', NOW_ISO, joins);
    expect(o.stage).toBe('verified');
    expect(o.steps[o.steps.length - 1].evidence.kind).toBe('observation');
  });
});

const engineReco = (over: Partial<IntelRecommendation>): IntelRecommendation => ({
  id: 'reco:incident:1',
  category: 'incident',
  title: 'Investigate Slack outage',
  detail: 'Correlated failures.',
  priority: 'critical',
  confidence: 0.8,
  evidence: ['ops:connector:slack'],
  ...over,
});

const prediction = (over: Partial<InsightPrediction>): InsightPrediction => ({
  id: 'pred:approval-backlog',
  kind: 'approval-backlog',
  title: 'Approval backlog',
  detail: 'Queue is growing.',
  horizonDays: 7,
  likelihood: 0.8,
  confidence: BASE,
  evidence: ['j1'],
  basis: 'Job store threshold.',
  suggestedAction: 'Decide the oldest proposals.',
  signals: ['workforce-jobs'],
  ...over,
});

describe('composeRecommendations', () => {
  it('composes engine + prediction recommendations with signals, correlation ids, and outcomes', () => {
    const out = composeRecommendations({
      engine: [engineReco({})],
      predictions: [prediction({})],
      base: BASE,
      joins: emptyJoins(),
    });
    expect(out).toHaveLength(2);
    const eng = out.find((r) => r.id === 'reco:incident:1')!;
    expect(eng.signals).toEqual(['connector-health']);
    expect(eng.correlationId).toBe('ins_reco_incident_1');
    expect(eng.outcome.stage).toBe('recommended');
    expect(eng.category).toBe('incident');
    const pred = out.find((r) => r.id === 'reco:pred:approval-backlog')!;
    expect(pred.category).toBe('prediction');
    expect(pred.priority).toBe('high'); // likelihood 0.8 ≥ 0.7
    expect(pred.suggestedAction).toBe('Decide the oldest proposals.');
  });

  it('ranks by priority then confidence; caps at 50', () => {
    const many = Array.from({ length: 60 }, (_, i) => engineReco({ id: `reco:r${i}`, priority: 'low' }));
    const out = composeRecommendations({
      engine: [...many, engineReco({ id: 'reco:top', priority: 'critical' })],
      predictions: [],
      base: BASE,
      joins: emptyJoins(),
    });
    expect(out).toHaveLength(50);
    expect(out[0].id).toBe('reco:top');
  });
});

describe('buildDependencyGraph (enhancement #2)', () => {
  function graph(): ReturnType<typeof buildDependencyGraph> {
    const recos: InsightRecommendation[] = composeRecommendations({
      engine: [engineReco({})],
      predictions: [prediction({})],
      base: BASE,
      joins: emptyJoins(),
    });
    return buildDependencyGraph({
      recommendations: recos,
      incidents: [
        {
          id: 'incident:c1',
          title: 'Critical incident — Slack',
          severity: 'critical',
          startTs: 0,
          endTs: 1,
          eventIds: ['connector:slack:a1'],
          resourceIds: ['ops:connector:slack'],
          rootCauseLabel: 'Slack connector',
          rootCauseConfidence: 0.7,
          blastRadius: 3,
          recommendedActions: ['Investigate'],
        },
      ],
      predictions: [prediction({})],
      health: {
        domains: [
          {
            key: 'approvals',
            label: 'Approvals',
            score: 40,
            band: 'at-risk',
            explanation: ['backlog'],
            evidence: ['approvals.pending=6'],
            confidence: 0.9,
            signals: ['workforce-jobs'],
            unavailable: null,
          },
        ],
        overall: 40,
        band: 'at-risk',
        confidence: BASE,
        generatedAt: NOW_ISO,
      },
    });
  }

  it('links signal → finding → recommendation with evidence-of / derived-from edges', () => {
    const g = graph();
    const ids = g.nodes.map((n) => n.id);
    expect(ids).toContain('signal:connector-health');
    expect(ids).toContain('finding:incident:c1');
    expect(ids).toContain('recommendation:reco:incident:1');
    expect(ids).toContain('finding:pred:approval-backlog');
    expect(ids).toContain('finding:health:approvals');
    const edges = g.edges.map((e) => `${e.from}|${e.relation}|${e.to}`);
    expect(edges).toContain('signal:connector-health|evidence-of|finding:incident:c1');
    expect(edges).toContain('signal:connector-health|evidence-of|recommendation:reco:incident:1');
    expect(edges).toContain('finding:pred:approval-backlog|derived-from|recommendation:reco:pred:approval-backlog');
    // The incident-born recommendation derives from its incident (shared evidence).
    expect(edges).toContain('finding:incident:c1|derived-from|recommendation:reco:incident:1');
  });

  it('every node id is unique and every edge endpoint resolves', () => {
    const g = graph();
    expect(new Set(g.nodes.map((n) => n.id)).size).toBe(g.nodes.length);
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.from), e.from).toBe(true);
      expect(ids.has(e.to), e.to).toBe(true);
    }
  });
});

describe('composeDashboard', () => {
  it('slices the report honestly and carries trend + verified log + dependencies', () => {
    const recos = composeRecommendations({ engine: [engineReco({})], predictions: [], base: BASE, joins: emptyJoins() });
    const report = {
      generatedAt: NOW_ISO,
      signals: [sig('workforce-jobs')],
      graph: { nodes: 5, edges: 4, byDomain: {}, crossDomainEdges: 2, projectedNodes: 3, projectedEdges: 2, projectedEvents: 1 },
      incidents: [
        { id: 'i1', title: 'x', severity: 'info' as const, startTs: 0, endTs: 0, eventIds: [], resourceIds: [], rootCauseLabel: null, rootCauseConfidence: 0, blastRadius: 0, recommendedActions: [] },
        { id: 'i2', title: 'y', severity: 'critical' as const, startTs: 0, endTs: 0, eventIds: [], resourceIds: [], rootCauseLabel: null, rootCauseConfidence: 0, blastRadius: 1, recommendedActions: [] },
      ],
      health: { domains: [], overall: 70, band: 'watch' as const, confidence: BASE, generatedAt: NOW_ISO },
      predictions: [prediction({})],
      recommendations: recos,
      dependencies: { nodes: [], edges: [] },
      confidence: BASE,
      unavailable: [],
    };
    const d = composeDashboard({
      report,
      trend: [{ day: '2026-07-30', overall: 71 }],
      recentlyVerified: [{ id: 'reco:z', title: 'Fixed thing', at: NOW_ISO }],
      nowIso: NOW_ISO,
    });
    expect(d.activeIncidents.map((i) => i.id)).toEqual(['i2']); // info excluded
    expect(d.trend).toHaveLength(1);
    expect(d.recentlyVerified[0].id).toBe('reco:z');
    expect(d.dependencies).toEqual({ nodes: [], edges: [] });
    expect(d.confidence).toEqual(BASE);
  });
});
