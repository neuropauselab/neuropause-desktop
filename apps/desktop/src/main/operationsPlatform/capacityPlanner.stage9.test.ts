/**
 * Phase 6 Stage 9 — capacity composition: deterministic pressure from the
 * available inputs (unknown when nothing is readable — never assumed low),
 * bottlenecks pass through the existing detector's rows, and the ONLY
 * forecast is the reused Stage 6 prediction list filtered to capacity kinds.
 */
import { describe, expect, it } from 'vitest';
import type { InsightPrediction } from '@neuropause/shared';
import { buildCapacityView, composePressure, type CapacityInput } from './capacityPlanner';

const NOW_ISO = '2026-07-31T09:00:00.000Z';

function prediction(kind: InsightPrediction['kind'], id: string): InsightPrediction {
  return {
    id,
    kind,
    title: `t-${id}`,
    detail: 'd',
    horizonDays: 7,
    likelihood: 0.6,
    confidence: { dataAvailability: 1, signalQuality: 1, historicalCoverage: 1, correlationStrength: 1, overall: 1 },
    evidence: ['e1'],
    basis: 'threshold',
    suggestedAction: 'act',
    signals: ['s1'],
  } as InsightPrediction;
}

function input(over: Partial<CapacityInput> = {}): CapacityInput {
  return {
    nowIso: NOW_ISO,
    executions: { active: 1, queued: 2, successRate: 0.95 },
    workforce: { queueDepth: 3, awaitingApproval: 2 },
    automation: { running: 1, failed: 0, paused: 0 },
    bottlenecks: [],
    predictions: [],
    failures: {},
    ...over,
  };
}

describe('composePressure', () => {
  it('normal ranges → low, with the honest all-clear detail', () => {
    const p = composePressure(input());
    expect(p.pressure).toBe('low');
    expect(p.detail).toContain('normal ranges');
  });

  it('nothing readable → unknown, never assumed low', () => {
    const p = composePressure(input({ executions: null, workforce: null, automation: null }));
    expect(p.pressure).toBe('unknown');
    expect(p.detail).toContain('not assumed low');
  });

  it('one mild signal stays low; two points reach elevated; stacked signals reach high', () => {
    // One mild signal (queue 26–50) scores 1 → still low: a single soft signal never pages.
    expect(composePressure(input({ workforce: { queueDepth: 30, awaitingApproval: 2 } })).pressure).toBe('low');
    // A deep queue alone scores 2 → elevated.
    expect(composePressure(input({ workforce: { queueDepth: 60, awaitingApproval: 2 } })).pressure).toBe('elevated');
    const high = composePressure(
      input({
        workforce: { queueDepth: 60, awaitingApproval: 30 }, // 2 + 1
        executions: { active: 5, queued: 25, successRate: 0.5 }, // 1 + 1
      }),
    );
    expect(high.pressure).toBe('high');
    expect(high.detail).toContain('queue depth 60');
  });

  it('bottlenecks add pressure (1 for a few, 2 for three or more)', () => {
    const b = { scope: 'worker', key: 'w1', kind: 'failure-rate', reason: 'r', value: 0.6, sampleSize: 10 };
    expect(composePressure(input({ bottlenecks: [b, b, b] })).pressure).toBe('elevated'); // 2 points
    // 1 (queue>25) + 2 (≥3 bottlenecks) = 3 → still elevated…
    expect(composePressure(input({ workforce: { queueDepth: 30, awaitingApproval: 2 }, bottlenecks: [b, b, b] })).pressure).toBe('elevated');
    // …and one more signal (parked approvals > 25) crosses into high (score 4).
    expect(composePressure(input({ workforce: { queueDepth: 30, awaitingApproval: 30 }, bottlenecks: [b, b, b] })).pressure).toBe('high');
  });
});

describe('buildCapacityView', () => {
  it('passes bottleneck rows through and filters the forecast to capacity kinds only', () => {
    const v = buildCapacityView(
      input({
        bottlenecks: [{ scope: 'skill', key: 's1', kind: 'backlog', reason: 'queue deep', value: 9, sampleSize: 9 }],
        predictions: [
          prediction('approval-backlog', 'p1'),
          prediction('project-delay', 'p2'),
          prediction('connector-instability', 'p3'),
          prediction('knowledge-staleness' as InsightPrediction['kind'], 'p4'), // non-capacity kind
        ],
      }),
    );
    expect(v.bottlenecks).toHaveLength(1);
    expect(v.forecast.map((f) => f.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('null reads surface as nulls + unavailable, never zeros', () => {
    const v = buildCapacityView(input({ executions: null, failures: { executions: 'engine offline' } }));
    expect(v.executions).toBeNull();
    expect(v.unavailable).toContainEqual({ system: 'executions', reason: 'engine offline' });
  });
});
