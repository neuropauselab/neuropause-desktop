/** AI Sandbox S2 — desktop executor end-to-end on the REAL S1 engine (registerExecutor). */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isTerminalExecutionStatus, type Execution, type ScenarioSpec } from '@neuropause/shared';
import { SandboxWorkspaceStore } from '../workspaceStore';
import { SandboxScenarioStore } from '../scenarioStore';
import { SandboxExecutionStore } from '../executionStore';
import { SandboxArtifactStore } from '../artifactStore';
import { SandboxDatasetStore } from '../datasetStore';
import { SandboxExecutionEngine } from '../executionEngine';
import { initDesktopAutomation } from './index';
import { FakeDesktopDriver, type FakeDriverScript } from './fakeDriver';

let seq = 0;
function harness(script: FakeDriverScript) {
  seq += 1;
  const dir = join(tmpdir(), `s2e-${Date.now()}-${seq}`);
  let t = 1000;
  const now = (): number => (t += 5);
  const workspaces = new SandboxWorkspaceStore(`${dir}-w.json`, now);
  const scenarios = new SandboxScenarioStore(`${dir}-s.json`, now);
  const executions = new SandboxExecutionStore(`${dir}-e.json`, now);
  const artifacts = new SandboxArtifactStore(`${dir}-a.json`, now);
  const datasets = new SandboxDatasetStore(`${dir}-d.json`, now);
  const engine = new SandboxExecutionEngine({ workspaces, scenarios, executions, artifacts, datasets, now });
  const driver = new FakeDesktopDriver(script);
  initDesktopAutomation({
    engine,
    baseDir: join(dir, 'sandbox'),
    launchTarget: { executablePath: '/bin/electron', args: ['/app'] },
    driver,
    now,
    sleep: () => Promise.resolve(),
  });
  const ws = workspaces.create({ name: 'QA' });
  const scenario = scenarios.create({ workspaceId: ws.id, key: 'desktop', name: 'Desktop Smoke' });
  return { engine, workspaces, scenarios, executions, artifacts, datasets, ws, scenario, driver };
}

async function waitTerminal(store: SandboxExecutionStore, id: string): Promise<Execution> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const e = store.get(id);
    if (e && isTerminalExecutionStatus(e.status)) return e;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('execution did not finish');
}

const PASS_SPEC: ScenarioSpec = {
  kind: 'desktop',
  launch: { profile: 'temporary' },
  actions: [
    { type: 'waitFor', selector: '#home' },
    { type: 'screenshot', name: 'home' },
    { type: 'click', selector: '#btn' },
    { type: 'assertVisible', selector: '#home' },
    { type: 'assertText', selector: '#home', text: 'Home' },
    { type: 'captureConsole' },
  ],
};

describe('desktop executor (via S1 engine.registerExecutor)', () => {
  it('runs a passing desktop scenario: artifacts, result metrics, report, timeline', async () => {
    const h = harness({
      windows: [{ title: 'NeuroPause', elements: [{ selector: '#home', visible: true, enabled: true, text: 'Home' }, { selector: '#btn', visible: true, enabled: true }] }],
      console: [{ level: 'log', text: 'ready', at: 1 }],
    });
    const v = h.scenarios.createVersion(h.scenario.id, PASS_SPEC);
    expect(v).not.toBeNull();
    const e = h.engine.enqueue({ scenarioId: h.scenario.id });
    const done = await waitTerminal(h.executions, e.id);

    expect(done.status).toBe('passed');
    const result = h.artifacts.getResult(e.id);
    expect(result?.outcome).toBe('pass');
    expect(result?.assertions).toEqual({ total: 2, passed: 2, failed: 0 });
    expect(result?.metrics).toHaveProperty('launchMs');
    expect(result?.metrics.screenshots).toBe(1);

    // real artifacts landed in the S1 store: a screenshot (with bytes on disk) + a console log + the result + a report
    expect(h.artifacts.screenshots(e.id)).toHaveLength(1);
    expect(h.artifacts.screenshots(e.id)[0].storageRef).toBeTruthy();
    expect(h.artifacts.logs(e.id).some((a) => a.name === 'console.log')).toBe(true);
    expect(h.artifacts.getReport(e.id)?.status).toBe('passed');

    // the S1 timeline captured the desktop steps
    const phases = h.executions.timelineFor(e.id).map((x) => x.phase);
    expect(phases).toEqual(expect.arrayContaining(['started', 'step', 'artifact', 'result', 'report', 'passed']));
  });

  it('marks a failed assertion as failed (not error)', async () => {
    const h = harness({ windows: [{ title: 'NeuroPause', elements: [{ selector: '#home', visible: false }] }] });
    h.scenarios.createVersion(h.scenario.id, { kind: 'desktop', actions: [{ type: 'assertVisible', selector: '#home' }] });
    const done = await waitTerminal(h.executions, h.engine.enqueue({ scenarioId: h.scenario.id }).id);
    expect(done.status).toBe('failed');
    expect(h.artifacts.getResult(done.id)?.assertions).toMatchObject({ failed: 1 });
  });

  it('errors with diagnostics when the automation backend is unavailable', async () => {
    const h = harness({ failLaunch: 'Desktop automation requires Playwright' });
    h.scenarios.createVersion(h.scenario.id, { kind: 'desktop', actions: [{ type: 'waitFor', selector: '#home' }] });
    const done = await waitTerminal(h.executions, h.engine.enqueue({ scenarioId: h.scenario.id }).id);
    expect(done.status).toBe('error');
    expect(done.error).toMatch(/unavailable|playwright/i);
    expect(h.artifacts.list(done.id).some((a) => a.name === 'diagnostics.json')).toBe(true);
  });

  it('errors on an invalid (non-desktop) spec without launching', async () => {
    const h = harness({});
    h.scenarios.createVersion(h.scenario.id, { kind: 'web', actions: [] });
    const done = await waitTerminal(h.executions, h.engine.enqueue({ scenarioId: h.scenario.id }).id);
    expect(done.status).toBe('error');
    expect(done.error).toMatch(/invalid desktop scenario/i);
  });

  it('recovers from a recoverable failure by relaunching, then passes', async () => {
    const h = harness({
      windows: [{ title: 'NeuroPause', elements: [] }], // 1st launch: #home missing → waitFor times out (recoverable)
      healOnRelaunch: true,
      healedWindows: [{ title: 'NeuroPause', elements: [{ selector: '#home', visible: true, enabled: true }] }],
    });
    h.scenarios.createVersion(h.scenario.id, { kind: 'desktop', actions: [{ type: 'waitFor', selector: '#home' }] });
    const done = await waitTerminal(h.executions, h.engine.enqueue({ scenarioId: h.scenario.id }).id);
    expect(done.status).toBe('passed');
    expect(h.artifacts.getResult(done.id)?.metrics.recoveries).toBe(1);
  });
});
