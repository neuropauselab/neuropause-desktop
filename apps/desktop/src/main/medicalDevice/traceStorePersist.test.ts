/**
 * A BACKGROUND WRITE THAT FAILS MUST REACH SOMEBODY. P13C ROUND 17l.
 *
 * WHERE THIS CAME FROM
 *
 * The first Windows release build of NeuroPause reported 765 files / 8018
 * tests, every one green, and failed anyway:
 *
 *   Unhandled Rejection
 *   ENOENT: rename 'C:\…\np-md-import-…\trace.json.tmp' -> '…\trace.json'
 *     at TraceEdgeStore.persist  traceStore.ts:113
 *     at TraceEdgeStore.drainPersist  traceStore.ts:135
 *
 * The proximate cause was a test teardown that slept 25ms instead of awaiting
 * `flush()`, and lost that guess on a runner 48x slower than the machine the
 * guess was calibrated on. That is fixed where it belongs, in the teardown.
 *
 * But the reason a lost race could fail a build at all is this: `schedulePersist`
 * assigned `drainPersist()` to a field and never observed it. On the ordinary
 * write path nothing calls `flush()`, so a rejected background persist had no
 * handler anywhere — it went to the process. In a test runner that fails the
 * suite. In the packaged application it is an unhandled rejection in the
 * Electron main process, from a store whose rows are, in its own words, "the
 * evidence for a recall."
 *
 * It is the swallowing catch turned inside out. A swallowed error reaches
 * nobody; an unobserved rejection reaches a global handler that cannot name the
 * store or say what the user should do. Neither delivers the failure to someone
 * who can act on it.
 *
 * SCOPE, STATED HONESTLY: 33 stores in `src/main` share the
 * `this.lastPersist = this.drain*()` shape. This file fixes and proves the one
 * that surfaced. The other 32 are recorded as D-8, not quietly left as fixed.
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TraceEdgeStore } from './traceStore';

const T0 = '2026-08-12T00:00:00.000Z';

const EDGE = {
  tenantId: 'default',
  kind: 'lot_of_product' as const,
  from: { type: 'lot' as const, id: 'lot-1', label: 'LOT-1' },
  to: { type: 'product' as const, id: 'prod-1', label: 'TR-1001' },
  at: T0,
};

describe('TraceEdgeStore — a failed background write', () => {
  it('is reported on `persist-failed` rather than leaking to the process', async () => {
    // A path whose directory does not exist: the atomic write cannot even
    // create its tmp file, so the persist rejects for a real reason rather
    // than a mocked one.
    const missing = join(tmpdir(), `np-trace-missing-${randomUUID()}`, 'trace.json');
    const store = new TraceEdgeStore(missing);
    await store.load();

    const failures: { path: string; error: unknown }[] = [];
    store.on('persist-failed', (f: { path: string; error: unknown }) => failures.push(f));

    store.record(EDGE);

    // `flush()` still rejects for a caller who explicitly waits — the
    // background path reports, the deliberate path throws. Both, not either.
    await expect(store.flush()).rejects.toThrow();

    expect(failures).toHaveLength(1);
    expect(failures[0]?.path).toBe(missing);
    expect((failures[0]?.error as NodeJS.ErrnoException)?.code).toBe('ENOENT');
  });

  /**
   * The negative control for the teardown half. Without an awaited `flush()`,
   * removing the directory while a write is queued is exactly the race the
   * Windows runner lost — and it is now observable rather than fatal.
   */
  it('survives its directory being removed mid-write, and says so', async () => {
    const dir = join(tmpdir(), `np-trace-race-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    const store = new TraceEdgeStore(join(dir, 'trace.json'));
    await store.load();

    const failures: unknown[] = [];
    store.on('persist-failed', (f) => failures.push(f));

    store.record(EDGE);
    await fs.rm(dir, { recursive: true, force: true });
    // The write may have completed before the removal on a fast machine, so the
    // assertion is on the CLASS of outcome: it either succeeded or it reported.
    // What it must never do is reject into nothing.
    const settled = await store
      .flush()
      .then(() => 'resolved' as const)
      .catch(() => 'rejected' as const);
    expect(settled === 'resolved' || failures.length === 1).toBe(true);
  });

  it('flush() resolves when the write really can succeed', async () => {
    const dir = join(tmpdir(), `np-trace-ok-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    const file = join(dir, 'trace.json');
    const store = new TraceEdgeStore(file);
    await store.load();

    const failures: unknown[] = [];
    store.on('persist-failed', (f) => failures.push(f));

    store.record(EDGE);
    await store.flush();

    // The point of awaiting flush() rather than sleeping: the bytes are on disk
    // the instant it resolves, so teardown cannot race the rename.
    const written = JSON.parse(await fs.readFile(file, 'utf8')) as { edges: unknown[] };
    expect(written.edges).toHaveLength(1);
    expect(failures).toEqual([]);

    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });
});
