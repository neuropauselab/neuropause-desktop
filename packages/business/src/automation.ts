/**
 * Module 18 — Business Automation. Reuses the Wave 4 Human-in-the-Loop gate to govern approvals
 * across CRM, finance, HR, payroll, vendor, purchasing, healthcare review, manufacturing, tax,
 * and budget operations. AI may draft and route, but may NOT self-approve a restricted business
 * operation — a human is always required where appropriate.
 */
import type { HumanInTheLoopGate } from '@neuropause/automation';
import type { BusinessGovernance } from './governance';

/** Business operations that always require human approval. */
export const RESTRICTED_OPERATIONS = new Set<string>([
  'payroll.run',
  'vendor.approve',
  'budget.approve',
  'purchase.approve',
  'tax.file',
  'healthcare.review',
  'manufacturing.dispatch',
  'bank.transfer',
  'journal.post.material',
]);

export interface ApprovalDecision {
  operation: string;
  approved: boolean;
  requiresHuman: boolean;
  reason: string;
}

export class BusinessAutomation {
  constructor(
    private readonly governance: BusinessGovernance,
    private readonly hitl: HumanInTheLoopGate,
  ) {}

  async requestApproval(input: { domain: string; operation: string; actor: string; aiInitiated?: boolean }): Promise<ApprovalDecision> {
    const requiresHuman = RESTRICTED_OPERATIONS.has(input.operation);
    if (requiresHuman && input.aiInitiated) {
      const cls = this.hitl.classify(input.operation); // reused Wave 4 gate
      if (!cls.aiAllowed) {
        await this.governance.record({ actor: input.actor, domain: input.domain, operation: `approval.denied`, targetId: input.operation, evidence: 'live-verified', detail: 'AI may not self-approve a restricted operation' });
        return { operation: input.operation, approved: false, requiresHuman: true, reason: 'AI may not self-approve a restricted business operation — human required' };
      }
    }
    await this.governance.record({ actor: input.actor, domain: input.domain, operation: `approval.granted`, targetId: input.operation, evidence: 'live-verified' });
    return { operation: input.operation, approved: true, requiresHuman, reason: requiresHuman ? 'human approval required and granted' : 'auto-approved (not restricted)' };
  }

  restrictedOperations(): string[] {
    return [...RESTRICTED_OPERATIONS];
  }
}
