/** AI Sandbox S3 — enterprise executor end-to-end on the REAL S1 engine (via the router). */
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
import { initEnterpriseRunner } from './index';
import { FakeEnterprisePlatform, type FakePlatformScript } from './fakePlatform';

let seq = 0;
function harness(script: FakePlatformScript = {}, desktopExecutor?: Parameters<typeof initEnterpriseRunner>[0]['desktopExecutor']) {
  seq += 1;
  const dir = join(tmpdir(), `s3e-${Date.now()}-${seq}`);
  let t = 1000;
  const now = (): number => (t += 5);
  const workspaces = new SandboxWorkspaceStore(`${dir}-w.json`, now);
  const scenarios = new SandboxScenarioStore(`${dir}-s.json`, now);
  const executions = new SandboxExecutionStore(`${dir}-e.json`, now);
  const artifacts = new SandboxArtifactStore(`${dir}-a.json`, now);
  const datasets = new SandboxDatasetStore(`${dir}-d.json`, now);
  const engine = new SandboxExecutionEngine({ workspaces, scenarios, executions, artifacts, datasets, now });
  const platform = new FakeEnterprisePlatform(script, now);
  initEnterpriseRunner({ engine, platform, desktopExecutor, now, sleep: () => Promise.resolve() });
  const ws = workspaces.create({ name: 'QA' });
  const scenario = scenarios.create({ workspaceId: ws.id, key: 'ent', name: 'Enterprise Smoke' });
  return { engine, scenarios, executions, artifacts, ws, scenario, platform };
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

function run(h: ReturnType<typeof harness>, spec: ScenarioSpec): Promise<Execution> {
  h.scenarios.createVersion(h.scenario.id, spec);
  return waitTerminal(h.executions, h.engine.enqueue({ scenarioId: h.scenario.id }).id);
}

const P2P: ScenarioSpec = {
  kind: 'enterprise',
  category: 'procurement',
  metadata: { title: 'Procure to Pay' },
  preconditions: [
    { type: 'moduleRegistered', target: 'crm-customers' },
    { type: 'permission', permission: 'sandbox:manage' },
  ],
  steps: [
    { id: 'cust', action: 'createCustomer', input: { name: 'Acme', status: 'active' }, saveAs: 'custId', assert: [{ type: 'recordExists', moduleId: 'crm-customers', target: '${custId}' }] },
    { id: 'po', action: 'createPurchaseOrder', input: { poNumber: 'PO-1', customer: '${custId}', total: 1000 }, saveAs: 'poId' },
    { id: 'approve', action: 'approvePurchaseOrder', input: { id: '${poId}' }, dependsOn: ['po'], assert: [
      { type: 'recordUpdated', moduleId: 'procurement-orders', target: '${poId}', field: 'status', expected: 'approved' },
      { type: 'timelineEventExists', target: '${poId}' },
      { type: 'knowledgeGraphUpdated', target: '${custId}' },
    ] },
    { id: 'health', action: 'executeRestCall', input: { method: 'GET', path: '/health' }, saveAs: 'health', assert: [{ type: 'restResponse', target: 'health', field: 'status', expected: 200 }] },
  ],
  assertions: [{ type: 'executiveKpiChanged', target: 'records' }],
};

describe('enterprise executor (via S1 engine.registerExecutor + router)', () => {
  it('runs a real multi-channel workflow: steps, assertions, reports, metrics, timeline', async () => {
    const h = harness();
    const done = await run(h, P2P);

    expect(done.status).toBe('passed');
    const result = h.artifacts.getResult(done.id);
    expect(result?.outcome).toBe('pass');
    expect(result?.assertions.failed).toBe(0);
    expect(result?.assertions.total).toBeGreaterThanOrEqual(5);
    expect(result?.metrics.stepsRun).toBe(4);
    expect(result?.metrics).toHaveProperty('scenarioMs');
    expect(result?.metrics.restCalls).toBe(1);

    // three report formats landed in the one S1 artifact store
    const names = h.artifacts.list(done.id).map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(['report.json', 'report.html', 'report.junit.xml']));
    expect(h.artifacts.getReport(done.id)?.status).toBe('passed');

    // real records were created across ERP/CRM
    expect(h.platform.records.size).toBe(2);

    const phases = h.executions.timelineFor(done.id).map((x) => x.phase);
    expect(phases).toEqual(expect.arrayContaining(['started', 'step', 'artifact', 'result', 'report', 'passed']));
  });

  it('marks a failed assertion as failed (not error)', async () => {
    const h = harness();
    const done = await run(h, {
      kind: 'enterprise', category: 'crm', metadata: { title: 'bad assert' },
      steps: [{ id: 's', action: 'createCustomer', input: { name: 'X', status: 'active' }, saveAs: 'id', assert: [{ type: 'recordUpdated', moduleId: 'crm-customers', target: '${id}', field: 'status', expected: 'archived' }] }],
    });
    expect(done.status).toBe('failed');
    expect(h.artifacts.getResult(done.id)?.assertions.failed).toBe(1);
  });

  it('errors on a malformed enterprise spec without running', async () => {
    const h = harness();
    const done = await run(h, { kind: 'enterprise', category: 'crm', metadata: { title: 'empty' }, steps: [] });
    expect(done.status).toBe('error');
    expect(done.error).toMatch(/invalid enterprise scenario/i);
  });

  it('router returns an error for an unroutable scenario kind', async () => {
    const h = harness();
    const done = await run(h, { kind: 'web', steps: [] });
    expect(done.status).toBe('error');
    expect(done.error).toMatch(/no executor registered/i);
  });

  it('errors when a precondition is not met', async () => {
    const h = harness({ modules: ['crm-customers'] });
    const done = await run(h, {
      kind: 'enterprise', category: 'inventory', metadata: { title: 'missing module' },
      preconditions: [{ type: 'moduleRegistered', target: 'inventory-products' }],
      steps: [{ action: 'createProduct', input: { sku: 'X' } }],
    });
    expect(done.status).toBe('error');
    expect(done.error).toMatch(/precondition/i);
  });

  it('recovers from a transient failure via the step retry policy, then passes', async () => {
    const h = harness({ failCreate: { moduleId: 'crm-customers', times: 1, message: 'timed out creating' } });
    const done = await run(h, {
      kind: 'enterprise', category: 'crm', metadata: { title: 'retry' },
      steps: [{ id: 's', action: 'createCustomer', input: { name: 'Acme' }, retry: { maxAttempts: 3, backoffMs: 0 } }],
    });
    expect(done.status).toBe('passed');
    expect(h.artifacts.getResult(done.id)?.metrics.recoveries).toBe(1);
  });

  it('rolls back records created during a failed run when no cleanup is defined', async () => {
    const h = harness();
    const done = await run(h, {
      kind: 'enterprise', category: 'crm', metadata: { title: 'rollback' },
      steps: [
        { id: 'a', action: 'createCustomer', input: { name: 'Acme' }, saveAs: 'id' },
        { id: 'b', action: 'createCustomer', input: { name: 'Globex' }, assert: [{ type: 'recordExists', moduleId: 'crm-customers', target: 'nonexistent' }] },
      ],
    });
    expect(done.status).toBe('failed');
    // both created records were rolled back (soft-deleted) after the failure
    const active = [...h.platform.records.values()].filter((r) => r.status !== 'deleted');
    expect(active).toHaveLength(0);
  });

  it('routes desktop-kind scenarios to the S2 desktop executor (reuse, not rebuild)', async () => {
    let desktopRan = false;
    const desktopExecutor = () => {
      desktopRan = true;
      return Promise.resolve({ outcome: 'pass' as const, summary: 'desktop ok' });
    };
    const h = harness({}, desktopExecutor);
    const done = await run(h, { kind: 'desktop', launch: { profile: 'temporary' }, actions: [{ type: 'waitFor', selector: '#home' }] });
    expect(desktopRan).toBe(true);
    expect(done.status).toBe('passed');
  });

  it('drives SDK, CLI, automation and connector channels in one scenario', async () => {
    const h = harness({ automationRules: ['rule-1'], connectors: ['github'] });
    const done = await run(h, {
      kind: 'enterprise', category: 'developer', metadata: { title: 'channels' },
      steps: [
        { id: 'sdk', action: 'executeSdkCall', input: { method: 'getModules' }, saveAs: 'mods', assert: [{ type: 'sdkResult', target: 'mods', field: 'ok', expected: true }] },
        { id: 'cli', action: 'executeCliCommand', input: { argv: ['health'] }, saveAs: 'cli', assert: [{ type: 'cliResult', target: 'cli', field: 'code', expected: 0 }] },
        { id: 'auto', action: 'triggerAutomation', input: { ruleId: 'rule-1' }, assert: [{ type: 'automationExecuted', expected: 1 }] },
        { id: 'sync', action: 'syncConnector', input: { connectorId: 'github' }, assert: [{ type: 'connectorSynced', target: 'github' }] },
      ],
    });
    expect(done.status).toBe('passed');
    expect(h.artifacts.getResult(done.id)?.metrics).toMatchObject({ sdkCalls: 1, cliCalls: 1, automationRuns: 1, connectorSyncs: 1 });
  });
});
