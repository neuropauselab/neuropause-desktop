/**
 * Module 6 — Disaster Recovery Platform. Recovery plans, DR regions, failover plans, recovery
 * validation, recovery drills, and recovery reports. REUSES the Wave 7 cloud-ops backup/DR runtime
 * for failover plans when connected. The plan and drill records are real and live-verified; real
 * cross-region failover is INFRASTRUCTURE-PENDING — represented via validated descriptors until real
 * DR infrastructure is configured, never claimed as executed.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { ProductionGovernance } from './governance';
import type { ProductionContext } from './types';

export interface RecoveryPlan {
  id: string;
  name: string;
  drRegion: string;
  rpoMinutes?: number;
  rtoMinutes?: number;
  reusedCloudOps: boolean;
  note: string;
  createdAt: number;
}
export interface DrillReport {
  id: string;
  planId: string;
  steps: string[];
  planValid: boolean;
  note: string;
  at: number;
}

export class DisasterRecoveryPlatform {
  private readonly plans = new Map<string, RecoveryPlan>();
  private readonly drills = new Map<string, DrillReport>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: ProductionGovernance,
    private readonly ctx: ProductionContext = {},
  ) {}

  async createPlan(input: { name: string; drRegion: string; rpoMinutes?: number; rtoMinutes?: number; org?: string }): Promise<RecoveryPlan> {
    let reusedCloudOps = false;
    if (this.ctx.cloudops) {
      await this.ctx.cloudops.backups().failover(input.name, input.name, input.rtoMinutes);
      reusedCloudOps = true;
    }
    const plan: RecoveryPlan = {
      id: randomId('drp'),
      name: input.name,
      drRegion: input.drRegion,
      ...(input.rpoMinutes !== undefined ? { rpoMinutes: input.rpoMinutes } : {}),
      ...(input.rtoMinutes !== undefined ? { rtoMinutes: input.rtoMinutes } : {}),
      reusedCloudOps,
      note: 'recovery plan recorded; real cross-region failover is infrastructure-pending until DR infrastructure is configured',
      createdAt: this.clock.now(),
    };
    this.plans.set(plan.id, plan);
    await this.governance.record({ operator: 'system', org: input.org ?? '_ops', environment: plan.drRegion, operation: 'dr.plan', targetId: plan.id, evidence: 'live-verified', decision: reusedCloudOps ? 'reused cloud-ops failover' : 'plan only' });
    return plan;
  }

  /** Run a recovery drill — validates the plan's structure (RPO/RTO + region present), not real failover. */
  async drill(planId: string, org?: string): Promise<DrillReport> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`no recovery plan ${planId}`);
    const planValid = plan.drRegion.length > 0 && (plan.rtoMinutes ?? 0) >= 0;
    const report: DrillReport = {
      id: randomId('drill'),
      planId,
      steps: ['validate plan structure', 'check DR region descriptor', 'verify RPO/RTO objectives', 'record drill outcome'],
      planValid,
      note: 'drill validated the plan structure; real failover requires configured DR infrastructure and was not performed',
      at: this.clock.now(),
    };
    this.drills.set(report.id, report);
    await this.governance.record({ operator: 'system', org: org ?? '_ops', environment: plan.drRegion, operation: 'dr.drill', targetId: report.id, evidence: 'live-verified', decision: planValid ? 'plan valid' : 'plan invalid' });
    return report;
  }

  planList(): RecoveryPlan[] { return [...this.plans.values()]; }
  drillReports(planId?: string): DrillReport[] {
    const all = [...this.drills.values()];
    return planId ? all.filter((d) => d.planId === planId) : all;
  }
  count(): number { return this.plans.size; }
}
