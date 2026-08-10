/** AI Sandbox S6 — unit tests (pipelines, runner, scheduler, regression, history, certification, dashboard, notifications, store). */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PipelineKind, QaSessionResult, ValidationRun } from '@neuropause/shared';
import { PIPELINE_LIST, getPipeline } from './pipelines';
import { runPipelineStages } from './pipelineRunner';
import { ValidationScheduler } from './scheduler';
import { analyzeRegression } from './regression';
import { recordHistory, recurringFailures } from './history';
import { buildCertification, certificationToHtml, certificationToJson, certificationToMarkdown } from './certification';
import { composeValidationDashboard } from './dashboard';
import { notificationsFor } from './notifications';
import { ValidationRunStore } from './runStore';
import { BenchmarkStore } from '../lab/benchmarkStore';
import type { LabRunOutput, StageExecutors, ValidationDeps } from './ports';
import { TEST_TENANT_SCOPE } from '../../tenancy/testScope';

function clock(): () => number {
  let t = 1000;
  return () => (t += 5);
}
function tmpPath(name: string): string {
  return join(tmpdir(), `s6-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}
function fakeLab(): LabRunOutput {
  return {
    report: { id: 'l', title: 't', generatedAt: 'x', verdict: 'pass', performance: [], load: [], stress: [], chaos: [], security: [], recovery: [], benchmarks: [], recommendations: [], summary: 'ok' },
    dashboard: { generatedAt: 'x', latencyP95Ms: 50, throughputPerSec: 100, cpuPercent: 0, memoryUsedMb: 0, queueDepth: 0, scenarioSuccessPct: 100, recoveryRatePct: 100, securityFailures: 0, regressionTrend: 'stable', panels: [] },
    exports: { json: '', html: '', csv: '', junit: '' },
    metrics: {},
  };
}
function fakeSession(over: Partial<QaSessionResult> = {}): QaSessionResult {
  return { sessionId: 's', agent: 'regression', goalId: 'g', goalText: 'x', planned: 1, executed: 1, passed: 1, failed: 0, skipped: 0, bugs: [], learnings: 0, metrics: {}, outcome: 'pass', summary: '', startedAt: 'x', ...over };
}
function executors(over: Partial<StageExecutors> = {}): StageExecutors {
  return {
    qaExecutor: { kind: 'fake', run: () => Promise.resolve({ executionId: 'e', status: 'passed', outcome: 'pass', assertions: { total: 1, passed: 1, failed: 0 }, metrics: {}, artifacts: [], timelinePhases: [], knowledgeGraphRefs: [], error: null }) },
    runQaSession: () => Promise.resolve(fakeSession()),
    runLab: () => Promise.resolve(fakeLab()),
    ...over,
  };
}
function deps(over: Partial<ValidationDeps> = {}): ValidationDeps {
  return { executors: executors(), benchmarks: new BenchmarkStore(tmpPath('b')).bindScope(() => TEST_TENANT_SCOPE), now: clock(), ...over };
}

describe('pipeline catalog', () => {
  it('exposes 13 pipelines; certification + RC certify', () => {
    expect(PIPELINE_LIST).toHaveLength(13);
    expect(getPipeline('certification').certifies).toBe(true);
    expect(getPipeline('release-candidate').certifies).toBe(true);
    expect(getPipeline('quick').certifies).toBe(false);
  });
});

describe('pipeline runner (dispatches to existing executors)', () => {
  it('runs scenario/ai-qa/lab stages and collects results', async () => {
    const out = await runPipelineStages(getPipeline('certification'), deps());
    expect(out.stages.length).toBe(getPipeline('certification').stages.length);
    expect(out.stages.every((s) => s.status === 'pass')).toBe(true);
    expect(out.qaSessions.length).toBe(2); // two ai-qa stages
    expect(out.labOutputs.length).toBe(1);
  });
  it('degrades an optional stage failure to a warning', async () => {
    const ex = executors({ qaExecutor: { kind: 'fake', run: () => Promise.resolve({ executionId: 'e', status: 'error', outcome: 'error', assertions: { total: 0, passed: 0, failed: 0 }, metrics: {}, artifacts: [], timelinePhases: [], knowledgeGraphRefs: [], error: 'boom' }) } });
    const out = await runPipelineStages(getPipeline('plugin'), deps({ executors: ex })); // plugin stage is optional
    expect(out.stages[0].status).toBe('warn');
  });
});

describe('scheduler (reuses the injected scheduler)', () => {
  it('registers schedules and fires a due nightly run through the tick', async () => {
    const fired: PipelineKind[] = [];
    let tick: (() => void) | null = null;
    const scheduler = new ValidationScheduler({
      scheduler: { every: (_id, _ms, fn) => { tick = fn; }, cancel: () => undefined },
      runPipeline: (p) => { fired.push(p); return Promise.resolve({ id: 'r', pipeline: p, trigger: 'nightly', status: 'passed', startedAt: 'x', finishedAt: 'x', durationMs: 1, stages: [], metrics: {}, certificationLevel: null, regressionCount: 0 } as ValidationRun); },
      now: () => Date.now(),
      clock: () => new Date(2026, 0, 2, 2, 0, 0), // local 02:00
    });
    scheduler.register('regression', { kind: 'nightly', atMinutes: 120 }, 'nightly');
    scheduler.ensureTick();
    expect(tick).not.toBeNull();
    await scheduler.tick();
    expect(fired).toContain('regression');
    // does not double-fire the same day
    fired.length = 0;
    await scheduler.tick();
    expect(fired).toHaveLength(0);
  });
});

describe('regression analysis (reuses the benchmark store)', () => {
  it('detects a latency regression against the baseline', () => {
    const bench = new BenchmarkStore(tmpPath('reg')).bindScope(() => TEST_TENANT_SCOPE);
    expect(analyzeRegression({ version: '1', latencyP95Ms: 100 }, bench).regressed).toBe(false); // no baseline
    const second = analyzeRegression({ version: '2', latencyP95Ms: 150 }, bench);
    expect(second.regressed).toBe(true);
    expect(second.findings.some((f) => f.kind === 'latency')).toBe(true);
    expect(second.worst).toBe('critical'); // +50%
  });
  it('flags security failures as a critical regression', () => {
    const r = analyzeRegression({ version: '1', securityFailures: 2 }, new BenchmarkStore(tmpPath('sec')).bindScope(() => TEST_TENANT_SCOPE));
    expect(r.findings.some((f) => f.kind === 'security' && f.severity === 'critical')).toBe(true);
  });
});

describe('history (reuses memory)', () => {
  it('records runs + failures and recalls recurring failures', () => {
    const writes: { tags: string[]; title: string }[] = [];
    const history = { remember: (i: { tags: string[]; title: string }) => writes.push(i), recall: () => writes.filter((w) => w.tags.includes('failure')).map((w) => ({ title: w.title, content: '' })) };
    recordHistory({ id: 'r', pipeline: 'smoke', trigger: 'manual', status: 'failed', startedAt: 'x', finishedAt: 'x', durationMs: 1, stages: [{ id: 's', name: 'CRM', kind: 'scenario', status: 'fail', durationMs: 1, summary: 'assert failed', metrics: {} }], metrics: {}, certificationLevel: null, regressionCount: 0 }, history);
    expect(writes.some((w) => w.tags.includes('validation'))).toBe(true);
    expect(writes.some((w) => w.tags.includes('failure'))).toBe(true);
    expect(recurringFailures(history).length).toBeGreaterThan(0);
  });
});

describe('certification + dashboard + notifications + store', () => {
  it('builds a certification report and exports it', () => {
    const report = buildCertification({
      pipeline: 'certification', version: '1.0.0', generatedAt: 'now',
      stages: [{ id: 's', name: 'CRM', kind: 'scenario', status: 'pass', durationMs: 1, summary: '', metrics: {} }],
      regression: { findings: [], regressed: false, worst: 'info', summary: 'no regressions' },
      scenario: { total: 2, passed: 2, failed: 0 }, qaSessions: [fakeSession()], labOutputs: [fakeLab()],
      kpis: [{ key: 'records', value: 5 }], health: { level: 'healthy', cpuPercent: 10, memoryUsedMb: 100 }, buildStatus: 'gates: green',
    });
    expect(report.level).toBe('pass');
    expect(JSON.parse(certificationToJson(report)).level).toBe('pass');
    expect(certificationToMarkdown(report)).toMatch(/Release Certification/);
    expect(certificationToHtml(report)).toContain('<table');
  });

  it('composes a dashboard + notifications, and persists runs', () => {
    const store = new ValidationRunStore(tmpPath('runs')).bindScope(() => TEST_TENANT_SCOPE);
    const run: ValidationRun = { id: 'r1', pipeline: 'certification', trigger: 'manual', status: 'passed', startedAt: 'a', finishedAt: 'b', durationMs: 10, stages: [{ id: 's', name: 'x', kind: 'scenario', status: 'pass', durationMs: 1, summary: '', metrics: {} }], metrics: {}, certificationLevel: 'pass', regressionCount: 0 };
    store.add(run);
    expect(store.history()[0].level).toBe('pass');
    const dash = composeValidationDashboard({ history: store.history(), scheduled: [], current: null, queueDepth: 0, generatedAt: 'now' });
    expect(dash.certificationStatus).toBe('pass');
    expect(dash.panels.length).toBeGreaterThan(4);
    const notifs = notificationsFor({ ...run, status: 'failed', certificationLevel: 'fail' }, { findings: [{ kind: 'security', metric: 'x', current: 1, baseline: 0, deltaPct: 100, severity: 'critical', detail: '' }], regressed: true, worst: 'critical', summary: 'sec' });
    expect(notifs.some((n) => n.kind === 'validation-failed')).toBe(true);
    expect(notifs.some((n) => n.kind === 'critical-failure')).toBe(true);
    expect(notifs.some((n) => n.kind === 'security-issue' && n.priority === 'critical')).toBe(true);
  });
});
