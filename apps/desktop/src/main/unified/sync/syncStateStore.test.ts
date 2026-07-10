import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SyncStateStore, stateToSnapshot } from './syncStateStore';

let dir: string;
beforeEach(async () => {
  dir = join(tmpdir(), `nps-ss-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function newStore(): Promise<SyncStateStore> {
  const s = new SyncStateStore(join(dir, 'sync-state.json'));
  await s.load();
  return s;
}

describe('SyncStateStore — concurrency-safe persistence (P2.3d)', () => {
  it('survives a storm of overlapping writes without an ENOENT rename race', async () => {
    const s = await newStore();
    const ops: Promise<unknown>[] = [];
    // Reproduce the orchestrator's write pattern under load: per-resource cursor + module stats, many at once.
    for (let i = 0; i < 60; i += 1) {
      ops.push(s.setCursor('microsoft-entra', 'acct', `res${i}`, `cur${i}`, '2026-07-11T00:00:00.000Z'));
      ops.push(
        s.recordResource('microsoft-entra', 'acct', `res${i}`, {
          label: `R${i}`,
          kind: 'message',
          objectCount: i,
          status: 'ok',
          reason: null,
          lastSyncAt: '2026-07-11T00:00:00.000Z',
        }),
      );
    }
    ops.push(s.recordRun('microsoft-entra', 'acct', { status: 'success', entityCount: 42 }));

    // The old single-fixed-temp-path persist threw `ENOENT` on rename under exactly this concurrency.
    await expect(Promise.all(ops)).resolves.toBeDefined();

    // The file on disk stays valid and the latest state round-trips through a fresh load.
    const reloaded = await newStore();
    expect(reloaded.get('microsoft-entra', 'acct').resources['res59']?.objectCount).toBe(59);
    expect(reloaded.get('microsoft-entra', 'acct').entityCount).toBe(42);
  });

  it('projects recorded module stats into the snapshot (ok + degraded)', async () => {
    const s = await newStore();
    await s.recordResource('microsoft-entra', 'acct', 'mail', {
      label: 'Outlook Mail',
      kind: 'message',
      objectCount: 2,
      status: 'ok',
      reason: null,
      lastSyncAt: '2026-07-11T00:00:00.000Z',
    });
    await s.recordResource('microsoft-entra', 'acct', 'contacts', {
      label: 'Contacts',
      kind: 'contact',
      objectCount: 0,
      status: 'unauthorized',
      reason: 'Missing Graph permission or module not licensed (403)',
    });
    const snap = stateToSnapshot(s.get('microsoft-entra', 'acct'), 0);
    expect(snap.modules?.find((m) => m.id === 'mail')).toMatchObject({ objectCount: 2, status: 'ok' });
    expect(snap.modules?.find((m) => m.id === 'contacts')?.status).toBe('unauthorized');
  });

  it('preserves a resource cursor when recording stats, and vice versa', async () => {
    const s = await newStore();
    await s.setCursor('microsoft-entra', 'acct', 'mail', 'DELTA', '2026-07-11T00:00:00.000Z');
    await s.recordResource('microsoft-entra', 'acct', 'mail', {
      label: 'Outlook Mail',
      kind: 'message',
      objectCount: 2,
      status: 'ok',
      reason: null,
    });
    // recordResource must not wipe the incremental cursor…
    expect(s.getCursor('microsoft-entra', 'acct', 'mail')).toBe('DELTA');
    // …and a later setCursor must not wipe the recorded module stats.
    await s.setCursor('microsoft-entra', 'acct', 'mail', 'DELTA2', '2026-07-11T00:01:00.000Z');
    expect(s.get('microsoft-entra', 'acct').resources['mail'].objectCount).toBe(2);
  });
});
