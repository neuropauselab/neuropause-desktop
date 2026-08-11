/**
 * AI Sandbox — Continuous Validation Platform (S6): the validation run store.
 *
 * Persists validation run history on the SAME S1 `PersistentStore` substrate every sandbox
 * store uses (atomic write + debounce) — capped to the most recent runs. Not an artifact or
 * benchmark store; it holds run metadata for the dashboard and the portal projection.
 */
import { randomUUID } from 'node:crypto';
import type { ValidationHistoryEntry, ValidationRun } from '@neuropause/shared';
import { PersistentStore } from '../persistentStore';

interface RunFile {
  runs: ValidationRun[];
}

const MAX_RUNS = 200;

export class ValidationRunStore extends PersistentStore<RunFile> {
  private runs: ValidationRun[] = [];

  constructor(filePath: string) {
    super(filePath, 'sandbox-validation-runs');
  }

  protected snapshot(): RunFile {
    return { runs: this.runs.slice(-MAX_RUNS) };
  }
  protected hydrate(data: Partial<RunFile>): void {
    this.runs = (data.runs ?? []).filter((r) => r && r.id);
  }

  newId(): string {
    return `vrun_${randomUUID()}`;
  }

  /**
   * P13C — a run is stamped with its owner, or refused.
   *
   * This store extends the same `PersistentStore` the five S1 stores do, and
   * gained the same seam — but nothing bound it, so it stayed open while its
   * siblings closed. `hasScope()` existing with no caller is exactly how that
   * happened; see the boot invariant in `sandbox/index.ts`.
   */
  add(run: ValidationRun): void {
    this.runs.push({ ...run, tenantId: this.requireTenant() });
    if (this.runs.length > MAX_RUNS) this.runs = this.runs.slice(-MAX_RUNS);
    this.changed();
  }
  update(run: ValidationRun): void {
    const existing = this.runs.findIndex((r) => r.id === run.id);
    // Only the OWNER may update a run. Without this, `update` was a write-side
    // IDOR keyed on a runId.
    if (existing >= 0) {
      if (!this.mine(this.runs[existing]!)) return;
      this.runs[existing] = { ...run, tenantId: this.runs[existing]!.tenantId ?? null };
      this.changed();
      return;
    }
    this.add(run);
  }
  /** The run, IF it is the caller's. A foreign runId reads as absent. */
  get(id: string): ValidationRun | null {
    const r = this.runs.find((x) => x.id === id) ?? null;
    return r !== null && this.mine(r) ? r : null;
  }
  all(): ValidationRun[] {
    return this.onlyMine(this.runs);
  }
  recent(limit = 25): ValidationRun[] {
    return this.onlyMine(this.runs).slice(-limit).reverse();
  }
  /**
   * History entries — scoped. These carry runIds, certification level and
   * pass/fail counts, and the runIds then unlock the full detail elsewhere, so
   * an unscoped history was both a disclosure and the key to a bigger one.
   */
  history(limit = 25): ValidationHistoryEntry[] {
    return this.recent(limit).map(toHistoryEntry);
  }
  count(): number {
    return this.all().length;
  }

  /** Unscoped ownership counts, for the migration inventory only. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    return this.countOwnership(this.runs);
  }
}

export function toHistoryEntry(run: ValidationRun): ValidationHistoryEntry {
  const passed = run.stages.filter((s) => s.status === 'pass').length;
  const failed = run.stages.filter((s) => s.status === 'fail' || s.status === 'error').length;
  return { runId: run.id, pipeline: run.pipeline, level: run.certificationLevel, status: run.status, at: run.startedAt, passed, failed };
}
