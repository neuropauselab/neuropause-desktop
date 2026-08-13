/**
 * `crashReporter.export()` MUST AWAIT THE WRITE BARRIER. P13C — F-11c.
 *
 * WHY THIS FILE EXISTS
 *
 * F-11b showed `TimelineService.flush()` was not a barrier. The census that
 * finding prompted swept every store that reads back a file it also appends to,
 * and found one more: `crashReporter.export()` called `fs.readFile` directly
 * while `crashLog.append()` is documented fire-and-forget.
 *
 * THE CONSEQUENCE IS BEHAVIOURAL, NOT COSMETIC. `status()` and
 * `recommendations()` both derive from `export()`. A stale read under-counts
 * crash categories, so the "repeated window crashes — try Safe Mode" guidance
 * can fail to appear for a user whose window is crashing repeatedly.
 *
 * THESE CASES DO NOT RACE. An append costs mkdir + stat + appendFile; the read
 * costs one readFile. The read always wins, so an unbarriered export always
 * misses the record. NEGATIVE CONTROL — delete `await this.crashLog.flush()`
 * from export() and both cases fail on any machine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockState = vi.hoisted(() => ({ userDataDir: '' }));
vi.mock('electron', () => ({
  app: { getPath: () => mockState.userDataDir, on: () => undefined },
  crashReporter: { start: () => undefined },
}));

import { crashReporter } from './crashReporter';

beforeEach(async () => {
  mockState.userDataDir = await fs.mkdtemp(join(tmpdir(), 'np-crash-flush-'));
});
afterEach(async () => {
  await fs.rm(mockState.userDataDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('F-11c — export() is a read behind the crash-log write barrier', () => {
  it('includes a crash reported immediately before the call', async () => {
    crashReporter.report('renderer', 'render-process-gone', 'the crash being exported');

    const records = await crashReporter.export();

    // Was []: readFile resolved before the queued append had reached the disk,
    // so the export omitted the only crash there was.
    expect(records.map((r) => r.kind)).toContain('render-process-gone');
  });

  it('recommendations see crashes reported in the same tick', async () => {
    for (let i = 0; i < 3; i += 1) {
      crashReporter.report('renderer', 'render-process-gone', `window crash ${i + 1}`);
    }

    const recs = await crashReporter.recommendations();

    // Three renderer crashes is the threshold for the Safe Mode recommendation.
    // Unbarriered, the same three read as zero and the user is told nothing.
    expect(recs.map((r) => r.id)).toContain('renderer-instability');
  });

  it('the archive itself holds every reported crash once flushed', async () => {
    crashReporter.report('worker', 'worker-fault', 'first');
    crashReporter.report('plugin', 'child-process-gone', 'second');

    const records = await crashReporter.export();
    const kinds = records.map((r) => r.kind);

    expect(kinds).toContain('worker-fault');
    expect(kinds).toContain('child-process-gone');
    // Newest first is the documented contract and must survive the barrier.
    expect(kinds.indexOf('child-process-gone')).toBeLessThan(kinds.indexOf('worker-fault'));
  });
});
