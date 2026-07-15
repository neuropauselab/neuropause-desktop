/**
 * The execution core of the Worker Runtime. Running one worker skill produces
 * exactly one `Job`:
 *
 *   1. The skill runs in a `SkillContext` and returns a read-only summary +
 *      evidence + zero or more **proposed actions** (it never acts itself).
 *   2. Each proposal is stamped into an `ActionRequest` and gated by the
 *      Governance Runtime, yielding a `JobProposal` that carries its verdict.
 *   3. The job's terminal status follows from those verdicts: any proposal that
 *      needs a human parks the job as `awaiting_approval`; otherwise it
 *      `succeeded`. If the skill throws, the job `failed` and the read result is
 *      simply absent.
 *
 * Pure and synchronous: governance and id generation are injected, so this
 * unit-tests from synthetic input with no Electron and no I/O. Real wall-clock
 * duration is measured even though logical timestamps are supplied.
 */
import type {
  ActionRequest,
  GovernanceVerdict,
  Job,
  JobLogEntry,
  JobProposal,
  RiskLevel,
  Worker,
} from '@neuropause/shared';
import type { SkillImpl, WorkforceData } from '../sdk';

export interface ExecuteDeps {
  /** Gate a proposed action (records audit as a side effect in production). */
  evaluate: (req: ActionRequest, worker: Worker, now: string) => GovernanceVerdict;
  newId: () => string;
}

export interface ExecuteArgs {
  jobId: string;
  worker: Worker;
  skill: SkillImpl;
  /** Intelligence-layer data already scoped to the worker's permissions. */
  data: WorkforceData;
  input: Record<string, unknown>;
  requestedBy: string;
  now: string;
  createdAt?: string;
  deps: ExecuteDeps;
}

/** How many proposals on a job still await a human decision. */
export function pendingApprovalCount(job: Job): number {
  return job.proposals.filter((p) => p.verdict.decision === 'require_approval' && p.approval === null).length;
}

export function executeJob(args: ExecuteArgs): Job {
  const { jobId, worker, skill, data, input, requestedBy, now, deps } = args;
  const createdAt = args.createdAt ?? now;
  const logs: JobLogEntry[] = [];
  const log = (level: JobLogEntry['level'], message: string): void => {
    logs.push({ at: now, level, message });
  };

  const startedAt = now;
  const t0 = Date.now();

  let summary: string | null = null;
  let grounded = false;
  let proposals: JobProposal[] = [];
  let evidence: Job['evidence'] = [];
  let status: Job['status'] = 'running';
  let error: string | null = null;

  try {
    log('info', `Running skill "${skill.id}" for ${worker.identity.name}.`);
    const result = skill.run({ worker, now, data, log }, input);
    summary = result.summary;
    grounded = result.grounded;
    evidence = result.evidence;

    proposals = result.proposals.map((p) => {
      // P8.4 — a proposal that carries an execution binding is inherently
      // side-effecting and at least high-risk, so governance ALWAYS gates it to
      // require_approval and an approved action can never auto-run. This holds
      // structurally even if a skill under-declared the proposal's risk. Built-in
      // executable skills already declare high risk, so for them this is a no-op
      // backstop; it only tightens a malformed/hand-written execution proposal.
      const hasBinding = p.execution != null;
      const sideEffects = p.sideEffects || hasBinding;
      const risk: RiskLevel = hasBinding && p.risk !== 'critical' ? 'high' : p.risk;
      const request: ActionRequest = {
        id: deps.newId(),
        workerId: worker.identity.id,
        workerRole: worker.identity.role,
        skillId: skill.id,
        title: p.title,
        summary: p.summary,
        sideEffects,
        permissions: p.permissions,
        risk,
        evidence: p.evidence,
        payload: p.payload,
        requestedAt: now,
      };
      const verdict = deps.evaluate(request, worker, now);
      log('info', `Proposal "${p.title}" → ${verdict.decision}.`);
      return {
        id: deps.newId(),
        title: p.title,
        summary: p.summary,
        sideEffects,
        risk,
        evidence: p.evidence,
        payload: p.payload,
        verdict,
        approval: null,
        // P8.3 — carry the optional execution binding so an approved action can run.
        ...(p.execution ? { execution: p.execution } : {}),
      };
    });

    const needsApproval = proposals.some((p) => p.verdict.decision === 'require_approval');
    status = needsApproval ? 'awaiting_approval' : 'succeeded';
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    status = 'failed';
    summary = null;
    proposals = [];
    evidence = [];
    grounded = false;
    log('error', `Skill failed: ${error}`);
  }

  const durationMs = Date.now() - t0;

  return {
    id: jobId,
    workerId: worker.identity.id,
    workerRole: worker.identity.role,
    skillId: skill.id,
    status,
    input,
    requestedBy,
    summary,
    evidence,
    proposals,
    logs,
    error,
    grounded,
    createdAt,
    startedAt,
    finishedAt: now,
    durationMs,
  };
}
