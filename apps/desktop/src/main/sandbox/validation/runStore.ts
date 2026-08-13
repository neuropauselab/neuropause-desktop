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

/**
 * Retention budget PER OWNER, not per install.
 *
 * P13C ROUND 10 (NEW-H3). This was `MAX_RUNS` and it was install-wide, applied
 * to the one shared `runs` array by both `add` and `snapshot`. Reads were
 * already scoped through `onlyMine`/`mine` and `update` had been hardened
 * against a write-side IDOR, so the cap was the last unpartitioned thing left
 * between them — and it sat on the write path, where scoping is not optional.
 *
 * The proven attack: tenant B holds 4 certification runs; tenant A submits 200
 * of its own; B's `all()` and `history()` both return 0. B's certification
 * evidence — what was validated, at what level, and the runIds that unlock the
 * full reports — is destroyed by another tenant's ordinary use of the product,
 * with no privileged call and nothing shown to A. And because `snapshot()`
 * applied the same slice, the loss was WRITTEN TO DISK on the next debounced
 * save, so it survived a restart.
 *
 * The number is unchanged: every tenant still keeps its most recent 200 runs.
 * What changed is that a tenant's 201st run can now only evict its OWN 1st.
 */
const MAX_RUNS_PER_OWNER = 200;

/**
 * The retention bucket a run is charged to.
 *
 * The SAME key the reads scope on — `tenantId`, via `mine`/`onlyMine` on the
 * base class. A cap keyed differently from the reads would be a second opinion
 * about who owns a row, and the disagreement always resolves as data loss for
 * whichever side is narrower.
 *
 * Pre-P13C rows carry no `tenantId`. They are visible to nobody, but they are
 * still rows in the file, so they get their own bucket rather than sharing one
 * with a live tenant: sharing would let inert legacy rows evict real evidence,
 * and would let a live tenant erase the migration inventory's own subject.
 * Same reasoning, same shape, as `graphStore.historyBucket`.
 */
const UNOWNED_RUN_BUCKET = '__unowned__';

function runBucket(run: ValidationRun): string {
  const owner = run.tenantId;
  return typeof owner === 'string' && owner !== '' ? `t:${owner}` : UNOWNED_RUN_BUCKET;
}

export class ValidationRunStore extends PersistentStore<RunFile> {
  private runs: ValidationRun[] = [];

  constructor(filePath: string) {
    super(filePath, 'sandbox-validation-runs');
  }

  /**
   * The file is exactly what is in memory.
   *
   * It used to be `this.runs.slice(-MAX_RUNS)`, which made persistence a SECOND
   * retention rule — one that ran on every debounced write, was never visible
   * to any read, and could disagree with the in-memory state. Retention now
   * happens at the single mutation point (`add` → `capPerOwner`), so there is
   * one rule, it is per-owner, and memory and disk cannot drift apart.
   */
  protected snapshot(): RunFile {
    return { runs: [...this.runs] };
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
    this.capPerOwner();
    this.changed();
  }

  /**
   * Keep the newest `MAX_RUNS_PER_OWNER` runs FOR EACH OWNER.
   *
   * Walks newest-first (the array is append-ordered, which is what `recent`
   * relies on when it takes `slice(-limit)`), counts per bucket, and keeps the
   * first `MAX_RUNS_PER_OWNER` it meets in each. The single `filter` at the end
   * preserves the original ordering for the survivors, so `recent` and the
   * dashboard are unaffected — and it is skipped entirely when nothing
   * overflowed, so the common path allocates nothing.
   *
   * This is the house pattern: `marketplaceStore.event()` (per listing) and
   * `graphStore.capHistoryPerTenant()` (per tenant). Same walk, same kept-set,
   * same single rewrite.
   */
  private capPerOwner(): void {
    const perOwner = new Map<string, number>();
    const kept = new Set<ValidationRun>();
    let overflowed = false;
    for (let i = this.runs.length - 1; i >= 0; i -= 1) {
      const row = this.runs[i]!;
      const bucket = runBucket(row);
      const n = perOwner.get(bucket) ?? 0;
      if (n < MAX_RUNS_PER_OWNER) {
        kept.add(row);
        perOwner.set(bucket, n + 1);
      } else {
        overflowed = true;
      }
    }
    if (overflowed) this.runs = this.runs.filter((r) => kept.has(r));
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
