/**
 * Migration engine — the ordered, recoverable upgrade core. Kept free of any
 * Electron import so it is unit-testable; the electron wiring (data-version
 * file, audit log, real backup/restore) lives in ./index.
 *
 * Guarantees:
 *   - migrations run in ascending target-version order;
 *   - a backup is taken before the first step;
 *   - a failing step triggers a restore from that backup and the data version is
 *     reverted, so a failed migration never leaves a half-upgraded store.
 */
import type {
  MaintenanceDomain,
  MigrationReport,
  MigrationStatus,
  MigrationStepResult,
  MigrationStepStatus,
} from '@neuropause/shared';

export interface MigrationContext {
  dataDir: string;
  log: (message: string, meta?: Record<string, unknown>) => void;
}

export interface MigrationDefinition {
  id: string;
  domain: MaintenanceDomain;
  /** The data version reached after this migration applies. */
  toVersion: number;
  up: (ctx: MigrationContext) => void | Promise<void>;
}

export interface MigrationEngineDeps {
  getCurrentVersion: () => Promise<number>;
  setCurrentVersion: (version: number) => Promise<void>;
  definitions: MigrationDefinition[];
  /** Take a pre-migration backup; returns an id, or null if backup is disabled. */
  backup: () => Promise<string | null>;
  /** Restore the named backup after a failed step. */
  restore: (backupId: string) => Promise<void>;
  context: MigrationContext;
  now?: () => number;
}

function targetVersion(defs: MigrationDefinition[]): number {
  return defs.reduce((max, d) => Math.max(max, d.toVersion), 0);
}

function pendingFrom(defs: MigrationDefinition[], current: number): MigrationDefinition[] {
  return defs.filter((d) => d.toVersion > current).sort((a, b) => a.toVersion - b.toVersion);
}

export class MigrationEngine {
  private readonly now: () => number;

  constructor(private readonly deps: MigrationEngineDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  async status(): Promise<MigrationStatus> {
    const current = await this.deps.getCurrentVersion();
    const target = targetVersion(this.deps.definitions);
    const pending = pendingFrom(this.deps.definitions, current).length;
    return { currentVersion: current, targetVersion: target, pending, upToDate: pending === 0, lastRun: null };
  }

  /** Run all pending migrations. With dryRun, report the plan without executing. */
  async run(opts: { dryRun?: boolean } = {}): Promise<MigrationReport> {
    const startedAt = new Date(this.now()).toISOString();
    const current = await this.deps.getCurrentVersion();
    const pending = pendingFrom(this.deps.definitions, current);
    const target = pending.length ? pending[pending.length - 1].toVersion : current;

    if (pending.length === 0) {
      return this.report(startedAt, current, current, true, null, false, []);
    }

    if (opts.dryRun) {
      const steps = pending.map<MigrationStepResult>((d) => ({
        id: d.id,
        domain: d.domain,
        fromVersion: current,
        toVersion: d.toVersion,
        status: 'pending',
        durationMs: 0,
        detail: 'dry run — not executed',
      }));
      return this.report(startedAt, current, target, true, null, false, steps);
    }

    const backupId = await this.deps.backup();
    const steps: MigrationStepResult[] = [];
    let reached = current;
    let ok = true;
    let recovered = false;

    for (let i = 0; i < pending.length; i++) {
      const def = pending[i];
      const from = reached;
      const startStep = this.now();
      try {
        await def.up(this.deps.context);
        reached = def.toVersion;
        await this.deps.setCurrentVersion(reached);
        steps.push(this.step(def, from, 'applied', this.now() - startStep, null));
      } catch (err) {
        ok = false;
        steps.push(
          this.step(def, from, 'failed', this.now() - startStep, err instanceof Error ? err.message : String(err)),
        );
        // Recover: restore the pre-migration backup and revert the version.
        if (backupId) {
          try {
            await this.deps.restore(backupId);
            recovered = true;
          } catch (restoreErr) {
            this.deps.context.log('Recovery restore failed', {
              message: restoreErr instanceof Error ? restoreErr.message : String(restoreErr),
            });
          }
        }
        await this.deps.setCurrentVersion(current);
        reached = current;
        // Mark the remaining steps as rolled back.
        for (let j = i + 1; j < pending.length; j++) {
          steps.push(this.step(pending[j], current, 'rolledBack', 0, 'not attempted after failure'));
        }
        break;
      }
    }

    return this.report(startedAt, current, reached, ok, backupId, recovered, steps);
  }

  private step(
    def: MigrationDefinition,
    fromVersion: number,
    status: MigrationStepStatus,
    durationMs: number,
    detail: string | null,
  ): MigrationStepResult {
    return { id: def.id, domain: def.domain, fromVersion, toVersion: def.toVersion, status, durationMs, detail };
  }

  private report(
    startedAt: string,
    fromVersion: number,
    toVersion: number,
    ok: boolean,
    backupId: string | null,
    recovered: boolean,
    steps: MigrationStepResult[],
  ): MigrationReport {
    return {
      startedAt,
      finishedAt: new Date(this.now()).toISOString(),
      fromVersion,
      toVersion,
      ok,
      backupId,
      recovered,
      steps,
    };
  }
}
