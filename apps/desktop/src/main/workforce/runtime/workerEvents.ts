/**
 * P8.2 — pure builders for AI Workforce timeline events.
 *
 * Turn a worker/job lifecycle transition (or an approval decision) into a
 * `PlatformEventInput` for the EXISTING platform event bus → durable timeline →
 * Enterprise Timeline. No new bus/timeline: the runtime publishes these through
 * the same `platform.api.publish` seam the workflow lifecycle already uses.
 *
 * Every event carries the correlation id, worker id, task (job) id, role, skill,
 * and status in flat metadata so it groups + filters cleanly. Pure + deterministic
 * (the bus stamps id/timestamp), so the event shaping is unit-tested in isolation.
 */
import type { PlatformEventInput, WorkerRole } from '@neuropause/shared';

export type WorkerJobEventKind = 'queued' | 'started' | 'awaiting_approval' | 'succeeded' | 'failed';

const JOB_EVENT_TYPE: Record<WorkerJobEventKind, PlatformEventInput['type']> = {
  queued: 'worker.job_queued',
  started: 'worker.job_started',
  awaiting_approval: 'worker.job_awaiting_approval',
  succeeded: 'worker.job_succeeded',
  failed: 'worker.job_failed',
};

export interface JobEventFields {
  jobId: string;
  workerId: string;
  workerRole: WorkerRole;
  skillId: string;
  correlationId: string;
  requestedBy?: string;
  summary?: string | null;
  durationMs?: number | null;
  error?: string | null;
  /** Number of proposals still parked for a human (for awaiting_approval). */
  pendingApprovals?: number;
}

/** Drop undefined values so metadata stays flat + primitive (bus requires it). */
function meta(entries: Record<string, string | number | boolean | null | undefined>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(entries)) if (v !== undefined) out[k] = v;
  return out;
}

/** Build a worker job-lifecycle event. `correlationId` groups the whole chain. */
export function jobLifecycleEvent(kind: WorkerJobEventKind, f: JobEventFields): PlatformEventInput {
  return {
    type: JOB_EVENT_TYPE[kind],
    category: 'automation',
    source: 'workforce',
    actor: { kind: 'system', id: f.workerId },
    resource: { type: 'job', id: f.jobId, name: `${f.skillId} · ${f.workerId}` },
    correlationId: f.correlationId,
    metadata: meta({
      correlationId: f.correlationId,
      workerId: f.workerId,
      workerRole: f.workerRole,
      skillId: f.skillId,
      jobId: f.jobId,
      taskId: f.jobId,
      requestedBy: f.requestedBy,
      summary: f.summary ?? undefined,
      durationMs: f.durationMs ?? undefined,
      error: f.error ?? undefined,
      pendingApprovals: f.pendingApprovals,
    }),
  };
}

export interface ApprovalEventFields {
  jobId: string;
  workerId: string;
  workerRole: WorkerRole;
  proposalId: string;
  proposalTitle: string;
  by: string;
  note?: string | null;
  correlationId: string;
}

/** Build a human approval decision event (granted/rejected). */
export function approvalDecisionEvent(decision: 'granted' | 'rejected', f: ApprovalEventFields): PlatformEventInput {
  return {
    type: decision === 'granted' ? 'approval.granted' : 'approval.rejected',
    category: 'automation',
    source: 'workforce',
    // The human who decided is the actor; the worker/job is the resource.
    actor: { kind: 'user', id: f.by },
    resource: { type: 'proposal', id: f.proposalId, name: f.proposalTitle },
    correlationId: f.correlationId,
    metadata: meta({
      correlationId: f.correlationId,
      workerId: f.workerId,
      workerRole: f.workerRole,
      jobId: f.jobId,
      taskId: f.jobId,
      proposalId: f.proposalId,
      decidedBy: f.by,
      note: f.note ?? undefined,
    }),
  };
}
