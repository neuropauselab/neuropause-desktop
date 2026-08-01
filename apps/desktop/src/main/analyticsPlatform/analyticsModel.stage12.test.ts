/**
 * Phase 6 Stage 12 — the analytics model: the ten question resolvers, the
 * EIGHT-WAY resolver disjointness (S5 brief/worksummary + S6 + S7 + S8 + S9 +
 * S10 + S11 + S12, both directions), and the ten answers riding the existing
 * 'intelligence' report kind over a real composed context.
 */
import { describe, expect, it } from 'vitest';
import { EANA_QUESTION_KEYS } from '@neuropause/shared';
import { resolveInsightQuestion } from '../insight/insightModel';
import { resolveKnowledgeQuestion } from '../knowledgeAssets/knowledgeModel';
import { resolveAutomationQuestion } from '../automationPlatform/automationModel';
import { resolveOperationsQuestion } from '../operationsPlatform/operationsModel';
import { resolveStrategyQuestion } from '../strategyPlatform/strategyModel';
import { resolveFederationQuestion } from '../enterpriseFederation/federationModel';
import { resolveBriefRequest, resolveWorkSummary } from '../assistant/assistantModel';
import { buildDecisionReport } from './decisionAnalytics';
import { buildForecastInventory } from './forecastInventory';
import { buildKpiCatalog } from './kpiCatalog';
import { buildTrendReport } from './trendAnalytics';
import { composeAnalyticsDashboard, composeAnalyticsReport, type EanaDashboardInputs } from './executiveAnalytics';
import { answerAnalyticsQuestion, resolveAnalyticsQuestion, type AnalyticsQuestionContext } from './analyticsModel';

const NOW = '2026-08-01T09:00:00.000Z';

const EANA_CASES: [string, string][] = [
  ['Analytics status, please', 'analytics-status'],
  ['What do the numbers say?', 'analytics-status'],
  ['Show me the KPI catalog', 'kpi-catalog'],
  ['List our KPIs', 'kpi-catalog'],
  ['Who produces our KPIs?', 'kpi-catalog'],
  ['KPI health, please', 'kpi-health'],
  ['Which KPIs need attention?', 'kpi-health'],
  ['Show me our trends', 'trends'],
  ['Which KPIs are regressing?', 'regressions'],
  ['What is getting worse?', 'regressions'],
  ['What can the platform predict?', 'forecast-capability'],
  ['Do we have forecasts?', 'forecast-capability'],
  ['Decision intelligence, please', 'decision-intelligence'],
  ['Show the outcome loop', 'decision-intelligence'],
  ['What is our benchmark position?', 'benchmark-position'],
  ['How do we compare?', 'benchmark-position'],
  ['What data coverage do we have?', 'data-coverage'],
  ['What data do we record?', 'data-coverage'],
  ['Prepare the analytics report', 'analytics-report'],
  ['Executive analytics, please', 'analytics-report'],
];

describe('resolveAnalyticsQuestion — the ten questions', () => {
  it('matches each phrasing to its key', () => {
    for (const [text, key] of EANA_CASES) expect(resolveAnalyticsQuestion(text), text).toBe(key);
  });

  it('every published question key is reachable', () => {
    const reached = new Set(EANA_CASES.map(([, k]) => k));
    for (const k of EANA_QUESTION_KEYS) expect(reached.has(k), k).toBe(true);
  });

  it('returns null for non-analytics asks', () => {
    for (const text of ['draft an email', 'Which objectives are at risk?', 'Federation status, please', 'Are we meeting our SLAs?', '']) {
      expect(resolveAnalyticsQuestion(text), text).toBeNull();
    }
  });
});

describe('EIGHT-WAY resolver disjointness (both directions)', () => {
  const OTHERS: [string, (t: string) => unknown][] = [
    ['S5-brief', (t) => resolveBriefRequest(t)],
    ['S5-worksummary', (t) => (resolveWorkSummary(t) ? 'ws' : null)],
    ['S6-insight', (t) => resolveInsightQuestion(t)],
    ['S7-knowledge', (t) => resolveKnowledgeQuestion(t)],
    ['S8-automation', (t) => resolveAutomationQuestion(t)],
    ['S9-operations', (t) => resolveOperationsQuestion(t)],
    ['S10-strategy', (t) => resolveStrategyQuestion(t)],
    ['S11-federation', (t) => resolveFederationQuestion(t)],
  ];

  it('every analytics phrasing resolves through NO earlier stage', () => {
    for (const [text] of EANA_CASES) {
      for (const [label, resolve] of OTHERS) {
        expect(resolve(text), `${label} must not match "${text}"`).toBeFalsy();
      }
    }
  });

  it('every earlier stage keeps its canonical questions — the analytics resolver stays silent on them', () => {
    const CANONICAL = [
      'morning brief', // S5
      'Summarize the current enterprise health', // S6
      "What risks do you predict?", // S6 (prediction stays with insight)
      'What is our deployment policy?', // S7
      'What is the status of my automations?', // S8
      'Are we meeting our SLAs?', // S9
      'Capacity status, please', // S9 (capacity stays with operations)
      'Which objectives are at risk?', // S10
      'Prepare the board brief', // S10
      'Which business capability is weakest?', // S10
      'Federation status, please', // S11
      'Intelligence network posture?', // S11 (network stays with federation)
      'Which partners do we trust?', // S11
    ];
    for (const text of CANONICAL) expect(resolveAnalyticsQuestion(text), text).toBeNull();
  });
});

/* ── answers over a real composed context ─────────────────────────────────── */

function mkCtx(): AnalyticsQuestionContext {
  const kpis = buildKpiCatalog({
    nowIso: NOW,
    executive: [{ key: 'org-health', label: 'Org health', display: '82/100', value: 82, band: 'healthy' }],
    process: [],
    p14: [],
    p18: [],
    failures: {},
  });
  const trends = buildTrendReport({
    nowIso: NOW,
    history: [
      { day: '2026-07-01', overall: 80, engineering: 70 },
      { day: '2026-07-30', overall: 72, engineering: 70 },
    ],
    valueDeltas: [],
    failures: {},
  });
  const forecasts = buildForecastInventory({
    nowIso: NOW,
    predictions: [{ kind: 'connector-instability', likelihood: 0.7 }],
    simulation: { scenarios: 2 },
    capacityPressure: 'low',
    failures: {},
  });
  const decisions = buildDecisionReport({
    nowIso: NOW,
    decisions: [{ id: 'd1', status: 'approved', fromRecommendationId: 'rec-1' }],
    outcomes: [{ id: 'rec-1', stage: 'verified' }],
    valueTotals: { delivered: 1, partial: 0, notYetObserved: 0, unmeasurable: 0 },
    strategyRecs: { count: 1, criticalOrHigh: 0 },
    federationRecs: null,
    failures: {},
  });
  const inputs: EanaDashboardInputs = {
    nowIso: NOW,
    kpis,
    trends,
    forecasts,
    decisions,
    domains: [{ stage: 's8', label: 'Automation (Stage 8)', state: 'steady', summary: '0 critical/high of 0 monitor finding(s)' }],
    benchmarks: null,
  };
  return {
    kpis,
    trends,
    forecasts,
    decisions,
    dashboard: composeAnalyticsDashboard(inputs),
    report: composeAnalyticsReport(inputs),
    nowIso: NOW,
  };
}

describe('answerAnalyticsQuestion — evidence-cited, honest empty states', () => {
  it("every answer rides the existing 'intelligence' report kind, grounded, with sections", () => {
    const ctx = mkCtx();
    for (const key of EANA_QUESTION_KEYS) {
      const r = answerAnalyticsQuestion(key, ctx);
      expect(r.kind, key).toBe('intelligence');
      expect(r.grounded, key).toBe(true);
      expect(r.sections.length, key).toBeGreaterThan(0);
    }
  });

  it('analytics-status composes the dashboard totals and carries the domain rollups + a disclosure', () => {
    const r = answerAnalyticsQuestion('analytics-status', mkCtx());
    expect(r.title).toContain("the platform’s own producers");
    const answer = r.sections.find((s) => s.title === 'Answer')!;
    expect(answer.lines[0]).toContain('1 catalogued');
    expect(r.sections.find((s) => s.title === 'Domains')!.lines[0]).toContain('Automation (Stage 8)');
    expect(r.sections.find((s) => s.title === 'Uncertainty')).toBeTruthy();
  });

  it('kpi-catalog names the producer on every row', () => {
    const r = answerAnalyticsQuestion('kpi-catalog', mkCtx());
    expect(r.sections.find((s) => s.title === 'Answer')!.lines[0]).toContain('producer executive-core');
  });

  it('regressions cites the recorded delta — measured, not asserted', () => {
    const r = answerAnalyticsQuestion('regressions', mkCtx());
    expect(r.sections.find((s) => s.title === 'Answer')!.lines[0]).toContain('80 → 72');
  });

  it('forecast-capability states CAN and CANNOT for every entry and lists what fires now', () => {
    const r = answerAnalyticsQuestion('forecast-capability', mkCtx());
    const answer = r.sections.find((s) => s.title === 'Answer')!;
    expect(answer.lines).toHaveLength(9);
    for (const line of answer.lines) expect(line).toContain('CANNOT');
    expect(r.sections.find((s) => s.title === 'Firing now')!.lines[0]).toContain('connector-instability');
  });

  it('benchmark-position with no P18 read declares it — never defaulted', () => {
    const r = answerAnalyticsQuestion('benchmark-position', mkCtx());
    expect(r.sections.find((s) => s.title === 'Answer')!.lines[0]).toContain('unreadable this pass');
  });

  it('data-coverage separates recorded windows from point-in-time compositions', () => {
    const r = answerAnalyticsQuestion('data-coverage', mkCtx());
    const lines = r.sections.find((s) => s.title === 'Answer')!.lines;
    expect(lines.some((l) => l.includes('recorded ('))).toBe(true);
    expect(lines.some((l) => l.includes('point-in-time composition — no recorded series'))).toBe(true);
  });

  it('analytics-report returns the composed executive report verbatim', () => {
    const ctx = mkCtx();
    const r = answerAnalyticsQuestion('analytics-report', ctx);
    expect(r.title).toBe(ctx.report.title);
    expect(r.sections.map((s) => s.title)).toEqual(ctx.report.sections.map((s) => s.title));
  });
});
