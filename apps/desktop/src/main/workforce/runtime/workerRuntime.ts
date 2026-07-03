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
import type { Job, JobPage, JobSpec, WorkerRole } from '@neuropause/shared';
import { createLogger } from '../../logger';
import { scopeData, type SkillImpl, type WorkforceData } from '../sdk';
import type { WorkerRegistry } from '../registry/workerRegistry';
import type { GovernanceRuntime } from '../governance';
import type { JobStore, JobQuery } from './jobStore';
import { executeJob, pendingApprovalCount } from './executor';

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
}

export class WorkerRuntime {
  private readonly newId: () => string;
  private readonly clock: () => string;

  constructor(private readonly deps: WorkerRuntimeDeps) {
    this.newId = deps.newId ?? randomUUID;
    this.clock = deps.clock ?? (() => new Date().toISOString());
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

    this.deps.jobs.put(job);
    if (job.status === 'succeeded') this.deps.registry.recordOutcome(worker.identity.id, true, now);
    else if (job.status === 'failed') this.deps.registry.recordOutcome(worker.identity.id, false, now);
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

    if (job.status === 'awaiting_approval' && pendingApprovalCount(job) === 0) {
      job.status = 'succeeded';
      job.finishedAt = now;
      this.deps.registry.recordOutcome(job.workerId, true, now);
    }

    this.deps.jobs.put(job);
    return job;
  }
}
