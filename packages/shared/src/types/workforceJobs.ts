/**
 * AI Workforce — jobs and workflows.
 *
 * A **Job** is one worker running one skill: the runtime executes the skill,
 * records the (always read-only) summary + evidence, and turns each proposed
 * action into a governed `JobProposal` carrying its `GovernanceVerdict`.
 * Side-effecting proposals park as `awaiting_approval` until a human acts.
 *
 * A **Workflow** is a DAG of steps (worker runs and human-approval checkpoints)
 * the orchestrator executes with dependencies, retry, timeout, and parallelism.
 *
 * Types-only. Built on worker.ts + workforceGovernance.ts.
 */
import type { ActionEvidence, GovernanceVerdict, RiskLevel } from './workforceGovernance';
import type { WorkerRole } from './worker';

export type JobStatus = 'queued' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'cancelled';

export type ApprovalDecision = 'approved' | 'rejected';

export interface ProposalApproval {
  decision: ApprovalDecision;
  decidedBy: string;
  decidedAt: string;
  note: string | null;
}

/**
 * P8.3 — which existing confirmation-gated executor runs an approved proposal.
 * `infra` → InfraActionExecutor, `m365` → M365Executor, `automation` → AutomationRunner.
 */
export type ExecutorKind = 'infra' | 'm365' | 'automation';

/**
 * P8.3 — an OPTIONAL execution binding a skill declares on a proposal so its
 * approved action actually runs through an existing executor. Advisory proposals
 * omit it and stay on the synchronous "approved → succeeded" path (unchanged).
 */
export interface ExecutionBinding {
  executor: ExecutorKind;
  /** infra: platformId · m365: connectorId · automation: ruleId. */
  target: string;
  /** account/subscription scope (infra + m365); ignored for automation. */
  accountId?: string;
  /** InfraAction.id / WriteAction.id (ignored for automation). */
  actionId?: string;
  /** Parameters passed straight to the executor. */
  params?: Record<string, unknown>;
}

export interface JobProposal {
  id: string;
  title: string;
  summary: string;
  sideEffects: boolean;
  risk: RiskLevel;
  evidence: ActionEvidence[];
  payload: Record<string, unknown>;
  /** The governance decision for this proposal. */
  verdict: GovernanceVerdict;
  /** Set once a human approves or rejects (for proposals that need it). */
  approval: ProposalApproval | null;
  /** P8.3 — optional binding to an existing executor; when present + approved, the action runs. */
  execution?: ExecutionBinding;
}

export interface JobLogEntry {
  at: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface Job {
  /**
   * The organization this belongs to (P13C Round 2).
   *
   * OPTIONAL so a file written before this round still parses. Absent means
   * UNRESOLVED — visible to nobody, never back-filled to the active or first
   * organization, because that guess is the defect the field exists to remove.
   */
  tenantId?: string | null;
  id: string;
  workerId: string;
  workerRole: WorkerRole;
  skillId: string;
  /**
   * P8.2 — groups this job's timeline events into a larger chain (a goal/workflow
   * run); defaults to the job's own id. Persisted so the approval path (which only
   * has the stored Job) emits under the same correlation id as the job's lifecycle.
   */
  correlationId?: string;
  status: JobStatus;
  input: Record<string, unknown>;
  requestedBy: string;
  /** The read-only result of the skill (always delivered). */
  summary: string | null;
  evidence: ActionEvidence[];
  proposals: JobProposal[];
  logs: JobLogEntry[];
  error: string | null;
  /** False when the worker had no connected data to act on. */
  grounded: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  /** P8.3 — the ExecutionSession id when an approved action was executed (join to the execution history). */
  executionId?: string;
  /** P8.3 — which executor ran the approved action (infra/m365/automation). */
  executor?: string;
}

export interface JobSpec {
  workerId: string;
  skillId: string;
  input?: Record<string, unknown>;
  requestedBy?: string;
  now?: string;
  /**
   * P8.2 — groups this job's timeline events into a larger chain (a goal or
   * workflow run). Defaults to the job's own id when omitted, so a standalone job
   * self-correlates. Observability metadata only; does not affect execution.
   */
  correlationId?: string;
}

export interface JobPage {
  jobs: Job[];
  total: number;
}

/* ────────────────────────────── Workflows ───────────────────────────────── */

export type WorkflowStepKind = 'worker' | 'approval';

export interface WorkflowStep {
  id: string;
  kind: WorkflowStepKind;
  /** For kind 'worker'. */
  workerId?: string;
  skillId?: string;
  input?: Record<string, unknown>;
  /** Step ids that must complete before this one runs. */
  dependsOn: string[];
  retry?: number;
  timeoutMs?: number;
  /** For kind 'approval' — the prompt shown at the human checkpoint. */
  approvalPrompt?: string;
}

export interface WorkflowSpec {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
}

export type WorkflowRunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface WorkflowStepRun {
  stepId: string;
  status: JobStatus | 'pending' | 'skipped';
  jobId: string | null;
  attempts: number;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface WorkflowRun {
  /**
   * The organization this belongs to (P13C Round 2).
   *
   * OPTIONAL so a file written before this round still parses. Absent means
   * UNRESOLVED — visible to nobody, never back-filled to the active or first
   * organization, because that guess is the defect the field exists to remove.
   */
  tenantId?: string | null;
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  stepRuns: WorkflowStepRun[];
  startedAt: string;
  finishedAt: string | null;
}
