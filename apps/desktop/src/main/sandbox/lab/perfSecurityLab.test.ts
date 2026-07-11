/** AI Sandbox S5 — lab contract (aggregation, benchmark comparison, verdict). */
import { describe, expect, it } from 'vitest';
import {
  aggregateLatency,
  compareBenchmark,
  labVerdict,
  recoveryRatePct,
  scenarioSuccessPct,
  throughputPerSec,
  type BenchmarkRecord,
} from '@neuropause/shared';

describe('aggregation helpers (reuse perfMetrics)', () => {
  it('aggregates latency with p50/p95/p99', () => {
    const { summary, p99Ms } = aggregateLatency([10, 20, 30, 40, 100]);
    expect(summary.count).toBe(5);
    expect(summary.p50Ms).toBe(30);
    expect(summary.maxMs).toBe(100);
    expect(p99Ms).toBe(100);
    expect(aggregateLatency([]).summary.count).toBe(0);
  });

  it('computes throughput', () => {
    expect(throughputPerSec(10, 1000)).toBe(10);
    expect(throughputPerSec(5, 0)).toBe(0);
  });
});

describe('benchmark comparison', () => {
  const rec = (value: number): BenchmarkRecord => ({ id: 'b', target: 'rest', metric: 'p95Ms', version: '2', value, at: 'x' });
  it('flags regressions and improvements (lower is better)', () => {
    expect(compareBenchmark(rec(120), 100).trend).toBe('regressed'); // +20%
    expect(compareBenchmark(rec(80), 100).trend).toBe('improved'); // -20%
    expect(compareBenchmark(rec(102), 100).trend).toBe('stable'); // +2% within noise
    expect(compareBenchmark(rec(120), null).trend).toBe('stable'); // no baseline
  });
});

describe('verdict + rates', () => {
  it('fails on security failure or unrecovered chaos, warns on regression', () => {
    const base = { performance: [], load: [], chaos: [], security: [], recovery: [], benchmarks: [] };
    expect(labVerdict(base)).toBe('pass');
    expect(labVerdict({ ...base, security: [{ id: 's', kind: 'rbac', passed: false, enforced: false, detail: '' }] })).toBe('fail');
    expect(labVerdict({ ...base, chaos: [{ id: 'c', fault: 'connector-timeout', mode: 'induce', induced: true, recovered: false, recoveryMs: 1, failureClass: 'x', healthLevelAfter: 'critical' }] })).toBe('fail');
    expect(labVerdict({ ...base, benchmarks: [{ id: 'b', metric: 'p95Ms', current: 120, baseline: 100, deltaPct: 20, trend: 'regressed' }] })).toBe('warn');
  });

  it('computes scenario success and recovery rate', () => {
    expect(scenarioSuccessPct([{ id: 'p', target: 'rest', runs: 4, passed: 3, latency: { count: 4, avgMs: 1, p50Ms: 1, p95Ms: 1, maxMs: 1 }, p99Ms: 1, throughputPerSec: 1 }])).toBe(75);
    expect(recoveryRatePct([{ id: 'r', kind: 'retry', recovered: true, recoveryMs: 1 }], [])).toBe(100);
    expect(recoveryRatePct([{ id: 'r', kind: 'retry', recovered: false, recoveryMs: 1 }], [])).toBe(0);
  });
});
