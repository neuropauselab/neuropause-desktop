/** AI Sandbox — Sandbox Core (S1): execution engine end-to-end (queue → run → status → artifacts → result → report → history). */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isTerminalExecutionStatus, type Execution, type SandboxEvent } from '@neuropause/shared';
import { SandboxWorkspaceStore } from './workspaceStore';
import { SandboxScenarioStore } from './scenarioStore';
import { SandboxExecutionStore } from './executionStore';
import { SandboxArtifactStore } from './artifactStore';
import { SandboxDatasetStore } from './datasetStore';
import { SandboxExecutionEngine, type SandboxExecutor } from './executionEngine';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

let seq = 0;
function harness(opts: { concurrency?: number } = {}) {
  seq += 1;
  const base = join(tmpdir(), `sbe-${Date.now()}-${seq}`);
  let t = 1_000;
  const now = (): number => t;
  const advance = (ms: number): void => {
    t += ms;
  };
  const workspaces = new SandboxWorkspaceStore(`${base}-w.json`, now).bindScope(() => TEST_TENANT_SCOPE);
  const scenarios = new SandboxScenarioStore(`${base}-s.json`, now).bindScope(() => TEST_TENANT_SCOPE);
  const executions = new SandboxExecutionStore(`${base}-e.json`, now).bindScope(() => TEST_TENANT_SCOPE);
  const artifacts = new SandboxArtifactStore(`${base}-a.json`, now).bindScope(() => TEST_TENANT_SCOPE);
  const datasets = new SandboxDatasetStore(`${base}-d.json`, now).bindScope(() => TEST_TENANT_SCOPE);
  const events: SandboxEvent[] = [];
  const engine = new SandboxExecutionEngine({ workspaces, scenarios, executions, artifacts, datasets, broadcast: (e) => events.push(e), now });

  const ws = workspaces.create({ name: 'QA', settings: { maxConcurrency: opts.concurrency ?? 2 } });
  const scenario = scenarios.create({ workspaceId: ws.id, key: 'checkout', name: 'Checkout' });
  scenarios.createVersion(scenario.id, { steps: 3 }, 'v1');
  return { engine, workspaces, scenarios, executions, artifacts, datasets, events, ws, scenario, advance };
}

async function waitTerminal(store: SandboxExecutionStore, id: string): Promise<Execution> {
  for (let i = 0; i < 200; i += 1) {
    const e = store.get(id);
    if (e && isTerminalExecutionStatus(e.status)) return e;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error(`execution ${id} did not reach a terminal state`);
}

describe('SandboxExecutionEngine', () => {
  it('errors an execution when no executor is registered', async () => {
    const h = harness();
    const e = h.engine.enqueue({ scenarioId: h.scenario.id });
    const done = await waitTerminal(h.executions, e.id);
    expect(done.status).toBe('error');
    expect(done.error).toMatch(/no sandbox executor/i);
    expect(done.reportId).not.toBeNull(); // a report is still generated
  });

  it('runs a passing scenario end-to-end: status, timeline, artifacts, result, report, history', async () => {
    const h = harness();
    const executor: SandboxExecutor = async (ctx) => {
      h.advance(50);
      ctx.step('open page');
      ctx.log('navigated');
      ctx.attachArtifact({ kind: 'screenshot', name: 'home.png', storageRef: 'blob://home' });
      return { outcome: 'pass', summary: 'Checkout works', assertions: { total: 2, passed: 2, failed: 0 }, metrics: { clicks: 4 } };
    };
    h.engine.registerExecutor(executor);

    const e = h.engine.enqueue({ scenarioId: h.scenario.id, priority: 'high', trigger: 'api' });
    const done = await waitTerminal(h.executions, e.id);

    expect(done.status).toBe('passed');
    expect(done.durationMs).toBeGreaterThanOrEqual(50);
    expect(done.resultId).not.toBeNull();
    expect(done.reportId).not.toBeNull();

    // result
    const result = h.artifacts.getResult(e.id);
    expect(result?.outcome).toBe('pass');
    expect(result?.assertions).toEqual({ total: 2, passed: 2, failed: 0 });
    expect(result?.metrics).toMatchObject({ steps: 1, clicks: 4 });

    // artifacts
    expect(h.artifacts.screenshots(e.id)).toHaveLength(1);

    // report
    const report = h.artifacts.getReport(e.id);
    expect(report?.status).toBe('passed');
    expect(report?.sections.length).toBeGreaterThan(0);

    // timeline covers the lifecycle
    const phases = h.executions.timelineFor(e.id).map((x) => x.phase);
    expect(phases).toEqual(expect.arrayContaining(['queued', 'started', 'step', 'artifact', 'result', 'report', 'passed']));

    // history + broadcast
    expect(h.executions.history({ scenarioId: h.scenario.id }).total).toBe(1);
    expect(h.events.map((x) => x.kind)).toEqual(expect.arrayContaining(['queued', 'started', 'passed']));
  });

  it('records a failing outcome and a thrown executor as error', async () => {
    const fail = harness();
    fail.engine.registerExecutor(async () => ({ outcome: 'fail', summary: 'assertion failed' }));
    const f = fail.engine.enqueue({ scenarioId: fail.scenario.id });
    expect((await waitTerminal(fail.executions, f.id)).status).toBe('failed');

    const err = harness();
    err.engine.registerExecutor(async () => {
      throw new Error('boom');
    });
    const e = err.engine.enqueue({ scenarioId: err.scenario.id });
    const done = await waitTerminal(err.executions, e.id);
    expect(done.status).toBe('error');
    expect(done.error).toBe('boom');
  });

  it('honors per-workspace concurrency and cancels a still-queued run', async () => {
    const h = harness({ concurrency: 1 });
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    h.engine.registerExecutor(async () => {
      await gate;
      return { outcome: 'pass' };
    });

    const first = h.engine.enqueue({ scenarioId: h.scenario.id });
    const second = h.engine.enqueue({ scenarioId: h.scenario.id });
    // concurrency 1 → first runs, second waits queued
    expect(h.executions.get(first.id)?.status).toBe('running');
    expect(h.executions.get(second.id)?.status).toBe('queued');
    const qs = h.engine.queueState(h.ws.id);
    expect(qs.depth).toBe(1);
    expect(qs.running).toEqual([first.id]);

    const cancelled = h.engine.cancel(second.id);
    expect(cancelled?.status).toBe('cancelled');

    release();
    expect((await waitTerminal(h.executions, first.id)).status).toBe('passed');
  });
});
