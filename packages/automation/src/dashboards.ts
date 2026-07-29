/**
 * Module 13 — Operations Dashboards. One dashboard per role (CEO/COO/CTO/Operations/
 * Customer Success/Engineering/Compliance) composing the SLA, analytics, approval, and
 * queue state into panels: workflow health, automation health, pending approvals, SLA
 * status, operational risks, execution queue. Pure read model over live state.
 */
import type { SlaOperations } from './sla';
import type { AutomationAnalytics } from './analytics';
import type { ApprovalPlatform } from './approvals';
import type { AutomationEngine } from './automation';
import type { OpsRole } from './constants';

export interface OpsDashboard {
  role: OpsRole;
  tenantId: string;
  panels: {
    workflowHealth: { completionRate: number; failures: number; compensated: number };
    automationHealth: { automationRate: number; successRate: number; manualInterventions: number };
    pendingApprovals: number;
    slaStatus: { compliance: number; avgDurationMs: number; escalations: number };
    operationalRisks: string[];
    executionQueue: number;
  };
}

export class OperationsDashboards {
  constructor(
    private readonly sla: SlaOperations,
    private readonly analytics: AutomationAnalytics,
    private readonly approvals: ApprovalPlatform,
    private readonly automation: AutomationEngine,
  ) {}

  build(role: OpsRole, tenantId: string): OpsDashboard {
    const s = this.sla.report(tenantId);
    const a = this.analytics.report(tenantId);
    const risks: string[] = [];
    if (s.failed > 0) risks.push(`${s.failed} failed execution(s)`);
    if (s.awaitingApproval > 0) risks.push(`${s.awaitingApproval} awaiting approval`);
    if (s.escalations > 0) risks.push(`${s.escalations} escalation(s)`);
    if (Object.keys(a.failureCauses).length) risks.push(`failure causes: ${Object.keys(a.failureCauses).length}`);
    return {
      role,
      tenantId,
      panels: {
        workflowHealth: { completionRate: s.completionRate, failures: s.failed, compensated: s.compensated },
        automationHealth: { automationRate: a.automationRate, successRate: a.workflowSuccessRate, manualInterventions: a.manualInterventions },
        pendingApprovals: this.approvals.pending(tenantId).length,
        slaStatus: { compliance: s.slaCompliance, avgDurationMs: s.avgDurationMs, escalations: s.escalations },
        operationalRisks: risks,
        executionQueue: this.automation.queueDepth(),
      },
    };
  }
}
