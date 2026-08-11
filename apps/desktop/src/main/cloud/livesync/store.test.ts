/**
 * P13C ROUND 9 — F17. Every case below survives from the pre-fix suite; what is
 * added is the seam the store now demands and the cross-tenant half the old
 * suite could not express, because before the fix `enqueue('org-2', …)` was a
 * legitimate call from anywhere.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MergeOutcome, SyncChange, TenantScope } from '@neuropause/shared';
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
  /** Who the test is acting as. The store reads it through the bound seam. */
  let acting: string | null;
  const scope = (): TenantScope | null =>
    acting === null ? null : { tenantId: acting, workspaceId: '' };
  const applyLocal = async (c: SyncChange): Promise<MergeOutcome> => {
    applied.push(c);
    return 'applied';
  };

  beforeEach(async () => {
    filePath = join(tmpdir(), `nps-sync-${randomUUID()}.json`);
    applied = [];
    acting = 'org-1';
    store = createPersistentSyncStore({ filePath, applyLocal }).bindScope(scope);
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
    // org-2's cursor is not this caller's to read: an honest zero either way.
    expect(await store.getCursor('org-2')).toBe(0);
    acting = 'org-2';
    expect(await store.getCursor('org-2')).toBe(0);
  });

  it('persists the queue and cursor across a reload', async () => {
    await store.enqueue('org-1', change({ entityId: 'a' }));
    await store.setCursor('org-1', 7);
    const reloaded = createPersistentSyncStore({ filePath, applyLocal }).bindScope(scope);
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
    acting = 'org-2';
    await store.enqueue('org-2', change({ orgId: 'org-2' }));
    expect(await store.listPending('org-2')).toHaveLength(1);
    acting = 'org-1';
    expect(await store.listPending('org-1')).toHaveLength(1);
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

  /* ── P13C ROUND 9 — F17. The seam, and what it refuses. ─────────────────── */

  it('an UNBOUND store writes nothing and reads nothing', async () => {
    const unbound = createPersistentSyncStore({ filePath, applyLocal });
    await unbound.load();
    await expect(unbound.enqueue('org-1', change())).rejects.toThrow(/no owner/i);
    expect(await unbound.listPending('org-1')).toEqual([]);
    expect(unbound.pendingCount('org-1')).toBe(0);
    expect(await unbound.applyRemote(change())).toBe('ignored');
  });

  it('the owner comes from the SEAM, not from the orgId argument', async () => {
    // Acting as org-1 and claiming org-2 is refused outright — before this fix
    // it simply filed the row under org-2.
    await expect(store.enqueue('org-2', change({ orgId: 'org-2' }))).rejects.toThrow(
      /not the active organization/i,
    );
    acting = 'org-2';
    expect(await store.listPending('org-2')).toEqual([]);
  });

  it('refuses to queue a change whose payload names another organization', async () => {
    await expect(store.enqueue('org-1', change({ orgId: 'org-2' }))).rejects.toThrow(
      /not the active organization/i,
    );
  });

  it('B cannot read, count, snapshot or drain A’s queue', async () => {
    const q = await store.enqueue('org-1', change());
    acting = 'org-2';
    expect(await store.listPending('org-1')).toEqual([]);
    expect(store.pendingCount('org-1')).toBe(0);
    expect(store.pendingSnapshot('org-1')).toEqual([]);
    await expect(store.removePending('org-1', [q.queueId])).rejects.toThrow(/not the active/i);
    // …and A's row is still there afterwards.
    acting = 'org-1';
    expect(await store.listPending('org-1')).toHaveLength(1);
  });

  it('B cannot delete A’s row by guessing its queue id from B’s own queue', async () => {
    const aRow = await store.enqueue('org-1', change());
    acting = 'org-2';
    await store.enqueue('org-2', change({ orgId: 'org-2' }));
    // A queue id is a UUID, but the store must not rely on that: removing by
    // A's id from B's context reaches nothing.
    await store.removePending('org-2', [aRow.queueId]);
    acting = 'org-1';
    expect(await store.listPending('org-1')).toHaveLength(1);
  });

  it('B cannot rewind A’s pull cursor', async () => {
    await store.setCursor('org-1', 40);
    acting = 'org-2';
    await expect(store.setCursor('org-1', 0)).rejects.toThrow(/not the active/i);
    acting = 'org-1';
    expect(await store.getCursor('org-1')).toBe(40);
  });

  it('applyRemote refuses a change for another organization', async () => {
    expect(await store.applyRemote(change({ orgId: 'org-2' }))).toBe('ignored');
    expect(applied).toEqual([]);
  });

  it('rows written before the owner existed are visible to nobody', async () => {
    // A file exactly as the pre-Round-9 store wrote it: no tenantId on the row.
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        queues: { 'org-1': [{ queueId: 'legacy-1', change: change() }] },
        cursors: {},
      }),
    );
    const reloaded = createPersistentSyncStore({ filePath, applyLocal }).bindScope(scope);
    await reloaded.load();
    expect(await reloaded.listPending('org-1')).toEqual([]);
    expect(reloaded.pendingCount('org-1')).toBe(0);
    // Nor can they be deleted by a caller who names the id.
    await reloaded.removePending('org-1', ['legacy-1']);
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as {
      queues: Record<string, unknown[]>;
    };
    expect(raw.queues['org-1']).toHaveLength(1);
  });

  it('a row stamped for another organization is invisible even inside this org’s bucket', async () => {
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        queues: { 'org-1': [{ queueId: 'planted', change: change(), tenantId: 'org-2' }] },
        cursors: {},
      }),
    );
    const reloaded = createPersistentSyncStore({ filePath, applyLocal }).bindScope(scope);
    await reloaded.load();
    expect(await reloaded.listPending('org-1')).toEqual([]);
    acting = 'org-2';
    expect(await reloaded.listPending('org-2')).toEqual([]);
  });
});

/* ── Retention: a cap is a WRITE, so it must be per owner. ───────────────── */

describe('the outbound queue’s retention cap is per organization', () => {
  let filePath: string;
  let acting: string;
  const scope = (): TenantScope => ({ tenantId: acting, workspaceId: '' });
  const applyLocal = async (): Promise<MergeOutcome> => 'applied';

  const at = (n: number): string => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();

  beforeEach(() => {
    filePath = join(tmpdir(), `nps-sync-cap-${randomUUID()}.json`);
    acting = 'org-a';
  });
  afterEach(async () => {
    await fs.rm(filePath, { force: true });
    await fs.rm(`${filePath}.tmp`, { force: true });
  });

  it('a flooding organization evicts only its OWN oldest rows', async () => {
    const store = createPersistentSyncStore({
      filePath,
      applyLocal,
      maxPendingPerOrg: 3,
    }).bindScope(scope);
    await store.load();

    // B queues two rows FIRST, so they are the oldest rows in the whole file —
    // exactly what an install-wide oldest-first cap would delete first.
    acting = 'org-b';
    await store.enqueue('org-b', change({ orgId: 'org-b', entityId: 'b-1', updatedAt: at(1) }));
    await store.enqueue('org-b', change({ orgId: 'org-b', entityId: 'b-2', updatedAt: at(2) }));

    acting = 'org-a';
    for (let i = 1; i <= 6; i += 1) {
      await store.enqueue(
        'org-a',
        change({ orgId: 'org-a', entityId: `a-${i}`, updatedAt: at(10 + i) }),
      );
    }

    const aRows = await store.listPending('org-a');
    expect(aRows).toHaveLength(3);
    expect(aRows.map((r) => r.change.entityId)).toEqual(['a-4', 'a-5', 'a-6']);

    acting = 'org-b';
    const bRows = await store.listPending('org-b');
    expect(bRows).toHaveLength(2);
    expect(bRows.map((r) => r.change.entityId)).toEqual(['b-1', 'b-2']);
  });

  it('survives a restart with both organizations’ rows intact and still separate', async () => {
    const first = createPersistentSyncStore({
      filePath,
      applyLocal,
      maxPendingPerOrg: 3,
    }).bindScope(scope);
    await first.load();
    acting = 'org-a';
    for (let i = 1; i <= 4; i += 1) {
      await first.enqueue('org-a', change({ orgId: 'org-a', entityId: `a-${i}`, updatedAt: at(i) }));
    }
    acting = 'org-b';
    await first.enqueue('org-b', change({ orgId: 'org-b', entityId: 'b-1', updatedAt: at(9) }));

    const reopened = createPersistentSyncStore({
      filePath,
      applyLocal,
      maxPendingPerOrg: 3,
    }).bindScope(scope);
    await reopened.load();

    acting = 'org-a';
    expect((await reopened.listPending('org-a')).map((r) => r.change.entityId)).toEqual([
      'a-2',
      'a-3',
      'a-4',
    ]);
    expect(await reopened.listPending('org-b')).toEqual([]); // still not A's to read
    acting = 'org-b';
    expect((await reopened.listPending('org-b')).map((r) => r.change.entityId)).toEqual(['b-1']);
  });
});
