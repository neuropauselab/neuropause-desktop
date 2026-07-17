/**
 * Intent Experience Program v2.0 — model tests. Pure reprojection of the REAL P14 strategy goals as user
 * intents: a multi-intent board, Today's Intent, per-intent dynamic workspaces, role lenses, and the next
 * best action — PLUS the AUTHENTICITY LAW (nothing is fabricated): every intent field maps to a real goal
 * value or an honest derivation over real values (band from status, urgency from status, blocked from a
 * dependency's real status), per-intent confidence/ETA/worker-roster are OMITTED not faked, and the layer
 * is deterministic and never-throws-on-empty.
 */
import { describe, expect, it } from 'vitest';
import {
  bandForStatus,
  buildIntentBoard,
  buildIntentGovernance,
  buildIntentRoleViews,
  buildIntentSummaries,
  buildIntentWorkspaces,
  intentUrgency,
  pickNextBestAction,
  statusLabel,
  OMITTED_WORKSPACE_PANELS,
  type IntentGoalInput,
  type IntentState,
} from './intentModel';

function goal(over: Partial<IntentGoalInput> & Pick<IntentGoalInput, 'id' | 'name'>): IntentGoalInput {
  return {
    id: over.id,
    category: over.category ?? 'operational',
    name: over.name,
    description: over.description ?? 'A real strategic goal.',
    horizon: over.horizon ?? '90d',
    successMetric: over.successMetric ?? 'Metric target met',
    target: over.target ?? 100,
    current: over.current ?? 50,
    unit: over.unit ?? 'score',
    progress: over.progress ?? 0.5,
    status: over.status ?? 'at_risk',
    objectives: over.objectives ?? [],
    dependencies: over.dependencies ?? [],
    milestones: over.milestones ?? [],
    evidence: over.evidence ?? [],
    nextAction: over.nextAction ?? null,
    relatedDecisions: over.relatedDecisions ?? [],
  };
}

function state(over: Partial<IntentState> = {}): IntentState {
  return {
    generatedAt: '2026-07-17T08:00:00.000Z',
    reasoningConfidence: 0.82,
    intents: [
      goal({
        id: 'goal-risk', category: 'security', name: 'Reduce enterprise risk', horizon: '90d',
        successMetric: 'Enterprise risk index < 40', target: 40, current: 68, unit: 'index', progress: 0.2, status: 'off_track',
        objectives: [{ id: 'obj-r1', label: 'infrastructure risk', metric: 'infra risk score', current: 70, target: 40, unit: 'index', progress: 0.1, status: 'off_track' }],
        milestones: [{ id: 'ms-r1', label: 'Risk review', horizon: '30d', status: 'at_risk' }],
        evidence: ['risk:spof-1', 'risk:spof-2'],
        nextAction: { label: 'Advance "Reduce enterprise risk"', action: 'mitigate_risk', approval: { governed: true, chainName: 'Security approval chain', steps: 2, note: 'Governed by an enabled chain.' }, evidence: ['risk:spof-1'] },
        relatedDecisions: [{ id: 'dec-1', title: 'Add payments redundancy', recommendation: 'Provision a standby.', confidence: 0.9, priority: 'critical', band: 'critical', requiresApproval: true }],
      }),
      goal({
        id: 'goal-health', category: 'operational', name: 'Sustain enterprise health', horizon: '90d',
        successMetric: 'Enterprise health score ≥ 80', target: 80, current: 72, unit: 'score', progress: 0.6, status: 'at_risk',
        dependencies: ['goal-risk'],
        evidence: ['health:security'],
        nextAction: { label: 'Advance "Sustain enterprise health"', action: 'optimize_workflow', approval: { governed: false, chainName: null, steps: 0, note: 'No enabled chain governs this action.' }, evidence: [] },
      }),
      goal({
        id: 'goal-cost', category: 'financial', name: 'Improve cloud cost efficiency', horizon: '180d',
        successMetric: 'Cloud utilization ≥ 70%', target: 70, current: 55, unit: '%', progress: 0.5, status: 'at_risk',
        nextAction: { label: 'Advance "Improve cloud cost efficiency"', action: 'optimize_budget', approval: { governed: true, chainName: 'Finance approval chain', steps: 1, note: 'Governed by an enabled chain.' }, evidence: [] },
        relatedDecisions: [{ id: 'dec-fin', title: 'Right-size the fleet', recommendation: 'Drop idle replicas.', confidence: 0.75, priority: 'high', band: 'at-risk', requiresApproval: false }],
      }),
      goal({
        id: 'goal-workforce', category: 'workforce', name: 'Raise workforce reliability', horizon: '90d',
        successMetric: 'Workforce success rate ≥ 90%', target: 90, current: 95, unit: '%', progress: 0.95, status: 'on_track',
        objectives: [{ id: 'obj-w1', label: 'Job success rate', metric: 'succeeded / decided', current: 95, target: 90, unit: '%', progress: 1, status: 'on_track' }],
        evidence: ['wf:bottleneck-none'],
        nextAction: null, // on-track ⇒ the platform recommends no step; none is invented.
      }),
    ],
    ...over,
  };
}

function emptyState(): IntentState {
  return { generatedAt: '2026-07-17T20:00:00.000Z', reasoningConfidence: 0, intents: [] };
}

describe('AUTHENTICITY: band + status derive only from real status, never false-colour', () => {
  it('maps real StrategyStatus to a band without inventing severity', () => {
    expect(bandForStatus('on_track')).toBe('healthy'); // an on-track goal is never false-red
    expect(bandForStatus('at_risk')).toBe('at-risk');
    expect(bandForStatus('off_track')).toBe('critical');
  });

  it('urgency is a status-severity weight (a sort key), not a fabricated priority label', () => {
    expect(intentUrgency('off_track')).toBeGreaterThan(intentUrgency('at_risk'));
    expect(intentUrgency('at_risk')).toBeGreaterThan(intentUrgency('on_track'));
  });

  it('never attaches a per-intent confidence — goals carry none, so none is invented', () => {
    const [top] = buildIntentSummaries(state());
    expect(Object.prototype.hasOwnProperty.call(top, 'confidence')).toBe(false);
  });
});

describe('buildIntentSummaries — every field traces to the real goal, ranked by urgency', () => {
  it('reprojects the real goal values verbatim (no fabrication)', () => {
    const summaries = buildIntentSummaries(state());
    const risk = summaries.find((s) => s.id === 'goal-risk')!;
    expect(risk.name).toBe('Reduce enterprise risk');
    expect(risk.successMetric).toBe('Enterprise risk index < 40');
    expect(risk.current).toBe(68);
    expect(risk.target).toBe(40);
    expect(risk.unit).toBe('index');
    expect(risk.progress).toBeCloseTo(0.2);
    expect(risk.progressPct).toBe(20);
    expect(risk.category).toBe('security');
    expect(risk.evidenceCount).toBe(2);
    expect(risk.objectiveCount).toBe(1);
    expect(risk.milestoneCount).toBe(1);
    // the honest "when" is the real planning horizon, NOT a fabricated calendar date
    expect(risk.horizon).toBe('90d');
    expect(risk.horizonLabel).toBe('90 days');
    // every card answers "what next?" with the real plan-step label
    expect(risk.nextAction).toBe('Advance "Reduce enterprise risk"');
  });

  it('ranks off-track first, then at-risk (lower progress first), then on-track', () => {
    const ids = buildIntentSummaries(state()).map((s) => s.id);
    expect(ids).toEqual(['goal-risk', 'goal-cost', 'goal-health', 'goal-workforce']);
  });

  it('derives "blocked" from a dependency\'s REAL status (not a flag on the goal)', () => {
    const summaries = buildIntentSummaries(state());
    const health = summaries.find((s) => s.id === 'goal-health')!;
    expect(health.dependencies).toEqual(['goal-risk']);
    expect(health.blocked).toBe(true); // goal-risk is off_track
    expect(health.blockedBy).toEqual(['Reduce enterprise risk']);
    const workforce = summaries.find((s) => s.id === 'goal-workforce')!;
    expect(workforce.blocked).toBe(false);
    expect(workforce.blockedBy).toEqual([]);
  });
});

describe('buildIntentBoard — Today\'s Intent + counts + board-level confidence', () => {
  it('Today\'s Intent is the single most urgent real outcome, with real risks + next action', () => {
    const b = buildIntentBoard(state());
    expect(b.todaysIntent?.intent.id).toBe('goal-risk');
    expect(b.todaysIntent?.currentOutcome).toBe('Enterprise risk index < 40');
    // its own off-track status is surfaced as a risk, plus nothing fabricated
    expect(b.todaysIntent?.risks.some((r) => r.id === 'risk:goal-risk')).toBe(true);
    expect(b.todaysIntent?.nextBestAction?.action).toBe('mitigate_risk');
    expect(b.todaysIntent?.approval?.chainName).toBe('Security approval chain');
    expect(b.todaysIntent?.recommendations[0]?.id).toBe('dec-1');
  });

  it('counts + overall progress come straight from the real goal statuses', () => {
    const b = buildIntentBoard(state());
    expect(b.counts).toEqual({ total: 4, onTrack: 1, atRisk: 2, offTrack: 1, blocked: 1 });
    expect(b.overallProgressPct).toBe(56); // mean of 20/60/50/95
    expect(b.reasoningConfidence).toBeCloseTo(0.82); // real board-level reasoning confidence, passed through
  });

  it('surfaces the single highest-priority real next best action across all intents', () => {
    const b = buildIntentBoard(state());
    expect(b.nextBestAction?.intentId).toBe('goal-risk');
  });

  it('an on-track goal yields NO invented next action', () => {
    const single = state({ intents: [state().intents[3]] }); // goal-workforce, on_track, nextAction null
    expect(pickNextBestAction(single)).toBeNull();
    expect(buildIntentBoard(single).nextBestAction).toBeNull();
  });
});

describe('buildIntentWorkspaces — assembled only from real per-intent facets', () => {
  it('assembles objectives/timeline/evidence/dependencies/decisions from real goal data', () => {
    const ws = buildIntentWorkspaces(state()).workspaces.find((w) => w.intentId === 'goal-risk')!;
    expect(ws.objectives.map((o) => o.id)).toEqual(['obj-r1']);
    expect(ws.objectives[0].progressPct).toBe(10);
    expect(ws.timeline.map((m) => m.id)).toEqual(['ms-r1']);
    expect(ws.timeline[0].horizonLabel).toBe('30 days');
    expect(ws.evidence).toEqual(['risk:spof-1', 'risk:spof-2']);
    expect(ws.relatedDecisions[0].id).toBe('dec-1');
    expect(ws.nextBestAction?.action).toBe('mitigate_risk');
    // panels list ONLY the real, present facets
    expect(ws.panels).toEqual(expect.arrayContaining(['Objectives', 'Timeline', 'Evidence', 'Related decisions', 'Next best action']));
  });

  it('marks a dependency as blocking when it is really off-track', () => {
    const ws = buildIntentWorkspaces(state()).workspaces.find((w) => w.intentId === 'goal-health')!;
    const dep = ws.dependencies.find((d) => d.id === 'goal-risk')!;
    expect(dep.blocking).toBe(true);
    expect(ws.panels).toContain('Dependencies');
  });

  it('documents what it withholds rather than fabricating (worker/connector/analytics panels)', () => {
    const ws = buildIntentWorkspaces(state()).workspaces[0];
    expect(ws.omitted).toBe(OMITTED_WORKSPACE_PANELS);
    expect(ws.omitted.join(' ')).toMatch(/worker/i);
    expect(ws.omitted.join(' ')).toMatch(/connector/i);
  });
});

describe('role lenses — a role emphasizes real intents by real category; it never invents one', () => {
  it('Founder sees every intent; each other role only its categories, in urgency order', () => {
    const summaries = buildIntentSummaries(state());
    const views = buildIntentRoleViews(summaries);
    const founder = views.find((v) => v.role === 'founder')!;
    expect(founder.intentIds).toEqual(['goal-risk', 'goal-cost', 'goal-health', 'goal-workforce']);
    const cfo = views.find((v) => v.role === 'cfo')!; // financial + compliance
    expect(cfo.intentIds).toEqual(['goal-cost']);
    const cto = views.find((v) => v.role === 'cto')!; // infrastructure + security + operational
    expect(cto.intentIds).toEqual(['goal-risk', 'goal-health']);
    const hr = views.find((v) => v.role === 'hr')!; // workforce
    expect(hr.intentIds).toEqual(['goal-workforce']);
    // every emphasized id is a REAL intent (subset of the board)
    const all = new Set(summaries.map((s) => s.id));
    for (const v of views) for (const id of v.intentIds) expect(all.has(id)).toBe(true);
  });
});

describe('governance — the authenticity ledger', () => {
  it('states the intent scope, a provenance trail, and honest omissions', () => {
    const g = buildIntentGovernance();
    expect(g.intentScope).toBe('intent:read');
    expect(g.law).toMatch(/what outcome/i);
    expect(g.provenance.length).toBeGreaterThanOrEqual(8);
    expect(g.provenance.every((p) => p.source.length > 0)).toBe(true);
    // the three things we refuse to fabricate must be documented
    expect(g.omissions.map((o) => o.item).join(' ')).toMatch(/confidence/i);
    expect(g.omissions.map((o) => o.item).join(' ')).toMatch(/ETA|completion/i);
    expect(g.omissions.map((o) => o.item).join(' ')).toMatch(/worker|connector/i);
  });
});

describe('determinism + never-throws-on-empty', () => {
  it('is deterministic — same state yields deep-equal board', () => {
    expect(buildIntentBoard(state())).toEqual(buildIntentBoard(state()));
  });

  it('never throws on an empty snapshot and still yields a complete board', () => {
    expect(() => buildIntentBoard(emptyState())).not.toThrow();
    expect(() => buildIntentWorkspaces(emptyState())).not.toThrow();
    const b = buildIntentBoard(emptyState());
    expect(b.todaysIntent).toBeNull();
    expect(b.intents).toEqual([]);
    expect(b.counts).toEqual({ total: 0, onTrack: 0, atRisk: 0, offTrack: 0, blocked: 0 });
    expect(b.overallProgressPct).toBe(0);
    expect(b.nextBestAction).toBeNull();
    expect(b.roleViews).toHaveLength(10);
    for (const v of b.roleViews) expect(v.intentIds).toEqual([]);
    expect(statusLabel('off_track')).toBe('off track');
  });
});
