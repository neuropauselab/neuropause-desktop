/**
 * P13C ROUND 37 — GATE 16. The shutdown flush barrier.
 *
 * Pinned: every registered flush runs; one thrower or one hang neither blocks
 * the quit nor starves the others (and is NAMED in the summary); the restore
 * relaunch can suppress the barrier exactly once — because after a restore,
 * draining stale in-memory state over the restored files would undo the
 * restore itself.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetShutdownFlushForTests,
  registerShutdownFlush,
  runShutdownFlush,
  shutdownFlushNames,
  suppressShutdownFlushOnce,
} from './shutdownFlush';

afterEach(() => __resetShutdownFlushForTests());

describe('shutdown flush barrier', () => {
  it('runs every registered flush', async () => {
    const ran: string[] = [];
    registerShutdownFlush('a', () => {
      ran.push('a');
    });
    registerShutdownFlush('b', async () => {
      ran.push('b');
    });
    const summary = await runShutdownFlush();
    expect(ran.sort()).toEqual(['a', 'b']);
    expect(summary).toMatchObject({ ran: 2, failed: [], timedOut: [] });
  });

  it('a thrower is isolated and named — the others still drain', async () => {
    const ran: string[] = [];
    registerShutdownFlush('bad', () => {
      throw new Error('disk sealed');
    });
    registerShutdownFlush('good', () => {
      ran.push('good');
    });
    const summary = await runShutdownFlush();
    expect(ran).toEqual(['good']);
    expect(summary.failed).toEqual(['bad']);
  });

  it('a hung flush is time-boxed and named — the quit is never blocked forever', async () => {
    registerShutdownFlush('hung', () => new Promise<void>(() => undefined));
    registerShutdownFlush('quick', () => undefined);
    const summary = await runShutdownFlush(50);
    expect(summary.timedOut).toEqual(['hung']);
    expect(summary.failed).toEqual([]);
    expect(summary.durationMs).toBeLessThan(2000);
  });

  it('re-registration under the same name replaces, not duplicates', async () => {
    let calls = 0;
    registerShutdownFlush('x', () => {
      calls += 1;
    });
    registerShutdownFlush('x', () => {
      calls += 10;
    });
    await runShutdownFlush();
    expect(calls).toBe(10);
    expect(shutdownFlushNames()).toEqual(['x']);
  });

  it('suppression is one-shot: the restore relaunch skips the drain, the NEXT quit flushes', async () => {
    let calls = 0;
    registerShutdownFlush('store', () => {
      calls += 1;
    });
    suppressShutdownFlushOnce('restore relaunch (test)');
    const first = await runShutdownFlush();
    expect(first.suppressed).toContain('restore relaunch');
    expect(calls).toBe(0); // stale memory did NOT overwrite the restore
    const second = await runShutdownFlush();
    expect(second.suppressed).toBeUndefined();
    expect(calls).toBe(1); // normal quits flush again
  });
});
