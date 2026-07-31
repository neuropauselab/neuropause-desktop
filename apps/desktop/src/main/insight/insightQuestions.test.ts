/**
 * Phase 6 Stage 6 — the ten enterprise questions: the deterministic matcher
 * recognizes each canonical phrasing (and rejects unrelated text), and every
 * answer follows the 6.10 contract — answer, evidence, confidence,
 * assumptions/unavailability, suggested action — including the honest misses
 * ("no revenue signal connected", "not enough evidence").
 */
import { describe, expect, it } from 'vitest';
import type { InsightQuestionKey, InsightReport, RootCauseReport } from '@neuropause/shared';
import { answerInsightQuestion, resolveInsightQuestion, type QuestionContext } from './insightModel';

const NOW_ISO = '2026-07-31T12:00:00.000Z';

describe('resolveInsightQuestion — the ten canonical phrasings', () => {
  const CASES: [string, InsightQuestionKey][] = [
    ['Why did sales decrease?', 'why-sales-decreased'],
    ['why has revenue dropped this month', 'why-sales-decreased'],
    ['Which projects are most at risk?', 'projects-at-risk'],
    ['What changed in the enterprise today?', 'what-changed-today'],
    ['what changed today', 'what-changed-today'],
    ['Which teams require attention?', 'teams-need-attention'],
    ['Show me operational anomalies', 'operational-anomalies'],
    ["Explain yesterday's failures", 'yesterdays-failures'],
    ['Which workflows repeatedly fail?', 'workflows-failing'],
    ['Which approvals are blocking delivery?', 'blocking-approvals'],
    ["Predict next week's risks", 'predict-next-week'],
    ['Summarize the current enterprise health', 'enterprise-health-summary'],
  ];
  it.each(CASES)('resolves “%s”', (text, key) => {
    expect(resolveInsightQuestion(text)).toBe(key);
  });

  it('unrelated requests do not match (no false positives)', () => {
    for (const text of [
      'draft an email to the team',
      'plan my day',
      'add a task to send the deck tomorrow',
      'find overdue invoices',
      'what is the weather',
    ]) {
      expect(resolveInsightQuestion(text)).toBeNull();
    }
  });
});

/* ── answer contract ───────────────────────────────────────────────────────── */

function emptyReport(): InsightReport {
  const conf = { dataAvailability: 0.8, signalQuality: 0.8, historicalCoverage: 0.2, correlationStrength: 0.4, overall: 0.6 };
  return {
    generatedAt: NOW_ISO,
    signals: [],
    graph: { nodes: 0, edges: 0, byDomain: {}, crossDomainEdges: 0, projectedNodes: 0, projectedEdges: 0, projectedEvents: 0 },
    incidents: [],
    health: { domains: [], overall: null, band: 'unknown', confidence: conf, generatedAt: NOW_ISO },
    predictions: [],
    recommendations: [],
    dependencies: { nodes: [], edges: [] },
    confidence: conf,
    unavailable: [],
  };
}

function ctx(over: Partial<QuestionContext>): QuestionContext {
  const emptyRc: RootCauseReport = { symptom: null, candidates: [], confidence: 0, builtAt: NOW_ISO };
  return {
    report: emptyReport(),
    engine: {} as QuestionContext['engine'],
    rootCause: () => emptyRc,
    changedToday: [],
    yesterdayFailures: [],
    revenueSignal: { connected: false, nodes: 0 },
    nowIso: NOW_ISO,
    ...over,
  };
}

describe('answerInsightQuestion — honest misses', () => {
  it('sales question without a revenue signal says so plainly (grounded:false, no invented cause)', () => {
    const r = answerInsightQuestion('why-sales-decreased', ctx({}));
    expect(r.kind).toBe('intelligence');
    expect(r.grounded).toBe(false);
    expect(r.sections[0].lines[0]).toContain('No revenue signal is connected');
    expect(JSON.stringify(r.sections)).not.toContain('Probable causes');
  });

  it('predictions question with no firing heuristics states that none are projected', () => {
    const r = answerInsightQuestion('predict-next-week', ctx({}));
    expect(r.sections[0].lines[0]).toContain('No prediction heuristic has enough evidence');
    expect(r.grounded).toBe(true); // an honest empty projection is still a grounded answer
  });

  it('health summary with nothing available says the enterprise cannot be scored', () => {
    const r = answerInsightQuestion('enterprise-health-summary', ctx({}));
    expect(r.grounded).toBe(false);
    expect(r.sections[0].lines[0]).toContain('cannot be scored');
  });

  it('yesterday with no failures reports zero without inventing causes', () => {
    const r = answerInsightQuestion('yesterdays-failures', ctx({}));
    expect(r.sections[0].lines[0]).toContain('No failure events were recorded yesterday');
  });
});

describe('answerInsightQuestion — evidence-cited answers', () => {
  it('sales question WITH revenue signal ranks root-cause candidates with confidence', () => {
    const rc: RootCauseReport = {
      symptom: { eventId: 'e9', resourceId: 'erp:inv-1', label: 'Invoice sync failed' },
      candidates: [
        { eventId: 'e1', resourceId: 'ops:connector:m365', label: 'M365 connector error', hopDistance: 1, score: 0.8, confidence: 0.9, reason: 'upstream dependency (1 hop)' },
      ],
      confidence: 0.75,
      builtAt: NOW_ISO,
    };
    const r = answerInsightQuestion('why-sales-decreased', ctx({ revenueSignal: { connected: true, nodes: 12 }, rootCause: () => rc }));
    expect(r.grounded).toBe(true);
    const all = JSON.stringify(r.sections);
    expect(all).toContain('M365 connector error');
    expect(all).toContain('upstream dependency (1 hop)');
    expect(all).toContain('e1'); // evidence id cited
    expect(all).toContain('never a single asserted cause');
    expect(all).toContain('Suggested action');
  });

  it('what-changed-today lists the timeline delta with timestamps', () => {
    const r = answerInsightQuestion(
      'what-changed-today',
      ctx({
        changedToday: [
          { type: 'worker.job_succeeded', label: 'Researcher run', at: `${NOW_ISO.slice(0, 11)}09:15:00.000Z` },
          { type: 'connector.sync_completed', label: 'Slack', at: `${NOW_ISO.slice(0, 11)}08:00:00.000Z` },
        ],
      }),
    );
    expect(r.grounded).toBe(true);
    expect(r.sections[0].lines[0]).toContain('2 tracked change(s)');
    expect(r.sections[1].lines[0]).toContain('09:15');
  });

  it('every answer carries a confidence section with the four-axis breakdown', () => {
    const keys: InsightQuestionKey[] = [
      'projects-at-risk',
      'teams-need-attention',
      'operational-anomalies',
      'workflows-failing',
      'blocking-approvals',
      'predict-next-week',
      'enterprise-health-summary',
    ];
    for (const key of keys) {
      const r = answerInsightQuestion(key, ctx({}));
      const conf = r.sections.find((s) => s.title.toLowerCase().includes('confidence'));
      expect(conf, key).toBeTruthy();
      expect(JSON.stringify(conf), key).toContain('data availability');
    }
  });
});
