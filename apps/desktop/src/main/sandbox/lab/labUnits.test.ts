/** AI Sandbox S5 — lab unit tests (profiles, load, stress, chaos, security, recovery, store, dashboard, report). */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runProfile, defaultProfiles } from './profiles';
import { runLoad } from './loadEngine';
import { runStress } from './stressEngine';
import { runChaos } from './chaosEngine';
import { runSecurityCheck } from './securityLab';
import { runRecoveryCheck } from './recoveryLab';
import { BenchmarkStore } from './benchmarkStore';
import { composeLabDashboard } from './dashboard';
import { buildLabReport, labReportToCsv, labReportToHtml, labReportToJson, labReportToJUnitXml } from './report';
import type { LabDeps, QaExecutor, QaRunResult } from './ports';
import { TEST_TENANT_SCOPE } from '../../tenancy/testScope';

function clock(): () => number {
  let t = 1000;
  return () => (t += 5);
}

function fakeExec(opts: { outcome?: 'pass' | 'fail' | 'error'; recoveries?: number; byName?: Record<string, Partial<QaRunResult>> } = {}): QaExecutor {
  return {
    kind: 'fake',
    run: (task) =>
      Promise.resolve({
        executionId: 'e', status: opts.outcome === 'fail' ? 'failed' : opts.outcome === 'error' ? 'error' : 'passed',
        outcome: opts.outcome ?? 'pass', assertions: { total: 1, passed: opts.outcome && opts.outcome !== 'pass' ? 0 : 1, failed: opts.outcome && opts.outcome !== 'pass' ? 1 : 0 },
        metrics: opts.recoveries ? { recoveries: opts.recoveries } : {}, artifacts: [], timelinePhases: ['started', 'passed'], knowledgeGraphRefs: [], error: opts.outcome === 'error' ? 'boom' : null,
        ...(opts.byName?.[task.name] ?? {}),
      }),
  };
}

const deps = (executor: QaExecutor, observers?: LabDeps['observers']): LabDeps => ({ executor, observers, now: clock(), sleep: () => Promise.resolve() });

describe('profiles', () => {
  it('runs N iterations and aggregates latency', async () => {
    const profile = defaultProfiles(3).find((p) => p.target === 'crm' || p.target === 'memory')!;
    const r = await runProfile(profile, deps(fakeExec()));
    expect(r.runs).toBe(3);
    expect(r.passed).toBe(3);
    expect(r.latency.count).toBe(3);
    expect(r.throughputPerSec).toBeGreaterThan(0);
  });
});

describe('load engine (worker pool + backpressure)', () => {
  it('drains a queue at the given concurrency and reports throughput + backpressure', async () => {
    let depth = 0;
    const observers = { queueDepth: () => Promise.resolve((depth += 2)) };
    const r = await runLoad({ id: 'load', dimension: 'rest', concurrency: 2, total: 6 }, { kind: 'enterprise', steps: [] }, deps(fakeExec(), observers));
    expect(r.completed).toBe(6);
    expect(r.failed).toBe(0);
    expect(r.latency.count).toBe(6);
    expect(r.peakQueueDepth).toBeGreaterThan(0);
    expect(r.backpressure).toBe(true); // depth grew beyond concurrency
  });
});

describe('stress engine (large dataset)', () => {
  it('runs a large-dataset scenario and reports degradation vs baseline', async () => {
    const r = await runStress({ id: 'stress', dimension: 'dataset', magnitude: 100 }, deps(fakeExec()), 5);
    expect(r.completed).toBe(1);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(r.degradationPct).toBeGreaterThanOrEqual(0);
  });
});

describe('chaos engine', () => {
  it('induce mode: contained when the platform stays resilient', async () => {
    const r = await runChaos({ id: 'c', fault: 'connector-timeout', mode: 'induce' }, deps(fakeExec({ outcome: 'fail' }), { health: () => Promise.resolve({ level: 'healthy', cpuPercent: 10, memoryUsedMb: 100 }) }));
    expect(r.induced).toBe(true);
    expect(r.recovered).toBe(true); // terminal + healthy
  });
  it('induce mode: NOT contained when health goes critical', async () => {
    const r = await runChaos({ id: 'c', fault: 'connector-timeout', mode: 'induce' }, deps(fakeExec({ outcome: 'error' }), { health: () => Promise.resolve({ level: 'critical', cpuPercent: 99, memoryUsedMb: 900 }) }));
    expect(r.recovered).toBe(false);
  });
  it('probe mode: reads diagnostics without inducing', async () => {
    const r = await runChaos({ id: 'c', fault: 'disk-full', mode: 'probe' }, deps(fakeExec(), { health: () => Promise.resolve({ level: 'healthy', cpuPercent: 5, memoryUsedMb: 50 }) }));
    expect(r.induced).toBe(false);
    expect(r.recovered).toBe(true);
  });
});

describe('security lab', () => {
  it('passes RBAC when the scenario enforces, reads the real audit trail', async () => {
    const rbac = await runSecurityCheck({ id: 's1', kind: 'rbac' }, deps(fakeExec()));
    expect(rbac.passed).toBe(true);
    const denied = await runSecurityCheck({ id: 's2', kind: 'permission-escalation' }, deps(fakeExec({ outcome: 'fail' })));
    expect(denied.passed).toBe(false);
    const audit = await runSecurityCheck({ id: 's3', kind: 'audit-trail' }, deps(fakeExec(), { auditCount: () => 42 }));
    expect(audit.enforced).toBe(true);
    expect(audit.detail).toMatch(/42/);
  });
});

describe('recovery lab', () => {
  it('detects recovery from the run metrics', async () => {
    expect((await runRecoveryCheck({ id: 'r', kind: 'retry' }, deps(fakeExec({ recoveries: 1 })))).recovered).toBe(true);
    expect((await runRecoveryCheck({ id: 'r', kind: 'rollback' }, deps(fakeExec()))).recovered).toBe(true); // clean pass
    expect((await runRecoveryCheck({ id: 'r', kind: 'failover' }, deps(fakeExec({ outcome: 'error' })))).recovered).toBe(false);
  });
});

describe('benchmark store (extends PersistentStore)', () => {
  it('records history and compares versions', async () => {
    const store = new BenchmarkStore(join(tmpdir(), `bench-${Date.now()}.json`), (() => { let t = 1; return () => (t += 1000); })()).bindScope(() => TEST_TENANT_SCOPE);
    store.record({ target: 'rest', metric: 'p95Ms', version: '1', value: 100 });
    store.record({ target: 'rest', metric: 'p95Ms', version: '2', value: 130 });
    const cmp = store.compareLatest('rest', 'p95Ms', '2');
    expect(cmp?.baseline).toBe(100);
    expect(cmp?.trend).toBe('regressed');
    expect(store.history('rest', 'p95Ms')).toHaveLength(2);
  });
});

describe('dashboard + report', () => {
  const report = buildLabReport({
    id: 'lab', title: 'Validation', generatedAt: 'now',
    performance: [{ id: 'p', target: 'rest', runs: 2, passed: 2, latency: { count: 2, avgMs: 10, p50Ms: 10, p95Ms: 12, maxMs: 15 }, p99Ms: 15, throughputPerSec: 100 }],
    load: [{ id: 'l', dimension: 'rest', concurrency: 2, total: 4, completed: 4, failed: 0, latency: { count: 4, avgMs: 8, p50Ms: 8, p95Ms: 9, maxMs: 12 }, p99Ms: 12, throughputPerSec: 120, peakQueueDepth: 3, backpressure: true }],
    stress: [{ id: 's', dimension: 'dataset', magnitude: 100, completed: 1, failed: 0, latencyMs: 50, degradationPct: 10, peakRssBytes: 1000 }],
    chaos: [{ id: 'c', fault: 'connector-timeout', mode: 'induce', induced: true, recovered: true, recoveryMs: 5, failureClass: 'environment', healthLevelAfter: 'healthy' }],
    security: [{ id: 'sec', kind: 'rbac', passed: true, enforced: true, detail: 'enforced' }],
    recovery: [{ id: 'rec', kind: 'retry', recovered: true, recoveryMs: 5 }],
    benchmarks: [{ id: 'b', metric: 'p95Ms', current: 12, baseline: 10, deltaPct: 20, trend: 'regressed' }],
  });

  it('builds a report with a verdict and exports all four formats', () => {
    expect(report.verdict).toBe('warn'); // regression → warn
    expect(JSON.parse(labReportToJson(report)).verdict).toBe('warn');
    expect(labReportToCsv(report)).toMatch(/section,id,metric/);
    expect(labReportToJUnitXml(report)).toContain('<testsuite');
    expect(labReportToHtml(report)).toContain('<table');
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  it('composes a dashboard from real run data', () => {
    const dash = composeLabDashboard({ report, health: { level: 'healthy', cpuPercent: 20, memoryUsedMb: 200 }, queueDepth: 3, generatedAt: 'now' });
    expect(dash.scenarioSuccessPct).toBe(100);
    expect(dash.recoveryRatePct).toBe(100);
    expect(dash.securityFailures).toBe(0);
    expect(dash.regressionTrend).toBe('regressed');
    expect(dash.panels.length).toBeGreaterThan(5);
  });
});
