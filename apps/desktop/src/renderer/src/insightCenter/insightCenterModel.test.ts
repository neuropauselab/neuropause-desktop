/**
 * Phase 6 Stage 6 — the Intelligence Center's pure view-model: tone mapping,
 * explained domain rows, the honest signal strip (problems first), outcome
 * badges, the dependency explanation walk, the trend spark, and the header.
 */
import { describe, expect, it } from 'vitest';
import type {
  ConfidenceBreakdown,
  InsightDashboard,
  InsightDependencyGraph,
  InsightHealthFramework,
  SignalRuntimeStatus,
} from '@neuropause/shared';
import {
  confidenceLine,
  dashboardHeader,
  domainRows,
  explainRecommendation,
  insightBandTone,
  outcomeBadge,
  predictionRows,
  recommendationRows,
  signalRows,
  signalSummary,
  trendModel,
} from './insightCenterModel';

const CONF: ConfidenceBreakdown = {
  dataAvailability: 0.75,
  signalQuality: 0.82,
  historicalCoverage: 0.33,
  correlationStrength: 0.55,
  overall: 0.68,
};

const HEALTH: InsightHealthFramework = {
  domains: [
    { key: 'organization', label: 'Organization', score: 78, band: 'healthy', explanation: ['Composed from the org model.'], evidence: ['orgHealth.overall=78'], confidence: 0.8, signals: ['org-health'], unavailable: null },
    { key: 'approvals', label: 'Approvals', score: 42, band: 'at-risk', explanation: ['6 approvals parked.'], evidence: ['approvals.pending=6'], confidence: 0.5, signals: ['workforce-jobs'], unavailable: null },
    { key: 'projects', label: 'Projects', score: null, band: 'unknown', explanation: ['Unavailable: no project entities synced'], evidence: [], confidence: 0, signals: ['work-entities'], unavailable: 'no project entities synced' },
  ],
  overall: 60,
  band: 'watch',
  confidence: CONF,
  generatedAt: '2026-07-31T12:00:00.000Z',
};

describe('tones + confidence line', () => {
  it('maps bands to the ops palette; unknown → gray', () => {
    expect(insightBandTone('healthy')).toBe('green');
    expect(insightBandTone('watch')).toBe('orange');
    expect(insightBandTone('at-risk')).toBe('red');
    expect(insightBandTone('critical')).toBe('red');
    expect(insightBandTone('unknown')).toBe('gray');
  });

  it('renders the four-axis breakdown', () => {
    expect(confidenceLine(CONF)).toBe('data 75% · quality 82% · history 33% · correlation 55%');
  });
});

describe('domainRows', () => {
  it('renders scores, low-confidence flags, and unavailable reasons honestly', () => {
    const rows = domainRows(HEALTH);
    expect(rows[0]).toMatchObject({ key: 'organization', scoreText: '78/100', tone: 'green', lowConfidence: false });
    expect(rows[1]).toMatchObject({ key: 'approvals', scoreText: '42/100', tone: 'red', lowConfidence: true, confidencePct: 50 });
    expect(rows[2]).toMatchObject({ key: 'projects', scoreText: '—', tone: 'gray', unavailable: 'no project entities synced', lowConfidence: false });
  });
});

describe('signal strip', () => {
  const SIGNALS: SignalRuntimeStatus[] = [
    { id: 'work-entities', available: true, itemCount: 500, latestAt: null, freshness: 'fresh', completeness: 1, note: null },
    { id: 'connector-health', available: true, itemCount: 3, latestAt: null, freshness: 'stale', completeness: 0.5, note: null },
    { id: 'workforce-jobs', available: false, itemCount: null, latestAt: null, freshness: 'unknown', completeness: 0, note: 'store offline' },
  ];

  it('summary counts availability + staleness', () => {
    expect(signalSummary(SIGNALS)).toEqual({ available: 2, total: 3, stale: 1, unavailableIds: ['workforce-jobs'] });
  });

  it('rows sort problems first: unavailable → stale → fresh', () => {
    const rows = signalRows(SIGNALS);
    expect(rows.map((r) => r.id)).toEqual(['workforce-jobs', 'connector-health', 'work-entities']);
    expect(rows[0]).toMatchObject({ statusText: 'unavailable', tone: 'red', note: 'store offline' });
    expect(rows[1].statusText).toContain('stale');
    expect(rows[2].statusText).toContain('fresh · 500 record(s)');
  });
});

describe('outcome badges + recommendation rows', () => {
  it('badges each lifecycle stage', () => {
    expect(outcomeBadge('recommended')).toEqual({ label: 'Recommended', tone: 'gray' });
    expect(outcomeBadge('approved')).toEqual({ label: 'Approved', tone: 'blue' });
    expect(outcomeBadge('executed')).toEqual({ label: 'Executed', tone: 'blue' });
    expect(outcomeBadge('verified')).toEqual({ label: 'Verified', tone: 'green' });
  });

  it('rows carry priority tone, confidence detail, evidence, and outcome steps', () => {
    const rows = recommendationRows([
      {
        id: 'reco:x',
        category: 'incident',
        title: 'Fix Slack connector',
        detail: 'It is down.',
        priority: 'critical',
        confidence: CONF,
        evidence: ['connector:slack:a1'],
        signals: ['connector-health'],
        suggestedAction: 'Re-authenticate Slack.',
        correlationId: 'ins_reco_x',
        outcome: {
          stage: 'approved',
          steps: [
            { stage: 'recommended', at: 't0', evidence: { kind: 'recommendation', id: 'reco:x' }, detail: 'produced' },
            { stage: 'approved', at: 't1', evidence: { kind: 'decision', id: 'dec:1' }, detail: 'decision accepted' },
          ],
        },
      },
    ]);
    expect(rows[0]).toMatchObject({ tone: 'red', confidencePct: 68, action: 'Re-authenticate Slack.' });
    expect(rows[0].outcome).toEqual({ label: 'Approved', tone: 'blue' });
    expect(rows[0].outcomeSteps.map((s) => s.stage)).toEqual(['recommended', 'approved']);
    expect(rows[0].evidence).toEqual(['connector:slack:a1']);
  });
});

describe('explainRecommendation (dependency walk)', () => {
  const GRAPH: InsightDependencyGraph = {
    nodes: [
      { id: 'signal:connector-health', kind: 'signal', label: 'Connector health & sync state' },
      { id: 'finding:incident:c1', kind: 'finding', label: 'Critical incident — Slack' },
      { id: 'recommendation:reco:x', kind: 'recommendation', label: 'Fix Slack connector' },
    ],
    edges: [
      { from: 'signal:connector-health', to: 'finding:incident:c1', relation: 'evidence-of' },
      { from: 'finding:incident:c1', to: 'recommendation:reco:x', relation: 'derived-from' },
      { from: 'signal:connector-health', to: 'recommendation:reco:x', relation: 'evidence-of' },
    ],
  };

  it('walks signals → findings → recommendation in order', () => {
    const lines = explainRecommendation(GRAPH, 'reco:x');
    expect(lines.map((l) => l.kind)).toEqual(['signal', 'finding', 'recommendation']);
    expect(lines[0].label).toBe('Connector health & sync state');
    expect(lines[2].label).toBe('Fix Slack connector');
  });

  it('an unknown recommendation yields an empty explanation (nothing invented)', () => {
    expect(explainRecommendation(GRAPH, 'reco:nope')).toEqual([]);
  });
});

describe('trend + header', () => {
  it('normalizes trend points and reports the window delta', () => {
    const t = trendModel([
      { day: '2026-07-29', overall: 70 },
      { day: '2026-07-30', overall: 74 },
      { day: '2026-07-31', overall: 78 },
    ]);
    expect(t.points).toHaveLength(3);
    expect(t.points[2].y01).toBeCloseTo(0.78, 5);
    expect(t.deltaText).toBe('+8');
    expect(trendModel([])).toEqual({ points: [], deltaText: null });
  });

  it('header composes health, confidence, signals, and unavailability', () => {
    const dash: InsightDashboard = {
      generatedAt: '2026-07-31T12:00:00.000Z',
      health: HEALTH,
      activeIncidents: [],
      predictions: [],
      recommendations: [],
      trend: [],
      signals: [
        { id: 'a', available: true, itemCount: 1, latestAt: null, freshness: 'fresh', completeness: 1, note: null },
        { id: 'b', available: false, itemCount: null, latestAt: null, freshness: 'unknown', completeness: 0, note: 'x' },
      ],
      dependencies: { nodes: [], edges: [] },
      recentlyVerified: [],
      confidence: CONF,
      unavailable: [{ system: 'b', reason: 'x' }],
    };
    const h = dashboardHeader(dash);
    expect(h).toMatchObject({ healthText: '60/100', band: 'watch', tone: 'orange', confidencePct: 68, unavailableCount: 1 });
    expect(h.signals).toEqual({ available: 1, total: 2, stale: 0, unavailableIds: ['b'] });
  });

  it('prediction rows expose likelihood, horizon, basis, and evidence counts', () => {
    const rows = predictionRows([
      {
        id: 'pred:risk-trend',
        kind: 'risk-trend',
        title: 'Risk rising',
        detail: 'Health fell 8 points.',
        horizonDays: 7,
        likelihood: 0.62,
        confidence: CONF,
        evidence: ['health:2026-07-30', 'health:2026-07-31'],
        basis: 'Health history decline.',
        suggestedAction: 'Review incidents.',
        signals: ['org-health'],
      },
    ]);
    expect(rows[0]).toMatchObject({ likelihoodPct: 62, horizonText: '7d', evidenceCount: 2, confidencePct: 68 });
  });
});
