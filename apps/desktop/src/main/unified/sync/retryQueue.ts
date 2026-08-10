/**
 * A small in-process retry queue with exponential backoff. The orchestrator
 * hands transient failures (rate limit, offline, retryable 5xx) here; the queue
 * re-runs the account sync up to `maxAttempts`, backing off each time, and gives
 * up cleanly afterwards (the sync-state already records the failure). The queue's
 * current depth per account feeds the Health Dashboard's "Queue Size".
 */
import { createLogger } from '../../logger';
import type { BackgroundPrincipal } from '../../tenancy/backgroundPrincipal';
import { currentPrincipal, runAsPrincipal } from '../../tenancy/backgroundPrincipal';

const log = createLogger('sync-retry');

interface QueueItem {
  connectorId: string;
  accountId: string;
  attempt: number;
  runAt: number;
  /**
   * WHO THIS RETRY IS FOR, captured when it was ENQUEUED.
   *
   * P13C PART 3 — THE QUEUE ESCAPED THE FAN-OUT, AND SILENTLY.
   *
   * The scheduled tick is fanned out per workspace, each pass inside
   * `runAsPrincipal`. This queue was not, and its shared timer made that
   * actively wrong rather than merely unscoped: `schedule()` clears and re-arms
   * ONE timer on every `enqueue`, so during the fan-out loop workspace B's
   * enqueue cancelled the timer armed inside workspace A's principal and re-
   * armed it inside B's. `drain()` then ran EVERY due item — including A's —
   * under B's context, and `runAccountSync` resolves its tenant at drain time.
   *
   * The result is not a stale read. It is a cross-tenant WRITE: A's provider
   * records land in the unified store stamped with B's tenant.
   *
   * Capturing the principal per ITEM also removes the timer contamination
   * entirely, because whichever context the timer fires in stops mattering.
   */
  principal: BackgroundPrincipal | null;
}

function key(connectorId: string, accountId: string): string {
  return `${connectorId}::${accountId}`;
}

export class RetryQueue {
  private items = new Map<string, QueueItem>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Guards against re-entrant drains (a timer firing while a drain is suspended on `await run`). */
  private draining = false;

  /**
   * @param run         re-runs a sync; resolves true when it should be retried again.
   * @param opts.maxAttempts  hard cap on attempts before dead-lettering.
   * @param opts.baseDelayMs  backoff base (doubles each attempt).
   * @param opts.maxDelayMs   backoff cap — the exponential term never exceeds this (thundering-herd guard).
   * @param opts.onExhausted  called once when an account exhausts its retry budget (→ dead-letter it).
   * @param opts.rng          injectable RNG for the jitter (tests pass a deterministic value).
   */
  constructor(
    private readonly run: (connectorId: string, accountId: string) => Promise<boolean>,
    opts: {
      maxAttempts?: number;
      baseDelayMs?: number;
      maxDelayMs?: number;
      onExhausted?: (connectorId: string, accountId: string, attempts: number) => void;
      rng?: () => number;
    } = {},
  ) {
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.baseDelayMs = opts.baseDelayMs ?? 2_000;
    this.maxDelayMs = opts.maxDelayMs ?? 5 * 60_000;
    this.onExhausted = opts.onExhausted;
    this.rng = opts.rng ?? Math.random;
  }

  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly onExhausted?: (connectorId: string, accountId: string, attempts: number) => void;
  private readonly rng: () => number;

  /**
   * The backoff for a given attempt: capped exponential with EQUAL JITTER — half fixed, half random in
   * `[0, half)`. Capping bounds the wait; jitter de-synchronizes many accounts that rate-limit together.
   */
  backoffFor(attempt: number): number {
    const exp = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (attempt - 1));
    const half = exp / 2;
    return Math.round(half + this.rng() * half);
  }

  /** Schedule (or reschedule) a retry. `delayMs` overrides the computed backoff. */
  enqueue(connectorId: string, accountId: string, delayMs?: number): void {
    const k = key(connectorId, accountId);
    const prev = this.items.get(k);
    const attempt = (prev?.attempt ?? 0) + 1;
    if (attempt > this.maxAttempts) {
      this.items.delete(k);
      log.warn('Retry budget exhausted — dead-lettering', { connectorId, accountId, attempt });
      this.onExhausted?.(connectorId, accountId, attempt - 1);
      return;
    }
    const backoff = delayMs ?? this.backoffFor(attempt);
    /**
     * Read HERE, at enqueue, where the caller's context is still the right one.
     *
     * A retry queued inside the fanned-out tick captures that workspace's
     * principal. A retry queued by a MANUAL sync captures null, because a manual
     * sync is an interactive request with a real user behind it — and null is
     * then honoured as "run on the session" at drain, not as "run as anyone".
     * Re-enqueues below carry the ORIGINAL principal forward, so an item's
     * owner is fixed at its first failure and cannot drift across attempts.
     */
    this.items.set(k, {
      connectorId,
      accountId,
      attempt,
      runAt: Date.now() + backoff,
      principal: prev?.principal ?? currentPrincipal(),
    });
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
    // A single drain at a time: a 0ms timer armed by a concurrent enqueue must not start a second
    // drain over the same items while this one is suspended on `await run` (that could re-run an item
    // and double-count attempts / double dead-letter).
    if (this.draining) return;
    this.draining = true;
    try {
      const now = Date.now();
      const due = [...this.items.values()].filter((i) => i.runAt <= now);
      for (const item of due) {
        const k = key(item.connectorId, item.accountId);
        this.items.delete(k);
        let again = false;
        try {
          /**
           * Each item under ITS OWN captured principal.
           *
           * This is what makes the shared timer harmless: the ambient context
           * the timer happens to fire in is no longer an input to the answer.
           */
          again =
            item.principal === null
              ? await this.run(item.connectorId, item.accountId)
              : await runAsPrincipal(item.principal, () =>
                  this.run(item.connectorId, item.accountId),
                );
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
    } finally {
      this.draining = false;
    }
    this.schedule();
  }
}
