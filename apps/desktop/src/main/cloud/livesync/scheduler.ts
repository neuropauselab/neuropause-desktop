/**
 * Drives the sync engine: a periodic cycle, backoff after failures, and immediate
 * syncs on demand or when connectivity returns. Timer functions are injected (real
 * defaults) so the loop is unit-testable without real timers. Deciding *what* to do
 * lives here; *when* to call `syncOnce` and the retry math come from the engine.
 */
import type { SyncStatus } from './types';

const DEFAULT_INTERVAL_MS = 60_000;

/** The engine surface the scheduler drives (the real SyncEngine satisfies this). */
export interface SyncEngineLike {
  syncOnce(orgId: string): Promise<SyncStatus>;
  getStatus(): SyncStatus;
  nextRetryDelay(): number;
}

export interface SyncSchedulerOptions {
  engine: SyncEngineLike;
  getActiveOrgId: () => string | null;
  intervalMs?: number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  onStatus?: (status: SyncStatus) => void;
}

/**
 * How long to wait before the next cycle: after a retryable failure (offline/error)
 * back off using the engine's retry delay; otherwise use the normal interval.
 */
export function computeNextDelay(
  status: SyncStatus,
  intervalMs: number,
  retryDelay: number,
): number {
  if (status.state === 'offline' || status.state === 'error') {
    return retryDelay > 0 ? retryDelay : intervalMs;
  }
  return intervalMs;
}

export class SyncScheduler {
  private readonly engine: SyncEngineLike;
  private readonly getActiveOrgId: () => string | null;
  private readonly intervalMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
  private readonly onStatus?: (status: SyncStatus) => void;

  private handle: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(opts: SyncSchedulerOptions) {
    this.engine = opts.engine;
    this.getActiveOrgId = opts.getActiveOrgId;
    this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((handle) => clearTimeout(handle));
    this.onStatus = opts.onStatus;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext(0);
  }

  stop(): void {
    this.running = false;
    if (this.handle !== null) {
      this.clearTimer(this.handle);
      this.handle = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Run a cycle now (a manual trigger). Reschedules the loop if running. */
  async syncNow(): Promise<SyncStatus> {
    return this.runCycle();
  }

  /** React to connectivity: sync immediately when coming back online. */
  setOnline(online: boolean): void {
    if (online && this.running) void this.syncNow();
  }

  private async runCycle(): Promise<SyncStatus> {
    const orgId = this.getActiveOrgId();
    if (!orgId) {
      const status = this.engine.getStatus();
      this.onStatus?.(status);
      if (this.running) this.scheduleNext(this.intervalMs);
      return status;
    }
    const status = await this.engine.syncOnce(orgId);
    this.onStatus?.(status);
    if (this.running) {
      this.scheduleNext(computeNextDelay(status, this.intervalMs, this.engine.nextRetryDelay()));
    }
    return status;
  }

  private scheduleNext(delay: number): void {
    if (this.handle !== null) this.clearTimer(this.handle);
    this.handle = this.setTimer(() => {
      void this.runCycle();
    }, delay);
  }
}
