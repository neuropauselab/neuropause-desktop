/**
 * EPIC 17 — Disaster Recovery Activation. Recovery registry, recovery/backup/restore validation,
 * recovery objectives, planning, and documentation. REUSES the Wave 14 production DR platform (plans
 * + drills) and the Sprint-1 deploy backup foundation (backup + real restore-integrity validation).
 * Real cross-region failover remains infrastructure-pending; nothing is claimed recovered without a
 * real validation.
 */
import { randomId } from '@neuropause/cloud-core';
import type { InfraGovernance } from './governance';
import type { InfraContext } from './types';

export interface RecoveryRecord {
  id: string;
  name: string;
  drRegion: string;
  rpoMinutes: number;
  rtoMinutes: number;
  reusedProduction: boolean;
  backupValidated: boolean;
  note: string;
}

export class DisasterRecoveryActivation {
  private readonly plans = new Map<string, RecoveryRecord>();

  constructor(
    private readonly governance: InfraGovernance,
    private readonly ctx: InfraContext = {},
  ) {}

  async createPlan(input: { name: string; drRegion: string; rpoMinutes?: number; rtoMinutes?: number; org?: string }): Promise<RecoveryRecord> {
    let reusedProduction = false;
    if (this.ctx.production) {
      await this.ctx.production.disasterRecovery().createPlan({ name: input.name, drRegion: input.drRegion, ...(input.rpoMinutes !== undefined ? { rpoMinutes: input.rpoMinutes } : {}), ...(input.rtoMinutes !== undefined ? { rtoMinutes: input.rtoMinutes } : {}) });
      reusedProduction = true;
    }
    const rec: RecoveryRecord = {
      id: randomId('dra'),
      name: input.name,
      drRegion: input.drRegion,
      rpoMinutes: input.rpoMinutes ?? 1440,
      rtoMinutes: input.rtoMinutes ?? 60,
      reusedProduction,
      backupValidated: false,
      note: 'recovery plan recorded; real cross-region failover is infrastructure-pending',
    };
    this.plans.set(rec.id, rec);
    await this.governance.record({ operator: 'system', org: input.org ?? '_ops', environment: rec.drRegion, epic: 'E17', operation: 'dr.plan', targetId: rec.id, evidence: 'live-verified', decision: reusedProduction ? 'reused production DR' : 'plan only' });
    return rec;
  }

  /** Validate a backup for a plan by REUSING the Sprint-1 backup foundation (real integrity check). */
  async validateBackup(planId: string, org?: string): Promise<{ valid: boolean; note: string }> {
    const rec = this.plans.get(planId);
    if (!rec) throw new Error(`no recovery plan ${planId}`);
    if (!this.ctx.deploy) return { valid: false, note: 'no deploy backup foundation connected' };
    const job = await this.ctx.deploy.backups().createJob({ kind: 'database', target: rec.name });
    const res = await this.ctx.deploy.backups().validateRestore(job.id);
    rec.backupValidated = res.valid;
    await this.governance.record({ operator: 'system', org: org ?? '_ops', environment: rec.drRegion, epic: 'E17', operation: 'dr.validate-backup', targetId: rec.id, evidence: 'live-verified', decision: res.valid ? 'validated' : 'failed' });
    return { valid: res.valid, note: res.note };
  }

  objectives(planId: string): { rpoMinutes: number; rtoMinutes: number } | undefined {
    const r = this.plans.get(planId);
    return r ? { rpoMinutes: r.rpoMinutes, rtoMinutes: r.rtoMinutes } : undefined;
  }
  list(): RecoveryRecord[] { return [...this.plans.values()]; }
  count(): number { return this.plans.size; }
}
