/**
 * A per-ACCOUNT rate gate. It enforces a minimum spacing between requests to a
 * given credential (proactive throttling) and a cooldown window after a 429
 * (reactive backoff, set via `penalize`). The HTTP client calls `acquire` before
 * every request; the orchestrator reads `cooldownUntilMs` for the dashboard.
 *
 * P13C ROUND 11 — M-8. It was per-CONNECTOR, and one instance is shared by every
 * workspace on the install. See `rateGateKey`.
 */
import type { RateGate } from './http';

/**
 * THE PARTITION KEY. P13C ROUND 11 — M-8.
 *
 * The gate was keyed on the BARE `connectorId` — `'github'`, `'slack'` — while
 * `initSync` constructs ONE `RateLimiter` and `forEachWorkspace` drives every
 * tenant's tick through it.
 *
 * So tenant A taking a 429 called `penalize('github', ms)` and tenant B's next
 * request slept on A's cooldown. `ms` comes from the provider's own
 * `Retry-After` / `x-ratelimit-reset`, so a tenant whose connector points at a
 * host they influence returns `Retry-After: 86400` and pins the shared entry for
 * a day. Worse than slow: the sleep happens BEFORE `fetch`, so the request
 * timeout never applies and each stalled call holds one of the four concurrent
 * sync slots. B is never told, because the durable `rateLimitedUntil` is written
 * only in the account's own catch block — B's connector just looks broken.
 *
 * Even with no 429 at all, the shared `lastAt` forced A's 200 ms spacing onto B.
 *
 * THE KEY IS THE CREDENTIAL, NOT THE VENDOR. Provider limits are per token /
 * installation, and `accountId` is a random `shortId('acct')` minted per
 * connection, so it is unguessable and never crosses a tenant. This is the same
 * `${connectorId}::${accountId}` composite that `connectorStore`, `retryQueue`
 * and `connectorRuntimeSupervisor` already use — and it additionally stops two
 * accounts of one provider inside ONE workspace stealing each other's budget.
 *
 * A function rather than an inline template, so the partition has one definition
 * to grep and a caller cannot half-adopt it.
 */
export function rateGateKey(connectorId: string, accountId: string): string {
  return `${connectorId}::${accountId}`;
}

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
