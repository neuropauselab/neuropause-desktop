/**
 * Phase 6 Stage 10 — the executive dashboard + board report: pure COMPOSITIONS
 * of the already-computed views. Recommendations dedupe by id across horizons,
 * unavailability dedupes by system, the disclosures ride every dashboard, and
 * the board report introduces no new facts.
 */
import { describe, expect, it } from 'vitest';
import { mkRecommendation } from '../operationsPlatform/operationsModel';
import { buildCapabilityMap, CAPABILITY_DISCLOSURE } from './capabilityMap';
import { VALUE_DISCLOSURE } from './businessOutcome';
import { buildRiskViews, buildStrategyHealth } from './strategyHealth';
import { composeBoardReport, composeStrategyDashboard, STRATEGY_DISCLOSURES, type DashboardInputs } from './executiveDashboard';
import type { BusinessValueReport, ObjectivesReport, PlanningReport, PortfolioReport } from '@neuropause/shared';

const NOW = '2026-07-31T12:00:00.000Z';

function rec(id: string) {
  return mkRecommendation({
    id,
    title: `T ${id}`,
    detail: 'detail',
    priority: 'high',
    suggestedAction: 'Review on the Strategy tab.',
    evidence: ['e1'],
    reasoning: 'computed from live measures',
    confidence: 0.8,
    affectedSystems: ['operations'],
    operationalImpact: 'impact',
    expectedBusinessOutcome: 'outcome',
    rollbackImplications: 'recommendation only',
  });
}

function objectives(): ObjectivesReport {
  return {
    generatedAt: NOW,
    company: [],
    departments: [],
    totals: { onTrack: 3, atRisk: 1, offTrack: 1, unknown: 0 },
    gaps: [],
    unavailable: [{ system: 'sla-framework', reason: 'unreadable' }],
  };
}

function portfolio(): PortfolioReport {
  return {
    generatedAt: NOW,
    initiatives: [],
    totals: { advancing: 2, blocked: 1, stalled: 0, done: 3, unknown: 0 },
    gaps: [],
    unavailable: [{ system: 'sla-framework', reason: 'unreadable' }], // duplicate system on purpose
  };
}

function value(): BusinessValueReport {
  return {
    generatedAt: NOW,
    decisions: [],
    totals: { delivered: 1, partial: 1, notYetObserved: 0, unmeasurable: 0 },
    disclosure: VALUE_DISCLOSURE,
    unavailable: [{ system: 'decisions', reason: 'store unreadable' }],
  };
}

function planning(): PlanningReport {
  return {
    generatedAt: NOW,
    horizons: [
      {
        horizon: 'current-quarter',
        label: 'Q3 2026',
        window: { fromIso: NOW, toIso: NOW },
        objectiveIds: [],
        initiativeIds: [],
        focus: [rec('stratrec:objective:a:current-quarter'), rec('stratrec:shared')],
        summary: 'Q3 2026: 2 focus item(s).',
      },
      {
        horizon: 'annual',
        label: '2026 (annual)',
        window: { fromIso: NOW, toIso: NOW },
        objectiveIds: [],
        initiativeIds: [],
        focus: [rec('stratrec:shared')], // duplicate id — must dedupe
        summary: '2026: 1 focus item(s).',
      },
    ],
    unavailable: [],
  };
}

function mkInputs(): DashboardInputs {
  const capabilities = buildCapabilityMap({
    nowIso: NOW,
    signals: { domains: null, kpis: null, s9Services: null, readiness: null, minedTypes: null, compliance: null, slaStatuses: null, apFindings: null, decisions: null },
    objectives: [],
    initiatives: [],
    units: null,
    users: null,
    knowledgeMatch: null,
    failures: {},
  });
  const health = buildStrategyHealth({
    nowIso: NOW,
    objectives: objectives(),
    capabilities,
    layers: { insightBand: null, knowledge: null, automation: null, operations: null, p14: null },
    risks: buildRiskViewsInput(),
    units: [],
    failures: {},
  });
  return {
    nowIso: NOW,
    objectives: objectives(),
    portfolio: portfolio(),
    value: value(),
    planning: planning(),
    capabilities,
    health,
    kpis: [{ key: 'org-health', label: 'Org health', display: '82', band: 'healthy' }],
  };
}

function buildRiskViewsInput() {
  return { slaStatuses: null, readiness: null, apFindings: null, incidentDomains: null };
}

describe('composeStrategyDashboard', () => {
  it('mirrors the computed totals and KPIs — no recomputation, no new facts', () => {
    const d = composeStrategyDashboard(mkInputs());
    expect(d.objectives).toMatchObject({ onTrack: 3, atRisk: 1, offTrack: 1, company: 0, departments: 0 });
    expect(d.portfolio.blocked).toBe(1);
    expect(d.value.delivered).toBe(1);
    expect(d.kpis).toEqual([{ key: 'org-health', label: 'Org health', display: '82', band: 'healthy' }]);
    expect(d.risks).toEqual({ substantiated: 0, unsubstantiated: 5 });
  });

  it('dedupes focus recommendations by id across horizons — and counts them once', () => {
    const d = composeStrategyDashboard(mkInputs());
    expect(d.recommendations.map((r) => r.id)).toEqual(['stratrec:objective:a:current-quarter', 'stratrec:shared']);
    expect(d.planning).toEqual({ horizons: 2, focusItems: 2 });
  });

  it('dedupes unavailability by system across all six views', () => {
    const d = composeStrategyDashboard(mkInputs());
    expect(d.unavailable.filter((u) => u.system === 'sla-framework')).toHaveLength(1);
    expect(d.unavailable.some((u) => u.system === 'decisions')).toBe(true);
  });

  it('always carries the three structural disclosures (registry data · no currency · attention counts)', () => {
    const d = composeStrategyDashboard(mkInputs());
    expect(d.disclosures).toEqual([...STRATEGY_DISCLOSURES]);
    expect(d.disclosures).toContain(VALUE_DISCLOSURE);
    expect(d.disclosures).toContain(CAPABILITY_DISCLOSURE);
  });
});

describe('composeBoardReport', () => {
  it('titles with the current-quarter label and sections the same computed views', () => {
    const b = composeBoardReport(mkInputs());
    expect(b.title).toContain('Q3 2026');
    expect(b.sections.map((s) => s.title)).toEqual([
      'Objectives',
      'Initiative portfolio',
      'Business value (computed, never estimated)',
      'Capabilities',
      'Strategic risks',
      'Executive focus (recommendations only — nothing executes from here)',
    ]);
  });

  it('states quiet risks and unjudged capabilities honestly instead of inventing severity', () => {
    const b = composeBoardReport(mkInputs());
    const risks = b.sections.find((s) => s.title === 'Strategic risks')!;
    expect(risks.lines[0]).toContain('No strategic risk is currently substantiated');
    const caps = b.sections.find((s) => s.title === 'Capabilities')!;
    expect(caps.lines[0]).toContain('No capability is judged weak');
  });

  it('surfaces the executive focus from the current quarter', () => {
    const b = composeBoardReport(mkInputs());
    const focus = b.sections.find((s) => s.title.startsWith('Executive focus'))!;
    expect(focus.lines).toHaveLength(2);
    expect(focus.lines[0]).toContain('HIGH');
  });
});

describe('buildRiskViews sanity for the dashboard risk count', () => {
  it('five registered risks ride the health view', () => {
    expect(buildRiskViews(buildRiskViewsInput())).toHaveLength(5);
  });
});
