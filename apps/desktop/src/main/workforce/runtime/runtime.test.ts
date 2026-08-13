import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Worker } from '@neuropause/shared';
import { WorkerRegistry } from '../registry/workerRegistry';
import { AuditLog } from '../governance/auditLog';
import { GovernanceRuntime } from '../governance';
import { JobStore } from './jobStore';
import { WorkerRuntime } from './workerRuntime';
import { Scheduler } from './scheduler';
import type { SkillImpl, WorkforceData } from '../sdk';
import { TEST_TENANT_SCOPE } from '../../tenancy/testScope';

const NOW = '2026-02-10T00:00:00.000Z';

const stores: Array<{ flush: () => Promise<void> }> = [];
const paths: string[] = [];
let counter = 0;
const newId = () => `id-${++counter}`;

function tempPath(): string {
  const p = join(tmpdir(), `nps-rt-${randomUUID()}.json`);
  paths.push(p);
  return p;
}

function worker(over: Partial<Worker> = {}): Worker {
  return {
    identity: { id: 'worker:ops', name: 'Ops', role: 'operations', version: '1.0.0', developer: 'np' },
    goals: [],
    skills: [
      { id: 'read', title: 'Read', description: 'r', sideEffects: false, requires: ['read:entities'] },
      { id: 'draft', title: 'Draft', description: 'd', sideEffects: true, requires: ['propose:draft'] },
      { id: 'boom', title: 'Boom', description: 'b', sideEffects: false, requires: ['read:entities'] },
    ],
    permissions: [
      { scope: 'read:entities', granted: true },
      { scope: 'propose:draft', granted: true },
    ],
    memoryScope: 'self',
    policyIds: [],
    trustScore: 0.7,
    lifecycle: 'idle',
    health: { state: 'healthy', lastCheckAt: NOW, successRate: 1, jobsRun: 0, jobsFailed: 0, message: null },
    createdAt: NOW,
    updatedAt: NOW,
    builtIn: true,
    metadata: {},
    ...over,
  };
}

const readSkill: SkillImpl = {
  id: 'read',
  run: (ctx) => ({
    summary: `Saw ${ctx.data.entities.length} entities`,
    evidence: [],
    grounded: ctx.data.entities.length > 0,
    proposals: [],
  }),
};
const draftSkill: SkillImpl = {
  id: 'draft',
  run: () => ({
    summary: 'Prepared a draft',
    evidence: [{ kind: 'entity', id: 'e1' }],
    grounded: true,
    proposals: [
      {
        title: 'Send draft',
        summary: 'send it',
        sideEffects: true,
        permissions: ['propose:draft'],
        risk: 'medium',
        evidence: [{ kind: 'entity', id: 'e1' }],
        payload: { to: 'x' },
      },
    ],
  }),
};
const boomSkill: SkillImpl = {
  id: 'boom',
  run: () => {
    throw new Error('kaboom');
  },
};

const impls = new Map<string, SkillImpl>([
  ['read', readSkill],
  ['draft', draftSkill],
  ['boom', boomSkill],
]);
const data: WorkforceData = { now: NOW, entities: [{ id: 'e1' } as never], events: [], memories: [], neighbors: () => [] };

async function setup() {
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
  return { registry, governance, jobs, runtime };
}

afterEach(async () => {
  await Promise.all(stores.map((s) => s.flush()));
  stores.length = 0;
  for (const p of paths) await fs.rm(p, { force: true });
  paths.length = 0;
});

describe('WorkerRuntime', () => {
  it('runs a read-only skill to success and delivers the summary', async () => {
    const { runtime, registry } = await setup();
    const job = runtime.runJob({ workerId: 'worker:ops', skillId: 'read' });
    expect(job.status).toBe('succeeded');
    expect(job.summary).toContain('1 entities');
    expect(job.proposals).toHaveLength(0);
    expect(job.durationMs).toBeGreaterThanOrEqual(0);
    expect(registry.get('worker:ops')!.trustScore).toBe(0.72);
  });

  it('parks a side-effecting proposal for approval, then completes on approve', async () => {
    const { runtime, registry } = await setup();
    const job = runtime.runJob({ workerId: 'worker:ops', skillId: 'draft' });
    expect(job.status).toBe('awaiting_approval');
    expect(job.proposals).toHaveLength(1);
    expect(job.proposals[0].verdict.decision).toBe('require_approval');
    expect(registry.get('worker:ops')!.health.jobsRun).toBe(0);

    const done = runtime.approveProposal(job.id, job.proposals[0].id, 'saurabh', 'ok', NOW)!;
    expect(done.status).toBe('succeeded');
    expect(done.proposals[0].approval!.decision).toBe('approved');
    expect(registry.get('worker:ops')!.health.jobsRun).toBe(1);
  });

  it('rejecting the only proposal still completes the job', async () => {
    const { runtime } = await setup();
    const job = runtime.runJob({ workerId: 'worker:ops', skillId: 'draft' });
    const done = runtime.rejectProposal(job.id, job.proposals[0].id, 'saurabh', 'no', NOW)!;
    expect(done.status).toBe('succeeded');
    expect(done.proposals[0].approval!.decision).toBe('rejected');
  });

  it('records a failed job when the skill throws and lowers trust', async () => {
    const { runtime, registry } = await setup();
    const job = runtime.runJob({ workerId: 'worker:ops', skillId: 'boom' });
    expect(job.status).toBe('failed');
    expect(job.error).toContain('kaboom');
    expect(registry.get('worker:ops')!.trustScore).toBe(0.65);
  });

  it('fails cleanly for an unknown skill', async () => {
    const { runtime } = await setup();
    const job = runtime.runJob({ workerId: 'worker:ops', skillId: 'nope' });
    expect(job.status).toBe('failed');
    expect(job.error).toContain('no skill');
  });

  it('schedules background execution: enqueue is queued, drain runs it', async () => {
    const { runtime, jobs } = await setup();
    const scheduler = new Scheduler(runtime, { newId, clock: () => NOW });
    const jobId = scheduler.enqueue({ workerId: 'worker:ops', skillId: 'read' });
    expect(jobs.get(jobId)!.status).toBe('queued');
    expect(scheduler.depth()).toBe(1);
    scheduler.drain();
    expect(scheduler.depth()).toBe(0);
    expect(jobs.get(jobId)!.status).toBe('succeeded');
  });
});
