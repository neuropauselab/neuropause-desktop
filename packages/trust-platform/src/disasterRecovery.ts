/**
 * EPIC 9 — Disaster Recovery & Business Continuity. Recovery plans, recovery validation, a backup
 * catalog, a restore registry, a failover registry, and business-continuity procedures. Backups and
 * recovery validation REUSE the Launch-Workstream-1 backup-recovery engine (real backup records + a real
 * recovery-validation drill that itself reuses the Sprint-4 reliability engine). Failover to real regions
 * and production restore are infrastructure-pending — represented until real infrastructure exists.
 */
import { randomId } from '@neuropause/cloud-core';
import { type BackupKind } from './constants';
import type { TpContext } from './types';
import type { TrustGovernance } from './governance';

export interface RecoveryPlan {
  id: string;
  name: string;
  rtoMinutes: number;
  rpoMinutes: number;
  steps: string[];
}
export interface BackupCatalogEntry {
  id: string;
  targetId: string;
  kind: BackupKind;
  snapshotId: string | null;
  restoreValidated: boolean;
  reusedBackupRecovery: boolean;
}
export interface RecoveryValidation {
  targetId: string;
  recovered: boolean;
  reusedBackupRecovery: boolean;
  note: string;
}
export interface FailoverEntry {
  id: string;
  region: string;
  mode: 'active-passive' | 'active-active';
  live: false;
}
export interface BcProcedure {
  id: string;
  name: string;
  steps: string[];
}

export class DisasterRecoveryPlatform {
  private readonly plans = new Map<string, RecoveryPlan>();
  private readonly catalog = new Map<string, BackupCatalogEntry>();
  private readonly failovers = new Map<string, FailoverEntry>();
  private readonly procedures = new Map<string, BcProcedure>();

  constructor(
    private readonly ctx: TpContext,
    private readonly gov: TrustGovernance,
    private readonly operator: string,
  ) {}

  async createRecoveryPlan(input: { name: string; rtoMinutes: number; rpoMinutes: number; steps: string[] }): Promise<RecoveryPlan> {
    const plan: RecoveryPlan = { id: randomId('rplan'), name: input.name, rtoMinutes: input.rtoMinutes, rpoMinutes: input.rpoMinutes, steps: input.steps };
    this.plans.set(plan.id, plan);
    await this.gov.record({ actor: this.operator, environment: '_dr', resource: input.name, policy: 'recovery-plan', epic: 'E9', operation: 'create-recovery-plan', targetId: plan.id, evidence: 'live-verified', decision: `rto:${input.rtoMinutes}m` });
    return plan;
  }

  /** Take a backup — REUSES the Launch-Workstream-1 backup-recovery engine's real backup record. */
  async backup(input: { targetId: string; kind: BackupKind }): Promise<BackupCatalogEntry> {
    let snapshotId: string | null = null;
    let restoreValidated = false;
    let reusedBackupRecovery = false;
    if (this.ctx.platformOperations) {
      const record = await this.ctx.platformOperations.backupRecovery().backup({ targetId: input.targetId, kind: input.kind });
      snapshotId = record.snapshotId;
      restoreValidated = record.restoreValidated;
      reusedBackupRecovery = true;
    }
    const entry: BackupCatalogEntry = { id: randomId('bkp'), targetId: input.targetId, kind: input.kind, snapshotId, restoreValidated, reusedBackupRecovery };
    this.catalog.set(entry.id, entry);
    await this.gov.record({ actor: this.operator, environment: '_dr', resource: input.targetId, policy: 'backup-catalog', epic: 'E9', operation: 'backup', targetId: entry.id, evidence: reusedBackupRecovery ? 'live-verified' : 'infrastructure-pending', decision: input.kind });
    return entry;
  }

  /** Validate disaster recovery — REUSES the backup-recovery engine's real validation drill. */
  async validateRecovery(targetId: string): Promise<RecoveryValidation> {
    if (this.ctx.platformOperations) {
      const result = await this.ctx.platformOperations.backupRecovery().validateDisasterRecovery({ targetId });
      await this.gov.record({ actor: this.operator, environment: '_dr', resource: targetId, policy: 'recovery-validation', epic: 'E9', operation: 'validate-recovery', targetId, evidence: 'live-verified', decision: result.recovered ? 'recovered' : 'failed' });
      return { targetId, recovered: result.recovered, reusedBackupRecovery: true, note: result.note };
    }
    return { targetId, recovered: false, reusedBackupRecovery: false, note: 'no backup-recovery engine wired in — validation represented until configured' };
  }

  /** Register a failover target — REPRESENTED; no real region is active until infrastructure exists. */
  async registerFailover(input: { region: string; mode: 'active-passive' | 'active-active' }): Promise<FailoverEntry> {
    const entry: FailoverEntry = { id: randomId('failover'), region: input.region, mode: input.mode, live: false };
    this.failovers.set(entry.id, entry);
    await this.gov.record({ actor: this.operator, environment: '_dr', resource: input.region, policy: 'failover-registry', epic: 'E9', operation: 'register-failover', targetId: entry.id, evidence: 'infrastructure-pending', decision: input.mode });
    return entry;
  }

  async addBcProcedure(input: { name: string; steps: string[] }): Promise<BcProcedure> {
    const proc: BcProcedure = { id: randomId('bcp'), name: input.name, steps: input.steps };
    this.procedures.set(proc.id, proc);
    await this.gov.record({ actor: this.operator, environment: '_dr', resource: input.name, policy: 'business-continuity', epic: 'E9', operation: 'add-bc-procedure', targetId: proc.id, evidence: 'live-verified', decision: `${input.steps.length} steps` });
    return proc;
  }

  backupCatalog(): BackupCatalogEntry[] {
    return [...this.catalog.values()];
  }
  planCount(): number {
    return this.plans.size;
  }
  failoverCount(): number {
    return this.failovers.size;
  }
  procedureCount(): number {
    return this.procedures.size;
  }
}
