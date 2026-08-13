/**
 * P13C ROUND 11 — M-8. ONE TENANT COULD STALL ANOTHER'S CONNECTORS.
 *
 * THE FINDING. `RateLimiter` keyed both of its maps on the BARE `connectorId` —
 * `'github'`, `'slack'` — and `initSync` constructs exactly ONE instance, which
 * `forEachWorkspace` drives for every tenant on the install. So:
 *
 *   1. tenant A's GitHub sync takes a 429;
 *   2. `http.ts` calls `gate.penalize('github', ms)`, where `ms` comes from the
 *      provider's own `Retry-After` / `x-ratelimit-reset` header;
 *   3. tenant B's next GitHub request calls `gate.acquire('github')` and sleeps
 *      on A's cooldown.
 *
 * WHY IT IS WORSE THAN "SLOW". The sleep happens BEFORE `fetch`, so the 60s
 * request timeout never applies, and each stalled call holds one of the four
 * concurrent sync slots. And B is never told: the durable, correctly-scoped
 * `rateLimitedUntil` is written only inside the account's own catch block, so no
 * event and no `rate_limited` status is produced for B — the connector simply
 * looks broken. `Retry-After` is attacker-influenced for anyone pointing a
 * connector at a host they control, so the stall length is not bounded by
 * anything the product decides.
 *
 * Even with no 429 anywhere, the shared `lastAt` imposed A's 200 ms spacing on B.
 *
 * REAL TIMERS, DELIBERATELY. Round 10 recorded a scheduler test that "passed
 * both ways" under fake timers and had to be rewritten. A cross-tenant stall is
 * a WALL-CLOCK property; asserting it against a mocked clock would prove the
 * bookkeeping and not the behaviour. The waits here are bounded so the suite
 * stays fast: the happy path asserts B is not delayed, and the penalty is
 * asserted through `cooldownUntilMs` rather than by sleeping through it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RateLimiter, rateGateKey } from '../unified/sync/rateLimiter';

const MAIN = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Three tenants, each with their own credential for the SAME provider. */
const A = rateGateKey('github', 'acct-a');
const B = rateGateKey('github', 'acct-b');
const C = rateGateKey('github', 'acct-c');

describe('the gate key is the credential, not the vendor', () => {
  it('two accounts of one provider are different keys', () => {
    expect(A).not.toBe(B);
    expect(rateGateKey('github', 'acct-a')).toBe('github::acct-a');
  });

  it('different providers on one account are also different keys', () => {
    expect(rateGateKey('github', 'acct-a')).not.toBe(rateGateKey('slack', 'acct-a'));
  });
});

describe('A’s penalty does not reach B or C', () => {
  it('a 429 against A leaves B and C with no cooldown at all', () => {
    const limiter = new RateLimiter(0);
    limiter.penalize(A, 60_000);

    expect(limiter.cooldownUntilMs(A)).toBeGreaterThan(Date.now());
    // The whole finding, as two numbers.
    expect(limiter.cooldownUntilMs(B)).toBe(0);
    expect(limiter.cooldownUntilMs(C)).toBe(0);
  });

  it('B is not delayed by A’s hour-long penalty — measured on the clock', async () => {
    const limiter = new RateLimiter(0);
    // A hostile or merely unlucky `Retry-After` from A's provider.
    limiter.penalize(A, 3_600_000);

    const started = Date.now();
    await limiter.acquire(B);
    await limiter.acquire(C);
    const elapsed = Date.now() - started;

    // Under the bare-connectorId key both of these slept on A's cooldown.
    expect(elapsed).toBeLessThan(250);
  });

  it('the penalty is REAL for A — the gate is not simply inert', async () => {
    // Without this, the case above would pass just as well if `penalize` did
    // nothing at all, which is the failure mode of a one-sided isolation test.
    const limiter = new RateLimiter(0);
    limiter.penalize(A, 40);
    const started = Date.now();
    await limiter.acquire(A);
    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
  });

  it('proactive spacing is per credential too', async () => {
    // The no-429 half: a shared `lastAt` imposed one tenant's spacing on another.
    const limiter = new RateLimiter(5_000);
    await limiter.acquire(A); // A takes its slot

    const started = Date.now();
    await limiter.acquire(B); // B must not inherit A's 5s spacing
    expect(Date.now() - started).toBeLessThan(250);
  });
});

describe('every call site adopted the key', () => {
  /**
   * A partition helper that two of three call sites use is not a partition. The
   * shared limiter means ONE un-migrated site re-opens the finding for every
   * tenant, so the sites are pinned by name rather than trusted.
   */
  it.each([
    ['unified/sync/orchestrator.ts', 'the background sync engine'],
    ['connectors/m365/executor.ts', 'the Graph write executor'],
    ['connectors/connectionTest.ts', 'the interactive connection test'],
  ])('%s keys its HttpClient with rateGateKey', (rel) => {
    const src = readFileSync(join(MAIN, rel), 'utf8');
    expect(src).toContain('rateGateKey(connectorId, accountId)');
  });

  it('no call site still passes a bare connectorId as the gate key', () => {
    for (const rel of [
      'unified/sync/orchestrator.ts',
      'connectors/m365/executor.ts',
      'connectors/connectionTest.ts',
    ]) {
      const src = readFileSync(join(MAIN, rel), 'utf8');
      expect(
        /new HttpClient\(\s*connectorId\s*,/.test(src),
        `${rel} constructs HttpClient with a bare connectorId — one shared limiter serves every tenant`,
      ).toBe(false);
    }
  });
});
