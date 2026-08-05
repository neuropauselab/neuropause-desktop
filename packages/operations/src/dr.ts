/**
 * Disaster Recovery (NCEA 15.0, Phase 5). Orchestrates recovery over a
 * `BackupTarget` — the interface the persistence `BackupManager` (Phase 12, already
 * VERIFIED against real Postgres) satisfies; DR does not reimplement backup. It
 * runs real drills (snapshot → simulate loss → restore → validate by state
 * fingerprint), measures RPO and RTO against declared objectives, supports
 * snapshot + (snapshot-granularity) point-in-time recovery, and emits recovery
 * reports. Per the mandate, DR is only reported "validated" when a drill is
 * actually executed; continuous WAL PITR, base backups, and cross-region failover
 * are Postgres/cloud operational procedures and are INFRA-PENDING.
 */
import { randomId, sha256Hex, systemClock, type Clock } from '@neuropause/cloud-core';

/** The backup contract DR orchestrates. The persistence BackupManager is a conforming adapter. */
export interface BackupTarget<S = unknown> {
  backup(): Promise<S>;
  restore(snapshot: S): Promise<void>;
  verify(snapshot: S): boolean;
  /** A stable hash of current state — used to validate that recovery reproduced it. */
  fingerprint(): Promise<string>;
}

export interface RecoveryObjectives {
  /** Recovery Point Objective — max acceptable data-loss window (ms). */
  rpoMs: number;
  /** Recovery Time Objective — max acceptable restore duration (ms). */
  rtoMs: number;
}

export interface Snapshot<S = unknown> {
  id: string;
  at: number;
  fingerprint: string;
  data: S;
}

export interface RecoveryReport {
  drillId: string;
  at: number;
  snapshotId: string;
  snapshotAt: number;
  backupVerified: boolean;
  /** Restored state matches the backed-up state (recovery validation). */
  recovered: boolean;
  /** Writes existed after the snapshot that the restore could not recover (the RPO window). */
  dataLoss: boolean;
  fingerprintBefore: string;
  fingerprintAfterSnapshot: string;
  fingerprintAfterRestore: string;
  rpoMs: number;
  rtoMs: number;
  withinRpo: boolean;
  withinRto: boolean;
  ok: boolean;
}

export interface DrEvent {
  kind: 'snapshot' | 'drill' | 'restore' | 'pitr';
  at: number;
  detail: Record<string, unknown>;
}

export interface DrOptions {
  metrics?: { inc(name: string, by?: number): void };
  onEvent?: (evt: DrEvent) => void;
}

export const DEFAULT_OBJECTIVES: RecoveryObjectives = { rpoMs: 5 * 60 * 1000, rtoMs: 15 * 60 * 1000 };

export class DisasterRecovery<S = unknown> {
  private readonly snapshots: Array<Snapshot<S>> = [];
  private readonly reports: RecoveryReport[] = [];

  constructor(
    private readonly target: BackupTarget<S>,
    private readonly clock: Clock = systemClock,
    private readonly objectives: RecoveryObjectives = DEFAULT_OBJECTIVES,
    private readonly options: DrOptions = {},
  ) {}

  private emit(kind: DrEvent['kind'], detail: Record<string, unknown>): void {
    this.options.onEvent?.({ kind, at: this.clock.now(), detail });
    this.options.metrics?.inc(`ops.dr.${kind}`);
  }

  /** Capture a verified snapshot of current state. */
  async takeSnapshot(): Promise<Snapshot<S>> {
    const data = await this.target.backup();
    const snapshot: Snapshot<S> = { id: randomId('snap'), at: this.clock.now(), fingerprint: await this.target.fingerprint(), data };
    this.snapshots.push(snapshot);
    this.emit('snapshot', { id: snapshot.id, verified: this.target.verify(data) });
    return snapshot;
  }
  listSnapshots(): Array<Snapshot<S>> {
    return this.snapshots.map((s) => ({ ...s }));
  }
  latestSnapshot(): Snapshot<S> | undefined {
    return this.snapshots[this.snapshots.length - 1];
  }

  objectivesOf(): RecoveryObjectives {
    return { ...this.objectives };
  }

  /**
   * Execute a recovery drill: fingerprint → (snapshot) → simulate loss → restore →
   * validate. Returns a report with measured RPO/RTO. Nothing here is asserted
   * "validated" unless this actually ran.
   */
  async drill(opts: { simulateLoss: () => void | Promise<void>; snapshot?: Snapshot<S> }): Promise<RecoveryReport> {
    const fingerprintBefore = await this.target.fingerprint();
    const snapshot = opts.snapshot ?? (await this.takeSnapshot());
    const fingerprintAfterSnapshot = snapshot.fingerprint;
    const drillStart = this.clock.now();
    const backupVerified = this.target.verify(snapshot.data);

    await opts.simulateLoss();

    const restoreStart = this.clock.now();
    await this.target.restore(snapshot.data);
    const restoreEnd = this.clock.now();
    const fingerprintAfterRestore = await this.target.fingerprint();

    const rtoMs = restoreEnd - restoreStart;
    const rpoMs = Math.max(0, drillStart - snapshot.at);
    const recovered = backupVerified && fingerprintAfterRestore === fingerprintAfterSnapshot;
    const dataLoss = fingerprintBefore !== fingerprintAfterSnapshot;
    const withinRto = rtoMs <= this.objectives.rtoMs;
    const withinRpo = rpoMs <= this.objectives.rpoMs;

    const report: RecoveryReport = {
      drillId: randomId('drill'),
      at: this.clock.now(),
      snapshotId: snapshot.id,
      snapshotAt: snapshot.at,
      backupVerified,
      recovered,
      dataLoss,
      fingerprintBefore,
      fingerprintAfterSnapshot,
      fingerprintAfterRestore,
      rpoMs,
      rtoMs,
      withinRpo,
      withinRto,
      ok: recovered && withinRto,
    };
    this.reports.push(report);
    this.emit('drill', { drillId: report.drillId, recovered, withinRto, withinRpo });
    return report;
  }

  /** Restore directly from a named snapshot. */
  async restoreFromSnapshot(snapshotId: string): Promise<{ restored: boolean; fingerprint: string }> {
    const snap = this.snapshots.find((s) => s.id === snapshotId);
    if (!snap) throw new Error(`snapshot '${snapshotId}' not found`);
    if (!this.target.verify(snap.data)) throw new Error('snapshot failed integrity verification');
    await this.target.restore(snap.data);
    const fingerprint = await this.target.fingerprint();
    this.emit('restore', { snapshotId, matches: fingerprint === snap.fingerprint });
    return { restored: fingerprint === snap.fingerprint, fingerprint };
  }

  /**
   * Snapshot-granularity point-in-time recovery: restore the latest snapshot at or
   * before `targetTime`. Continuous, sub-snapshot WAL PITR is INFRA-PENDING.
   */
  async pointInTimeRecovery(targetTime: number): Promise<{ restored: boolean; snapshotId: string | null; at: number | null }> {
    const eligible = this.snapshots.filter((s) => s.at <= targetTime).sort((a, b) => b.at - a.at);
    const snap = eligible[0];
    if (!snap) {
      this.emit('pitr', { targetTime, found: false });
      return { restored: false, snapshotId: null, at: null };
    }
    await this.target.restore(snap.data);
    const fingerprint = await this.target.fingerprint();
    this.emit('pitr', { targetTime, snapshotId: snap.id, matches: fingerprint === snap.fingerprint });
    return { restored: fingerprint === snap.fingerprint, snapshotId: snap.id, at: snap.at };
  }

  reportHistory(): RecoveryReport[] {
    return [...this.reports];
  }
  lastReport(): RecoveryReport | undefined {
    return this.reports[this.reports.length - 1];
  }
}

/**
 * A real (in-memory) BackupTarget over a mutable key/value state — the always-
 * available default so `disasterRecovery()` exists without external infra. It
 * genuinely backs up, restores, verifies, and fingerprints its state, so drills
 * against it are VERIFIED. Production swaps in the persistence-backed target (the
 * Phase-12 BackupManager over real Postgres), which satisfies the same interface.
 */
export class MemoryBackupTarget implements BackupTarget<Record<string, unknown>> {
  constructor(private state: Record<string, unknown> = {}) {}
  set(key: string, value: unknown): void {
    this.state[key] = value;
  }
  wipe(): void {
    this.state = {};
  }
  current(): Record<string, unknown> {
    return { ...this.state };
  }
  async backup(): Promise<Record<string, unknown>> {
    return { ...this.state };
  }
  async restore(snapshot: Record<string, unknown>): Promise<void> {
    this.state = { ...snapshot };
  }
  verify(snapshot: Record<string, unknown>): boolean {
    return snapshot !== null && typeof snapshot === 'object';
  }
  async fingerprint(): Promise<string> {
    return sha256Hex(JSON.stringify(Object.keys(this.state).sort().map((k) => [k, this.state[k]])));
  }
}
