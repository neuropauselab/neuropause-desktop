/**
 * `await flush()` MUST BE A BARRIER. P13C — F-11b.
 *
 * WHY THIS FILE EXISTS
 *
 * The F11 fix gave the live query window one bounded buffer per owner, so a
 * busy tenant could no longer evict a quiet one. The retention suite proved it.
 * Then that suite began failing intermittently — `query()` returning 7 and
 * `export()` returning 0 for the same tenant, which is the F11 symptom exactly.
 *
 * The window was not the cause. `flush()` was:
 *
 *     if (this.writing || this.pending.length === 0) return;
 *
 * A caller that awaited `flush()` while an append was already in flight got an
 * immediately-resolved promise and a false assurance. `export()` awaits
 * `flush()` and then reads the file; `dispose()` awaits it and then stops. So
 * under load — 770 test files competing for the event loop — the read landed
 * before the write it was supposed to wait for, and `dispose()` could drop the
 * tail of the log entirely.
 *
 * IT REPRODUCED 0/20 TIMES IN ISOLATION. Timing tests do not fail on an idle
 * machine. The two cases below do not race: they put a write in flight
 * deliberately, so the barrier is either honoured or it is not.
 *
 * NEGATIVE CONTROL — restore the ORIGINAL flush() VERBATIM: the early return,
 * the `writing` boolean, the single un-drained batch. Both cases then fail —
 * `expected +0 to be 2` and `to have a length of 2 but got 1`.
 *
 * A PARAPHRASE IS NOT A CONTROL. A variant that still drains `pending` but does
 * not await the write passes case 1, because on an idle machine the append
 * lands before the read. That was tried, and it proved nothing about either the
 * test or the fix. This file detects THE DEFECT THAT SHIPPED. It does not
 * detect every conceivable non-barrier implementation, and saying otherwise
 * would be the same overreach as the green suite that hid this bug.
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PlatformEvent, TenantScope } from '@neuropause/shared';
import { TimelineService } from './timelineService';

const S: TenantScope = { tenantId: 'org-barrier', workspaceId: 'ws-barrier' };

let clock = 0;
function ev(marker: string): PlatformEvent {
  clock += 1;
  return {
    id: `ev_${randomUUID()}`,
    tenantId: S.tenantId,
    type: 'system.ready',
    category: 'system',
    version: 1,
    priority: 'normal',
    timestamp: new Date(Date.UTC(2026, 2, 1) + clock * 1000).toISOString(),
    source: 'barrier-test',
    actor: { kind: 'system', id: null },
    resource: null,
    correlationId: 'c',
    causationId: null,
    metadata: { marker },
  } as PlatformEvent;
}

async function fixture(): Promise<{ dir: string; t: TimelineService }> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'np-timeline-barrier-'));
  const t = new TimelineService({ dir, maxInMemory: 1000, flushIntervalMs: 10_000, batchSize: 50 });
  t.bindScope(() => S);
  await t.init();
  return { dir, t };
}

describe('F-11b — flush() is a write barrier, not a best effort', () => {
  it('export() sees an event appended while an earlier write was in flight', async () => {
    const { dir, t } = await fixture();

    t.append(ev('E1'));
    const inflight = t.flush(); // writing starts; [E1] handed to appendFile
    t.append(ev('E2')); // queued behind a write that has not landed

    const dump = await t.export();
    await inflight;
    await t.dispose();
    await fs.rm(dir, { recursive: true, force: true });

    // Was 1: export() awaited a flush() that returned without doing anything,
    // then read a file E2 had never reached.
    expect(dump.count).toBe(2);
  });

  it('dispose() does not drop the tail of the log', async () => {
    const { dir, t } = await fixture();

    t.append(ev('D1'));
    const inflight = t.flush();
    t.append(ev('D2'));

    await t.dispose();
    await inflight;

    const raw = await fs.readFile(join(dir, 'timeline.jsonl'), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    await fs.rm(dir, { recursive: true, force: true });

    // A shutdown that reports success while an event is still in memory has
    // lost it. There is no later flush: the timer is already cleared.
    expect(lines).toHaveLength(2);
  });
});
