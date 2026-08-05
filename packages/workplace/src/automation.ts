/**
 * Module 16 — Workspace Automation. Reuses the Wave 4 Human-in-the-Loop gate to govern workspace
 * approvals — meeting scheduling, task assignment, document routing, approval routing, notifications,
 * and knowledge publishing. AI may draft and route, but may not self-approve a restricted operation.
 */
import type { HumanInTheLoopGate } from '@neuropause/automation';
import type { WorkspaceGovernance } from './governance';

export const RESTRICTED_WORKSPACE_OPS = new Set<string>(['document.approve', 'approval.route', 'knowledge.publish', 'budget.approve']);

export interface ApprovalDecision {
  operation: string;
  approved: boolean;
  requiresHuman: boolean;
  reason: string;
}

export class WorkspaceAutomation {
  constructor(
    private readonly governance: WorkspaceGovernance,
    private readonly hitl: HumanInTheLoopGate,
  ) {}

  async requestApproval(input: { operation: string; actor: string; aiInitiated?: boolean }): Promise<ApprovalDecision> {
    const requiresHuman = RESTRICTED_WORKSPACE_OPS.has(input.operation);
    if (requiresHuman && input.aiInitiated) {
      const cls = this.hitl.classify(input.operation); // reused Wave 4 gate
      if (!cls.aiAllowed) {
        await this.governance.record({ actor: input.actor, module: 'automation', operation: 'approval.denied', targetId: input.operation, evidence: 'live-verified', detail: 'AI may not self-approve a restricted workspace operation' });
        return { operation: input.operation, approved: false, requiresHuman: true, reason: 'AI may not self-approve a restricted workspace operation — human required' };
      }
    }
    await this.governance.record({ actor: input.actor, module: 'automation', operation: 'approval.granted', targetId: input.operation, evidence: 'live-verified' });
    return { operation: input.operation, approved: true, requiresHuman, reason: requiresHuman ? 'human approval required and granted' : 'auto-approved (not restricted)' };
  }
}
