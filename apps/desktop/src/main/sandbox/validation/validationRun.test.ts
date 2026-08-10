/** AI Sandbox S6 — full pipeline runs (fake executors) + REAL S1→S3→S4→S5 orchestration. */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isTerminalExecutionStatus, type QaSessionResult, type ValidationNotification } from '@neuropause/shared';
import { SandboxWorkspaceStore } from '../workspaceStore';
import { SandboxScenarioStore } from '../scenarioStore';
import { SandboxExecutionStore } from '../executionStore';
import { SandboxArtifactStore } from '../artifactStore';
import { SandboxDatasetStore } from '../datasetStore';
import { SandboxExecutionEngine } from '../executionEngine';
import { initEnterpriseRunner } from '../enterprise';
import { FakeEnterprisePlatform, type FakePlatformScript } from '../enterprise/fakePlatform';
import { createQaExecutor, type QaExecutorBackend } from '../agent';
import { runAgentSession } from '../agent/session';
import { DeterministicReasoner } from '../agent/reasoner';
import { FakeQaMemory } from '../agent/memory';
import { runLab } from '../lab';
import { BenchmarkStore } from '../lab/benchmarkStore';
import { PIPELINE_LIST } from './pipelines';
import { runValidationPipeline } from './platform';
import { ValidationRunStore } from './runStore';
import type { LabRunOutput, StageExecutors, ValidationDeps } from './ports';
import { TEST_TENANT_SCOPE } from '../../tenancy/testScope';

function clock(): () => number {
  let t = 1000;
  return () => (t += 5);
}
function tmpPath(name: string): string {
  return join(tmpdir(), `s6r-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}
function fakeLab(): LabRunOutput {
  return {
    report: { id: 'l', title: 't', generatedAt: 'x', verdict: 'pass', performance: [], load: [], stress: [], chaos: [], security: [], recovery: [], benchmarks: [], recommendations: [], summary: 'ok' },
    dashboard: { generatedAt: 'x', latencyP95Ms: 40, throughputPerSec: 120, cpuPercent: 0, memoryUsedMb: 0, queueDepth: 0, scenarioSuccessPct: 100, recoveryRatePct: 100, securityFailures: 0, regressionTrend: 'stable', panels: [] },
    exports: { json: '', html: '', csv: '', junit: '' }, metrics: {},
  };
}
function fakeSession(): QaSessionResult {
  return { sessionId: 's', agent: 'regression', goalId: 'g', goalText: 'x', planned: 1, executed: 1, passed: 1, failed: 0, skipped: 0, bugs: [], learnings: 0, metrics: {}, outcome: 'pass', summary: '', startedAt: 'x' };
}
function fakeExecutors(): StageExecutors {
  return {
    qaExecutor: { kind: 'fake', run: () => Promise.resolve({ executionId: 'e', status: 'passed', outcome: 'pass', assertions: { total: 1, passed: 1, failed: 0 }, metrics: {}, artifacts: [], timelinePhases: [], knowledgeGraphRefs: [], error: null }) },
    runQaSession: () => Promise.resolve(fakeSession()),
    runLab: () => Promise.resolve(fakeLab()),
  };
}

describe('runValidationPipeline (fake executors)', () => {
  it('runs every one of the 13 pipelines to a terminal status', async () => {
    const store = new ValidationRunStore(tmpPath('all')).bindScope(() => TEST_TENANT_SCOPE);
    for (const p of PIPELINE_LIST) {
      const deps: ValidationDeps & { version: string } = { executors: fakeExecutors(), benchmarks: new BenchmarkStore(tmpPath('b')).bindScope(() => TEST_TENANT_SCOPE), now: clock(), version: '1.0.0' };
      const out = await runValidationPipeline(p.kind, 'manual', deps, store);
      expect(['passed', 'warning']).toContain(out.run.status);
    }
    expect(store.count()).toBe(13);
  });

  it('certifies, regression-analyzes, notifies and records history for a certifying pipeline', async () => {
    const notified: ValidationNotification[] = [];
    const remembered: { tags: string[] }[] = [];
    const store = new ValidationRunStore(tmpPath('cert')).bindScope(() => TEST_TENANT_SCOPE);
    const deps: ValidationDeps & { version: string } = {
      executors: fakeExecutors(),
      benchmarks: new BenchmarkStore(tmpPath('b')).bindScope(() => TEST_TENANT_SCOPE),
      now: clock(),
      version: '1.0.0',
      notifier: { notify: (n) => notified.push(n) },
      history: { remember: (i) => remembered.push(i), recall: () => [] },
      observers: { kpis: () => [{ key: 'records', value: 5 }], health: () => Promise.resolve({ level: 'healthy', cpuPercent: 10, memoryUsedMb: 100 }) },
    };
    const out = await runValidationPipeline('certification', 'certification', deps, store);
    expect(out.run.status).toBe('passed');
    expect(out.certification?.level).toBe('pass');
    expect(out.run.certificationLevel).toBe('pass');
    expect(notified.some((n) => n.kind === 'certification-ready' || n.kind === 'validation-complete')).toBe(true);
    expect(remembered.some((r) => r.tags.includes('validation'))).toBe(true);
  });
});

/* ── the capstone: S6 orchestrates the REAL S1 → S3 → S4 → S5 stack ── */
function realStack(script: FakePlatformScript) {
  const now = clock();
  const dir = join(tmpdir(), `s6i-${Date.now()}-${Math.floor(now())}`);
  const workspaces = new SandboxWorkspaceStore(`${dir}-w.json`, now).bindScope(() => TEST_TENANT_SCOPE);
  const scenarios = new SandboxScenarioStore(`${dir}-s.json`, now).bindScope(() => TEST_TENANT_SCOPE);
  const executions = new SandboxExecutionStore(`${dir}-e.json`, now).bindScope(() => TEST_TENANT_SCOPE);
  const artifacts = new SandboxArtifactStore(`${dir}-a.json`, now).bindScope(() => TEST_TENANT_SCOPE);
  const datasets = new SandboxDatasetStore(`${dir}-d.json`, now).bindScope(() => TEST_TENANT_SCOPE);
  const engine = new SandboxExecutionEngine({ workspaces, scenarios, executions, artifacts, datasets, now });
  initEnterpriseRunner({ engine, platform: new FakeEnterprisePlatform(script, now), now, sleep: () => Promise.resolve() });
  const ws = workspaces.create({ name: 'CV' });
  const backend: QaExecutorBackend = {
    ensureWorkspace: () => Promise.resolve(ws.id),
    createScenario: (workspaceId, key, name) => Promise.resolve(scenarios.create({ workspaceId, key, name }).id),
    createVersion: (scenarioId, spec) => { scenarios.createVersion(scenarioId, spec); return Promise.resolve(); },
    enqueue: (scenarioId) => Promise.resolve(engine.enqueue({ scenarioId }).id),
    getExecution: (id) => { const e = executions.get(id); return Promise.resolve(e ? { status: e.status, error: e.error ?? null } : null); },
    getResult: (id) => { const r = artifacts.getResult(id); return Promise.resolve(r ? { outcome: r.outcome, assertions: r.assertions, metrics: r.metrics } : null); },
    listArtifacts: (id) => Promise.resolve(artifacts.list(id).map((a) => ({ name: a.name, kind: a.kind, ref: a.storageRef ?? null }))),
    getTimeline: (id) => Promise.resolve(executions.timelineFor(id).map((t) => t.phase)),
    isTerminal: (status) => isTerminalExecutionStatus(status),
  };
  const executor = createQaExecutor(backend, { now, sleep: () => new Promise((r) => setTimeout(r, 2)), budgetMs: 15_000 });
  const benchmarks = new BenchmarkStore(tmpPath('bench')).bindScope(() => TEST_TENANT_SCOPE);
  const executors: StageExecutors = {
    qaExecutor: executor,
    runQaSession: (goal) => runAgentSession({ text: goal }, { executor, reasoner: new DeterministicReasoner(), memory: new FakeQaMemory(), now, sleep: () => Promise.resolve() }).then((o) => o.session),
    runLab: (config) => runLab(config, { executor, observers: { health: () => Promise.resolve({ level: 'healthy', cpuPercent: 10, memoryUsedMb: 100 }) }, now, sleep: () => Promise.resolve() }, benchmarks),
  };
  return { executors, benchmarks, now };
}

describe('runValidationPipeline (REAL S1→S3→S4→S5 stack)', () => {
  it('runs a certifying release-candidate pipeline through every real executor and certifies', async () => {
    const { executors, benchmarks, now } = realStack({ deny: ['nonexistent:permission'], connectors: ['github'], automationRules: ['rule-1'] });
    const store = new ValidationRunStore(tmpPath('rc')).bindScope(() => TEST_TENANT_SCOPE);
    const deps: ValidationDeps & { version: string } = {
      executors, benchmarks, now, version: '1.0.0',
      observers: { kpis: () => [{ key: 'records', value: 3 }], health: () => Promise.resolve({ level: 'healthy', cpuPercent: 12, memoryUsedMb: 140 }) },
    };
    const out = await runValidationPipeline('release-candidate', 'pre-release', deps, store);

    expect(out.run.status).not.toBe('error');
    expect(out.certification).not.toBeNull();
    expect(out.certification?.level).not.toBe('fail'); // security enforced, chaos contained
    expect(out.run.stages.length).toBe(4); // smoke + regression QA + automation + resilience lab
    expect(store.get(out.run.id)).not.toBeNull();
    expect(out.run.metrics).toHaveProperty('pipelineMs');
  });
});
