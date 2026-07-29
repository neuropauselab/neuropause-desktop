/**
 * Module 11 — Backup & Disaster Recovery. Represents backup / restore / snapshot / recovery /
 * disaster-recovery / failover PLANS with RPO/RTO targets. These are in-process plan records
 * (live-verified as a registry) — the actual backup, restore, failover, and DR EXECUTION is a
 * simulation and is INFRA-PENDING (needs real multi-region infrastructure + data replication).
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { CloudOpsGovernance } from './governance';
import type { RecoveryPlan } from './types';
import { RECOVERY_PLAN_KINDS, type RecoveryPlanKind } from './constants';

export interface PlanInput {
  kind: RecoveryPlanKind;
  name: string;
  targetId: string;
  rpoMinutes?: number;
  rtoMinutes?: number;
  metadata?: Record<string, unknown>;
}

export class BackupDisasterRecovery {
  private readonly plans = new Map<string, RecoveryPlan>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: CloudOpsGovernance,
  ) {}

  async plan(input: PlanInput): Promise<RecoveryPlan> {
    if (!RECOVERY_PLAN_KINDS.includes(input.kind)) throw new Error(`unknown recovery plan kind: ${input.kind}`);
    const executes = input.kind === 'failover' || input.kind === 'disaster-recovery' || input.kind === 'restore';
    const plan: RecoveryPlan = {
      id: randomId('rec'),
      kind: input.kind,
      name: input.name,
      targetId: input.targetId,
      ...(input.rpoMinutes !== undefined ? { rpoMinutes: input.rpoMinutes } : {}),
      ...(input.rtoMinutes !== undefined ? { rtoMinutes: input.rtoMinutes } : {}),
      metadata: input.metadata ?? {},
      createdAt: this.clock.now(),
      evidence: 'live-verified',
      note: executes
        ? `${input.kind} plan recorded — EXECUTION is INFRA-PENDING (simulation only; needs real multi-region infrastructure)`
        : `${input.kind} plan recorded — simulation only, not executed against real storage`,
    };
    this.plans.set(plan.id, plan);
    await this.governance.record({ actor: 'system', operation: `recovery.plan.${input.kind}`, targetId: plan.id, evidence: 'live-verified', scope: input.targetId, detail: plan.note });
    return plan;
  }

  backup(name: string, targetId: string, rpoMinutes?: number): Promise<RecoveryPlan> {
    return this.plan({ kind: 'backup', name, targetId, ...(rpoMinutes !== undefined ? { rpoMinutes } : {}) });
  }
  failover(name: string, targetId: string, rtoMinutes?: number): Promise<RecoveryPlan> {
    return this.plan({ kind: 'failover', name, targetId, ...(rtoMinutes !== undefined ? { rtoMinutes } : {}) });
  }

  objectives(id: string): { rpoMinutes?: number; rtoMinutes?: number } {
    const p = this.require(id);
    return { ...(p.rpoMinutes !== undefined ? { rpoMinutes: p.rpoMinutes } : {}), ...(p.rtoMinutes !== undefined ? { rtoMinutes: p.rtoMinutes } : {}) };
  }

  private require(id: string): RecoveryPlan {
    const p = this.plans.get(id);
    if (!p) throw new Error(`no recovery plan ${id}`);
    return p;
  }

  get(id: string): RecoveryPlan | undefined {
    return this.plans.get(id);
  }
  list(kind?: RecoveryPlanKind): RecoveryPlan[] {
    const all = [...this.plans.values()];
    return kind ? all.filter((p) => p.kind === kind) : all;
  }
  byTarget(targetId: string): RecoveryPlan[] {
    return this.list().filter((p) => p.targetId === targetId);
  }
  count(): number {
    return this.plans.size;
  }
}
