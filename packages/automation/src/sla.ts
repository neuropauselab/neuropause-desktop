/**
 * Module 9 — SLA & Operations. Computes operational metrics over the REAL execution
 * history: workflow duration, queue length, failures, retries, SLA compliance,
 * escalations, response time, and completion rate. No new store — it reads what the
 * workflow runtime, automation engine, and approval platform already record.
 */
import type { WorkflowRuntime } from './workflow';
import type { AutomationEngine } from './automation';
import type { ApprovalPlatform } from './approvals';

export interface SlaConfig {
  maxDurationMs?: number;
}

export interface SlaReport {
  tenantId: string;
  totalExecutions: number;
  completed: number;
  failed: number;
  compensated: number;
  awaitingApproval: number;
  avgDurationMs: number;
  retries: number;
  escalations: number;
  queueLength: number;
  slaCompliance: number;
  completionRate: number;
}

export class SlaOperations {
  constructor(
    private readonly workflow: WorkflowRuntime,
    private readonly automation: AutomationEngine,
    private readonly approvals: ApprovalPlatform,
    private readonly config: SlaConfig = {},
  ) {}

  report(tenantId: string): SlaReport {
    const execs = this.workflow.executions(tenantId);
    const total = execs.length;
    const completed = execs.filter((e) => e.status === 'completed').length;
    const failed = execs.filter((e) => e.status === 'failed').length;
    const compensated = execs.filter((e) => e.status === 'compensated').length;
    const awaiting = execs.filter((e) => e.status === 'awaiting-approval').length;
    const avgDurationMs = total ? Math.round(execs.reduce((a, e) => a + e.durationMs, 0) / total) : 0;
    const retries = execs.reduce((a, e) => a + e.steps.reduce((s, st) => s + Math.max(0, st.attempts - 1), 0), 0);
    const escalations = this.approvals.list(tenantId).filter((r) => r.status === 'escalated').length;
    const max = this.config.maxDurationMs;
    const withinSla = max === undefined ? total : execs.filter((e) => e.durationMs <= max).length;
    return {
      tenantId,
      totalExecutions: total,
      completed,
      failed,
      compensated,
      awaitingApproval: awaiting,
      avgDurationMs,
      retries,
      escalations,
      queueLength: this.automation.queueDepth(),
      slaCompliance: total ? Math.round((withinSla / total) * 100) / 100 : 1,
      completionRate: total ? Math.round((completed / total) * 100) / 100 : 0,
    };
  }
}
