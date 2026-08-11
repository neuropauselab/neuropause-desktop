/**
 * P8.3 — approved binding-carrying proposals execute through the (faked) engine and
 * settle the job; advisory proposals stay synchronous; and a crash-orphaned 'running'
 * job is recovered on load.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ExecutionRequest, ExecutionSession, Job, Worker } from '@neuropause/shared';
import { WorkerRegistry } from '../registry/workerRegistry';
import { AuditLog } from '../governance/auditLog';
import { GovernanceRuntime } from '../governance';
import { JobStore } from './jobStore';
import { WorkerRuntime } from './workerRuntime';
import { aggregateOutcome, bindingToRequest } from '../execution/router';
import type { SkillImpl, WorkforceData } from '../sdk';
import { TEST_TENANT_SCOPE } from '../../tenancy/testScope';

const NOW = '2026-07-15T00:00:00.000Z';
const stores: Array<{ flush: () => Promise<void> }> = [];
const paths: string[] = [];
let counter = 0;
const newId = (): string => `id-${++counter}`;
function tempPath(): string {
  const p = join(tmpdir(), `nps-exec-${randomUUID()}.json`);
  paths.push(p);
  return p;
}

function worker(): Worker {
  return {
    identity: { id: 'worker:ops', name: 'Ops', role: 'operations', version: '1.0.0', developer: 'np' },
    goals: [],
    skills: [{ id: 'exec', title: 'Exec', description: 'e', sideEffects: true, requires: ['propose:message'] }],
    permissions: [{ scope: 'propose:message', granted: true }],
    memoryScope: 'self',
    policyIds: [],
    trustScore: 0.7,
    lifecycle: 'idle',
    health: { state: 'healthy', lastCheckAt: NOW, successRate: 1, jobsRun: 0, jobsFailed: 0, message: null },
    createdAt: NOW,
    updatedAt: NOW,
    builtIn: true,
    metadata: {},
  };
}

/** A skill whose proposal carries an execution binding (opts into real execution). */
const execSkill: SkillImpl = {
  id: 'exec',
  run: () => ({
    summary: 'Proposing an action',
    evidence: [{ kind: 'entity', id: 'e1' }],
    grounded: true,
    proposals: [
      {
        title: 'Stop instance',
        summary: 'stop it',
        sideEffects: true,
        permissions: ['propose:message'],
        risk: 'medium',
        evidence: [{ kind: 'entity', id: 'e1' }],
        payload: {},
        execution: { executor: 'infra', target: 'aws', accountId: 'acct', actionId: 'stop', params: { id: 'i-1' } },
      },
    ],
  }),
};
const impls = new Map<string, SkillImpl>([['exec', execSkill]]);
const data: WorkforceData = { now: NOW, entities: [{ id: 'e1' } as never], events: [], memories: [], neighbors: () => [] };

async function setup(submit: (req: ExecutionRequest) => Promise<ExecutionSession>): Promise<{
  runtime: WorkerRuntime;
  jobs: JobStore;
  dispatched: () => Promise<void>;
}> {
  counter = 0;
  const registry = new WorkerRegistry(tempPath());
  const audit = new AuditLog(tempPath()).bindScope(() => TEST_TENANT_SCOPE);
  const jobs = new JobStore(tempPath()).bindScope(() => TEST_TENANT_SCOPE);
  stores.push(registry, audit, jobs);
  await registry.load();
  await audit.load();
  await jobs.load();
  const governance = new GovernanceRuntime(audit);
  registry.register({ worker: worker(), skills: new Map() }, NOW);
  const runtime = new WorkerRuntime({
    registry,
    governance,
    jobs,
    dataProvider: () => data,
    skillsFor: (id) => (id === 'worker:ops' ? impls : null),
    newId,
    clock: () => NOW,
  });
  let last: Promise<void> = Promise.resolve();
  runtime.setDispatchApproved((job, proposals) => {
    const bindings = proposals.filter((p) => p.execution);
    if (bindings.length === 0) return;
    const executor = bindings[0].execution!.executor;
    last = Promise.all(bindings.map((p) => submit(bindingToRequest(job, p)!))).then((sessions) => {
      runtime.settleExecution(job.id, aggregateOutcome(sessions, executor));
    });
  });
  return { runtime, jobs, dispatched: () => last };
}

function completedSession(over: Partial<ExecutionSession> = {}): ExecutionSession {
  return {
    id: 'exec-1',
    kind: 'connector',
    label: 'l',
    state: 'completed',
    steps: [],
    currentStep: -1,
    startedAt: NOW,
    completedAt: NOW,
    durationMs: 3,
    error: null,
    resultSummary: 'infra ok',
    result: null,
    correlationId: null,
    ...over,
  };
}

afterEach(async () => {
  await Promise.all(stores.map((s) => s.flush()));
  stores.length = 0;
  for (const p of paths) await fs.rm(p, { force: true });
  paths.length = 0;
});

describe('WorkerRuntime approved-action execution', () => {
  it('runs an approved binding proposal and settles the job succeeded', async () => {
    const { runtime, dispatched } = await setup(async () => completedSession());
    const job = runtime.runJob({ workerId: 'worker:ops', skillId: 'exec' });
    expect(job.status).toBe('awaiting_approval');
    // Approving moves the job to 'running' (dispatch fired), not straight to 'succeeded'.
    const approved = runtime.approveProposal(job.id, job.proposals[0].id, 'alice', null);
    expect(approved?.status).toBe('running');
    await dispatched();
    const settled = runtime.getJob(job.id)!;
    expect(settled.status).toBe('succeeded');
    expect(settled.executor).toBe('infra');
    expect(settled.executionId).toBe('exec-1');
  });

  it('settles the job failed when the execution fails', async () => {
    const { runtime, dispatched } = await setup(async () => completedSession({ state: 'failed', error: 'denied', resultSummary: null }));
    const job = runtime.runJob({ workerId: 'worker:ops', skillId: 'exec' });
    runtime.approveProposal(job.id, job.proposals[0].id, 'alice', null);
    await dispatched();
    const settled = runtime.getJob(job.id)!;
    expect(settled.status).toBe('failed');
    expect(settled.error).toBe('denied');
  });

  it('keeps a binding proposal advisory (immediate succeeded) when no dispatcher is wired', async () => {
    const registry = new WorkerRegistry(tempPath());
    const audit = new AuditLog(tempPath()).bindScope(() => TEST_TENANT_SCOPE);
    const jobs = new JobStore(tempPath()).bindScope(() => TEST_TENANT_SCOPE);
    stores.push(registry, audit, jobs);
    await registry.load();
    await audit.load();
    await jobs.load();
    registry.register({ worker: worker(), skills: new Map() }, NOW);
    // No setDispatchApproved → willExecute is false → approval completes synchronously.
    const runtime = new WorkerRuntime({
      registry,
      governance: new GovernanceRuntime(audit),
      jobs,
      dataProvider: () => data,
      skillsFor: (id) => (id === 'worker:ops' ? impls : null),
      newId,
      clock: () => NOW,
    });
    const job = runtime.runJob({ workerId: 'worker:ops', skillId: 'exec' });
    expect(job.status).toBe('awaiting_approval');
    const approved = runtime.approveProposal(job.id, job.proposals[0].id, 'alice', null);
    expect(approved?.status).toBe('succeeded');
  });

  it('never strands a job in running when the engine is not ready (settles failed)', async () => {
    const registry = new WorkerRegistry(tempPath());
    const audit = new AuditLog(tempPath()).bindScope(() => TEST_TENANT_SCOPE);
    const jobs = new JobStore(tempPath()).bindScope(() => TEST_TENANT_SCOPE);
    stores.push(registry, audit, jobs);
    await registry.load();
    await audit.load();
    await jobs.load();
    registry.register({ worker: worker(), skills: new Map() }, NOW);
    const runtime = new WorkerRuntime({
      registry,
      governance: new GovernanceRuntime(audit),
      jobs,
      dataProvider: () => data,
      skillsFor: (id) => (id === 'worker:ops' ? impls : null),
      newId,
      clock: () => NOW,
    });
    // Mirror initWorkforce's engine-not-ready branch: settle failed instead of hanging.
    runtime.setDispatchApproved((job, proposals) => {
      const bindings = proposals.filter((p) => p.execution);
      if (bindings.length === 0) return;
      runtime.settleExecution(job.id, { ok: false, summary: null, error: 'Execution engine not ready', executionId: '', executor: bindings[0].execution!.executor });
    });
    const job = runtime.runJob({ workerId: 'worker:ops', skillId: 'exec' });
    const approved = runtime.approveProposal(job.id, job.proposals[0].id, 'alice', null);
    expect(approved?.status).toBe('failed');
    expect(runtime.getJob(job.id)!.error).toBe('Execution engine not ready');
  });

  it('settleExecution is idempotent — only a running job settles', async () => {
    const { runtime, dispatched } = await setup(async () => completedSession());
    const job = runtime.runJob({ workerId: 'worker:ops', skillId: 'exec' });
    runtime.approveProposal(job.id, job.proposals[0].id, 'alice', null);
    await dispatched();
    expect(runtime.getJob(job.id)!.status).toBe('succeeded');
    // A second settle on an already-succeeded job is a no-op.
    runtime.settleExecution(job.id, { ok: false, summary: null, error: 'late', executionId: 'x', executor: 'infra' });
    expect(runtime.getJob(job.id)!.status).toBe('succeeded');
  });
});

describe('JobStore crash recovery (P8.3)', () => {
  it('recovers an orphaned running job to failed on load', async () => {
    const p = tempPath();
    const running: Job = {
      id: 'stuck',
      workerId: 'w',
      workerRole: 'operations',
      skillId: 's',
      status: 'running',
      input: {},
      requestedBy: 'u',
      summary: null,
      evidence: [],
      proposals: [],
      logs: [],
      error: null,
      grounded: true,
      createdAt: NOW,
      startedAt: NOW,
      finishedAt: null,
      durationMs: null,
    };
    await fs.writeFile(p, JSON.stringify({ jobs: [running] }));
    const store = new JobStore(p).bindScope(() => TEST_TENANT_SCOPE);
    stores.push(store);
    await store.load();
    /**
     * P13C Round 2 — crash recovery is a MAINTENANCE sweep, not a tenant read.
     *
     * A crash orphans every tenant's running jobs, so recovery must settle all
     * of them — leaving another tenant's job stuck 'running' forever would be a
     * worse bug than the one being fixed. It therefore iterates the raw map at
     * load, and is asserted here through the unscoped accessor.
     */
    const recovered = store.unscopedForRuntime('stuck')!;
    expect(recovered.status).toBe('failed');
    expect(recovered.error).toBe('Interrupted by application restart');
    expect(recovered.finishedAt).not.toBeNull();

    /**
     * And the row written before P13C carries no owner, so it is visible to
     * NOBODY through the tenant-facing accessor — recovered, retained, and
     * shown to no one, which is the same rule every other pre-boundary store
     * follows.
     */
    expect(store.get('stuck')).toBeNull();
    expect(store.ownershipCounts()).toEqual({ total: 1, assigned: 0, unresolved: 1 });
  });
});
