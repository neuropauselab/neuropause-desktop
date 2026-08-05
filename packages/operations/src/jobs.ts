/**
 * Job & Queue Reliability (NCEA 15.0, Phase 4). Extends the EXISTING runtime
 * scheduler (it registers one drain task on it — it does not create a second
 * scheduler) with durable job semantics: a pluggable `JobStore` (in-memory here,
 * the persistence layer in production), priority + delayed execution, retry with
 * backoff, a dead-letter queue, poison-message handling, checkpoint + interrupted-
 * job recovery, cancellation, replay, and backpressure. Tick-driven and clock-
 * injected, so the whole lifecycle is deterministic and VERIFIED.
 */
import { randomId, systemClock, type Clock } from '@neuropause/cloud-core';
import { backoffDelay, DEFAULT_RETRY, type RetryPolicy } from '@neuropause/integrations';
import type { Scheduler } from '@neuropause/runtime';
import { classifyFailure } from './reliability';

export type JobState = 'pending' | 'delayed' | 'running' | 'succeeded' | 'failed' | 'dead' | 'cancelled';

export interface Job<P = unknown, R = unknown> {
  id: string;
  type: string;
  payload: P;
  priority: number; // higher runs first
  state: JobState;
  attempts: number;
  maxAttempts: number;
  runAt: number;
  createdAt: number;
  updatedAt: number;
  checkpoint?: unknown;
  lastError?: string;
  result?: R;
}

/** The durability seam. InMemoryJobStore is VERIFIED here; a persistence-backed store implements the same contract. */
export interface JobStore {
  save(job: Job): void;
  load(id: string): Job | undefined;
  all(): Job[];
  remove(id: string): void;
}
export class InMemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, Job>();
  save(job: Job): void {
    this.jobs.set(job.id, { ...job });
  }
  load(id: string): Job | undefined {
    const j = this.jobs.get(id);
    return j ? { ...j } : undefined;
  }
  all(): Job[] {
    return [...this.jobs.values()].map((j) => ({ ...j }));
  }
  remove(id: string): void {
    this.jobs.delete(id);
  }
}

export interface JobContext {
  attempt: number;
  previousCheckpoint: unknown;
  checkpoint(data: unknown): void;
}
export type JobHandler<P = unknown, R = unknown> = (payload: P, ctx: JobContext) => Promise<R>;

/** Thrown by a handler to send a message straight to the DLQ (no retries). */
export class PoisonMessageError extends Error {
  constructor(message = 'poison message') {
    super(message);
    this.name = 'PoisonMessageError';
  }
}
/** Thrown by enqueue when the queue is at capacity (backpressure). */
export class BackpressureError extends Error {
  constructor(depth: number, max: number) {
    super(`queue backpressure: depth ${depth} >= max ${max}`);
    this.name = 'BackpressureError';
  }
}

export type JobEventKind = 'enqueued' | 'succeeded' | 'retry' | 'dead' | 'cancelled' | 'replayed' | 'recovered';
export interface JobEvent {
  kind: JobEventKind;
  job: Job;
}

export interface JobQueueOptions {
  store?: JobStore;
  retry?: RetryPolicy;
  defaultMaxAttempts?: number;
  /** Backpressure ceiling on in-flight (pending+delayed+running) jobs. Default: unbounded. */
  maxDepth?: number;
  metrics?: { inc(name: string, by?: number): void };
  onEvent?: (evt: JobEvent) => void;
  rng?: () => number;
}

export interface EnqueueInput<P = unknown> {
  type: string;
  payload: P;
  priority?: number;
  delayMs?: number;
  maxAttempts?: number;
}

export class JobQueue {
  private readonly store: JobStore;
  private readonly handlers = new Map<string, JobHandler>();
  private readonly retry: RetryPolicy;
  private readonly defaultMaxAttempts: number;
  private readonly maxDepth: number;
  private readonly rng: () => number;

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly options: JobQueueOptions = {},
  ) {
    this.store = options.store ?? new InMemoryJobStore();
    this.retry = options.retry ?? DEFAULT_RETRY;
    this.defaultMaxAttempts = options.defaultMaxAttempts ?? 3;
    this.maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
    this.rng = options.rng ?? Math.random;
  }

  registerHandler<P, R>(type: string, handler: JobHandler<P, R>): void {
    this.handlers.set(type, handler as JobHandler);
  }

  private metric(key: string): void {
    this.options.metrics?.inc(`ops.jobs.${key}`);
  }
  private emit(kind: JobEventKind, job: Job): void {
    this.options.onEvent?.({ kind, job: { ...job } });
  }

  /** In-flight depth for backpressure — pending + delayed + running. */
  depth(): number {
    return this.store.all().filter((j) => j.state === 'pending' || j.state === 'delayed' || j.state === 'running').length;
  }

  enqueue<P = unknown>(input: EnqueueInput<P>): Job {
    const depth = this.depth();
    if (depth >= this.maxDepth) throw new BackpressureError(depth, this.maxDepth);
    const now = this.clock.now();
    const delayMs = input.delayMs ?? 0;
    const job: Job = {
      id: randomId('job'),
      type: input.type,
      payload: input.payload,
      priority: input.priority ?? 0,
      state: delayMs > 0 ? 'delayed' : 'pending',
      attempts: 0,
      maxAttempts: input.maxAttempts ?? this.defaultMaxAttempts,
      runAt: now + delayMs,
      createdAt: now,
      updatedAt: now,
    };
    this.store.save(job);
    this.metric('enqueued');
    this.emit('enqueued', job);
    return job;
  }

  get(id: string): Job | undefined {
    return this.store.load(id);
  }
  list(state?: JobState): Job[] {
    const all = this.store.all();
    return state ? all.filter((j) => j.state === state) : all;
  }
  deadLetter(): Job[] {
    return this.list('dead');
  }
  retryQueue(): Job[] {
    return this.list('delayed');
  }

  /** Run every runnable job (pending/delayed with runAt ≤ now), highest priority first. */
  async drain(): Promise<{ ran: string[] }> {
    const now = this.clock.now();
    const runnable = this.store
      .all()
      .filter((j) => (j.state === 'pending' || j.state === 'delayed') && j.runAt <= now)
      .sort((a, b) => b.priority - a.priority || a.runAt - b.runAt || a.createdAt - b.createdAt);
    const ran: string[] = [];
    for (const job of runnable) {
      await this.runOne(job.id);
      ran.push(job.id);
    }
    return { ran };
  }

  private toDead(job: Job, reason: string): void {
    job.state = 'dead';
    job.lastError = reason;
    job.updatedAt = this.clock.now();
    this.store.save(job);
    this.metric('dead');
    this.emit('dead', job);
  }

  private async runOne(id: string): Promise<void> {
    const job = this.store.load(id);
    if (!job || (job.state !== 'pending' && job.state !== 'delayed')) return;
    const handler = this.handlers.get(job.type);
    job.state = 'running';
    job.attempts += 1;
    job.updatedAt = this.clock.now();
    this.store.save(job);
    if (!handler) {
      this.toDead(job, `no handler registered for type '${job.type}'`);
      return;
    }
    const ctx: JobContext = {
      attempt: job.attempts,
      previousCheckpoint: job.checkpoint,
      checkpoint: (data: unknown) => {
        job.checkpoint = data;
        job.updatedAt = this.clock.now();
        this.store.save(job);
      },
    };
    try {
      const result = await handler(job.payload, ctx);
      job.state = 'succeeded';
      job.result = result;
      job.updatedAt = this.clock.now();
      this.store.save(job);
      this.metric('succeeded');
      this.emit('succeeded', job);
    } catch (e) {
      job.lastError = e instanceof Error ? e.message : String(e);
      const poison = e instanceof PoisonMessageError;
      const permanent = classifyFailure(e) === 'permanent';
      if (poison || permanent || job.attempts >= job.maxAttempts) {
        this.toDead(job, job.lastError);
        return;
      }
      const delay = backoffDelay(job.attempts, this.retry, this.rng);
      job.state = 'delayed';
      job.runAt = this.clock.now() + delay;
      job.updatedAt = this.clock.now();
      this.store.save(job);
      this.metric('retry');
      this.emit('retry', job);
    }
  }

  /** Cancel a non-terminal job. */
  cancel(id: string): boolean {
    const job = this.store.load(id);
    if (!job || job.state === 'succeeded' || job.state === 'dead' || job.state === 'cancelled') return false;
    job.state = 'cancelled';
    job.updatedAt = this.clock.now();
    this.store.save(job);
    this.emit('cancelled', job);
    return true;
  }

  /** Replay a dead-lettered job — reset attempts and re-queue. */
  replay(id: string): Job | undefined {
    const job = this.store.load(id);
    if (!job || job.state !== 'dead') return undefined;
    job.state = 'pending';
    job.attempts = 0;
    job.runAt = this.clock.now();
    job.updatedAt = this.clock.now();
    this.store.save(job);
    this.metric('replayed');
    this.emit('replayed', job);
    return job;
  }

  /** Recover interrupted jobs after a restart — anything stuck 'running' returns to 'pending'. */
  recover(): { recovered: number } {
    let recovered = 0;
    for (const job of this.store.all()) {
      if (job.state === 'running') {
        job.state = 'pending';
        job.runAt = this.clock.now();
        job.updatedAt = this.clock.now();
        this.store.save(job);
        this.emit('recovered', job);
        recovered += 1;
      }
    }
    return { recovered };
  }

  /** Register the drain loop on the EXISTING runtime scheduler (one scheduler, not a new one). */
  attachToScheduler(scheduler: Scheduler, intervalMs = 1000, name = 'ops.jobs.drain'): void {
    scheduler.register({ name, intervalMs, handler: () => this.drain().then(() => undefined) });
  }

  stats(): { total: number; byState: Record<JobState, number>; depth: number } {
    const byState = { pending: 0, delayed: 0, running: 0, succeeded: 0, failed: 0, dead: 0, cancelled: 0 } as Record<JobState, number>;
    for (const j of this.store.all()) byState[j.state] += 1;
    return { total: this.store.all().length, byState, depth: this.depth() };
  }
}
