/**
 * The Worker Runtime's background scheduler. `enqueue` records a `queued` job and
 * returns its id immediately; the job actually runs on the next tick, so callers
 * are never blocked. This is an honest cooperative in-process scheduler — it
 * drains its queue on a timer (and `drain()` can be called directly for
 * deterministic execution), not a pool of OS processes.
 *
 * Electron-free; the application starts/stops it from the composition root.
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { JobSpec } from '@neuropause/shared';
import { createLogger } from '../../logger';
import type { WorkerRuntime } from './workerRuntime';

const log = createLogger('workforce-scheduler');

interface QueueItem {
  jobId: string;
  spec: JobSpec;
  createdAt: string;
}

export interface SchedulerOptions {
  intervalMs?: number;
  newId?: () => string;
  clock?: () => string;
}

export class Scheduler extends EventEmitter {
  private readonly queue: QueueItem[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly newId: () => string;
  private readonly clock: () => string;
  private readonly intervalMs: number;

  constructor(private readonly runtime: WorkerRuntime, opts: SchedulerOptions = {}) {
    super();
    this.newId = opts.newId ?? randomUUID;
    this.clock = opts.clock ?? (() => new Date().toISOString());
    this.intervalMs = opts.intervalMs ?? 1000;
  }

  /** Queue a job for background execution; returns the job id immediately. */
  enqueue(spec: JobSpec): string {
    const now = spec.now ?? this.clock();
    const jobId = this.newId();
    this.runtime.createQueued(spec, jobId, now);
    this.queue.push({ jobId, spec, createdAt: now });
    this.emit('enqueued', jobId);
    return jobId;
  }

  /** Drain the queue once. Synchronous and deterministic. */
  drain(): void {
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;
      this.runtime.executeQueued(item.jobId, item.spec, item.createdAt);
      this.emit('ran', item.jobId);
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.drain(), this.intervalMs);
    this.timer.unref?.();
    log.info('Workforce scheduler started', { intervalMs: this.intervalMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  depth(): number {
    return this.queue.length;
  }
}
