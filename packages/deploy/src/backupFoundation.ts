/**
 * EPIC 11 — Backup Foundation. Backup/snapshot/retention policies, database backup jobs, restore
 * validation, and recovery plans. REPRESENTS jobs and REUSES the Wave 14 production backup platform
 * (which itself reuses cloud-ops) when connected. It DOES NOT claim successful backups: a created
 * backup starts unvalidated and is only marked restorable after a real integrity check.
 */
import { randomId } from '@neuropause/cloud-core';
import type { DeployGovernance } from './governance';
import type { DeployContext } from './types';
import type { BackupKind } from '@neuropause/production';

export interface BackupJob {
  id: string;
  kind: BackupKind;
  target: string;
  reusedProduction: boolean;
  restoreValidated: boolean;
  snapshotId: string | null;
  note: string;
}

export class BackupFoundation {
  private readonly jobs = new Map<string, BackupJob>();

  constructor(
    private readonly governance: DeployGovernance,
    private readonly ctx: DeployContext = {},
  ) {}

  policies(): { schedule: string; retentionDays: number; kinds: BackupKind[] } {
    return { schedule: '0 2 * * *', retentionDays: 30, kinds: ['tenant', 'workspace', 'database', 'configuration'] };
  }

  /** Create a backup job — REUSES the production backup platform; never claims success. */
  async createJob(input: { kind: BackupKind; target: string; org?: string }): Promise<BackupJob> {
    let snapshotId: string | null = null;
    let restoreValidated = false;
    let reusedProduction = false;
    if (this.ctx.production) {
      const snap = await this.ctx.production.backups().createBackup({ kind: input.kind, targetId: input.target });
      snapshotId = snap.id;
      restoreValidated = snap.restoreValidated; // false until a real integrity check runs
      reusedProduction = true;
    }
    const job: BackupJob = {
      id: randomId('bkjob'),
      kind: input.kind,
      target: input.target,
      reusedProduction,
      restoreValidated,
      snapshotId,
      note: reusedProduction ? 'backup created via the reused production/cloud-ops runtime; restore not yet validated' : 'backup job represented; no production backup platform connected',
    };
    this.jobs.set(job.id, job);
    await this.governance.record({ operator: 'system', org: input.org ?? '_ops', environment: '_platform', epic: 'E11', operation: `backup.${input.kind}`, targetId: job.id, evidence: 'live-verified', decision: 'restore not yet validated' });
    return job;
  }

  /** Validate restore by REUSING the production backup validation (a real integrity check). */
  async validateRestore(jobId: string, org?: string): Promise<{ valid: boolean; note: string }> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`no backup job ${jobId}`);
    if (!this.ctx.production || !job.snapshotId) return { valid: false, note: 'no production backup platform connected — restore not validated' };
    const res = await this.ctx.production.backups().validateRestore(job.snapshotId);
    job.restoreValidated = res.valid;
    await this.governance.record({ operator: 'system', org: org ?? '_ops', environment: '_platform', epic: 'E11', operation: 'backup.validate-restore', targetId: job.id, evidence: 'live-verified', decision: res.valid ? 'validated' : 'failed' });
    return { valid: res.valid, note: res.note };
  }

  list(): BackupJob[] { return [...this.jobs.values()]; }
  count(): number { return this.jobs.size; }
}
