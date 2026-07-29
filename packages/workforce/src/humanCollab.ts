/**
 * Module 10 — Human Collaboration. Approval requests, escalation, review, feedback, delegation,
 * and human override. Reuses the Wave 4 HITL gate: an AI worker may draft and propose, but any
 * restricted or regulated action requires a human — an AI-initiated approval of such an action is
 * refused. Human override always wins.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { HumanInTheLoopGate } from '@neuropause/automation';
import type { WorkforceGovernance } from './governance';
import { REGULATED_ACTIONS } from './constants';

/** Actions that always require a human (regulated + other high-impact workforce ops). */
export const HUMAN_REQUIRED_ACTIONS = new Set<string>([...REGULATED_ACTIONS, 'document.publish', 'budget.approve', 'vendor.approve']);

export interface ApprovalDecision {
  action: string;
  approved: boolean;
  requiresHuman: boolean;
  reason: string;
}
export interface Escalation {
  id: string;
  worker: string;
  issue: string;
  at: number;
}

export class HumanCollaboration {
  private readonly escalations: Escalation[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkforceGovernance,
    private readonly hitl: HumanInTheLoopGate,
  ) {}

  async requestApproval(input: { worker: string; action: string; actor: string; org: string; aiInitiated?: boolean }): Promise<ApprovalDecision> {
    const requiresHuman = HUMAN_REQUIRED_ACTIONS.has(input.action);
    if (requiresHuman && input.aiInitiated) {
      const cls = this.hitl.classify(input.action); // reused Wave 4 gate
      if (!cls.aiAllowed) {
        await this.governance.record({ user: input.actor, org: input.org, worker: input.worker, operation: 'approval.denied', targetId: input.action, evidence: 'live-verified', approval: 'denied', reasoning: 'AI may not self-approve a restricted/regulated action' });
        return { action: input.action, approved: false, requiresHuman: true, reason: 'AI may not self-approve a restricted/regulated action — human required' };
      }
    }
    await this.governance.record({ user: input.actor, org: input.org, worker: input.worker, operation: 'approval.granted', targetId: input.action, evidence: 'live-verified', approval: 'approved' });
    return { action: input.action, approved: true, requiresHuman, reason: requiresHuman ? 'human approval required and granted' : 'auto-approved (not restricted)' };
  }

  async escalate(input: { worker: string; issue: string; org: string }): Promise<Escalation> {
    const e: Escalation = { id: randomId('esc'), worker: input.worker, issue: input.issue, at: this.clock.now() };
    this.escalations.push(e);
    await this.governance.record({ user: 'system', org: input.org, worker: input.worker, operation: 'escalate', targetId: e.id, evidence: 'live-verified', approval: 'pending' });
    return e;
  }

  /** Human override always wins — records the human decision over an AI proposal. */
  async override(input: { worker: string; actionId: string; byHuman: string; decision: 'approved' | 'denied'; org: string }): Promise<{ actionId: string; decision: string; byHuman: string }> {
    await this.governance.record({ user: input.byHuman, org: input.org, worker: input.worker, operation: 'human.override', targetId: input.actionId, evidence: 'live-verified', approval: input.decision });
    return { actionId: input.actionId, decision: input.decision, byHuman: input.byHuman };
  }

  escalations_(): Escalation[] {
    return [...this.escalations];
  }
}
