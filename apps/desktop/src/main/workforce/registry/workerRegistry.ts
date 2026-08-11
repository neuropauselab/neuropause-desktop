/**
 * The Worker Registry. Holds every `Worker` — identity, role, skills,
 * permissions, goals, memory scope, policy bindings, trust, lifecycle, and
 * health. Trust and health evolve **deterministically** from job outcomes:
 * success nudges trust up, failure down (floored); health reflects the recent
 * success rate (healthy ≥ 0.8 > degraded > unhealthy when the majority of a
 * meaningful number of jobs fail).
 *
 * Electron-free (constructor takes a file path); the singleton lives in
 * registryInstance.ts. Persistence mirrors the rest of the app: a serialized
 * background writer with atomic temp-file + rename.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import type {
  Worker,
  WorkerHealthState,
  WorkerLifecycle,
  WorkerSummary,
  WorkforceHealthInput,
} from '@neuropause/shared';
import { toWorkerSummary } from '@neuropause/shared';
import { createLogger } from '../../logger';
import type { WorkerDefinition } from '../sdk';
import { declareStoreScope } from '../../tenancy/storeScope';

/** P13C ROUND 8 — the structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'worker-registry',
  scope: 'INSTALL_GLOBAL',
  persistence: 'file',
  // P13C ROUND 9 — F2/F19. Was ORG_ROLE, which is the Round 7 finding class as a
  // LEGAL declaration: an install-wide resource whose mutation an organization
  // role could authorize. `declareStoreScope` now refuses that combination.
  authority: 'PLATFORM_OPERATOR',
  classification: 'INSTALL_METADATA',
  retention: 'No cap. unregister removes one worker for the whole install, and now requires cloud:operate.',
  reason: "WHY GLOBAL: Worker has no tenant field, and composed workers register into ONE process-wide registry with one skill-resolution seam, so two tenants cannot hold different versions of the same worker id. WHAT DATA: package identity, declared skills, permissions, goals — publisher-authored. ROUND 8 FINDING: trustScore and health.{jobsRun,jobsFailed,successRate} were mutated from TENANT job execution and read install-wide, making this a live counter of another tenant's job volume and failure rate; see recordOutcome. CROSS-TENANT COST: a workforce:manage holder can uninstall a package other tenants use.",
});

const log = createLogger('worker-registry');

const MIN_TRUST = 0.05;

/** One tenant's execution counters for one worker package. P13C Round 8. */
interface WorkerOutcomeCounters {
  jobsRun: number;
  jobsFailed: number;
  /** Null until this tenant has run the worker; falls back to the package default. */
  trust: number | null;
}

interface RegistryFile {
  workers: Worker[];
  /**
   * Per-tenant execution counters. P13C Round 8.
   *
   * DURABLE, because trust and health were durable before this change and losing
   * them on restart would be a regression dressed as a security fix. Shape:
   * `{ [tenantId]: { [workerId]: counters } }`, with `''` for an unresolved
   * writer — a partition that reaches nobody, not a shared one.
   */
  outcomes?: Record<string, Record<string, WorkerOutcomeCounters>>;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export class WorkerRegistry extends EventEmitter {
  /**
   * P13C ROUND 8 — THE COUNTERS ARE PER TENANT; THE PACKAGE IS NOT.
   *
   * The registry itself is genuinely install-level: `Worker` has no tenant field,
   * and composed workers register into ONE process-wide registry with one
   * skill-resolution seam, so two tenants cannot hold different versions of the
   * same worker id. That classification survives inspection.
   *
   * What did NOT survive inspection is `trustScore` and
   * `health.{jobsRun,jobsFailed,successRate}`. Those are mutated by
   * `recordOutcome` from TENANT JOB EXECUTION, and `healthSummaries()` served them
   * install-wide on `workforce:read` — a live counter of how many jobs another
   * tenant ran and how many failed. A store can be correctly classified and still
   * hold one field that is not: the classification is per FIELD, not per file, and
   * this is the sharpest example of it in the codebase.
   *
   * So the outcome counters live in a per-tenant side table. The package row keeps
   * its publisher-authored identity and nothing else.
   */
  private readonly outcomes = new Map<string, Map<string, WorkerOutcomeCounters>>();
  private tenantIdFor: () => string | null = () => null;

  /** Bind the tenant boundary for OUTCOME COUNTERS. The catalogue stays global. */
  bindOutcomeScope(source: () => string | null): this {
    this.tenantIdFor = source;
    return this;
  }

  /** One tenant's counters for one worker. `''` when unresolved — see `mine`. */
  private counters(workerId: string): WorkerOutcomeCounters {
    const key = this.tenantIdFor() ?? '';
    const bucket = this.outcomes.get(key) ?? new Map<string, WorkerOutcomeCounters>();
    if (!this.outcomes.has(key)) this.outcomes.set(key, bucket);
    return bucket.get(workerId) ?? { jobsRun: 0, jobsFailed: 0, trust: null };
  }

  private setCounters(workerId: string, next: WorkerOutcomeCounters): void {
    const key = this.tenantIdFor() ?? '';
    const bucket = this.outcomes.get(key) ?? new Map<string, WorkerOutcomeCounters>();
    bucket.set(workerId, next);
    this.outcomes.set(key, bucket);
  }

  private workers = new Map<string, Worker>();
  private loaded = false;
  private lastPersist: Promise<void> = Promise.resolve();
  private persisting = false;
  private dirty = false;

  constructor(private readonly filePath: string) {
    super();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw) as Partial<RegistryFile>;
      for (const w of data.workers ?? []) if (w && w.identity?.id) this.workers.set(w.identity.id, w);
      /**
       * MIGRATION. A pre-Round-8 file has no `outcomes`, and its worker rows carry
       * counters that are the SUM of every tenant's runs. Those are not adopted by
       * any tenant — attributing an aggregate to whoever loads it first is the
       * "first caller claims it" fallback this program has removed four times.
       *
       * The catalogue row keeps them, so the pre-upgrade totals remain visible as
       * the package's own history; each tenant starts counting its own from zero.
       */
      for (const [tenantId, byWorker] of Object.entries(data.outcomes ?? {})) {
        const bucket = new Map<string, WorkerOutcomeCounters>();
        for (const [workerId, c] of Object.entries(byWorker)) bucket.set(workerId, c);
        this.outcomes.set(tenantId, bucket);
      }
    } catch {
      // First run — empty registry.
    }
    this.loaded = true;
    log.info('Worker registry ready', { workers: this.workers.size });
  }

  private async persist(): Promise<void> {
    const file: RegistryFile = {
      workers: [...this.workers.values()],
      outcomes: Object.fromEntries(
        [...this.outcomes].map(([tenantId, byWorker]) => [tenantId, Object.fromEntries(byWorker)]),
      ),
    };
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  private schedulePersist(): void {
    this.dirty = true;
    if (this.persisting) return;
    this.persisting = true;
    this.lastPersist = this.drainPersist();
  }

  private async drainPersist(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        await this.persist();
      }
    } catch (err) {
      log.error('Registry persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }

  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  private mutated(): void {
    this.schedulePersist();
    this.emit('changed');
  }

  /**
   * Register a worker from its definition. Re-registering the same id (e.g. a
   * version upgrade) refreshes identity/skills/permissions but **preserves**
   * trust, health, and lifecycle.
   */
  register(def: WorkerDefinition, now = new Date().toISOString()): Worker {
    const id = def.worker.identity.id;
    const existing = this.workers.get(id);
    const worker: Worker = existing
      ? {
          ...def.worker,
          trustScore: existing.trustScore,
          health: existing.health,
          lifecycle: existing.lifecycle,
          createdAt: existing.createdAt,
          updatedAt: now,
        }
      : { ...def.worker, createdAt: now, updatedAt: now };
    this.workers.set(id, worker);
    this.mutated();
    // Return the row WITH the caller's own history, exactly as `get()` does —
    // otherwise re-registering would appear to reset this tenant's trust.
    return this.withCallerHistory(worker);
  }

  /**
   * One worker, with THE CALLER'S execution history projected onto it.
   *
   * P13C ROUND 8 — the projection is what makes this both correct and
   * non-breaking. The catalogue row is shared and install-level, as declared. The
   * `trustScore` and `health` fields on it were accumulating every tenant's runs,
   * so an install-wide read told one tenant how much work another had put through
   * the same worker.
   *
   * Removing those fields would have created a new vacuous zero for the dozen
   * consumers that read them — which is Finding 7 all over again. So they are
   * OVERLAID per caller instead: every existing call site keeps working and now
   * sees its own numbers, which is what each of them always meant.
   */
  get(id: string): Worker | null {
    const w = this.workers.get(id);
    return w === undefined ? null : this.withCallerHistory(w);
  }

  /** Overlay the caller's counters onto a shared catalogue row. */
  private withCallerHistory(w: Worker): Worker {
    const c = this.counters(w.identity.id);
    if (c.jobsRun === 0 && c.trust === null) return w;
    const successRate = c.jobsRun > 0 ? round3((c.jobsRun - c.jobsFailed) / c.jobsRun) : 1;
    const state: WorkerHealthState =
      c.jobsRun >= 3 && successRate < 0.5 ? 'unhealthy' : successRate < 0.8 ? 'degraded' : 'healthy';
    return {
      ...w,
      trustScore: c.trust ?? w.trustScore,
      health: {
        ...w.health,
        state,
        successRate,
        jobsRun: c.jobsRun,
        jobsFailed: c.jobsFailed,
      },
    };
  }

  has(id: string): boolean {
    return this.workers.has(id);
  }

  /**
   * P8.5 — remove a worker from the registry (used by worker-package uninstall).
   * Returns true if a worker was removed. Built-in workers are re-seeded at every
   * startup, so callers must guard against unregistering a built-in; this primitive
   * itself is neutral.
   */
  unregister(id: string): boolean {
    const removed = this.workers.delete(id);
    if (removed) this.mutated();
    return removed;
  }

  /** The shared catalogue, each row carrying the CALLER'S own execution history. */
  list(): Worker[] {
    return [...this.workers.values()]
      .map((w) => this.withCallerHistory(w))
      .sort((a, b) => a.identity.name.localeCompare(b.identity.name));
  }

  summaries(): WorkerSummary[] {
    return this.list().map(toWorkerSummary);
  }

  /**
   * Per-worker health projection for workforce-health aggregation (V8.1). Exposes
   * the success-rate fields toWorkerSummary omits, read from the same computed
   * Worker.health — no new logic.
   */
  /**
   * Health for the CALLER'S OWN runs of each worker.
   *
   * P13C Round 8. This returned the install's counters, so `jobsRun` told one
   * tenant how much work another tenant had put through the same worker package.
   * The worker LIST is still install-wide — the catalogue is shared and that is
   * correct — but the numbers beside each entry are now this tenant's own.
   */
  healthSummaries(): WorkforceHealthInput[] {
    // `list()` already overlays the caller's history, so this stays a projection
    // rather than becoming a second place that computes health.
    return this.list().map((w) => ({
      id: w.identity.id,
      name: w.identity.name,
      state: w.health.state,
      successRate: w.health.successRate,
      jobsRun: w.health.jobsRun,
      jobsFailed: w.health.jobsFailed,
    }));
  }

  setLifecycle(id: string, lifecycle: WorkerLifecycle, now = new Date().toISOString()): Worker | null {
    const w = this.workers.get(id);
    if (!w) return null;
    const updated: Worker = { ...w, lifecycle, updatedAt: now };
    this.workers.set(id, updated);
    this.mutated();
    return updated;
  }

  /** Record a job outcome: updates health (run/fail counts, success rate, state) and trust. */
  recordOutcome(id: string, success: boolean, now = new Date().toISOString()): Worker | null {
    const w = this.workers.get(id);
    if (!w) return null;

    /**
     * The counters advance in the CALLER'S bucket. P13C Round 8.
     *
     * `w.health.jobsRun + 1` accumulated every tenant's executions onto one shared
     * row, which is why the install-wide read was a cross-tenant activity meter.
     */
    const prev = this.counters(id);
    const jobsRun = prev.jobsRun + 1;
    const jobsFailed = prev.jobsFailed + (success ? 0 : 1);
    const successRate = jobsRun > 0 ? (jobsRun - jobsFailed) / jobsRun : 1;

    let trust = (prev.trust ?? w.trustScore) + (success ? 0.02 : -0.05);
    trust = Math.max(MIN_TRUST, Math.min(1, round3(trust)));

    const state: WorkerHealthState =
      jobsRun >= 3 && successRate < 0.5 ? 'unhealthy' : successRate < 0.8 ? 'degraded' : 'healthy';

    this.setCounters(id, { jobsRun, jobsFailed, trust });

    /**
     * The PACKAGE row is left alone: its `health` and `trustScore` are the shared
     * catalogue's fields and no longer accumulate tenant executions. The returned
     * value carries the CALLER'S numbers so existing callers see their own, which
     * is what they always meant.
     */
    const updated: Worker = {
      ...w,
      trustScore: trust,
      health: { state, lastCheckAt: now, successRate: round3(successRate), jobsRun, jobsFailed, message: null },
      updatedAt: now,
    };
    this.mutated();
    return updated;
  }
}
