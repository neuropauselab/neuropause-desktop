/**
 * The Job Store. Every worker run — queued, running, awaiting approval, or
 * finished — is recorded here, giving a durable, queryable history of all work
 * the workforce has done and the proposals each run produced.
 *
 * Electron-free (constructor takes a file path); the singleton lives in
 * jobInstance.ts. Persistence is the standard serialized background writer with
 * atomic temp-file + rename.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import type { Job, JobPage, JobStatus, TenantScope } from '@neuropause/shared';
import { TenantOwnership } from '../../tenancy/tenantOwnedStore';
import { createLogger } from '../../logger';

const log = createLogger('workforce-jobs');

const MAX_JOBS = 2000;

interface JobsFile {
  jobs: Job[];
}

export interface JobQuery {
  limit?: number;
  offset?: number;
  workerId?: string;
  status?: JobStatus;
}

export class JobStore extends EventEmitter {
  /**
   * P13C Round 2 — H3. THE TENANT BOUNDARY.
   *
   * `Job` had no owner and this store had no seam. `page()` filtered on
   * `workerId` and `status`; `get()` took a bare id. That made every job's
   * `summary`, `evidence`, `logs` and `proposals` — the worker's output over
   * the tenant's connected data — readable by any member of any tenant, under
   * `workforce:read`, which is in the base role.
   *
   * The sharpest consequence was not the read. `WorkerRuntime.decide()`
   * resolves the job through `get()` before approving a proposal, and an
   * approved proposal RE-ENTERS THE EXECUTE ENGINE. An unscoped `get` therefore
   * let one tenant cause another tenant's action to execute — an execution
   * authorization failure, not a disclosure. Scoping this accessor is what
   * closes that path at its root rather than at each of its callers.
   */
  private readonly tenancy = new TenantOwnership('workforce-jobs');
  private jobs = new Map<string, Job>();
  private order: string[] = [];
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
      const data = JSON.parse(raw) as Partial<JobsFile>;
      for (const j of data.jobs ?? []) {
        if (j && j.id) {
          this.jobs.set(j.id, j);
          this.order.push(j.id);
        }
      }
    } catch {
      // First run — no jobs yet.
    }
    // P8.3 — a job left 'running' by a crash mid-execution can never settle (the
    // ExecuteEngine marks its session 'interrupted', but the Job is orphaned). Recover
    // any such job to 'failed' so it is never stuck; persisted on the next write.
    let recovered = 0;
    const nowIso = new Date().toISOString();
    for (const j of this.jobs.values()) {
      if (j.status === 'running') {
        j.status = 'failed';
        j.error = j.error ?? 'Interrupted by application restart';
        j.finishedAt = j.finishedAt ?? nowIso;
        recovered += 1;
      }
    }
    this.loaded = true;
    if (recovered > 0) {
      log.warn('Recovered interrupted running jobs', { recovered });
      this.schedulePersist();
    }
    log.info('Workforce job store ready', { jobs: this.jobs.size, recovered });
  }

  private async persist(): Promise<void> {
    const file: JobsFile = { jobs: this.order.map((id) => this.jobs.get(id)).filter((j): j is Job => !!j) };
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
      log.error('Job persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }

  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  /** Bind the tenant boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.tenancy.hasScope();
  }
  /** Unscoped ownership counts, for the migration inventory only. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    return this.tenancy.countOwnership([...this.jobs.values()]);
  }

  /**
   * Insert or replace a job.
   *
   * A NEW job is stamped with the caller's tenant. An EXISTING job may only be
   * replaced by its owner — without that, `put` is a write-side IDOR: the
   * runtime writes back through it on every state transition, so a caller who
   * reached a foreign job could overwrite its status, logs and proposals.
   */
  put(job: Job): void {
    const existing = this.jobs.get(job.id) ?? null;
    if (existing !== null && !this.tenancy.mine(existing)) return;
    /**
     * Stamped IN PLACE, not by spreading into a copy.
     *
     * The runtime holds a reference to the job it is executing and mutates it
     * as the job progresses — `decide()` sets `status` then dispatches, and
     * `settleExecution` reads the row back expecting to see that mutation.
     * Returning a fresh object here would silently break that aliasing and
     * strand jobs in `running`, which is a correctness bug introduced by a
     * security fix — the worst kind, because the tests that catch it look
     * unrelated.
     */
    const owned = job;
    owned.tenantId = existing === null ? this.tenancy.requireTenant() : existing.tenantId;

    if (!this.jobs.has(owned.id)) {
      this.order.push(owned.id);
      /**
       * Retention PER TENANT. The cap was install-wide and oldest-first, so a
       * busy tenant did not merely consume capacity — it chose which of another
       * tenant's jobs, and therefore which EVIDENCE, was destroyed.
       */
      const kept = this.tenancy.pruneOwn(
        this.order.map((id) => this.jobs.get(id)).filter((j): j is Job => !!j),
        MAX_JOBS,
        (a, b) => this.order.indexOf(a.id) - this.order.indexOf(b.id),
      );
      if (kept.length < this.jobs.size) {
        const keep = new Set(kept.map((j) => j.id));
        keep.add(owned.id);
        for (const id of [...this.jobs.keys()]) if (!keep.has(id)) this.jobs.delete(id);
        this.order = this.order.filter((id) => keep.has(id));
      }
    }
    this.jobs.set(owned.id, owned);
    this.schedulePersist();
    this.emit('changed', owned);
  }

  /**
   * The job, IF it is the caller's. A foreign id reads as absent.
   *
   * THE APPROVAL GATE. `WorkerRuntime.decide()` resolves through this before
   * approving a proposal, and an approved proposal re-enters the ExecuteEngine.
   */
  get(id: string): Job | null {
    const job = this.jobs.get(id) ?? null;
    return job !== null && this.tenancy.mine(job) ? job : null;
  }

  /**
   * Unscoped, for the RUNTIME's own writeback only.
   *
   * `executeQueued` runs under the job's own background principal and needs to
   * read the row it is already executing. Named so it cannot be mistaken for
   * `get`, and it answers no request.
   */
  unscopedForRuntime(id: string): Job | null {
    return this.jobs.get(id) ?? null;
  }

  /** Page through the CALLER'S jobs, newest first. Was every job on the install. */
  page(query: JobQuery = {}): JobPage {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);
    let rows = this.tenancy.onlyMine(
      [...this.order].reverse().map((id) => this.jobs.get(id)).filter((j): j is Job => !!j),
    );
    if (query.workerId) rows = rows.filter((j) => j.workerId === query.workerId);
    if (query.status) rows = rows.filter((j) => j.status === query.status);
    const total = rows.length;
    return { jobs: rows.slice(offset, offset + limit), total };
  }

  /** Scoped: an install-wide size tells one tenant how busy another is. */
  size(): number {
    return this.tenancy.onlyMine([...this.jobs.values()]).length;
  }
}
