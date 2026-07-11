/** AI Sandbox S5 — full lab run (fake executor suite + REAL S1 engine + S3 runner integration). */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isTerminalExecutionStatus } from '@neuropause/shared';
import { SandboxWorkspaceStore } from '../workspaceStore';
import { SandboxScenarioStore } from '../scenarioStore';
import { SandboxExecutionStore } from '../executionStore';
import { SandboxArtifactStore } from '../artifactStore';
import { SandboxDatasetStore } from '../datasetStore';
import { SandboxExecutionEngine } from '../executionEngine';
import { initEnterpriseRunner } from '../enterprise';
import { FakeEnterprisePlatform, type FakePlatformScript } from '../enterprise/fakePlatform';
import { createQaExecutor, type QaExecutorBackend } from '../agent';
import { runLab } from './lab';
import { BenchmarkStore } from './benchmarkStore';
import type { LabDeps, QaExecutor } from './ports';

function clock(): () => number {
  let t = 1000;
  return () => (t += 5);
}

function passExec(): QaExecutor {
  return {
    kind: 'fake',
    run: () => Promise.resolve({ executionId: 'e', status: 'passed', outcome: 'pass', assertions: { total: 1, passed: 1, failed: 0 }, metrics: {}, artifacts: [], timelinePhases: ['started', 'passed'], knowledgeGraphRefs: [], error: null }),
  };
}

describe('runLab (full default suite, fake executor)', () => {
  it('runs every validation dimension and emits a report + dashboard + four export formats', async () => {
    const now = clock();
    const store = new BenchmarkStore(join(tmpdir(), `labbench-${Date.now()}.json`), now);
    const deps: LabDeps = { executor: passExec(), observers: { health: () => Promise.resolve({ level: 'healthy', cpuPercent: 10, memoryUsedMb: 120 }), auditCount: () => 5, queueDepth: () => Promise.resolve(1) }, now, sleep: () => Promise.resolve() };
    const out = await runLab({ version: '1.0.0', iterations: 1 }, deps, store);

    expect(out.report.performance).toHaveLength(15);
    expect(out.report.chaos.length).toBeGreaterThan(10);
    expect(out.report.security.length).toBe(15);
    expect(out.report.recovery.length).toBe(11);
    expect(out.report.verdict).toBe('pass');
    expect(out.exports.json).toContain('"verdict"');
    expect(out.exports.csv).toMatch(/section,id/);
    expect(out.exports.junit).toContain('<testsuites');
    expect(out.exports.html).toContain('<table');
    expect(out.dashboard.scenarioSuccessPct).toBe(100);
    expect(store.count()).toBeGreaterThan(0); // benchmarks recorded
    expect(out.metrics).toHaveProperty('labMs');
  });
});

/* ── integration: the lab drives the REAL S1 engine + S3 enterprise runner ── */
function realBackend(script: FakePlatformScript) {
  const now = clock();
  const dir = join(tmpdir(), `s5-${Date.now()}-${Math.floor(now())}`);
  const workspaces = new SandboxWorkspaceStore(`${dir}-w.json`, now);
  const scenarios = new SandboxScenarioStore(`${dir}-s.json`, now);
  const executions = new SandboxExecutionStore(`${dir}-e.json`, now);
  const artifacts = new SandboxArtifactStore(`${dir}-a.json`, now);
  const datasets = new SandboxDatasetStore(`${dir}-d.json`, now);
  const engine = new SandboxExecutionEngine({ workspaces, scenarios, executions, artifacts, datasets, now });
  initEnterpriseRunner({ engine, platform: new FakeEnterprisePlatform(script, now), now, sleep: () => Promise.resolve() });
  const ws = workspaces.create({ name: 'Lab' });
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
  return { backend, now, queueDepth: () => Promise.resolve(engine.queueState().depth) };
}

describe('runLab (real S1 engine + S3 enterprise runner)', () => {
  it('validates performance + load + stress + chaos + security + recovery end-to-end', async () => {
    const { backend, now, queueDepth } = realBackend({ permissions: ['sandbox:read'], deny: ['nonexistent:permission'], connectors: ['github'], automationRules: ['rule-1'] });
    const deps: LabDeps = {
      executor: createQaExecutor(backend, { now, sleep: () => new Promise((r) => setTimeout(r, 2)), budgetMs: 15_000 }),
      observers: { health: () => Promise.resolve({ level: 'healthy', cpuPercent: 15, memoryUsedMb: 150 }), auditCount: () => 3, queueDepth },
      now,
      sleep: () => Promise.resolve(),
    };
    const store = new BenchmarkStore(join(tmpdir(), `labbench2-${Date.now()}.json`), now);
    const out = await runLab({
      version: '1.0.0',
      iterations: 1,
      profiles: [
        { id: 'perf-crm', target: 'crm', label: 'CRM', spec: { kind: 'enterprise', category: 'crm', metadata: { title: 'CRM' }, steps: [{ id: 'c', action: 'createCustomer', input: { name: 'Lab', status: 'active' }, saveAs: 'id' }] }, iterations: 1 },
        { id: 'perf-scenario-runner', target: 'scenario-runner', label: 'P2P', spec: { kind: 'enterprise', category: 'procurement', metadata: { title: 'P2P' }, steps: [{ id: 'c', action: 'createCustomer', input: { name: 'Co', status: 'active' } }] }, iterations: 1 },
      ],
      load: [{ id: 'load-rest', dimension: 'rest', concurrency: 3, total: 6 }],
      stress: [{ id: 'stress-dataset', dimension: 'dataset', magnitude: 25 }],
      chaos: [{ id: 'chaos-connector', fault: 'connector-timeout', mode: 'induce' }, { id: 'chaos-disk', fault: 'disk-full', mode: 'probe' }],
      security: [{ id: 'sec-rbac', kind: 'rbac' }, { id: 'sec-audit', kind: 'audit-trail' }],
      recovery: [{ id: 'rec-retry', kind: 'retry' }, { id: 'rec-rollback', kind: 'rollback' }],
    }, deps, store);

    expect(out.report.verdict).not.toBe('fail'); // security enforced, chaos contained
    expect(out.report.performance).toHaveLength(2);
    expect(out.report.performance.every((p) => p.passed === p.runs)).toBe(true); // real enterprise runs passed
    expect(out.report.security.find((s) => s.kind === 'rbac')?.passed).toBe(true); // RBAC enforced end-to-end
    expect(out.report.chaos.find((c) => c.fault === 'connector-timeout')?.recovered).toBe(true); // contained
    expect(out.report.load[0].completed).toBe(6);
    expect(store.count()).toBeGreaterThan(0);
  });
});
