import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SyncChange } from '@neuropause/shared';
import { SyncEngine } from './engine';
import { createPersistentSyncStore } from './store';
import type { SyncTransport } from './types';
import { createLocalSyncMirror, type LocalSyncMirror } from './mirror';

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

describe('createLocalSyncMirror', () => {
  let filePath: string;
  let mirror: LocalSyncMirror;

  beforeEach(async () => {
    filePath = join(tmpdir(), `nps-mirror-${randomUUID()}.json`);
    mirror = createLocalSyncMirror({ filePath });
    await mirror.load();
  });
  afterEach(async () => {
    await fs.rm(filePath, { force: true });
    await fs.rm(`${filePath}.tmp`, { force: true });
  });

  it('applies a new record and reads it back', async () => {
    expect(await mirror.apply(change())).toBe('applied');
    expect(mirror.get('org-1', 'org_prefs', 'prefs')?.data).toEqual({ theme: 'dark' });
  });

  it('applies a strictly newer change over an existing one', async () => {
    await mirror.apply(change({ version: 1 }));
    expect(await mirror.apply(change({ version: 2, data: { theme: 'light' } }))).toBe('applied');
    expect(mirror.get('org-1', 'org_prefs', 'prefs')?.data).toEqual({ theme: 'light' });
  });

  it('ignores a stale change and leaves the local copy intact', async () => {
    await mirror.apply(change({ version: 3, data: { theme: 'light' } }));
    expect(await mirror.apply(change({ version: 2, data: { theme: 'dark' } }))).toBe('ignored');
    expect(mirror.get('org-1', 'org_prefs', 'prefs')?.data).toEqual({ theme: 'light' });
  });

  it('reports a conflict on an exact version+timestamp tie', async () => {
    await mirror.apply(change({ data: { theme: 'dark' } }));
    expect(await mirror.apply(change({ data: { theme: 'light' } }))).toBe('conflict');
  });

  it('applies a tombstone', async () => {
    await mirror.apply(change({ version: 1 }));
    await mirror.apply(change({ version: 2, deleted: true, data: null }));
    expect(mirror.get('org-1', 'org_prefs', 'prefs')?.deleted).toBe(true);
  });

  it('lists records by org and entity type', async () => {
    await mirror.apply(change({ entityId: 'prefs' }));
    await mirror.apply(change({ entityType: 'workspace_settings', entityId: 'ws-1' }));
    await mirror.apply(change({ orgId: 'org-2', entityId: 'prefs' }));
    expect(mirror.list('org-1')).toHaveLength(2);
    expect(mirror.list('org-1', 'workspace_settings')).toHaveLength(1);
    expect(mirror.list('org-2')).toHaveLength(1);
  });

  it('persists records across a reload', async () => {
    await mirror.apply(change({ version: 5, data: { theme: 'sync' } }));
    const reloaded = createLocalSyncMirror({ filePath });
    await reloaded.load();
    expect(reloaded.get('org-1', 'org_prefs', 'prefs')?.data).toEqual({ theme: 'sync' });
  });

  it('lands pulled data locally through the full engine + store + mirror path', async () => {
    const storePath = join(tmpdir(), `nps-store-${randomUUID()}.json`);
    const store = createPersistentSyncStore({ filePath: storePath, applyLocal: mirror.apply });
    await store.load();

    const transport: SyncTransport = {
      async push(_orgId, _deviceId, changes) {
        return {
          results: changes.map(() => ({
            entityType: 'org_prefs',
            entityId: 'prefs',
            status: 'applied' as const,
            serverVersion: 1,
            serverUpdatedAt: 'x',
          })),
          cursor: 0,
        };
      },
      async pull() {
        return {
          changes: [change({ entityId: 'remote', version: 4, data: { landed: true } })],
          cursor: 12,
          hasMore: false,
        };
      },
    };
    const engine = new SyncEngine({ transport, store, deviceId: 'devA' });
    await engine.syncOnce('org-1');

    expect(mirror.get('org-1', 'org_prefs', 'remote')?.data).toEqual({ landed: true });
    expect(await store.getCursor('org-1')).toBe(12);
    await fs.rm(storePath, { force: true });
    await fs.rm(`${storePath}.tmp`, { force: true });
  });
});
