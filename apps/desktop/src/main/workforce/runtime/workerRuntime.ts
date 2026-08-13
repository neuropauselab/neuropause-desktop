/**
 * The Worker Runtime facade. It runs a worker skill end to end: resolve the
 * worker and its skill, snapshot the intelligence layer and scope it to the
 * worker's permissions, execute the skill (see executor.ts), persist the
 * resulting `Job`, and feed the outcome back into the registry so trust and
 * health evolve. It also owns the human side of the loop — approving or
 * rejecting the proposals a job parked for review.
 *
 * Dependencies are injected (registry, governance, job store, a data provider,
 * and a skill lookup), so the runtime is electron-free and unit-testable; the
 * application wires the real singletons in the composition root.
 */
import { randomUUID } from 'node:crypto';
import type { Job, JobPage, JobProposal, JobSpec, PlatformEventInput, WorkerRole } from '@neuropause/shared';
import { createLogger } from '../../logger';
import { scopeData, type SkillImpl, type WorkforceData } from '../sdk';
import type { WorkerRegistry } from '../registry/workerRegistry';
import type { GovernanceRuntime } from '../governance';
import type { JobStore, JobQuery } from './jobStore';
import { executeJob, pendingApprovalCount } from './executor';
import { approvalDecisionEvent, jobLifecycleEvent, type WorkerJobEventKind } from './workerEvents';
import type { WorkforceExecutionOutcome } from '../execution/router';

const log = createLogger('workforce-runtime');

export interface WorkerRuntimeDeps {
  registry: WorkerRegistry;
  governance: GovernanceRuntime;
  jobs: JobStore;
  /** Unscoped intelligence-layer snapshot for a run. */
  dataProvider: (now: string) => WorkforceData;
  /** Skill implementations for a worker, by skill id. */
  skillsFor: (workerId: string) => Map<string, SkillImpl> | null;
  newId?: () => string;
  clock?: () => string;
  /**
   * P8.2 — publish worker/job lifecycle events onto the platform bus → timeline.
   * Optional so the runtime still runs standalone/in tests; the composition root
   * passes `platform.api.publish` (the same seam workflow lifecycle uses).
   */
  publish?: (event: PlatformEventInput) => void;
}

/** P8.3 — dispatch an approved job's binding-carrying proposals into execution. */
export type DispatchApproved = (job: Job, proposals: JobProposal[]) => void;

export class WorkerRuntime {
  private readonly newId: () => string;
  private readonly clock: () => string;
  /**
   * P8.3 — set by the composition root after the ExecuteEngine exists (the engine
   * is built after the workforce). null → approved actions stay advisory.
   */
  private dispatchApprovedFn: DispatchApproved | null = null;

  constructor(private readonly deps: WorkerRuntimeDeps) {
    this.newId = deps.newId ?? randomUUID;
    this.clock = deps.clock ?? (() => new Date().toISOString());
  }

  /** P8.3 — wire the approved-work dispatcher (late-bound; see initWorkforce). */
  setDispatchApproved(fn: DispatchApproved): void {
    this.dispatchApprovedFn = fn;
  }

  /** Emit a worker job-lifecycle event (no-op when no publisher is wired). */
  private emitJob(kind: WorkerJobEventKind, job: Job, correlationId: string): void {
    if (!this.deps.publish) return;
    this.deps.publish(
      jobLifecycleEvent(kind, {
        jobId: job.id,
        workerId: job.workerId,
        workerRole: job.workerRole,
        skillId: job.skillId,
        correlationId,
        requestedBy: job.requestedBy,
        summary: job.summary,
        durationMs: job.durationMs,
        error: job.error,
        pendingApprovals: kind === 'awaiting_approval' ? pendingApprovalCount(job) : undefined,
      }),
    );
  }

  /** Run a job synchronously and return its terminal (or awaiting-approval) state. */
  runJob(spec: JobSpec): Job {
    const now = spec.now ?? this.clock();
    return this.execute(spec, this.newId(), now, now);
  }

  /** Materialise a queued job (used by the scheduler before background execution). */
  createQueued(spec: JobSpec, jobId: string, now: string): Job {
    const worker = this.deps.registry.get(spec.workerId);
    const job: Job = {
      id: jobId,
      workerId: spec.workerId,
      workerRole: worker?.identity.role ?? 'operations',
      skillId: spec.skillId,
      correlationId: spec.correlationId ?? jobId,
      status: 'queued',
      input: spec.input ?? {},
      requestedBy: spec.requestedBy ?? 'system',
      summary: null,
      evidence: [],
      proposals: [],
      logs: [{ at: now, level: 'info', message: 'Queued for background execution.' }],
      error: null,
      grounded: false,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
    };
    this.deps.jobs.put(job);
    this.emitJob('queued', job, spec.correlationId ?? jobId);
    return job;
  }

  /** Execute a previously queued job in place. */
  executeQueued(jobId: string, spec: JobSpec, createdAt: string): Job {
    const now = spec.now ?? this.clock();
    return this.execute(spec, jobId, now, createdAt);
  }

  private execute(spec: JobSpec, jobId: string, now: string, createdAt: string): Job {
    const requestedBy = spec.requestedBy ?? 'system';
    const input = spec.input ?? {};

    const worker = this.deps.registry.get(spec.workerId);
    if (!worker) return this.fail(jobId, spec, now, createdAt, `Unknown worker "${spec.workerId}".`, 'operations');

    const skill = this.deps.skillsFor(spec.workerId)?.get(spec.skillId);
    if (!skill) {
      return this.fail(jobId, spec, now, createdAt, `Worker "${spec.workerId}" has no skill "${spec.skillId}".`, worker.identity.role);
    }

    const correlationId = spec.correlationId ?? jobId;
    if (this.deps.publish) {
      this.deps.publish(
        jobLifecycleEvent('started', {
          jobId,
          workerId: worker.identity.id,
          workerRole: worker.identity.role,
          skillId: spec.skillId,
          correlationId,
          requestedBy,
        }),
      );
    }

    const scoped = scopeData(this.deps.dataProvider(now), worker);
    const job = executeJob({
      jobId,
      worker,
      skill,
      data: scoped,
      input,
      requestedBy,
      now,
      createdAt,
      deps: {
        evaluate: (req, w, n) => this.deps.governance.evaluate(req, w, n),
        newId: this.newId,
      },
    });

    job.correlationId = correlationId;
    this.deps.jobs.put(job);
    if (job.status === 'succeeded') {
      this.deps.registry.recordOutcome(worker.identity.id, true, now);
      this.emitJob('succeeded', job, correlationId);
    } else if (job.status === 'failed') {
      this.deps.registry.recordOutcome(worker.identity.id, false, now);
      this.emitJob('failed', job, correlationId);
    } else if (job.status === 'awaiting_approval') {
      this.emitJob('awaiting_approval', job, correlationId);
    }
    return job;
  }

  private fail(
    jobId: string,
    spec: JobSpec,
    now: string,
    createdAt: string,
    message: string,
    role: WorkerRole,
  ): Job {
    log.warn('Job could not run', { jobId, message });
    const job: Job = {
      id: jobId,
      workerId: spec.workerId,
      workerRole: role,
      skillId: spec.skillId,
      correlationId: spec.correlationId ?? jobId,
      status: 'failed',
      input: spec.input ?? {},
      requestedBy: spec.requestedBy ?? 'system',
      summary: null,
      evidence: [],
      proposals: [],
      logs: [{ at: now, level: 'error', message }],
      error: message,
      grounded: false,
      createdAt,
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
    };
    this.deps.jobs.put(job);
    this.emitJob('failed', job, spec.correlationId ?? jobId);
    return job;
  }

  getJob(id: string): Job | null {
    return this.deps.jobs.get(id);
  }

  listJobs(query: JobQuery = {}): JobPage {
    return this.deps.jobs.page(query);
  }

  approveProposal(jobId: string, proposalId: string, by: string, note: string | null, now = this.clock()): Job | null {
    return this.decide(jobId, proposalId, 'approved', by, note, now);
  }

  rejectProposal(jobId: string, proposalId: string, by: string, note: string | null, now = this.clock()): Job | null {
    return this.decide(jobId, proposalId, 'rejected', by, note, now);
  }

  private decide(
    jobId: string,
    proposalId: string,
    decision: 'approved' | 'rejected',
    by: string,
    note: string | null,
    now: string,
  ): Job | null {
    const job = this.deps.jobs.get(jobId);
    if (!job) return null;
    const proposal = job.proposals.find((p) => p.id === proposalId);
    if (!proposal) return null;
    if (proposal.approval) return job; // idempotent — already decided
    if (proposal.verdict.decision !== 'require_approval') return job; // nothing to decide

    proposal.approval = { decision, decidedBy: by, decidedAt: now, note };
    job.logs.push({ at: now, level: 'info', message: `Proposal "${proposal.title}" ${decision} by ${by}.` });

    // The job carries its originating correlationId (falling back to its own id), so
    // approval + completion events group with the rest of the job's lifecycle chain.
    const correlationId = job.correlationId ?? job.id;
    const completed = job.status === 'awaiting_approval' && pendingApprovalCount(job) === 0;

    // P8.3 — approved proposals carrying an execution binding RUN (through the
    // ExecuteEngine); the job goes to 'running' and settles asynchronously via
    // settleExecution(). Everything else keeps today's immediate 'succeeded'.
    const executable = completed
      ? job.proposals.filter((p) => p.approval?.decision === 'approved' && p.execution)
      : [];
    const willExecute = executable.length > 0 && this.dispatchApprovedFn != null;

    if (completed) {
      if (willExecute) {
        job.status = 'running';
        // Measure execution duration from dispatch (not the earlier skill run), so a
        // long human approval wait doesn't inflate durationMs / the avg-duration metric.
        job.startedAt = now;
      } else {
        job.status = 'succeeded';
        job.finishedAt = now;
        this.deps.registry.recordOutcome(job.workerId, true, now);
      }
    }

    // Persist before emitting so a throwing subscriber can never leave the stored
    // job behind the events (consistent with the execute() path).
    this.deps.jobs.put(job);

    if (this.deps.publish) {
      this.deps.publish(
        approvalDecisionEvent(decision === 'approved' ? 'granted' : 'rejected', {
          jobId: job.id,
          workerId: job.workerId,
          workerRole: job.workerRole,
          proposalId: proposal.id,
          proposalTitle: proposal.title,
          by,
          note,
          correlationId,
        }),
      );
    }
    if (completed && !willExecute) this.emitJob('succeeded', job, correlationId);
    if (completed && willExecute) this.dispatchApprovedFn!(job, executable);

    return job;
  }

  /**
   * P8.3 — settle a 'running' job once the ExecuteEngine finishes its approved
   * action. Idempotent (only a still-running job settles), records the executor +
   * ExecutionSession id, updates trust/health, and emits the terminal worker event.
   */
  settleExecution(jobId: string, outcome: WorkforceExecutionOutcome): void {
    /**
     * P13C Round 2 — THE RUNTIME'S OWN WRITEBACK, deliberately unscoped.
     *
     * This runs in a promise continuation AFTER the approving IPC call has
     * returned, so by the time it fires the session may have switched
     * organizations. Resolving through the tenant-facing `get()` would then
     * return null and strand the job in `running` until the next restart
     * recovered it to `failed` — a correctness regression introduced by the
     * scoping fix, which is the worst kind because the job silently never
     * settles.
     *
     * Safe because this is not a request: the job id comes from the engine's
     * own dispatch, not from a caller, and the only mutation is settling a run
     * that this runtime already started. The APPROVAL that authorized it was
     * gated by the scoped `get()` in `decide()`, which is where the boundary
     * belongs.
     */
    const job = this.deps.jobs.unscopedForRuntime(jobId);
    if (!job || job.status !== 'running') return;
    const now = this.clock();
    job.status = outcome.ok ? 'succeeded' : 'failed';
    job.finishedAt = now;
    job.durationMs = job.startedAt ? Math.max(0, Date.parse(now) - Date.parse(job.startedAt)) : job.durationMs;
    if (outcome.executionId) job.executionId = outcome.executionId;
    job.executor = outcome.executor;
    if (outcome.ok) {
      job.logs.push({ at: now, level: 'info', message: `Executed via ${outcome.executor}.` });
    } else {
      job.error = outcome.error;
      job.logs.push({
        at: now,
        level: 'error',
        message: `Execution via ${outcome.executor} failed: ${outcome.error ?? 'unknown error'}`,
      });
    }
    this.deps.registry.recordOutcome(job.workerId, outcome.ok, now);
    this.deps.jobs.put(job);
    this.emitJob(outcome.ok ? 'succeeded' : 'failed', job, job.correlationId ?? job.id);
  }
}
