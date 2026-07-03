import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Worker, WorkflowSpec, WorkflowStep } from '@neuropause/shared';
import { WorkerRegistry } from '../registry/workerRegistry';
import { AuditLog } from '../governance/auditLog';
import { GovernanceRuntime } from '../governance';
import { JobStore } from '../runtime/jobStore';
import { WorkerRuntime } from '../runtime/workerRuntime';
import type { SkillImpl, WorkforceData } from '../sdk';
import { Orchestrator } from './orchestrator';

const NOW = '2026-02-12T00:00:00.000Z';

const stores: Array<{ flush: () => Promise<void> }> = [];
const paths: string[] = [];
let jobCounter = 0;
let wfCounter = 0;
let flakyCalls = 0;

function tempPath(): string {
  const p = join(tmpdir(), `nps-orch-${randomUUID()}.json`);
  paths.push(p);
  return p;
}

function worker(): Worker {
  return {
    identity: { id: 'worker:flow', name: 'Flow', role: 'operations', version: '1.0.0', developer: 'np' },
    goals: [],
    skills: [
      { id: 'ok', title: 'Ok', description: 'always ok', sideEffects: false, requires: ['read:entities'] },
      { id: 'flaky', title: 'Flaky', description: 'fails once', sideEffects: false, requires: ['read:entities'] },
      { id: 'fail', title: 'Fail', description: 'throws', sideEffects: false, requires: ['read:entities'] },
      { id: 'slow', title: 'Slow', description: 'burns time', sideEffects: false, requires: ['read:entities'] },
      { id: 'propose', title: 'Propose', description: 'side effect', sideEffects: true, requires: ['propose:draft'] },
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

const okSkill: SkillImpl = {
  id: 'ok',
  run: (ctx) => ({ summary: `ok ${ctx.data.entities.length}`, evidence: [], grounded: true, proposals: [] }),
};
const flakySkill: SkillImpl = {
  id: 'flaky',
  run: () => {
    flakyCalls += 1;
    if (flakyCalls === 1) throw new Error('flaky first attempt');
    return { summary: 'ok on retry', evidence: [], grounded: true, proposals: [] };
  },
};
const failSkill: SkillImpl = {
  id: 'fail',
  run: () => {
    throw new Error('always fails');
  },
};
const slowSkill: SkillImpl = {
  id: 'slow',
  run: () => {
    const start = Date.now();
    while (Date.now() - start < 12) {
      /* deliberately burn wall-clock to exceed a tiny timeout budget */
    }
    return { summary: 'slow done', evidence: [], grounded: true, proposals: [] };
  },
};
const proposeSkill: SkillImpl = {
  id: 'propose',
  run: () => ({
    summary: 'prepared a draft',
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

const impls = new Map<string, SkillImpl>([
  ['ok', okSkill],
  ['flaky', flakySkill],
  ['fail', failSkill],
  ['slow', slowSkill],
  ['propose', proposeSkill],
]);
const data: WorkforceData = { now: NOW, entities: [{ id: 'e1' } as never], events: [], memories: [], neighbors: () => [] };

async function setup() {
  jobCounter = 0;
  wfCounter = 0;
  flakyCalls = 0;
  const registry = new WorkerRegistry(tempPath());
  const audit = new AuditLog(tempPath());
  const jobs = new JobStore(tempPath());
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
    skillsFor: (id) => (id === 'worker:flow' ? impls : null),
    newId: () => `job-${++jobCounter}`,
    clock: () => NOW,
  });
  const orchestrator = new Orchestrator({ runtime, newId: () => `wf-${++wfCounter}`, clock: () => NOW });
  return { registry, governance, jobs, runtime, orchestrator };
}

function step(id: string, over: Partial<WorkflowStep> = {}): WorkflowStep {
  return { id, kind: 'worker', workerId: 'worker:flow', skillId: 'ok', dependsOn: [], ...over };
}

function spec(steps: WorkflowStep[], id = 'wf'): WorkflowSpec {
  return { id, name: id, description: 'test workflow', steps };
}

afterEach(async () => {
  await Promise.all(stores.map((s) => s.flush()));
  stores.length = 0;
  for (const p of paths) await fs.rm(p, { force: true });
  paths.length = 0;
});

describe('Orchestrator', () => {
  it('runs a sequential chain A→B→C to success', async () => {
    const { orchestrator } = await setup();
    const wf = spec([
      step('A'),
      step('B', { dependsOn: ['A'] }),
      step('C', { dependsOn: ['B'] }),
    ]);
    const run = orchestrator.start(wf, NOW);
    expect(run.status).toBe('succeeded');
    expect(run.stepRuns.map((r) => r.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    expect(run.finishedAt).toBe(NOW);
  });

  it('runs independent branches in parallel before a join (A,B → C)', async () => {
    const { orchestrator } = await setup();
    const wf = spec([
      step('A'),
      step('B'),
      step('C', { dependsOn: ['A', 'B'] }),
    ]);
    const run = orchestrator.start(wf, NOW);
    expect(run.status).toBe('succeeded');
    expect(run.stepRuns.every((r) => r.status === 'succeeded')).toBe(true);
  });

  it('retries a failing step within its retry budget and then succeeds', async () => {
    const { orchestrator } = await setup();
    const wf = spec([step('A', { skillId: 'flaky', retry: 1 })]);
    const run = orchestrator.start(wf, NOW);
    expect(run.status).toBe('succeeded');
    expect(run.stepRuns[0].status).toBe('succeeded');
    expect(run.stepRuns[0].attempts).toBe(2);
  });

  it('fails a step that exceeds its timeout budget', async () => {
    const { orchestrator } = await setup();
    const wf = spec([
      step('A', { skillId: 'slow', timeoutMs: 5 }),
      step('B', { dependsOn: ['A'] }),
    ]);
    const run = orchestrator.start(wf, NOW);
    expect(run.status).toBe('failed');
    expect(run.stepRuns[0].status).toBe('failed');
    expect(run.stepRuns[1].status).toBe('skipped');
  });

  it('skips dependents when a step fails', async () => {
    const { orchestrator } = await setup();
    const wf = spec([
      step('A', { skillId: 'fail' }),
      step('B', { dependsOn: ['A'] }),
      step('C', { dependsOn: ['B'] }),
    ]);
    const run = orchestrator.start(wf, NOW);
    expect(run.status).toBe('failed');
    expect(run.stepRuns[0].status).toBe('failed');
    expect(run.stepRuns[1].status).toBe('skipped');
    expect(run.stepRuns[2].status).toBe('skipped');
  });

  it('pauses at an explicit approval checkpoint and resumes on approve', async () => {
    const { orchestrator } = await setup();
    const wf = spec([
      step('A'),
      step('B', { kind: 'approval', dependsOn: ['A'], approvalPrompt: 'Proceed?' }),
      step('C', { dependsOn: ['B'] }),
    ]);
    let run = orchestrator.start(wf, NOW);
    expect(run.status).toBe('awaiting_approval');
    expect(run.stepRuns[1].status).toBe('awaiting_approval');
    expect(run.stepRuns[2].status).toBe('pending');

    run = orchestrator.approveCheckpoint(run, wf, 'B', true, NOW);
    expect(run.status).toBe('succeeded');
    expect(run.stepRuns.map((r) => r.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
  });

  it('rejecting an approval checkpoint fails the run and skips dependents', async () => {
    const { orchestrator } = await setup();
    const wf = spec([
      step('A', { kind: 'approval', approvalPrompt: 'Proceed?' }),
      step('B', { dependsOn: ['A'] }),
    ]);
    let run = orchestrator.start(wf, NOW);
    expect(run.status).toBe('awaiting_approval');
    run = orchestrator.approveCheckpoint(run, wf, 'A', false, NOW);
    expect(run.status).toBe('failed');
    expect(run.stepRuns[0].status).toBe('failed');
    expect(run.stepRuns[1].status).toBe('skipped');
  });

  it('parks a worker step whose job needs approval, then completes via the runtime + resume', async () => {
    const { orchestrator, runtime } = await setup();
    const wf = spec([
      step('A', { skillId: 'propose' }),
      step('B', { dependsOn: ['A'] }),
    ]);
    let run = orchestrator.start(wf, NOW);
    expect(run.status).toBe('awaiting_approval');
    expect(run.stepRuns[0].status).toBe('awaiting_approval');
    expect(run.stepRuns[1].status).toBe('pending');

    const jobId = run.stepRuns[0].jobId!;
    const job = runtime.getJob(jobId)!;
    expect(job.status).toBe('awaiting_approval');
    runtime.approveProposal(jobId, job.proposals[0].id, 'saurabh', 'ok', NOW);

    run = orchestrator.resume(run, wf, NOW);
    expect(run.status).toBe('succeeded');
    expect(run.stepRuns[0].status).toBe('succeeded');
    expect(run.stepRuns[1].status).toBe('succeeded');
  });
});
