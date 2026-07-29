/**
 * Wave 4 core types — workflow definitions, execution state, and the fully-attributed
 * execution record. The execution record carries everything the governance module
 * (Module 12) requires: trigger, version, inputs, evidence, approvals, outputs, duration,
 * errors, audit id, replay id, rollback id — so every automation is replayable and
 * traceable through the audit chain.
 */
import type { EvidenceRef } from '@neuropause/intelligence';
import type { WorkflowMode, StepKind, RiskTier } from './constants';

export type { EvidenceRef };

/** Mutable state threaded through a workflow run (inputs + per-step outputs + evidence). */
export interface WorkflowState {
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  evidence: EvidenceRef[];
}

export interface StepContext {
  tenantId: string;
  actor: string;
  traceId: string;
  aiInitiated: boolean;
  state: WorkflowState;
}

export type StepAction = (ctx: StepContext) => Promise<unknown>;

export interface WorkflowStepDef {
  name: string;
  kind: StepKind;
  /** for 'action' / 'notify' steps. */
  action?: StepAction;
  /** conditional gate — the step is skipped when this returns false. */
  when?: (state: WorkflowState) => boolean;
  retries?: number;
  timeoutMs?: number;
  compensate?: (ctx: StepContext) => Promise<void>;
  /** approval gate — references an approval policy; no high-risk step runs without one. */
  approval?: { policyId: string };
  /** loop over an inputs array key, running `body` per element (element bound as input `item`). */
  loop?: { over: string; body: WorkflowStepDef };
  /** parallel fan-out of sub-steps within a sequential workflow. */
  parallel?: WorkflowStepDef[];
  riskTier?: RiskTier;
  /** whether this step touches an external system (SaaS/notification) — for honest labelling. */
  external?: boolean;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  mode: WorkflowMode;
  steps: WorkflowStepDef[];
  description?: string;
}

export interface StepResult {
  name: string;
  ok: boolean;
  skipped?: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
  attempts: number;
  approvalId?: string;
  external?: boolean;
}

export type ExecutionStatus = 'completed' | 'failed' | 'awaiting-approval' | 'compensated';

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  version: number;
  tenantId: string;
  actor: string;
  trigger: string;
  aiInitiated: boolean;
  inputs: Record<string, unknown>;
  status: ExecutionStatus;
  steps: StepResult[];
  outputs: Record<string, unknown>;
  evidence: EvidenceRef[];
  approvals: string[];
  durationMs: number;
  error?: string;
  auditId: string;
  replayId: string;
  rollbackId?: string;
  replayOf?: string;
  startedAt: number;
  finishedAt: number;
}
