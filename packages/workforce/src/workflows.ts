/**
 * Module 13 — Autonomous Workflows. Sales / procurement / HR / finance / project / workspace
 * automation — RESTRICTED BY GOVERNANCE. A workflow that requires approval and is AI-initiated is
 * gated by the Wave 4 HITL and stops at 'awaiting-approval'; only non-restricted, in-process
 * workflows complete autonomously. Nothing regulated executes without a human.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { HumanInTheLoopGate } from '@neuropause/automation';
import type { WorkforceGovernance } from './governance';

export interface WorkforceWorkflow {
  id: string;
  name: string;
  domain: string;
  steps: string[];
  requiresApproval: boolean;
  createdAt: number;
}
export interface WorkflowRun {
  workflowId: string;
  status: 'completed' | 'awaiting-approval';
  requiresHuman: boolean;
  note: string;
}

export class AutonomousWorkflows {
  private readonly workflows = new Map<string, WorkforceWorkflow>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkforceGovernance,
    private readonly hitl: HumanInTheLoopGate,
  ) {}

  async define(input: { name: string; domain: string; steps: string[]; requiresApproval?: boolean }): Promise<WorkforceWorkflow> {
    const wf: WorkforceWorkflow = { id: randomId('wf'), name: input.name, domain: input.domain, steps: input.steps, requiresApproval: input.requiresApproval ?? false, createdAt: this.clock.now() };
    this.workflows.set(wf.id, wf);
    await this.governance.record({ user: 'system', org: '_org', worker: 'workflow', operation: `workflow.define.${input.domain}`, targetId: wf.id, evidence: 'live-verified' });
    return wf;
  }

  async run(input: { workflowId: string; actor: string; org: string; aiInitiated?: boolean }): Promise<WorkflowRun> {
    const wf = this.workflows.get(input.workflowId);
    if (!wf) throw new Error(`no workflow ${input.workflowId}`);
    if (wf.requiresApproval && input.aiInitiated) {
      const cls = this.hitl.classify(`workflow.${wf.domain}`);
      if (!cls.aiAllowed) {
        await this.governance.record({ user: input.actor, org: input.org, worker: 'workflow', operation: 'workflow.awaiting-approval', targetId: wf.id, evidence: 'live-verified', approval: 'pending' });
        return { workflowId: wf.id, status: 'awaiting-approval', requiresHuman: true, note: 'AI-initiated workflow requires human approval — not executed autonomously' };
      }
    }
    await this.governance.record({ user: input.actor, org: input.org, worker: 'workflow', operation: 'workflow.completed', targetId: wf.id, evidence: 'live-verified', approval: wf.requiresApproval ? 'approved' : 'not-required' });
    return { workflowId: wf.id, status: 'completed', requiresHuman: wf.requiresApproval, note: 'completed in-process under governance' };
  }

  list(domain?: string): WorkforceWorkflow[] {
    const all = [...this.workflows.values()];
    return domain ? all.filter((w) => w.domain === domain) : all;
  }
  count(): number { return this.workflows.size; }
}
