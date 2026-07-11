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
    super(filePath);
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

  add(run: ValidationRun): void {
    this.runs.push(run);
    if (this.runs.length > MAX_RUNS) this.runs = this.runs.slice(-MAX_RUNS);
    this.changed();
  }
  update(run: ValidationRun): void {
    const i = this.runs.findIndex((r) => r.id === run.id);
    if (i >= 0) this.runs[i] = run;
    else this.add(run);
    this.changed();
  }
  get(id: string): ValidationRun | null {
    return this.runs.find((r) => r.id === id) ?? null;
  }
  all(): ValidationRun[] {
    return [...this.runs];
  }
  recent(limit = 25): ValidationRun[] {
    return this.runs.slice(-limit).reverse();
  }
  history(limit = 25): ValidationHistoryEntry[] {
    return this.recent(limit).map(toHistoryEntry);
  }
  count(): number {
    return this.runs.length;
  }
}

export function toHistoryEntry(run: ValidationRun): ValidationHistoryEntry {
  const passed = run.stages.filter((s) => s.status === 'pass').length;
  const failed = run.stages.filter((s) => s.status === 'fail' || s.status === 'error').length;
  return { runId: run.id, pipeline: run.pipeline, level: run.certificationLevel, status: run.status, at: run.startedAt, passed, failed };
}
