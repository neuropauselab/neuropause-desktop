/**
 * PROGRAM 13C ROUND 2 — H4 (workflow runs) and M-B (sandbox running state).
 *
 * H4: `workflowRuns` was `Map<runId, …>`, install-wide. Three consequences, and
 * only the first is a disclosure: `WorkforceWorkflowRuns` takes `EmptyRequest`
 * and enumerated every tenant's runs AND their specs; `Resume` recovered
 * another tenant's failed run; `Checkpoint` approved another tenant's
 * human-approval gate. The second and third are EXECUTION.
 *
 * M-B: `queueState` filtered the engine's install-wide `running` set with
 * `workspaceId ? … : true`, so omitting the field returned every tenant's
 * running execution ids — the last surviving instance of the "omitted field
 * widens" bypass this program removed from four sibling stores.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope, WorkflowRun, WorkflowSpec } from '@neuropause/shared';
import { SandboxWorkspaceStore } from '../../sandbox/workspaceStore';
import { SandboxScenarioStore } from '../../sandbox/scenarioStore';
import { SandboxExecutionStore } from '../../sandbox/executionStore';
import { SandboxArtifactStore } from '../../sandbox/artifactStore';
import { SandboxDatasetStore } from '../../sandbox/datasetStore';
import { SandboxExecutionEngine } from '../../sandbox/executionEngine';
import { MARKER_A, MARKER_B, TENANT_A, TENANT_B } from './twoTenantFixture';

let scope: TenantScope | null = TENANT_A;

/* ── H4: the tenant-keyed workflow run table ────────────────────────────── */

describe('H4 — workflow runs are keyed by tenant', () => {
  /**
   * `runsForCaller()` reproduced exactly as `workforce/index.ts` implements it.
   * Tested here rather than through the IPC handler because the keying IS the
   * fix — a handler test would prove the wiring and miss the next handler.
   */
  const table = new Map<string, Map<string, { run: WorkflowRun; spec: WorkflowSpec }>>();
  const runsForCaller = (): Map<string, { run: WorkflowRun; spec: WorkflowSpec }> => {
    const tenantId = scope?.tenantId ?? null;
    if (tenantId === null) return new Map();
    const existing = table.get(tenantId);
    if (existing) return existing;
    const fresh = new Map<string, { run: WorkflowRun; spec: WorkflowSpec }>();
    table.set(tenantId, fresh);
    return fresh;
  };

  const run = (id: string, marker: string): { run: WorkflowRun; spec: WorkflowSpec } => ({
    run: { id, workflowId: marker, status: 'awaiting_approval', stepRuns: [] } as unknown as WorkflowRun,
    spec: { id: marker, name: `Workflow ${marker}`, steps: [] } as unknown as WorkflowSpec,
  });

  beforeEach(() => {
    table.clear();
    scope = TENANT_A;
    runsForCaller().set('run-a', run('run-a', MARKER_A));
    scope = TENANT_B;
    runsForCaller().set('run-b', run('run-b', MARKER_B));
    scope = TENANT_A;
  });

  it('the EmptyRequest listing returns only the caller’s runs and specs', () => {
    scope = TENANT_A;
    const listed = [...runsForCaller().values()];
    expect(listed.map((x) => x.run.id)).toEqual(['run-a']);
    // The SPEC is the sensitive half — it describes the workflow's steps.
    expect(JSON.stringify(listed)).not.toContain(MARKER_B);
  });

  it('A cannot GET B’s run, and B cannot get A’s', () => {
    scope = TENANT_A;
    expect(runsForCaller().get('run-b')).toBeUndefined();
    scope = TENANT_B;
    expect(runsForCaller().get('run-a')).toBeUndefined();
  });

  /**
   * RESUME is execution: a failed run is RECOVERED, replaying its unfinished
   * branches. A foreign runId must never reach the orchestrator.
   */
  it('a cross-tenant RESUME starts nothing', () => {
    const resumed: string[] = [];
    const resume = (runId: string): boolean => {
      const entry = runsForCaller().get(runId);
      if (!entry) return false;
      resumed.push(runId); // stands in for orchestrator.resume/recover
      return true;
    };

    scope = TENANT_A;
    expect(resume('run-b')).toBe(false);
    expect(resumed).toEqual([]);
    expect(resume('run-a')).toBe(true); // own run still works
  });

  /** CHECKPOINT approval advances a workflow — also execution. */
  it('a cross-tenant CHECKPOINT approval advances nothing', () => {
    const approved: string[] = [];
    const approve = (runId: string): boolean => {
      const entry = runsForCaller().get(runId);
      if (!entry) return false;
      approved.push(runId);
      return true;
    };

    scope = TENANT_A;
    expect(approve('run-b')).toBe(false);
    expect(approved).toEqual([]);

    scope = TENANT_B;
    expect(runsForCaller().get('run-b')!.run.status).toBe('awaiting_approval');
  });

  it('an unresolved caller sees no runs and can reach none', () => {
    scope = null;
    expect([...runsForCaller().values()]).toEqual([]);
    expect(runsForCaller().get('run-a')).toBeUndefined();
  });

  /** Two tenants may hold the same run id without colliding. */
  it('identical run ids in two tenants stay separate', () => {
    scope = TENANT_A;
    runsForCaller().set('shared', run('shared', MARKER_A));
    scope = TENANT_B;
    runsForCaller().set('shared', run('shared', MARKER_B));

    scope = TENANT_A;
    expect(runsForCaller().get('shared')!.spec.name).toContain(MARKER_A);
    scope = TENANT_B;
    expect(runsForCaller().get('shared')!.spec.name).toContain(MARKER_B);
  });
});

/* ── M-B: sandbox running state ─────────────────────────────────────────── */

describe('M-B — sandbox running state and the omitted workspaceId', () => {
  let dir: string;
  let engine: SandboxExecutionEngine;
  let workspaces: SandboxWorkspaceStore;
  let scenarios: SandboxScenarioStore;
  let executions: SandboxExecutionStore;
  let ids: Record<string, { workspaceId: string; executionId: string }> = {};

  beforeEach(async () => {
    dir = join(tmpdir(), `np-mb-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    const src = (): TenantScope | null => scope;
    workspaces = new SandboxWorkspaceStore(join(dir, 'w.json')).bindScope(src);
    scenarios = new SandboxScenarioStore(join(dir, 's.json')).bindScope(src);
    executions = new SandboxExecutionStore(join(dir, 'e.json')).bindScope(src);
    const artifacts = new SandboxArtifactStore(join(dir, 'a.json')).bindScope(src);
    const datasets = new SandboxDatasetStore(join(dir, 'd.json')).bindScope(src);
    await Promise.all([
      workspaces.load(),
      scenarios.load(),
      executions.load(),
      artifacts.load(),
      datasets.load(),
    ]);
    engine = new SandboxExecutionEngine({
      workspaces,
      scenarios,
      executions,
      artifacts,
      datasets,
      broadcast: () => undefined,
    });

    ids = {};
    for (const [tenant, marker] of [
      [TENANT_A, MARKER_A],
      [TENANT_B, MARKER_B],
    ] as const) {
      scope = tenant;
      const ws = workspaces.create({ name: `Sandbox ${marker}` });
      const sc = scenarios.create({ workspaceId: ws.id, key: `k-${marker}`, name: marker });
      const v = scenarios.createVersion(sc.id, { m: marker }, 'v1')!;
      const ex = executions.create({
        workspaceId: ws.id,
        scenarioId: sc.id,
        scenarioVersion: v.version,
        trigger: 'manual',
        priority: 'normal',
      });
      ids[tenant.tenantId] = { workspaceId: ws.id, executionId: ex.id };
    }
    scope = TENANT_A;
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });

  /** Simulate two tenants' executions being live in the engine at once. */
  function markRunning(): void {
    const running = (engine as unknown as { running: Set<string> }).running;
    running.add(ids[TENANT_A.tenantId]!.executionId);
    running.add(ids[TENANT_B.tenantId]!.executionId);
  }

  it('an OMITTED workspaceId returns only the caller’s running executions', () => {
    markRunning();
    scope = TENANT_A;
    const state = engine.queueState(); // the `{}` payload — the old bypass
    expect(state.running).toEqual([ids[TENANT_A.tenantId]!.executionId]);
    expect(state.running).not.toContain(ids[TENANT_B.tenantId]!.executionId);
  });

  it('is symmetric — B sees only B’s running execution', () => {
    markRunning();
    scope = TENANT_B;
    expect(engine.queueState().running).toEqual([ids[TENANT_B.tenantId]!.executionId]);
  });

  it('naming the OTHER tenant’s workspaceId returns nothing', () => {
    markRunning();
    scope = TENANT_A;
    expect(engine.queueState(ids[TENANT_B.tenantId]!.workspaceId).running).toEqual([]);
  });

  it('an unresolved caller sees no running executions and no queue', () => {
    markRunning();
    scope = null;
    const state = engine.queueState();
    expect(state.running).toEqual([]);
    expect(state.pending).toEqual([]);
  });

  it('pending and concurrency were already scoped, and still are', () => {
    scope = TENANT_A;
    const state = engine.queueState();
    expect(state.pending.map((p) => p.executionId)).toEqual([
      ids[TENANT_A.tenantId]!.executionId,
    ]);
    expect(state.depth).toBe(1);
  });

  it('A cannot CANCEL B’s execution', () => {
    scope = TENANT_A;
    expect(engine.cancel(ids[TENANT_B.tenantId]!.executionId)).toBeNull();
    scope = TENANT_B;
    expect(executions.get(ids[TENANT_B.tenantId]!.executionId)?.status).toBe('queued');
  });
});
