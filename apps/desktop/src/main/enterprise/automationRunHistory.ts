/**
 * Automation run-history store (V4.7) — a bounded in-memory ring of recent run
 * records, plus a derived monitor snapshot. In-memory by design (runs are
 * high-frequency and ephemeral); the durable per-rule outcome lives on the rule's
 * lastRun via AutomationStore.recordRun. Pure + testable.
 */
import type { AutomationMonitor, AutomationRunRecord } from '@neuropause/shared';

const MAX_HISTORY = 200;

export class AutomationRunHistory {
  private records: AutomationRunRecord[] = [];
  private paused = 0;

  /** Append a run record, evicting the oldest beyond the cap. */
  add(record: AutomationRunRecord): void {
    this.records.unshift(record);
    if (this.records.length > MAX_HISTORY) {
      this.records = this.records.slice(0, MAX_HISTORY);
    }
  }

  /** Most-recent-first history, optionally limited. */
  list(limit = 50): AutomationRunRecord[] {
    return this.records.slice(0, limit);
  }

  /** Let the monitor reflect how many rules are currently paused. */
  setPaused(count: number): void {
    this.paused = count;
  }

  /** Derived monitor snapshot for the Automations screen. Pure. */
  monitor(): AutomationMonitor {
    const completed = this.records.filter((r) => r.ok).length;
    const failed = this.records.filter((r) => !r.ok).length;
    const durations = this.records.map((r) => r.durationMs);
    const averageRuntimeMs =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;
    return {
      running: 0, // runs are synchronous today; no long-running queue yet
      completed,
      failed,
      paused: this.paused,
      lastExecution: this.records[0]?.completedAt,
      averageRuntimeMs,
    };
  }
}
