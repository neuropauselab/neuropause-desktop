/**
 * The Workforce Orchestrator runs a workflow — a DAG of steps — over the Worker
 * Runtime. It supports:
 *
 *   • sequential & parallel execution — a step runs as soon as its `dependsOn`
 *     steps have succeeded, so independent branches advance together;
 *   • retry — a failing worker step is retried up to its `retry` budget;
 *   • timeout — a step whose run exceeds `timeoutMs` is failed;
 *   • dependency management — dependents of a failed step are skipped;
 *   • human approval checkpoints — an `approval` step (or a worker step whose job
 *     parked proposals) pauses the run until a human resolves it.
 *
 * Worker steps execute synchronously through the runtime, so a run advances as
 * far as it can in one pass and then reports `succeeded`, `failed`, or
 * `awaiting_approval`. Resolving a checkpoint and calling `resume` continues it.
 * The runtime, id generation, and clock are injected — no Electron, no I/O.
 */
import { randomUUID } from 'node:crypto';
import type { WorkflowRun, WorkflowSpec, WorkflowStep, WorkflowStepRun } from '@neuropause/shared';
import { createLogger } from '../../logger';
import type { WorkerRuntime } from '../runtime';

const log = createLogger('workforce-orchestrator');

export interface OrchestratorDeps {
  runtime: WorkerRuntime;
  newId?: () => string;
  clock?: () => string;
}

export class Orchestrator {
  private readonly newId: () => string;
  private readonly clock: () => string;

  constructor(private readonly deps: OrchestratorDeps) {
    this.newId = deps.newId ?? randomUUID;
    this.clock = deps.clock ?? (() => new Date().toISOString());
  }

  /** Begin a workflow run and advance it as far as it can go in one pass. */
  start(spec: WorkflowSpec, now = this.clock()): WorkflowRun {
    const run: WorkflowRun = {
      id: this.newId(),
      workflowId: spec.id,
      status: 'pending',
      stepRuns: spec.steps.map((s) => ({
        stepId: s.id,
        status: 'pending',
        jobId: null,
        attempts: 0,
        startedAt: null,
        finishedAt: null,
      })),
      startedAt: now,
      finishedAt: null,
    };
    log.info('Workflow started', { workflow: spec.id, steps: spec.steps.length });
    this.advance(run, spec, now);
    return run;
  }

  /** Continue a run after external resolution (e.g. a job's proposals approved). */
  resume(run: WorkflowRun, spec: WorkflowSpec, now = this.clock()): WorkflowRun {
    this.advance(run, spec, now);
    return run;
  }

  /** Resolve an explicit approval checkpoint, then continue. */
  approveCheckpoint(
    run: WorkflowRun,
    spec: WorkflowSpec,
    stepId: string,
    approved: boolean,
    now = this.clock(),
  ): WorkflowRun {
    const sr = run.stepRuns.find((r) => r.stepId === stepId);
    if (sr && sr.status === 'awaiting_approval') {
      sr.status = approved ? 'succeeded' : 'failed';
      sr.finishedAt = now;
    }
    this.advance(run, spec, now);
    return run;
  }

  private advance(run: WorkflowRun, spec: WorkflowSpec, now: string): void {
    const stepById = new Map(spec.steps.map((s) => [s.id, s]));
    const runById = new Map(run.stepRuns.map((r) => [r.stepId, r]));

    // Reconcile worker steps that were awaiting approval against their jobs.
    for (const sr of run.stepRuns) {
      if (sr.status !== 'awaiting_approval') continue;
      const step = stepById.get(sr.stepId);
      if (step?.kind === 'worker' && sr.jobId) {
        const job = this.deps.runtime.getJob(sr.jobId);
        if (job?.status === 'succeeded') {
          sr.status = 'succeeded';
          sr.finishedAt = now;
        } else if (job?.status === 'failed') {
          sr.status = 'failed';
          sr.finishedAt = now;
        }
      }
    }

    // Run ready steps in waves until nothing new can progress.
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const step of spec.steps) {
        const sr = runById.get(step.id);
        if (!sr || sr.status !== 'pending') continue;
        const depsOk = step.dependsOn.every((d) => runById.get(d)?.status === 'succeeded');
        if (!depsOk) continue;

        sr.startedAt = now;
        if (step.kind === 'approval') {
          sr.status = 'awaiting_approval';
        } else {
          const after = this.runWorkerStep(step, sr, spec, now);
          if (after === 'succeeded') progressed = true;
        }
      }
    }

    this.recomputeStatus(run, now);
  }

  private runWorkerStep(
    step: WorkflowStep,
    sr: WorkflowStepRun,
    spec: WorkflowSpec,
    now: string,
  ): WorkflowStepRun['status'] {
    const maxAttempts = Math.max((step.retry ?? 0) + 1, 1);
    const timeoutMs = step.timeoutMs ?? 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      sr.attempts = attempt;
      const t0 = Date.now();
      const job = this.deps.runtime.runJob({
        workerId: step.workerId ?? '',
        skillId: step.skillId ?? '',
        input: step.input,
        requestedBy: `workflow:${spec.id}`,
        now,
      });
      const elapsed = Date.now() - t0;
      sr.jobId = job.id;

      if (timeoutMs > 0 && elapsed > timeoutMs) {
        sr.status = 'failed';
        sr.finishedAt = now;
        return sr.status;
      }
      if (job.status === 'failed') {
        if (attempt < maxAttempts) continue;
        sr.status = 'failed';
        sr.finishedAt = now;
        return sr.status;
      }
      if (job.status === 'awaiting_approval') {
        sr.status = 'awaiting_approval';
        return sr.status;
      }
      sr.status = 'succeeded';
      sr.finishedAt = now;
      return sr.status;
    }
    return sr.status;
  }

  private recomputeStatus(run: WorkflowRun, now: string): void {
    const statuses = run.stepRuns.map((r) => r.status);
    if (statuses.includes('failed')) {
      for (const sr of run.stepRuns) if (sr.status === 'pending') sr.status = 'skipped';
      run.status = 'failed';
      run.finishedAt = now;
      return;
    }
    if (statuses.includes('awaiting_approval')) {
      run.status = 'awaiting_approval';
      return;
    }
    if (run.stepRuns.every((r) => r.status === 'succeeded' || r.status === 'skipped')) {
      run.status = 'succeeded';
      run.finishedAt = now;
      return;
    }
    run.status = 'running';
  }
}
