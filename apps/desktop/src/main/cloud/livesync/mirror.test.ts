/**
 * P13C ROUND 9 — F17. Every case below survives from the pre-fix suite; the seam
 * is new, and so is the cross-tenant half — before the fix `mirror.list('org-2')`
 * from anywhere returned org-2's mirrored records.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SyncChange, TenantScope } from '@neuropause/shared';
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
  /** Who the test is acting as. The mirror reads it through the bound seam. */
  let acting: string | null;
  const scope = (): TenantScope | null =>
    acting === null ? null : { tenantId: acting, workspaceId: '' };

  beforeEach(async () => {
    filePath = join(tmpdir(), `nps-mirror-${randomUUID()}.json`);
    acting = 'org-1';
    mirror = createLocalSyncMirror({ filePath }).bindScope(scope);
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
    acting = 'org-2';
    await mirror.apply(change({ orgId: 'org-2', entityId: 'prefs' }));
    expect(mirror.list('org-2')).toHaveLength(1);
    acting = 'org-1';
    expect(mirror.list('org-1')).toHaveLength(2);
    expect(mirror.list('org-1', 'workspace_settings')).toHaveLength(1);
  });

  it('persists records across a reload', async () => {
    await mirror.apply(change({ version: 5, data: { theme: 'sync' } }));
    const reloaded = createLocalSyncMirror({ filePath }).bindScope(scope);
    await reloaded.load();
    expect(reloaded.get('org-1', 'org_prefs', 'prefs')?.data).toEqual({ theme: 'sync' });
  });

  it('lands pulled data locally through the full engine + store + mirror path', async () => {
    const storePath = join(tmpdir(), `nps-store-${randomUUID()}.json`);
    const store = createPersistentSyncStore({
      filePath: storePath,
      applyLocal: mirror.apply,
    }).bindScope(scope);
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

  /* ── P13C ROUND 9 — F17. The seam, and what it refuses. ─────────────────── */

  it('an UNBOUND mirror reads nothing and writes nothing', async () => {
    const unbound = createLocalSyncMirror({ filePath });
    await unbound.load();
    expect(await unbound.apply(change())).toBe('ignored');
    expect(unbound.get('org-1', 'org_prefs', 'prefs')).toBeNull();
    expect(unbound.list('org-1')).toEqual([]);
  });

  it('B cannot read or list A’s mirrored records', async () => {
    await mirror.apply(change({ entityId: 'prefs', data: { secret: 'a' } }));
    acting = 'org-2';
    expect(mirror.get('org-1', 'org_prefs', 'prefs')).toBeNull();
    expect(mirror.list('org-1')).toEqual([]);
    expect(mirror.list('org-2')).toEqual([]);
  });

  it('a pulled change is filed by the SEAM, never by the payload’s own orgId', async () => {
    // Acting as org-1, a change claiming org-2 must not land anywhere.
    expect(await mirror.apply(change({ orgId: 'org-2', entityId: 'planted' }))).toBe('ignored');
    expect(mirror.get('org-1', 'org_prefs', 'planted')).toBeNull();
    acting = 'org-2';
    expect(mirror.get('org-2', 'org_prefs', 'planted')).toBeNull();
    expect(mirror.list('org-2')).toEqual([]);
  });

  it('records mirrored before the owner existed are visible to nobody', async () => {
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        records: { 'org-1|org_prefs|prefs': change({ data: { legacy: true } }) },
      }),
    );
    const reloaded = createLocalSyncMirror({ filePath }).bindScope(scope);
    await reloaded.load();
    expect(reloaded.get('org-1', 'org_prefs', 'prefs')).toBeNull();
    expect(reloaded.list('org-1')).toEqual([]);

    // …and the owning organization's next pull supersedes it in place.
    expect(await reloaded.apply(change({ version: 2, data: { fresh: true } }))).toBe('applied');
    expect(reloaded.get('org-1', 'org_prefs', 'prefs')?.data).toEqual({ fresh: true });
  });
});
