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
import type { JobSpec, TenantScope } from '@neuropause/shared';
import { createLogger } from '../../logger';
import type { BackgroundPrincipal } from '../../tenancy/backgroundPrincipal';
import { runAsPrincipal, tenantPrincipal } from '../../tenancy/backgroundPrincipal';
import type { WorkerRuntime } from './workerRuntime';

const log = createLogger('workforce-scheduler');

interface QueueItem {
  jobId: string;
  spec: JobSpec;
  createdAt: string;
  /**
   * WHO THIS JOB IS FOR, decided when it was ENQUEUED.
   *
   * This is the case the background-principal design was written around and the
   * one a queue makes unavoidable: `enqueue` happens on an IPC call, where the
   * signed-in user's tenant is the right answer; `drain` happens on a timer up
   * to a second later, by which time the user may have switched organizations.
   * Resolving the tenant at drain time would run tenant A's queued job as tenant
   * B — and the job would succeed, writing A's work into B's records.
   *
   * Null means the enqueue could not resolve a tenant. Such an item is dropped
   * at drain rather than executed, because there is no tenant to execute it for.
   */
  principal: BackgroundPrincipal | null;
}

export interface SchedulerOptions {
  intervalMs?: number;
  newId?: () => string;
  clock?: () => string;
  /**
   * The tenant to capture at enqueue time.
   *
   * Optional so the runtime's own deterministic tests (which drive `drain()`
   * directly and assert on execution, not on tenancy) keep working unchanged.
   * When absent the scheduler behaves as it did before: no principal is
   * captured, and the job resolves its tenant the way every non-background call
   * does. The composition root supplies the real resolver, so production always
   * captures.
   */
  resolveScope?: () => TenantScope | null;
}

export class Scheduler extends EventEmitter {
  private readonly queue: QueueItem[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly newId: () => string;
  private readonly clock: () => string;
  private readonly intervalMs: number;
  private readonly resolveScope: (() => TenantScope | null) | null;

  constructor(private readonly runtime: WorkerRuntime, opts: SchedulerOptions = {}) {
    super();
    this.newId = opts.newId ?? randomUUID;
    this.clock = opts.clock ?? (() => new Date().toISOString());
    this.intervalMs = opts.intervalMs ?? 1000;
    this.resolveScope = opts.resolveScope ?? null;
  }

  /**
   * Queue a job for background execution; returns the job id immediately.
   *
   * The tenant is captured HERE, not at drain. See `QueueItem.principal`.
   */
  enqueue(spec: JobSpec): string {
    const now = spec.now ?? this.clock();
    const jobId = this.newId();
    this.runtime.createQueued(spec, jobId, now);
    const principal =
      this.resolveScope === null
        ? null
        : tenantPrincipal({ jobId: `workforce:${jobId}`, scope: this.resolveScope() });
    this.queue.push({ jobId, spec, createdAt: now, principal });
    this.emit('enqueued', jobId);
    return jobId;
  }

  /**
   * Drain the queue once. Synchronous and deterministic.
   *
   * Each item runs under ITS OWN captured principal, so two organizations'
   * jobs sitting in the same queue execute as their own tenants even though one
   * timer drains both — and a job whose enqueue could not name a tenant is
   * dropped rather than run under whoever happens to be active now.
   */
  drain(): void {
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;
      const run = (): void => {
        this.runtime.executeQueued(item.jobId, item.spec, item.createdAt);
        this.emit('ran', item.jobId);
      };
      if (item.principal === null && this.resolveScope !== null) {
        /**
         * FAIL CLOSED, and say so.
         *
         * Only reachable when a resolver IS configured and returned null — a
         * job enqueued while signed out, or into a suspended tenant. Running it
         * would mean choosing an organization for work that named none.
         */
        log.warn('Dropping queued job with no tenant', { jobId: item.jobId });
        this.emit('dropped', item.jobId);
        continue;
      }
      if (item.principal === null) run();
      else runAsPrincipal(item.principal, run);
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
