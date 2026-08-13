import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SyncChange, TenantScope } from '@neuropause/shared';
import { createLiveSyncService, type LiveSyncService } from './liveSyncService';
import type { SyncTransport } from './types';

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

describe('createLiveSyncService', () => {
  let storePath: string;
  let mirrorPath: string;
  let pushed: SyncChange[][];
  let svc: LiveSyncService;
  /** Who the test is acting as. Bound as the service's tenant seam. */
  let acting: string | null;
  const scope = (): TenantScope | null =>
    acting === null ? null : { tenantId: acting, workspaceId: '' };

  const transport: SyncTransport = {
    async push(_orgId, _deviceId, changes) {
      pushed.push(changes);
      return {
        results: changes.map((c) => ({
          entityType: c.entityType,
          entityId: c.entityId,
          status: 'applied' as const,
          serverVersion: c.version,
          serverUpdatedAt: c.updatedAt,
        })),
        cursor: 0,
      };
    },
    async pull(orgId) {
      return {
        changes: [change({ orgId, entityId: 'remote', version: 3, data: { landed: true } })],
        cursor: 8,
        hasMore: false,
      };
    },
  };

  beforeEach(async () => {
    storePath = join(tmpdir(), `nps-svc-store-${randomUUID()}.json`);
    mirrorPath = join(tmpdir(), `nps-svc-mirror-${randomUUID()}.json`);
    pushed = [];
    acting = 'org-1';
    svc = createLiveSyncService({
      deviceId: 'devA',
      storeFilePath: storePath,
      mirrorFilePath: mirrorPath,
      transport,
      getActiveOrgId: () => 'org-1',
      scope,
      intervalMs: 999_999,
    });
    await svc.init();
  });
  afterEach(async () => {
    svc.stop();
    for (const p of [storePath, mirrorPath]) {
      await fs.rm(p, { force: true });
      await fs.rm(`${p}.tmp`, { force: true });
    }
  });

  it('enqueues a local change, pushes it, and lands pulled data in the mirror on syncNow', async () => {
    await svc.enqueue('org-1', change());
    const status = await svc.syncNow();
    expect(status.state).toBe('idle');
    expect(pushed[0]).toHaveLength(1);
    expect(svc.read('org-1', 'org_prefs', 'remote')?.data).toEqual({ landed: true });
  });

  it('reads and lists synced records from the mirror', async () => {
    await svc.syncNow();
    expect(svc.list('org-1')).toHaveLength(1);
    expect(svc.read('org-1', 'org_prefs', 'remote')).not.toBeNull();
  });

  it('start / stop toggles the scheduler', () => {
    expect(svc.isRunning()).toBe(false);
    svc.start();
    expect(svc.isRunning()).toBe(true);
    svc.stop();
    expect(svc.isRunning()).toBe(false);
  });

  it('exposes the current engine status', () => {
    expect(svc.getStatus().state).toBe('idle');
  });

  /* ── P13C ROUND 9 — F3. The reads are the CALLER'S. ─────────────────────── */

  it('status, detail and the cursor answer the CALLER, not the device pointer', async () => {
    await svc.enqueue('org-1', change());
    await svc.syncNow();
    expect(svc.getStatus().cursor).toBe(8);
    expect(svc.getDetail().orgId).toBe('org-1');
    expect(svc.getDetail().entities.some((e) => e.synced > 0)).toBe(true);

    // The device pointer still says org-1 — that is exactly the stale-pointer
    // case. A caller from another organization must see nothing of org-1's.
    acting = 'org-2';
    const status = svc.getStatus();
    expect(status.cursor).toBe(0);
    expect(status.pendingCount).toBe(0);
    expect(status.lastSyncedAt).toBeNull();

    const detail = svc.getDetail();
    expect(detail.orgId).toBe('org-2');
    expect(detail.entities.every((e) => e.pending === 0 && e.synced === 0)).toBe(true);
    expect(detail.conflicts).toEqual([]);
    expect(svc.list('org-1')).toEqual([]);
    expect(svc.read('org-1', 'org_prefs', 'remote')).toBeNull();
  });

  it('a caller with no organization sees the empty status, never the last one’s', async () => {
    await svc.enqueue('org-1', change());
    await svc.syncNow();
    acting = null;
    expect(svc.getStatus()).toMatchObject({ cursor: 0, pendingCount: 0, lastSyncedAt: null });
    expect(svc.getDetail().orgId).toBeNull();
    expect(svc.setOnline(false)).toMatchObject({ cursor: 0 });
  });

  it('B cannot enqueue into A’s queue through the service', async () => {
    acting = 'org-2';
    await expect(svc.enqueue('org-1', change())).rejects.toThrow(/not the active organization/i);
    acting = 'org-1';
    expect(svc.getStatus().pendingCount).toBe(0);
  });

  it('the cycle carries the org’s principal, while an entity applier runs outside it', async () => {
    const { currentPrincipal } = await import('../../tenancy/backgroundPrincipal');
    const seen: { where: string; tenant: string | null }[] = [];
    const applierPath = createLiveSyncService({
      deviceId: 'devA',
      storeFilePath: join(tmpdir(), `nps-svc-store-${randomUUID()}.json`),
      mirrorFilePath: join(tmpdir(), `nps-svc-mirror-${randomUUID()}.json`),
      transport: {
        push: transport.push,
        async pull(orgId, cursor, o) {
          seen.push({ where: 'transport', tenant: currentPrincipal()?.tenantId ?? null });
          return transport.pull(orgId, cursor, o);
        },
      },
      getActiveOrgId: () => 'org-1',
      scope,
      intervalMs: 999_999,
      entityAppliers: {
        org_prefs: async () => {
          seen.push({ where: 'applier', tenant: currentPrincipal()?.tenantId ?? null });
          return 'applied';
        },
      },
    });
    await applierPath.init();
    await applierPath.syncNow();
    applierPath.stop();

    // The transport leg runs AS the organization; the memory-style applier, which
    // resolves its own viewer and needs a workspace/identity the org-level
    // principal does not carry, runs outside it.
    expect(seen).toEqual([
      { where: 'transport', tenant: 'org-1' },
      { where: 'applier', tenant: null },
    ]);
  });

  it('pausing is per organization: A’s pause does not stop B’s sync', async () => {
    acting = 'org-1';
    svc.setOnline(false);
    expect(svc.getStatus().state).toBe('offline');
    await svc.enqueue('org-1', change());
    await svc.syncNow();
    expect(pushed).toHaveLength(0); // A is paused, nothing left the device

    acting = 'org-2';
    expect(svc.getStatus().state).toBe('idle'); // B was never paused
    await svc.enqueue('org-2', change({ orgId: 'org-2' }));
    await svc.syncNow();
    expect(pushed).toHaveLength(1);
    expect(pushed[0][0].orgId).toBe('org-2');

    // …and A is still paused with its own edit still queued locally.
    acting = 'org-1';
    expect(svc.getStatus().state).toBe('offline');
    expect(svc.getStatus().pendingCount).toBe(1);
  });
});
