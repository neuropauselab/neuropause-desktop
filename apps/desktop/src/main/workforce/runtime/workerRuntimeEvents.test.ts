/**
 * P8.2 — WorkerRuntime emits worker/approval timeline events (with correlation).
 * Constructs the real runtime with a capturing `publish` and asserts the event
 * sequence for the success, approval, and failure paths. Mirrors the fixtures in
 * runtime.test.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PlatformEventInput, Worker } from '@neuropause/shared';
import { WorkerRegistry } from '../registry/workerRegistry';
import { AuditLog } from '../governance/auditLog';
import { GovernanceRuntime } from '../governance';
import { JobStore } from './jobStore';
import { WorkerRuntime } from './workerRuntime';
import type { SkillImpl, WorkforceData } from '../sdk';

const NOW = '2026-07-15T00:00:00.000Z';
const stores: Array<{ flush: () => Promise<void> }> = [];
const paths: string[] = [];
let counter = 0;
const newId = (): string => `id-${++counter}`;

function tempPath(): string {
  const p = join(tmpdir(), `nps-evt-${randomUUID()}.json`);
  paths.push(p);
  return p;
}

function worker(): Worker {
  return {
    identity: { id: 'worker:ops', name: 'Ops', role: 'operations', version: '1.0.0', developer: 'np' },
    goals: [],
    skills: [
      { id: 'read', title: 'Read', description: 'r', sideEffects: false, requires: ['read:entities'] },
      { id: 'draft', title: 'Draft', description: 'd', sideEffects: true, requires: ['propose:draft'] },
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
  };
}

const readSkill: SkillImpl = {
  id: 'read',
  run: (ctx) => ({ summary: `Saw ${ctx.data.entities.length}`, evidence: [], grounded: true, proposals: [] }),
};
const draftSkill: SkillImpl = {
  id: 'draft',
  run: () => ({
    summary: 'Prepared a draft',
    evidence: [{ kind: 'entity', id: 'e1' }],
    grounded: true,
    proposals: [
      { title: 'Send draft', summary: 'send it', sideEffects: true, permissions: ['propose:draft'], risk: 'medium', evidence: [{ kind: 'entity', id: 'e1' }], payload: { to: 'x' } },
    ],
  }),
};
const impls = new Map<string, SkillImpl>([
  ['read', readSkill],
  ['draft', draftSkill],
]);
const data: WorkforceData = { now: NOW, entities: [{ id: 'e1' } as never], events: [], memories: [], neighbors: () => [] };

async function setup(withPublish = true): Promise<{ runtime: WorkerRuntime; events: PlatformEventInput[] }> {
  counter = 0;
  const registry = new WorkerRegistry(tempPath());
  const audit = new AuditLog(tempPath());
  const jobs = new JobStore(tempPath());
  stores.push(registry, audit, jobs);
  await registry.load();
  await audit.load();
  await jobs.load();
  const governance = new GovernanceRuntime(audit);
  registry.register({ worker: worker(), skills: new Map() }, NOW);
  const events: PlatformEventInput[] = [];
  const runtime = new WorkerRuntime({
    registry,
    governance,
    jobs,
    dataProvider: () => data,
    skillsFor: (id) => (id === 'worker:ops' ? impls : null),
    newId,
    clock: () => NOW,
    ...(withPublish ? { publish: (e: PlatformEventInput) => events.push(e) } : {}),
  });
  return { runtime, events };
}

afterEach(async () => {
  await Promise.all(stores.map((s) => s.flush()));
  stores.length = 0;
  for (const p of paths) await fs.rm(p, { force: true });
  paths.length = 0;
});

describe('WorkerRuntime timeline events', () => {
  it('emits started + succeeded with correlationId = jobId for a read-only job', async () => {
    const { runtime, events } = await setup();
    const job = runtime.runJob({ workerId: 'worker:ops', skillId: 'read' });
    expect(job.status).toBe('succeeded');
    expect(events.map((e) => e.type)).toEqual(['worker.job_started', 'worker.job_succeeded']);
    for (const e of events) expect(e.correlationId).toBe(job.id);
    expect(events[0].metadata).toMatchObject({ workerId: 'worker:ops', jobId: job.id, taskId: job.id, skillId: 'read' });
  });

  it('groups a job into a larger chain via spec.correlationId', async () => {
    const { runtime, events } = await setup();
    runtime.runJob({ workerId: 'worker:ops', skillId: 'read', correlationId: 'goal-42' });
    expect(events.length).toBe(2);
    expect(events.every((e) => e.correlationId === 'goal-42')).toBe(true);
  });

  it('keeps ONE correlationId across the whole approval chain (regression)', async () => {
    const { runtime, events } = await setup();
    const job = runtime.runJob({ workerId: 'worker:ops', skillId: 'draft', correlationId: 'goal-99' });
    runtime.approveProposal(job.id, job.proposals[0].id, 'alice', null);
    // started, awaiting_approval, approval.granted, succeeded — all under goal-99.
    expect(events.map((e) => e.type)).toEqual([
      'worker.job_started',
      'worker.job_awaiting_approval',
      'approval.granted',
      'worker.job_succeeded',
    ]);
    expect(events.every((e) => e.correlationId === 'goal-99')).toBe(true);
  });

  it('emits started + awaiting_approval, then approval.granted + succeeded on approve', async () => {
    const { runtime, events } = await setup();
    const job = runtime.runJob({ workerId: 'worker:ops', skillId: 'draft' });
    expect(job.status).toBe('awaiting_approval');
    expect(events.map((e) => e.type)).toEqual(['worker.job_started', 'worker.job_awaiting_approval']);
    expect(events[1].metadata?.pendingApprovals).toBe(1);

    events.length = 0;
    const updated = runtime.approveProposal(job.id, job.proposals[0].id, 'alice', null);
    expect(updated?.status).toBe('succeeded');
    expect(events.map((e) => e.type)).toEqual(['approval.granted', 'worker.job_succeeded']);
    expect(events[0].actor).toEqual({ kind: 'user', id: 'alice' });
    expect(events[0].metadata).toMatchObject({ jobId: job.id, proposalId: job.proposals[0].id, decidedBy: 'alice' });
  });

  it('emits approval.rejected, then the job completes (existing decide() semantics)', async () => {
    // NOTE: the existing runtime marks a job succeeded once no proposal is still
    // pending — including after a reject of the sole proposal. P8.2 only surfaces
    // that transition as events; it does not change the runtime's approval logic.
    const { runtime, events } = await setup();
    const job = runtime.runJob({ workerId: 'worker:ops', skillId: 'draft' });
    events.length = 0;
    runtime.rejectProposal(job.id, job.proposals[0].id, 'bob', 'no');
    expect(events.map((e) => e.type)).toEqual(['approval.rejected', 'worker.job_succeeded']);
    expect(events[0].actor).toEqual({ kind: 'user', id: 'bob' });
  });

  it('emits a single failed event for an unknown worker', async () => {
    const { runtime, events } = await setup();
    runtime.runJob({ workerId: 'ghost', skillId: 'read' });
    expect(events.map((e) => e.type)).toEqual(['worker.job_failed']);
  });

  it('emits nothing when no publisher is wired', async () => {
    const { runtime, events } = await setup(false);
    runtime.runJob({ workerId: 'worker:ops', skillId: 'read' });
    expect(events).toHaveLength(0);
  });
});
