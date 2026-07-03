import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SyncChange } from '@neuropause/shared';
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
    async pull() {
      return {
        changes: [change({ entityId: 'remote', version: 3, data: { landed: true } })],
        cursor: 8,
        hasMore: false,
      };
    },
  };

  beforeEach(async () => {
    storePath = join(tmpdir(), `nps-svc-store-${randomUUID()}.json`);
    mirrorPath = join(tmpdir(), `nps-svc-mirror-${randomUUID()}.json`);
    pushed = [];
    svc = createLiveSyncService({
      deviceId: 'devA',
      storeFilePath: storePath,
      mirrorFilePath: mirrorPath,
      transport,
      getActiveOrgId: () => 'org-1',
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
});
