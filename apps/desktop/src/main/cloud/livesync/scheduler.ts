/**
 * Drives the sync engine: a periodic cycle, backoff after failures, and immediate
 * syncs on demand or when connectivity returns. Timer functions are injected (real
 * defaults) so the loop is unit-testable without real timers. Deciding *what* to do
 * lives here; *when* to call `syncOnce` and the retry math come from the engine.
 *
 * Pausing is real: `setOnline(orgId, false)` pauses that organization in the
 * engine, so no cycle runs for it and its local edits stay queued on the device
 * until resume.
 *
 * P13C ROUND 9 — F3. TWO CHANGES, BOTH ABOUT ONE ORGANIZATION AFFECTING ANOTHER.
 *
 * 1. THE PAUSE IS PER ORGANIZATION AND NO LONGER CANCELS THE LOOP. `setOnline`
 *    used to pause the ENGINE and clear the timer, so an administrator of one
 *    organization stopped the background loop for every organization on the
 *    machine — and, resuming, restarted egress for an organization whose own
 *    administrator had deliberately stopped it. The timer now keeps ticking and
 *    each cycle is a no-op for a paused organization, which is the same
 *    behaviour for the pausing tenant and no behaviour at all for the others.
 *
 * 2. A CYCLE RUNS UNDER A BACKGROUND PRINCIPAL FOR THE ORGANIZATION IT SYNCS.
 *    The queue and the mirror resolve their owner from a tenant seam. On the IPC
 *    path that seam is the caller's session; inside this timer there is no
 *    caller, and falling through to "whichever organization the window happens
 *    to be showing" is exactly how a background loop comes to act inside
 *    someone else's tenant. `tenantPrincipal` + `runAsPrincipal` name the
 *    organization the cycle is for, and every store it touches resolves to that
 *    one. NO PRINCIPAL MEANS NO CYCLE — there is no fallback.
 */
import type { TenantScope } from '@neuropause/shared';
import {
  runAsPrincipal,
  runOutsidePrincipal,
  tenantPrincipal,
} from '../../tenancy/backgroundPrincipal';
import type { SyncStatus } from './types';

const DEFAULT_INTERVAL_MS = 60_000;

/** The engine surface the scheduler drives (the real SyncEngine satisfies this). */
export interface SyncEngineLike {
  syncOnce(orgId: string): Promise<SyncStatus>;
  getStatus(orgId: string | null): SyncStatus;
  nextRetryDelay(orgId: string | null): number;
  /** Pause/resume ONE organization: while paused the engine refuses its cycles. */
  setPaused(orgId: string, paused: boolean): void;
  isPaused(orgId: string | null): boolean;
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

  /** Whether THIS organization has paused its own sync. */
  isPaused(orgId: string | null): boolean {
    return this.engine.isPaused(orgId);
  }

  /**
   * Run a cycle now for ONE organization (a manual trigger). Reschedules the
   * background loop if it is running.
   *
   * The organization is named by the caller — the service resolves it from the
   * caller's own seam — rather than read from the device pointer, so a manual
   * sync cannot be aimed at somebody else's queue.
   *
   * THE CALLER'S OBLIGATION, STATED BECAUSE THIS IS THE SHARP EDGE: a cycle runs
   * AS `orgId`, so whoever names it decides which organization's stores the
   * cycle resolves. There are exactly two callers, and both derive the id rather
   * than accept one — the service from the caller's own tenant seam, and the
   * timer from the device's active-organization pointer, which
   * `livesync:setActiveOrg` already refuses to set to anything but the session's
   * own organization. A future caller that passes a renderer-supplied id would
   * reintroduce F3, which is why no such parameter reaches this method today.
   */
  async syncNow(orgId: string | null): Promise<SyncStatus> {
    return this.runCycle(orgId);
  }

  /**
   * Pause or resume syncing FOR ONE ORGANIZATION. Pausing keeps its queued edits
   * local; resuming syncs it immediately when the loop is running. Idempotent —
   * re-asserting the current mode does nothing.
   */
  setOnline(orgId: string, online: boolean): SyncStatus {
    const paused = !online;
    if (this.engine.isPaused(orgId) === paused) return this.engine.getStatus(orgId);
    this.engine.setPaused(orgId, paused);
    if (!paused && this.running) {
      void this.runCycle(orgId);
      return this.engine.getStatus(orgId);
    }
    const status = this.engine.getStatus(orgId);
    this.emit(status);
    return status;
  }

  private async runCycle(orgId: string | null): Promise<SyncStatus> {
    if (orgId === null) {
      const status = this.engine.getStatus(null);
      this.emit(status);
      if (this.running) this.scheduleNext(this.intervalMs);
      return status;
    }
    if (this.engine.isPaused(orgId)) {
      const status = this.engine.getStatus(orgId);
      this.emit(status);
      // Still rescheduled: this organization is paused, the loop is not, and
      // another organization may be the active one on the next tick.
      if (this.running) this.scheduleNext(this.intervalMs);
      return status;
    }
    /**
     * The cycle acts AS this organization. `tenantPrincipal` returns null when
     * the organization does not resolve, and null means do not run — there is
     * deliberately no variant that substitutes the active or the first one.
     *
     * The workspace half is empty on purpose: a tenant-level job reads
     * tenant-wide records and no workspace-scoped ones, which is the honest
     * reading of "this cycle acts for the organization, not from inside any one
     * of its workspaces".
     */
    const scope: TenantScope = { tenantId: orgId, workspaceId: '' };
    const principal = tenantPrincipal({ jobId: 'livesync-cycle', scope });
    if (principal === null) {
      const status = this.engine.getStatus(orgId);
      this.emit(status);
      if (this.running) this.scheduleNext(this.intervalMs);
      return status;
    }
    const status = await runAsPrincipal(principal, () => this.engine.syncOnce(orgId));
    this.emit(status);
    if (this.running) {
      this.scheduleNext(
        computeNextDelay(status, this.intervalMs, this.engine.nextRetryDelay(orgId)),
      );
    }
    return status;
  }

  /**
   * Tell the listeners, OUTSIDE the cycle's principal.
   *
   * A listener fans this out towards the renderer, and the window in front of
   * the user may be showing a different organization than the one this cycle
   * ran for. Leaving the principal means anything a listener resolves for the
   * UI resolves as the SESSION — never as the job — so a background pass cannot
   * broadcast one organization's live numbers into another's window.
   */
  private emit(status: SyncStatus): void {
    if (!this.onStatus) return;
    const listener = this.onStatus;
    runOutsidePrincipal(() => listener(status));
  }

  private scheduleNext(delay: number): void {
    if (this.handle !== null) this.clearTimer(this.handle);
    this.handle = this.setTimer(() => {
      void this.runCycle(this.getActiveOrgId());
    }, delay);
  }
}
