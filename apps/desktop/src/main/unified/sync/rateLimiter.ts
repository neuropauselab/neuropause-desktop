/**
 * A per-connector rate gate. It enforces a minimum spacing between requests to a
 * given connector (proactive throttling) and a cooldown window after a 429
 * (reactive backoff, set via `penalize`). The HTTP client calls `acquire` before
 * every request; the orchestrator reads `cooldownUntilMs` for the dashboard.
 */
import type { RateGate } from './http';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RateLimiter implements RateGate {
  private lastAt = new Map<string, number>();
  private cooldown = new Map<string, number>();

  constructor(private readonly minIntervalMs = 200) {}

  async acquire(key: string): Promise<void> {
    const now = Date.now();
    const cooldownUntil = this.cooldown.get(key) ?? 0;
    const nextAllowed = (this.lastAt.get(key) ?? 0) + this.minIntervalMs;
    const wait = Math.max(0, cooldownUntil - now, nextAllowed - now);
    if (wait > 0) await delay(wait);
    this.lastAt.set(key, Date.now());
  }

  penalize(key: string, ms: number): void {
    this.cooldown.set(key, Date.now() + ms);
  }

  cooldownUntilMs(key: string): number {
    return this.cooldown.get(key) ?? 0;
  }
}
