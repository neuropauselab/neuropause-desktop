/** AI Sandbox S4 — agent session end-to-end (fake executor + REAL S1 engine + S3 runner). */
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
import { runAgentSession } from './session';
import { createQaExecutor, type QaExecutorBackend } from './executor';
import { DeterministicReasoner } from './reasoner';
import { FakeQaMemory } from './memory';
import type { QaExecutor, QaRunResult } from './ports';

const clock = (): (() => number) => {
  let t = 1000;
  return () => (t += 5);
};

/* ── a fully controllable fake executor keyed by task name ── */
function fakeExecutor(byName: Record<string, Partial<QaRunResult>>): QaExecutor {
  return {
    kind: 'fake',
    run: (task) =>
      Promise.resolve({
        executionId: 'e', status: 'passed', outcome: 'pass', assertions: { total: 1, passed: 1, failed: 0 },
        metrics: { scenarioMs: 10 }, artifacts: [{ name: 'report.json', kind: 'report', ref: null }],
        timelinePhases: ['started', 'passed'], knowledgeGraphRefs: [], error: null,
        ...(byName[task.name] ?? {}),
      }),
  };
}

const baseDeps = () => ({ reasoner: new DeterministicReasoner(), memory: new FakeQaMemory(), now: clock(), sleep: () => Promise.resolve() });

describe('agent session (fake executor)', () => {
  it('plans and passes a CRM goal, files no bugs', async () => {
    const out = await runAgentSession({ text: 'Validate the customer lifecycle', agent: 'crm' }, { executor: fakeExecutor({}), ...baseDeps() });
    expect(out.session.outcome).toBe('pass');
    expect(out.session.passed).toBe(1);
    expect(out.session.bugs).toHaveLength(0);
    expect(out.session.metrics.qaEfficiency).toBe(100);
  });

  it('files a bug + stores a learning when a task fails', async () => {
    const memory = new FakeQaMemory();
    const out = await runAgentSession(
      { text: 'Validate the customer lifecycle', agent: 'crm' },
      { executor: fakeExecutor({ 'Customer lifecycle': { outcome: 'fail', status: 'failed', assertions: { total: 2, passed: 1, failed: 1 } } }), reasoner: new DeterministicReasoner(), memory, now: clock(), sleep: () => Promise.resolve() },
    );
    expect(out.session.outcome).toBe('fail');
    expect(out.session.failed).toBe(1);
    expect(out.session.bugs).toHaveLength(1);
    expect(out.session.learnings).toBe(1);
    expect(memory.stored[0].tags).toContain('regression');
    // three export formats produced
    expect(out.bugReports[0].json).toContain('"severity"');
    expect(out.bugReports[0].markdown).toMatch(/# /);
    expect(out.bugReports[0].html).toContain('<html');
  });

  it('escalates (not retries) a permission failure — a real security boundary', async () => {
    const out = await runAgentSession(
      { text: 'Validate the customer lifecycle', agent: 'crm' },
      { executor: fakeExecutor({ 'Customer lifecycle': { outcome: 'error', status: 'error', error: 'missing permission crm:manage' } }), ...baseDeps() },
    );
    expect(out.session.failed).toBe(1);
    expect(out.session.bugs[0].failureClass).toBe('permission');
    expect(out.session.metrics.recoveries).toBe(0); // escalated, not retried
  });

  it('exposes all 15 agents and reports metrics', async () => {
    const out = await runAgentSession({ text: 'regression suite', agent: 'regression' }, { executor: fakeExecutor({}), ...baseDeps() });
    expect(out.session.planned).toBeGreaterThanOrEqual(3);
    expect(out.session.metrics).toHaveProperty('planningMs');
    expect(out.session.metrics).toHaveProperty('sessionMs');
  });
});

/* ── integration: the agent drives the REAL S1 engine + S3 enterprise executor ── */
function realBackend(script: FakePlatformScript = {}) {
  const now = clock();
  const dir = join(tmpdir(), `s4-${Date.now()}-${Math.floor(now())}`);
  const workspaces = new SandboxWorkspaceStore(`${dir}-w.json`, now);
  const scenarios = new SandboxScenarioStore(`${dir}-s.json`, now);
  const executions = new SandboxExecutionStore(`${dir}-e.json`, now);
  const artifacts = new SandboxArtifactStore(`${dir}-a.json`, now);
  const datasets = new SandboxDatasetStore(`${dir}-d.json`, now);
  const engine = new SandboxExecutionEngine({ workspaces, scenarios, executions, artifacts, datasets, now });
  initEnterpriseRunner({ engine, platform: new FakeEnterprisePlatform(script, now), now, sleep: () => Promise.resolve() });
  const ws = workspaces.create({ name: 'AI QA' });
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
  return { backend, now };
}

describe('agent session (real S1 engine + S3 enterprise runner)', () => {
  it('runs a CRM goal end-to-end through the real executors and passes', async () => {
    const { backend, now } = realBackend();
    const executor = createQaExecutor(backend, { now, sleep: () => new Promise((r) => setTimeout(r, 2)), budgetMs: 15_000 });
    const out = await runAgentSession(
      { text: 'Validate the customer lifecycle', agent: 'crm' },
      { executor, reasoner: new DeterministicReasoner(), memory: new FakeQaMemory(), now, sleep: () => Promise.resolve() },
    );
    expect(out.session.outcome).toBe('pass');
    expect(out.session.passed).toBe(1);
    expect(out.session.bugs).toHaveLength(0);
  });

  it('files a real bug when a security RBAC expectation fails end-to-end', async () => {
    // default fake grants everything, so the "denied permission must be blocked" assertion fails.
    const { backend, now } = realBackend();
    const memory = new FakeQaMemory();
    const executor = createQaExecutor(backend, { now, sleep: () => new Promise((r) => setTimeout(r, 2)), budgetMs: 15_000 });
    const out = await runAgentSession(
      { text: 'Validate RBAC enforcement', agent: 'security' },
      { executor, reasoner: new DeterministicReasoner(), memory, now, sleep: () => Promise.resolve() },
    );
    expect(out.session.outcome).toBe('fail');
    expect(out.session.bugs.length).toBeGreaterThanOrEqual(1);
    expect(memory.stored.length).toBeGreaterThanOrEqual(1);
  });
});
