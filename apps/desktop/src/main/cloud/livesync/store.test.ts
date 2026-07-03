import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MergeOutcome, SyncChange } from '@neuropause/shared';
import { SyncEngine } from './engine';
import type { SyncTransport } from './types';
import { createPersistentSyncStore, type PersistentSyncStore } from './store';

function change(over: Partial<SyncChange> = {}): SyncChange {
  return {
    entityType: 'org_prefs',
    entityId: 'prefs',
    orgId: 'org-1',
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    deleted: false,
    data: { theme: 'dark' },
    ...over,
  };
}

describe('createPersistentSyncStore', () => {
  let filePath: string;
  let applied: SyncChange[];
  let store: PersistentSyncStore;
  const applyLocal = async (c: SyncChange): Promise<MergeOutcome> => {
    applied.push(c);
    return 'applied';
  };

  beforeEach(async () => {
    filePath = join(tmpdir(), `nps-sync-${randomUUID()}.json`);
    applied = [];
    store = createPersistentSyncStore({ filePath, applyLocal });
    await store.load();
  });
  afterEach(async () => {
    await fs.rm(filePath, { force: true });
    await fs.rm(`${filePath}.tmp`, { force: true });
  });

  it('enqueues and lists pending changes', async () => {
    const q = await store.enqueue('org-1', change());
    const pending = await store.listPending('org-1');
    expect(pending).toHaveLength(1);
    expect(pending[0].queueId).toBe(q.queueId);
    expect(store.pendingCount('org-1')).toBe(1);
  });

  it('removes acknowledged changes', async () => {
    const q = await store.enqueue('org-1', change());
    await store.removePending('org-1', [q.queueId]);
    expect(await store.listPending('org-1')).toHaveLength(0);
  });

  it('tracks the cursor per org', async () => {
    expect(await store.getCursor('org-1')).toBe(0);
    await store.setCursor('org-1', 42);
    expect(await store.getCursor('org-1')).toBe(42);
    expect(await store.getCursor('org-2')).toBe(0);
  });

  it('persists the queue and cursor across a reload', async () => {
    await store.enqueue('org-1', change({ entityId: 'a' }));
    await store.setCursor('org-1', 7);
    const reloaded = createPersistentSyncStore({ filePath, applyLocal });
    await reloaded.load();
    expect(await reloaded.listPending('org-1')).toHaveLength(1);
    expect(await reloaded.getCursor('org-1')).toBe(7);
  });

  it('delegates applyRemote to applyLocal', async () => {
    const c = change({ entityId: 'x' });
    const outcome = await store.applyRemote(c);
    expect(outcome).toBe('applied');
    expect(applied).toEqual([c]);
  });

  it('isolates queues by org', async () => {
    await store.enqueue('org-1', change());
    await store.enqueue('org-2', change({ orgId: 'org-2' }));
    expect(await store.listPending('org-1')).toHaveLength(1);
    expect(await store.listPending('org-2')).toHaveLength(1);
  });

  it('drives a full engine cycle: enqueue, push, clear, pull, apply', async () => {
    await store.enqueue('org-1', change());
    const transport: SyncTransport = {
      async push(_orgId, _deviceId, changes) {
        return {
          results: changes.map((c) => ({
            entityType: c.entityType,
            entityId: c.entityId,
            status: 'applied' as const,
            serverVersion: c.version,
            serverUpdatedAt: c.updatedAt,
          })),
          cursor: 1,
        };
      },
      async pull() {
        return { changes: [change({ entityId: 'remote', version: 2 })], cursor: 9, hasMore: false };
      },
    };
    const engine = new SyncEngine({ transport, store, deviceId: 'devA' });
    const status = await engine.syncOnce('org-1');

    expect(status.state).toBe('idle');
    expect(await store.listPending('org-1')).toHaveLength(0);
    expect(await store.getCursor('org-1')).toBe(9);
    expect(applied.some((c) => c.entityId === 'remote')).toBe(true);
  });
});
