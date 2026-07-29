/**
 * Module 11 — Business Continuity Platform. Continuity plans, disaster-recovery plans, escalation
 * trees, incident response, and recovery playbooks. REUSES the Wave 7 cloud-ops backup/DR runtime
 * for DR plans when present (no duplication). Live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { OperationsGovernance } from './governance';
import type { OpsContext } from './types';

export interface ContinuityPlan {
  id: string;
  name: string;
  kind: 'continuity' | 'disaster-recovery';
  rpoMinutes?: number;
  rtoMinutes?: number;
  reusedCloudOps: boolean;
  createdAt: number;
}
export interface EscalationTree {
  id: string;
  name: string;
  levels: string[];
}
export interface Playbook {
  id: string;
  name: string;
  steps: string[];
}

export class BusinessContinuity {
  private readonly plans = new Map<string, ContinuityPlan>();
  private readonly trees = new Map<string, EscalationTree>();
  private readonly playbooks = new Map<string, Playbook>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: OperationsGovernance,
    private readonly ctx: OpsContext = {},
  ) {}

  async createPlan(input: { name: string; kind: 'continuity' | 'disaster-recovery'; rpoMinutes?: number; rtoMinutes?: number; org?: string }): Promise<ContinuityPlan> {
    let reusedCloudOps = false;
    if (input.kind === 'disaster-recovery' && this.ctx.cloudops) {
      // reuse the Wave 7 cloud-ops DR runtime — no duplication
      await this.ctx.cloudops.backups().plan({ kind: 'disaster-recovery', name: input.name, targetId: input.name, ...(input.rpoMinutes !== undefined ? { rpoMinutes: input.rpoMinutes } : {}), ...(input.rtoMinutes !== undefined ? { rtoMinutes: input.rtoMinutes } : {}) });
      reusedCloudOps = true;
    }
    const plan: ContinuityPlan = { id: randomId('cont'), name: input.name, kind: input.kind, ...(input.rpoMinutes !== undefined ? { rpoMinutes: input.rpoMinutes } : {}), ...(input.rtoMinutes !== undefined ? { rtoMinutes: input.rtoMinutes } : {}), reusedCloudOps, createdAt: this.clock.now() };
    this.plans.set(plan.id, plan);
    await this.governance.record({ user: 'system', org: input.org ?? '_ops', mission: '_continuity', operation: `continuity.${input.kind}`, targetId: plan.id, evidence: 'live-verified' });
    return plan;
  }

  async escalationTree(input: { name: string; levels: string[] }): Promise<EscalationTree> {
    const t: EscalationTree = { id: randomId('esctree'), name: input.name, levels: input.levels };
    this.trees.set(t.id, t);
    return t;
  }
  async playbook(input: { name: string; steps: string[] }): Promise<Playbook> {
    const p: Playbook = { id: randomId('play'), name: input.name, steps: input.steps };
    this.playbooks.set(p.id, p);
    return p;
  }

  planList(): ContinuityPlan[] { return [...this.plans.values()]; }
  treeList(): EscalationTree[] { return [...this.trees.values()]; }
  playbookList(): Playbook[] { return [...this.playbooks.values()]; }
  count(): number { return this.plans.size; }
}
