/**
 * Module 10 — Automation Analytics. Measures workflow success, automation rate, manual
 * intervention, approval time, bottlenecks, and failure causes over the REAL execution
 * history. Business impact is reported honestly as un-quantified — no revenue/cost model
 * is connected in this environment, so no dollar figure is invented.
 */
import type { WorkflowRuntime } from './workflow';
import type { ApprovalPlatform } from './approvals';

export interface AnalyticsReport {
  tenantId: string;
  totalExecutions: number;
  workflowSuccessRate: number;
  automationRate: number;
  manualInterventions: number;
  avgApprovalTimeMs: number;
  bottlenecks: Array<{ step: string; avgDurationMs: number; runs: number }>;
  failureCauses: Record<string, number>;
  businessImpact: string;
}

const AUTOMATED_TRIGGERS = new Set(['scheduled', 'conditional', 'recurring']);
const isAutomated = (trigger: string): boolean => AUTOMATED_TRIGGERS.has(trigger) || trigger.startsWith('event:');

export class AutomationAnalytics {
  constructor(
    private readonly workflow: WorkflowRuntime,
    private readonly approvals: ApprovalPlatform,
  ) {}

  report(tenantId: string): AnalyticsReport {
    const execs = this.workflow.executions(tenantId);
    const total = execs.length;
    const successes = execs.filter((e) => e.status === 'completed').length;
    const automated = execs.filter((e) => isAutomated(e.trigger)).length;
    const manual = execs.filter((e) => e.status === 'awaiting-approval' || e.trigger === 'manual').length;

    // approval times
    const resolved = this.approvals.list(tenantId).filter((r) => r.resolvedAt !== undefined);
    const avgApprovalTimeMs = resolved.length ? Math.round(resolved.reduce((a, r) => a + (r.resolvedAt! - r.createdAt), 0) / resolved.length) : 0;

    // bottlenecks — slowest steps by average duration
    const stepAgg = new Map<string, { total: number; runs: number }>();
    for (const e of execs) for (const s of e.steps) {
      const cur = stepAgg.get(s.name) ?? { total: 0, runs: 0 };
      cur.total += s.durationMs;
      cur.runs += 1;
      stepAgg.set(s.name, cur);
    }
    const bottlenecks = [...stepAgg.entries()]
      .map(([step, agg]) => ({ step, avgDurationMs: Math.round(agg.total / agg.runs), runs: agg.runs }))
      .sort((a, b) => b.avgDurationMs - a.avgDurationMs)
      .slice(0, 5);

    // failure causes
    const failureCauses: Record<string, number> = {};
    for (const e of execs) if (e.error) {
      const cause = e.error.slice(0, 60);
      failureCauses[cause] = (failureCauses[cause] ?? 0) + 1;
    }

    return {
      tenantId,
      totalExecutions: total,
      workflowSuccessRate: total ? Math.round((successes / total) * 100) / 100 : 0,
      automationRate: total ? Math.round((automated / total) * 100) / 100 : 0,
      manualInterventions: manual,
      avgApprovalTimeMs,
      bottlenecks,
      failureCauses,
      businessImpact: 'not quantified — no revenue/cost model is connected in this environment (infra-pending)',
    };
  }
}
