/**
 * Phase 6 Stage 9 — the SLA framework: target-vs-measured math per metric,
 * both comparators, and the two honesty paths — DECLARED unmeasurable
 * (measuredBy null: no aggregate exists) and source-empty unmeasurable (the
 * aggregate exists but has no value yet — never assumed met).
 */
import { describe, expect, it } from 'vitest';
import { buildSlaReport, measureTarget, type SlaMeasurements } from './slaFramework';
import { SLA_BY_ID } from './operationsRegistry';

const NOW_ISO = '2026-07-31T09:00:00.000Z';

function measurements(over: Partial<SlaMeasurements> = {}): SlaMeasurements {
  return {
    executions: { successRate: 0.95, averageRuntimeMs: 30_000 },
    workforce: { queueDepth: 5, oldestApprovalHours: 3 },
    automation: { completed: 18, failed: 2 },
    connectors: { configured: 4, healthy: 4 },
    aiState: 'ready',
    ...over,
  };
}

describe('measureTarget', () => {
  it('reads each metric from its EXISTING aggregate', () => {
    const m = measurements();
    expect(measureTarget(SLA_BY_ID.get('exec-success-rate')!, m)).toEqual({ value: 0.95, source: 'execution-stats' });
    expect(measureTarget(SLA_BY_ID.get('exec-avg-runtime')!, m)).toEqual({ value: 30_000, source: 'execution-stats' });
    expect(measureTarget(SLA_BY_ID.get('jobs-queue-depth')!, m)).toEqual({ value: 5, source: 'job-store' });
    expect(measureTarget(SLA_BY_ID.get('approval-age')!, m)).toEqual({ value: 3, source: 'job-store' });
    expect(measureTarget(SLA_BY_ID.get('automation-failure-ratio')!, m)).toEqual({ value: 0.1, source: 'automation-monitor' });
    expect(measureTarget(SLA_BY_ID.get('connector-healthy-ratio')!, m)).toEqual({ value: 1, source: 'connector-service' });
    expect(measureTarget(SLA_BY_ID.get('ai-engine-ready')!, m)).toEqual({ value: 1, source: 'engine-manager' });
  });

  it('a measuredBy:null target measures to null — the DECLARED path (no source exists)', () => {
    expect(measureTarget(SLA_BY_ID.get('assistant-response-latency')!, measurements())).toBeNull();
    expect(measureTarget(SLA_BY_ID.get('notification-latency')!, measurements())).toBeNull();
  });
});

describe('buildSlaReport — met / breached / unmeasurable, honestly', () => {
  it('healthy measurements meet the seven measurable targets; the two declared stay unmeasurable', () => {
    const r = buildSlaReport({ nowIso: NOW_ISO, measurements: measurements(), failures: {} });
    expect(r.totals).toEqual({ targets: 9, met: 7, breached: 0, unmeasurable: 2 });
    const declared = r.statuses.filter((s) => s.status === 'unmeasurable');
    for (const s of declared) {
      expect(s.measured).toBeNull();
      expect(s.detail).toContain('DECLARED unmeasurable');
      expect(s.detail).toContain('not estimated');
    }
  });

  it('breaches: gte-comparator below target and lte-comparator above target', () => {
    const r = buildSlaReport({
      nowIso: NOW_ISO,
      measurements: measurements({
        executions: { successRate: 0.5, averageRuntimeMs: 120_000 },
        workforce: { queueDepth: 40, oldestApprovalHours: 30 },
        automation: { completed: 5, failed: 5 },
        connectors: { configured: 4, healthy: 1 },
        aiState: 'needs-setup',
      }),
      failures: {},
    });
    expect(r.totals.breached).toBe(7);
    const success = r.statuses.find((s) => s.targetId === 'exec-success-rate')!;
    expect(success.status).toBe('breached');
    expect(success.detail).toContain('BREACHED');
    expect(success.evidence).toContain('execution-stats');
    const runtime = r.statuses.find((s) => s.targetId === 'exec-avg-runtime')!;
    expect(runtime.status).toBe('breached'); // lte 60000, measured 120000
  });

  it('an aggregate with no value yet is unmeasurable — never assumed met', () => {
    const r = buildSlaReport({
      nowIso: NOW_ISO,
      measurements: measurements({
        executions: { successRate: null, averageRuntimeMs: null }, // nothing finished
        automation: { completed: 0, failed: 0 }, // no finished runs
        connectors: { configured: 0, healthy: 0 }, // nothing configured
      }),
      failures: {},
    });
    for (const id of ['exec-success-rate', 'exec-avg-runtime', 'automation-failure-ratio', 'connector-healthy-ratio']) {
      const s = r.statuses.find((x) => x.targetId === id)!;
      expect(s.status, id).toBe('unmeasurable');
      expect(s.detail, id).toContain('honestly unmeasurable, not assumed met');
    }
  });

  it('a null source read is unmeasurable with the source cited', () => {
    const r = buildSlaReport({ nowIso: NOW_ISO, measurements: measurements({ workforce: null }), failures: { 'job-store': 'offline' } });
    const q = r.statuses.find((s) => s.targetId === 'jobs-queue-depth')!;
    expect(q.status).toBe('unmeasurable');
    expect(q.evidence).toContain('job-store');
    expect(r.unavailable).toContainEqual({ system: 'job-store', reason: 'offline' });
  });

  it('boundary values are met (gte at target; lte at target)', () => {
    const r = buildSlaReport({
      nowIso: NOW_ISO,
      measurements: measurements({ executions: { successRate: 0.9, averageRuntimeMs: 60_000 }, workforce: { queueDepth: 25, oldestApprovalHours: 24 } }),
      failures: {},
    });
    for (const id of ['exec-success-rate', 'exec-avg-runtime', 'jobs-queue-depth', 'approval-age']) {
      expect(r.statuses.find((x) => x.targetId === id)!.status, id).toBe('met');
    }
  });
});
