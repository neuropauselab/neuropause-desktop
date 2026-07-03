/**
 * A small in-process retry queue with exponential backoff. The orchestrator
 * hands transient failures (rate limit, offline, retryable 5xx) here; the queue
 * re-runs the account sync up to `maxAttempts`, backing off each time, and gives
 * up cleanly afterwards (the sync-state already records the failure). The queue's
 * current depth per account feeds the Health Dashboard's "Queue Size".
 */
import { createLogger } from '../../logger';

const log = createLogger('sync-retry');

interface QueueItem {
  connectorId: string;
  accountId: string;
  attempt: number;
  runAt: number;
}

function key(connectorId: string, accountId: string): string {
  return `${connectorId}::${accountId}`;
}

export class RetryQueue {
  private items = new Map<string, QueueItem>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param run     re-runs a sync; resolves true when it should be retried again.
   * @param maxAttempts hard cap on attempts before giving up.
   * @param baseDelayMs backoff base (doubles each attempt).
   */
  constructor(
    private readonly run: (connectorId: string, accountId: string) => Promise<boolean>,
    private readonly maxAttempts = 5,
    private readonly baseDelayMs = 2_000,
  ) {}

  /** Schedule (or reschedule) a retry. `delayMs` overrides the computed backoff. */
  enqueue(connectorId: string, accountId: string, delayMs?: number): void {
    const k = key(connectorId, accountId);
    const prev = this.items.get(k);
    const attempt = (prev?.attempt ?? 0) + 1;
    if (attempt > this.maxAttempts) {
      this.items.delete(k);
      log.warn('Retry budget exhausted', { connectorId, accountId, attempt });
      return;
    }
    const backoff = delayMs ?? this.baseDelayMs * 2 ** (attempt - 1);
    this.items.set(k, { connectorId, accountId, attempt, runAt: Date.now() + backoff });
    this.schedule();
  }

  /** Depth of the queue, optionally filtered to one account. */
  size(connectorId?: string, accountId?: string): number {
    if (!connectorId) return this.items.size;
    let n = 0;
    for (const it of this.items.values()) {
      if (it.connectorId !== connectorId) continue;
      if (accountId && it.accountId !== accountId) continue;
      n += 1;
    }
    return n;
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.items.clear();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.items.size === 0) return;
    const next = Math.min(...[...this.items.values()].map((i) => i.runAt));
    const wait = Math.max(0, next - Date.now());
    this.timer = setTimeout(() => {
      void this.drain();
    }, wait);
  }

  private async drain(): Promise<void> {
    const now = Date.now();
    const due = [...this.items.values()].filter((i) => i.runAt <= now);
    for (const item of due) {
      const k = key(item.connectorId, item.accountId);
      this.items.delete(k);
      let again = false;
      try {
        again = await this.run(item.connectorId, item.accountId);
      } catch (err) {
        log.warn('Retry run threw', { connectorId: item.connectorId, err: String(err) });
        again = true;
      }
      if (again) {
        // Re-enqueue preserving the attempt count progression.
        this.items.set(k, { ...item });
        this.enqueue(item.connectorId, item.accountId);
      }
    }
    this.schedule();
  }
}
