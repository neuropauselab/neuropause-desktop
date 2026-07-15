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
import type { Job, JobPage, JobStatus } from '@neuropause/shared';
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

  /** Insert or replace a job. */
  put(job: Job): void {
    if (!this.jobs.has(job.id)) {
      this.order.push(job.id);
      if (this.order.length > MAX_JOBS) {
        const evicted = this.order.shift();
        if (evicted) this.jobs.delete(evicted);
      }
    }
    this.jobs.set(job.id, job);
    this.schedulePersist();
    this.emit('changed', job);
  }

  get(id: string): Job | null {
    return this.jobs.get(id) ?? null;
  }

  /** Page through jobs, newest first, with optional filters. */
  page(query: JobQuery = {}): JobPage {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);
    let rows = [...this.order].reverse().map((id) => this.jobs.get(id)).filter((j): j is Job => !!j);
    if (query.workerId) rows = rows.filter((j) => j.workerId === query.workerId);
    if (query.status) rows = rows.filter((j) => j.status === query.status);
    const total = rows.length;
    return { jobs: rows.slice(offset, offset + limit), total };
  }

  size(): number {
    return this.jobs.size;
  }
}
