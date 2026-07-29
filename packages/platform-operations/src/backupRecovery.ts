/**
 * EPIC 12 — Backup & Recovery. Scheduled backups, restore verification, snapshot lifecycle, and DR
 * validation. Backups + restore verification REUSE the production backup platform (real record-integrity
 * check); DR validation REUSES the Sprint-4 recovery-validation engine. Real off-site data restore
 * requires provisioned infrastructure and is not claimed.
 */
import { randomId } from '@neuropause/cloud-core';
import type { PlatformOpsContext } from './types';
import type { PlatformOpsGovernance } from './governance';

export interface BackupRecord {
  id: string;
  targetId: string;
  snapshotId: string | null;
  restoreValidated: boolean;
  reusedProduction: boolean;
}

export class BackupRecovery {
  private readonly backups = new Map<string, BackupRecord>();

  constructor(
    private readonly ctx: PlatformOpsContext,
    private readonly gov: PlatformOpsGovernance,
    private readonly operator: string,
  ) {}

  /** Schedule + take a backup, verifying restore via the reused production backup platform. */
  async backup(input: { targetId: string; kind?: 'database' | 'configuration' | 'tenant' }): Promise<BackupRecord> {
    let snapshotId: string | null = null;
    let restoreValidated = false;
    let reusedProduction = false;
    if (this.ctx.production) {
      const snap = await this.ctx.production.backups().createBackup({ kind: input.kind ?? 'database', targetId: input.targetId });
      const val = await this.ctx.production.backups().validateRestore(snap.id);
      snapshotId = snap.id;
      restoreValidated = val.valid;
      reusedProduction = true;
    }
    const record: BackupRecord = { id: randomId('backup'), targetId: input.targetId, snapshotId, restoreValidated, reusedProduction };
    this.backups.set(record.id, record);
    await this.gov.record({ operator: this.operator, environment: 'production', deployment: '_none', cluster: '_backup', version: '_platform', epic: 'E12', operation: 'backup', targetId: input.targetId, evidence: 'live-verified', decision: restoreValidated ? 'restore validated' : 'not validated' });
    return record;
  }

  /** DR validation reuses the Sprint-4 recovery-validation engine when wired in. */
  async validateDisasterRecovery(input: { targetId: string }): Promise<{ recovered: boolean; reusedReliability: boolean; note: string }> {
    if (this.ctx.reliability) {
      const drill = await this.ctx.reliability.recovery().validate({ kind: 'backup-restore', targetId: input.targetId });
      await this.gov.record({ operator: this.operator, environment: 'disaster-recovery', deployment: '_none', cluster: '_dr', version: '_platform', epic: 'E12', operation: 'dr-validation', targetId: input.targetId, evidence: 'live-verified', decision: drill.recovered ? 'recovered' : 'not-recovered' });
      return { recovered: drill.recovered, reusedReliability: true, note: 'DR validated via the reused Sprint-4 recovery engine; real cross-region failover requires provisioned DR infrastructure' };
    }
    return { recovered: false, reusedReliability: false, note: 'reliability platform not wired in' };
  }

  list(): BackupRecord[] {
    return [...this.backups.values()];
  }
  validatedCount(): number {
    return [...this.backups.values()].filter((b) => b.restoreValidated).length;
  }
}
