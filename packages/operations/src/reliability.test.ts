import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { ReliabilityRegistry, Bulkhead, BulkheadFullError, CircuitOpenError, classifyFailure, isTransient, isPermanent } from './reliability';

describe('Failure classification (Phase 2)', () => {
  it('classifies transient vs permanent vs unknown', () => {
    expect(classifyFailure(new Error('connection timeout'))).toBe('transient');
    expect(classifyFailure({ status: 503 })).toBe('transient');
    expect(classifyFailure({ status: 429 })).toBe('transient');
    expect(classifyFailure(new Error('ECONNRESET'))).toBe('transient');
    expect(classifyFailure({ status: 400 })).toBe('permanent');
    expect(classifyFailure(new Error('invalid input'))).toBe('permanent');
    expect(classifyFailure(new Error('not found'))).toBe('permanent');
    expect(isTransient(new Error('service unavailable'))).toBe(true);
    expect(isPermanent(new Error('forbidden'))).toBe(true);
    expect(classifyFailure(new Error('something odd'))).toBe('unknown');
  });
});

describe('Bulkhead isolation (Phase 2)', () => {
  it('caps concurrency and rejects overflow past the queue', async () => {
    const b = new Bulkhead(2, 0);
    const releases: Array<() => void> = [];
    const gate = (): Promise<void> => new Promise((r) => releases.push(r));
    const p1 = b.run(() => gate());
    const p2 = b.run(() => gate());
    expect(b.stats().active).toBe(2);
    await expect(b.run(async () => undefined)).rejects.toBeInstanceOf(BulkheadFullError);
    releases.forEach((r) => r());
    await Promise.all([p1, p2]);
    expect(b.stats().active).toBe(0);
  });

  it('queues up to maxQueue then serves the waiter when a slot frees', async () => {
    const b = new Bulkhead(1, 1);
    let release1: () => void = () => undefined;
    const first = b.run(() => new Promise<void>((r) => { release1 = r; })); // holds the only slot
    const second = b.run(async () => 'second'); // slot busy, queue has room ⇒ queued
    expect(b.stats().queued).toBe(1);
    await expect(b.run(async () => 'third')).rejects.toBeInstanceOf(BulkheadFullError); // queue full ⇒ reject
    release1(); // free the slot → the queued call is served
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBe('second');
  });
});

describe('ReliabilityRegistry — one policy, composed (Phase 2)', () => {
  const instant = { sleep: () => Promise.resolve(), rng: () => 0 };

  it('retries transient failures and succeeds; does not retry permanent ones', async () => {
    const reg = new ReliabilityRegistry(new ManualClock(0), instant);
    reg.define('svc', { retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, jitter: 0 }, breaker: false, retryOn: ['transient', 'unknown'] });
    let calls = 0;
    const out = await reg.execute('svc', async () => {
      calls += 1;
      if (calls < 3) throw new Error('temporarily unavailable');
      return 'ok';
    });
    expect(out).toBe('ok');
    expect(calls).toBe(3);

    let perm = 0;
    await expect(
      reg.execute('svc', async () => {
        perm += 1;
        throw new Error('invalid request');
      }),
    ).rejects.toThrow(/invalid/);
    expect(perm).toBe(1); // permanent ⇒ no retry
  });

  it('opens the circuit after the threshold, rejects while open, half-opens after cooldown', async () => {
    const clock = new ManualClock(0);
    const reg = new ReliabilityRegistry(clock, instant);
    reg.define('cb', { retry: false, breaker: { failureThreshold: 2, resetTimeoutMs: 1000 } });
    await expect(reg.execute('cb', async () => { throw new Error('e1'); })).rejects.toThrow();
    await expect(reg.execute('cb', async () => { throw new Error('e2'); })).rejects.toThrow();
    expect(reg.breakerState('cb')).toBe('open');
    await expect(reg.execute('cb', async () => 'x')).rejects.toBeInstanceOf(CircuitOpenError);
    expect(reg.stats('cb')?.rejectedOpen).toBe(1);
    clock.advance(1000);
    expect(reg.breakerState('cb')).toBe('half-open');
    expect(await reg.execute('cb', async () => 'ok')).toBe('ok');
    expect(reg.breakerState('cb')).toBe('closed');
  });

  it('falls back on failure and fires recovery hooks when health returns', async () => {
    const reg = new ReliabilityRegistry(new ManualClock(0), instant);
    reg.define('fb', { retry: false, breaker: false, fallback: () => 'fallback-value' });
    expect(await reg.execute('fb', async () => { throw new Error('boom'); })).toBe('fallback-value');
    expect(reg.stats('fb')?.fallback).toBe(1);

    reg.define('rec', { retry: false, breaker: false });
    let recovered = 0;
    reg.onRecovery('rec', () => { recovered += 1; });
    await expect(reg.execute('rec', async () => { throw new Error('down'); })).rejects.toThrow();
    await reg.execute('rec', async () => 'back');
    expect(recovered).toBe(1);
  });
});
