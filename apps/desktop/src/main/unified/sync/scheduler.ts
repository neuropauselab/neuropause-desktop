/**
 * Background scheduler for automatic sync. A single low-frequency interval calls
 * `onTick`; the orchestrator's tick decides which accounts are actually due, so
 * cadence policy lives in one place and the timer stays dumb.
 */
export const SCHEDULER_INTERVAL_MS = 60 * 1000;

export class SyncScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly intervalMs: number,
    private readonly onTick: () => Promise<void>,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.onTick().catch(() => {});
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
