/**
 * Phase 6 Stage 10 — the Enterprise tab's pure view-model (lives beside the
 * Strategy Center tests so the existing strategyCenter/** vitest glob runs it;
 * the model itself lives in ../strategyPlatform). Total tone maps, header
 * stats, presentation rows that carry the composed honesty (gaps, ownership
 * misses, disclosures), and the deduped unavailability strip.
 */
import { describe, expect, it } from 'vitest';
import type { CapabilityMapView, ObjectivesReport, PlanningReport, StrategyDashboard, StrategyHealthView } from '@neuropause/shared';
import {
  alignmentRows,
  capabilityRows,
  estratHeaderStats,
  focusRows,
  healthTone,
  initiativeTone,
  objectiveRows,
  riskRows,
  unavailableLines,
  verdictTone,
} from '../strategyPlatform/estratPlatformModel';

describe('tone maps (total)', () => {
  it('objective health, initiative state, and value verdict all map to presentation tones', () => {
    expect(healthTone('on-track')).toBe('green');
    expect(healthTone('at-risk')).toBe('orange');
    expect(healthTone('off-track')).toBe('red');
    expect(healthTone('unknown')).toBe('gray');
    expect(initiativeTone('advancing')).toBe('green');
    expect(initiativeTone('blocked')).toBe('red');
    expect(initiativeTone('done')).toBe('blue');
    expect(verdictTone('delivered')).toBe('green');
    expect(verdictTone('unmeasurable')).toBe('gray');
  });
});

const DASH: StrategyDashboard = {
  generatedAt: 'now',
  objectives: { onTrack: 9, atRisk: 1, offTrack: 1, unknown: 0, company: 5, departments: 6 },
  portfolio: { advancing: 2, blocked: 1, stalled: 0, done: 3, unknown: 0 },
  value: { delivered: 1, partial: 2, notYetObserved: 1, unmeasurable: 0 },
  planning: { horizons: 3, focusItems: 4 },
  capabilities: { weakest: 'sales', unsupported: 8, lackingStandards: 3 },
  risks: { substantiated: 1, unsubstantiated: 4 },
  kpis: [],
  recommendations: [],
  disclosures: ['registry data', 'no currency'],
  unavailable: [],
};

describe('estratHeaderStats', () => {
  it('summarizes the six dimensions with honest hints (off-track → red, breach counts visible)', () => {
    const stats = estratHeaderStats(DASH);
    expect(stats).toHaveLength(6);
    expect(stats[0]).toMatchObject({ label: 'Objectives', value: '9/11', tone: 'red' });
    expect(stats[1].hint).toContain('1 blocked');
    expect(stats[2].hint).toContain('computed, never estimated');
    expect(stats[3].value).toBe('sales');
    expect(stats[4]).toMatchObject({ label: 'Risks', value: '1/5', tone: 'red' });
    expect(stats[5]).toMatchObject({ label: 'Focus', value: '4', tone: 'orange' });
  });

  it('an all-quiet dashboard reads green/none-weak', () => {
    const quiet: StrategyDashboard = {
      ...DASH,
      objectives: { onTrack: 11, atRisk: 0, offTrack: 0, unknown: 0, company: 5, departments: 6 },
      portfolio: { advancing: 0, blocked: 0, stalled: 0, done: 6, unknown: 0 },
      capabilities: { weakest: null, unsupported: 0, lackingStandards: 0 },
      risks: { substantiated: 0, unsubstantiated: 5 },
      planning: { horizons: 3, focusItems: 0 },
    };
    const stats = estratHeaderStats(quiet);
    expect(stats[0].tone).toBe('green');
    expect(stats[3].value).toBe('none weak');
    expect(stats[4].tone).toBe('green');
    expect(stats[5].tone).toBe('green');
  });
});

describe('rows carry the composed honesty', () => {
  it('objective rows: ownership gaps and unreadable measures stay visible', () => {
    const r: ObjectivesReport = {
      generatedAt: 'now',
      company: [
        {
          id: 'co-x',
          kind: 'company',
          label: 'X',
          description: '',
          themeId: null,
          horizon: 'current-quarter',
          owner: null,
          unitName: 'Operations',
          companyObjectiveId: null,
          capabilityKeys: ['operations'],
          measures: [{ kind: 'kpi', ref: 'org-health', reading: null, state: 'unknown', detail: 'KPI missing' }],
          health: 'unknown',
          healthDetail: 'no measure was readable',
          rollup: [],
        },
      ],
      departments: [],
      totals: { onTrack: 0, atRisk: 0, offTrack: 0, unknown: 1 },
      gaps: [],
      unavailable: [],
    };
    const rows = objectiveRows(r);
    expect(rows[0].ownerText).toBe('NO OWNER RESOLVED (gap)');
    expect(rows[0].measureText).toContain('org-health: unreadable');
    expect(rows[0].tone).toBe('gray');
  });

  it('capability rows: coverage, counts, gaps, and the operational-risk detail ride along', () => {
    const view: CapabilityMapView = {
      generatedAt: 'now',
      capabilities: [
        {
          key: 'sales',
          label: 'Sales',
          owner: null,
          condition: 'at-risk',
          conditionDetail: 'domain departments: at-risk',
          evidenceCoverage: 0.5,
          objectives: { total: 1, atRisk: 1 },
          initiatives: { total: 0, blocked: 0 },
          kpis: [],
          riskIds: ['risk-integration-outage'],
          decisionAttention: 2,
          standards: { matched: false, refs: [{ ref: 'sales', matched: false }] },
          operationalRisk: { findings: 1, breachedSlas: 0, detail: '1 of 2 declared signal(s) unhealthy' },
          gaps: ['no initiative supports this capability'],
        },
      ],
      weakest: { key: 'sales', detail: 'Sales: at-risk' },
      unsupported: ['sales'],
      investmentFocus: [{ key: 'sales', attention: 2 }],
      lackingStandards: ['sales'],
      highestOperationalRisk: null,
      disclosure: 'counts, never currency',
      unavailable: [],
    };
    const rows = capabilityRows(view);
    expect(rows[0].coverageText).toBe('evidence coverage 50%');
    expect(rows[0].countsText).toContain('1 objective(s) · 0 initiative(s) · attention 2');
    expect(rows[0].gapText).toContain('no initiative supports');
    expect(rows[0].ownerText).toBe('ownership gap');
  });

  it('risk + alignment rows keep the substantiation and gap language', () => {
    const health = {
      generatedAt: 'now',
      themes: [],
      layers: [],
      capabilities: {} as CapabilityMapView,
      risks: [
        {
          id: 'r1',
          label: 'R1',
          description: '',
          capabilityKeys: ['operations' as const],
          substantiated: false,
          evidence: [],
          detail: 'unsubstantiated — its evidencing signals are currently quiet (stated honestly, not escalated)',
        },
      ],
      alignment: [
        { unitName: 'Design', companyObjectiveIds: [], aligned: false, detail: 'no department objective binds this unit (gap)' },
      ],
      unavailable: [],
    } as unknown as StrategyHealthView;
    expect(riskRows(health)[0]).toMatchObject({ tone: 'green', substantiated: false });
    expect(alignmentRows(health)[0]).toMatchObject({ tone: 'orange', aligned: false });
  });

  it('focus rows flatten horizons and carry the full Principle-C line', () => {
    const p: PlanningReport = {
      generatedAt: 'now',
      horizons: [
        {
          horizon: 'current-quarter',
          label: 'Q3 2026',
          window: { fromIso: 'a', toIso: 'b' },
          objectiveIds: [],
          initiativeIds: [],
          focus: [
            {
              id: 'stratrec:objective:o:current-quarter',
              title: 'Objective off-track',
              detail: 'd',
              priority: 'critical',
              suggestedAction: 'Review.',
              evidence: ['e1', 'e2'],
              reasoning: 'r',
              confidence: 0.85,
              affectedSystems: ['operations'],
              operationalImpact: 'i',
              expectedBusinessOutcome: 'o',
              rollbackImplications: 'none — recommendation only',
            },
          ],
          summary: 's',
        },
      ],
      unavailable: [],
    };
    const rows = focusRows(p);
    expect(rows[0].horizonLabel).toBe('Q3 2026');
    expect(rows[0].tone).toBe('red');
    expect(rows[0].principleC).toContain('Rollback: none — recommendation only');
    expect(rows[0].principleC).toContain('confidence 85%');
    expect(rows[0].principleC).toContain('2 evidence ref(s)');
  });
});

describe('the unavailability strip', () => {
  it('dedupes identical system+reason lines across views', () => {
    const lines = unavailableLines([
      { unavailable: [{ system: 'sla-framework', reason: 'unreadable' }] },
      { unavailable: [{ system: 'sla-framework', reason: 'unreadable' }, { system: 'decisions', reason: 'store closed' }] },
    ]);
    expect(lines).toEqual(['sla-framework: unreadable', 'decisions: store closed']);
  });
});
