/**
 * Phase 6 Stage 6 — the Hub Executive intelligence tile projection, plus the
 * additive deep-link/source-label rows for the insight delivery sources.
 */
import { describe, expect, it } from 'vitest';
import type { InsightDashboard } from '@neuropause/shared';
import { insightTile, sectionForDeepLink, sourceLabel } from './hubModel';

const CONF = { dataAvailability: 1, signalQuality: 0.9, historicalCoverage: 0.4, correlationStrength: 0.6, overall: 0.78 };

function dashboard(over: Partial<InsightDashboard> = {}): InsightDashboard {
  return {
    generatedAt: '2026-07-31T12:00:00.000Z',
    health: { domains: [], overall: 81, band: 'healthy', confidence: CONF, generatedAt: '2026-07-31T12:00:00.000Z' },
    activeIncidents: [],
    predictions: [],
    recommendations: [],
    trend: [],
    signals: [
      { id: 'a', available: true, itemCount: 1, latestAt: null, freshness: 'fresh', completeness: 1, note: null },
      { id: 'b', available: true, itemCount: 2, latestAt: null, freshness: 'fresh', completeness: 1, note: null },
      { id: 'c', available: false, itemCount: null, latestAt: null, freshness: 'unknown', completeness: 0, note: 'x' },
    ],
    dependencies: { nodes: [], edges: [] },
    recentlyVerified: [{ id: 'r1', title: 'Fixed', at: '2026-07-31T11:00:00.000Z' }],
    confidence: CONF,
    unavailable: [],
    ...over,
  };
}

describe('insightTile', () => {
  it('projects health, counts, signals, and the top recommendation', () => {
    const t = insightTile(
      dashboard({
        recommendations: [
          {
            id: 'reco:x',
            category: 'incident',
            title: 'Fix Slack connector',
            detail: '',
            priority: 'critical',
            confidence: CONF,
            evidence: [],
            signals: [],
            suggestedAction: '',
            correlationId: 'ins_x',
            outcome: { stage: 'recommended', steps: [] },
          },
        ],
        activeIncidents: [
          { id: 'i1', title: 'x', severity: 'critical', startTs: 0, endTs: 0, eventIds: [], resourceIds: [], rootCauseLabel: null, rootCauseConfidence: 0, blastRadius: 1, recommendedActions: [] },
        ],
      }),
    );
    expect(t).toMatchObject({
      healthText: '81/100 (healthy)',
      tone: 'ok',
      openIncidents: 1,
      predictions: 0,
      topRecommendation: 'Fix Slack connector',
      recentlyVerified: 1,
      signalsText: '2/3 signals',
      confidencePct: 78,
    });
  });

  it('unknown health renders the honest unavailable text with a muted tone', () => {
    const t = insightTile(
      dashboard({ health: { domains: [], overall: null, band: 'unknown', confidence: CONF, generatedAt: 'x' } }),
    );
    expect(t.healthText).toBe('unavailable');
    expect(t.tone).toBe('muted');
    expect(t.topRecommendation).toBeNull();
  });
});

describe('insight deep links + source labels (additive rows)', () => {
  it("routes the insight deepLink to the existing 'intelligence' section", () => {
    expect(sectionForDeepLink('intelligence')).toBe('intelligence');
  });

  it('labels both new delivery sources', () => {
    expect(sourceLabel('insight-monitor')).toBe('Intelligence Monitor');
    expect(sourceLabel('insight-risk-trend')).toBe('Risk Trend');
  });
});
