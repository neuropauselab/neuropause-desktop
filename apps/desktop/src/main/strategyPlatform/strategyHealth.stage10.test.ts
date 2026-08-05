/**
 * Phase 6 Stage 10 — strategy health: theme rollup (worst-of its objectives),
 * the five composed layers with per-layer isolation (S6/S7/S8/S9/P14 — P14 as
 * ONE injected input), strategic risks substantiated ONLY by live signals
 * (quiet risks stay honest), and unit→company-objective alignment.
 */
import { describe, expect, it } from 'vitest';
import type { ObjectivesReport, ObjectiveView } from '@neuropause/shared';
import { buildCapabilityMap } from './capabilityMap';
import { buildRiskViews, buildStrategyHealth, type RiskSignals, type StrategyHealthInput } from './strategyHealth';

const NOW = '2026-07-31T12:00:00.000Z';

function objectiveView(over: Partial<ObjectiveView>): ObjectiveView {
  return {
    id: 'o',
    kind: 'company',
    label: 'O',
    description: '',
    themeId: null,
    horizon: null,
    owner: null,
    unitName: 'Operations',
    companyObjectiveId: null,
    capabilityKeys: ['operations'],
    measures: [],
    health: 'on-track',
    healthDetail: 'all good',
    rollup: [],
    ...over,
  };
}

function objectivesReport(views: ObjectiveView[]): ObjectivesReport {
  const company = views.filter((v) => v.kind === 'company');
  const departments = views.filter((v) => v.kind === 'department');
  return {
    generatedAt: NOW,
    company,
    departments,
    totals: { onTrack: 0, atRisk: 0, offTrack: 0, unknown: 0 },
    gaps: [],
    unavailable: [],
  };
}

function emptyCapabilities() {
  return buildCapabilityMap({
    nowIso: NOW,
    signals: {
      domains: null,
      kpis: null,
      s9Services: null,
      readiness: null,
      minedTypes: null,
      compliance: null,
      slaStatuses: null,
      apFindings: null,
      decisions: null,
    },
    objectives: [],
    initiatives: [],
    units: null,
    users: null,
    knowledgeMatch: null,
    failures: {},
  });
}

const QUIET_RISKS: RiskSignals = {
  slaStatuses: [
    { targetId: 'exec-success-rate', status: 'met', detail: 'within target' },
    { targetId: 'connector-healthy-ratio', status: 'met', detail: 'within target' },
    { targetId: 'automation-failure-ratio', status: 'met', detail: 'within target' },
  ],
  readiness: [
    { key: 'governance', state: 'ready', detail: 'ready' },
    { key: 'organization', state: 'ready', detail: 'ready' },
  ],
  apFindings: [],
  incidentDomains: [],
};

function mkInput(over: Partial<StrategyHealthInput> = {}): StrategyHealthInput {
  return {
    nowIso: NOW,
    objectives: objectivesReport([
      objectiveView({ id: 'co-reliable-execution', health: 'on-track' }),
      objectiveView({ id: 'co-healthy-organization', health: 'on-track' }),
      objectiveView({ id: 'co-governed-ai', health: 'on-track' }),
      objectiveView({ id: 'co-dependable-integrations', health: 'on-track' }),
      objectiveView({ id: 'co-trustworthy-automation', health: 'on-track' }),
    ]),
    capabilities: emptyCapabilities(),
    layers: {
      insightBand: 'healthy',
      knowledge: { assets: 24, findings: 0 },
      automation: { criticalFindings: 0, totalFindings: 2 },
      operations: { ready: 7, notReady: 0, unknown: 0 },
      p14: { goalsOnTrack: 9, goalsTotal: 9, healthBand: 'healthy' },
    },
    risks: QUIET_RISKS,
    units: [
      { id: 'u1', name: 'Engineering' },
      { id: 'u2', name: 'Design' },
    ],
    failures: {},
    ...over,
  };
}

describe('themes — worst-of rollup, never averaged past a failure', () => {
  it('all bound objectives on-track → every theme on-track', () => {
    const h = buildStrategyHealth(mkInput());
    expect(h.themes).toHaveLength(3);
    for (const t of h.themes) expect(t.state, t.id).toBe('on-track');
  });

  it('one off-track objective drags exactly its theme, and the detail names the culprit', () => {
    const h = buildStrategyHealth(
      mkInput({
        objectives: objectivesReport([
          objectiveView({ id: 'co-reliable-execution', health: 'off-track' }),
          objectiveView({ id: 'co-healthy-organization', health: 'on-track' }),
          objectiveView({ id: 'co-governed-ai', health: 'on-track' }),
          objectiveView({ id: 'co-dependable-integrations', health: 'on-track' }),
          objectiveView({ id: 'co-trustworthy-automation', health: 'on-track' }),
        ]),
      }),
    );
    const rel = h.themes.find((t) => t.id === 'reliable-autonomous-operations')!;
    expect(rel.state).toBe('off-track');
    expect(rel.detail).toContain('co-reliable-execution');
    expect(h.themes.find((t) => t.id === 'connected-enterprise')!.state).toBe('on-track');
  });
});

describe('the five composed layers — per-layer isolation, P14 as ONE input', () => {
  it('healthy inputs → all five layers on-track, p14 detail says composed not duplicated', () => {
    const h = buildStrategyHealth(mkInput());
    expect(h.layers.map((l) => l.layer)).toEqual(['intelligence', 'knowledge', 'automation', 'operations', 'p14-strategy']);
    for (const l of h.layers) expect(l.state, l.layer).toBe('on-track');
    expect(h.layers.find((l) => l.layer === 'p14-strategy')!.detail).toContain('composed, not duplicated');
  });

  it('a failing layer degrades to unknown WITH the reason — its siblings stay computed', () => {
    const h = buildStrategyHealth(
      mkInput({ layers: { insightBand: null, knowledge: null, automation: { criticalFindings: 1, totalFindings: 3 }, operations: { ready: 5, notReady: 1, unknown: 1 }, p14: null } }),
    );
    expect(h.layers.find((l) => l.layer === 'intelligence')!.state).toBe('unknown');
    expect(h.layers.find((l) => l.layer === 'knowledge')!.detail).toContain('unreadable');
    expect(h.layers.find((l) => l.layer === 'automation')!.state).toBe('at-risk');
    expect(h.layers.find((l) => l.layer === 'operations')!.state).toBe('off-track');
    expect(h.layers.find((l) => l.layer === 'p14-strategy')!.state).toBe('unknown');
  });

  it('P14 grading: all goals on track → on-track; critical band → off-track; otherwise at-risk', () => {
    const at = buildStrategyHealth(mkInput({ layers: { ...mkInput().layers, p14: { goalsOnTrack: 5, goalsTotal: 9, healthBand: 'watch' } } }));
    expect(at.layers.find((l) => l.layer === 'p14-strategy')!.state).toBe('at-risk');
    const off = buildStrategyHealth(mkInput({ layers: { ...mkInput().layers, p14: { goalsOnTrack: 2, goalsTotal: 9, healthBand: 'critical' } } }));
    expect(off.layers.find((l) => l.layer === 'p14-strategy')!.state).toBe('off-track');
  });
});

describe('strategic risks — substantiated ONLY by live signals', () => {
  it('quiet signals → every risk unsubstantiated, stated honestly (never escalated)', () => {
    const risks = buildRiskViews(QUIET_RISKS);
    expect(risks).toHaveLength(5);
    for (const r of risks) {
      expect(r.substantiated, r.id).toBe(false);
      expect(r.detail).toContain('stated honestly, not escalated');
    }
  });

  it('a breached SLA substantiates exactly the risks that DECLARED it as evidence', () => {
    const risks = buildRiskViews({
      ...QUIET_RISKS,
      slaStatuses: [{ targetId: 'exec-success-rate', status: 'breached', detail: 'success 82% < 90%' }],
    });
    const exec = risks.find((r) => r.id === 'risk-execution-degradation')!;
    expect(exec.substantiated).toBe(true);
    expect(exec.evidence.some((e) => e.kind === 'sla-target' && e.live)).toBe(true);
    expect(exec.detail).toContain('SUBSTANTIATED by live signals');
    expect(risks.find((r) => r.id === 'risk-automation-sprawl')!.substantiated).toBe(false);
  });

  it('open incidents in a declared domain and error-rule findings substantiate their risks', () => {
    const risks = buildRiskViews({
      ...QUIET_RISKS,
      incidentDomains: [{ domain: 'connectors', severity: 'critical' }],
      apFindings: [{ kind: 'error-rule', severity: 'high' }],
    });
    expect(risks.find((r) => r.id === 'risk-integration-outage')!.substantiated).toBe(true);
    expect(risks.find((r) => r.id === 'risk-automation-sprawl')!.substantiated).toBe(true);
    expect(risks.find((r) => r.id === 'risk-ungoverned-ai')!.substantiated).toBe(false);
  });

  it('unreadable signal sources degrade the EVIDENCE detail, never invent substantiation', () => {
    const risks = buildRiskViews({ slaStatuses: null, readiness: null, apFindings: null, incidentDomains: null });
    for (const r of risks) {
      expect(r.substantiated, r.id).toBe(false);
      expect(r.evidence.some((e) => e.detail.includes('unreadable'))).toBe(true);
    }
  });
});

describe('alignment — every unit accounted for, gaps declared', () => {
  it('a unit with department objectives aligns to its company objectives; one without is an honest gap', () => {
    const h = buildStrategyHealth(mkInput());
    const eng = h.alignment.find((a) => a.unitName === 'Engineering')!;
    expect(eng.aligned).toBe(true);
    expect(eng.companyObjectiveIds).toEqual(['co-reliable-execution']);
    const design = h.alignment.find((a) => a.unitName === 'Design')!;
    expect(design.aligned).toBe(false);
    expect(design.detail).toContain('alignment gap');
  });

  it('failures surface as unavailable entries on the view', () => {
    const h = buildStrategyHealth(mkInput({ failures: { 'p14-strategy': 'overview read failed' } }));
    expect(h.unavailable).toContainEqual({ system: 'p14-strategy', reason: 'overview read failed' });
  });
});
