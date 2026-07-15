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

const log = createLogger('worker-registry');

const MIN_TRUST = 0.05;

interface RegistryFile {
  workers: Worker[];
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export class WorkerRegistry extends EventEmitter {
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
    } catch {
      // First run — empty registry.
    }
    this.loaded = true;
    log.info('Worker registry ready', { workers: this.workers.size });
  }

  private async persist(): Promise<void> {
    const file: RegistryFile = { workers: [...this.workers.values()] };
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
    return worker;
  }

  get(id: string): Worker | null {
    return this.workers.get(id) ?? null;
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

  list(): Worker[] {
    return [...this.workers.values()].sort((a, b) => a.identity.name.localeCompare(b.identity.name));
  }

  summaries(): WorkerSummary[] {
    return this.list().map(toWorkerSummary);
  }

  /**
   * Per-worker health projection for workforce-health aggregation (V8.1). Exposes
   * the success-rate fields toWorkerSummary omits, read from the same computed
   * Worker.health — no new logic.
   */
  healthSummaries(): WorkforceHealthInput[] {
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

    const jobsRun = w.health.jobsRun + 1;
    const jobsFailed = w.health.jobsFailed + (success ? 0 : 1);
    const successRate = jobsRun > 0 ? (jobsRun - jobsFailed) / jobsRun : 1;

    let trust = w.trustScore + (success ? 0.02 : -0.05);
    trust = Math.max(MIN_TRUST, Math.min(1, round3(trust)));

    const state: WorkerHealthState =
      jobsRun >= 3 && successRate < 0.5 ? 'unhealthy' : successRate < 0.8 ? 'degraded' : 'healthy';

    const updated: Worker = {
      ...w,
      trustScore: trust,
      health: { state, lastCheckAt: now, successRate: round3(successRate), jobsRun, jobsFailed, message: null },
      updatedAt: now,
    };
    this.workers.set(id, updated);
    this.mutated();
    return updated;
  }
}
