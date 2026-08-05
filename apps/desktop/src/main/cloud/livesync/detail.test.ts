import { describe, expect, it } from 'vitest';
import { SYNC_ENTITY_TYPES } from '@neuropause/shared';
import type {
  LiveSyncConflict,
  LiveSyncStatus,
  SyncEntityType,
  SyncRecord,
} from '@neuropause/shared';
import type { QueuedChange } from './types';
import { projectEntityStates, projectLiveSyncDetail } from './detail';

function record(
  entityType: SyncEntityType,
  entityId: string,
  updatedAt: string,
  over: Partial<SyncRecord> = {},
): SyncRecord {
  return {
    entityType,
    entityId,
    orgId: 'org-1',
    version: 1,
    updatedAt,
    deleted: false,
    data: { name: entityId },
    ...over,
  };
}

function queued(entityType: SyncEntityType, entityId: string, updatedAt: string): QueuedChange {
  return {
    queueId: `q-${entityType}-${entityId}`,
    change: record(entityType, entityId, updatedAt),
  };
}

function status(over: Partial<LiveSyncStatus> = {}): LiveSyncStatus {
  return {
    state: 'idle',
    online: true,
    pendingCount: 0,
    failures: 0,
    lastError: null,
    lastSyncedAt: null,
    cursor: 0,
    ...over,
  };
}

describe('projectEntityStates', () => {
  it('emits one row per syncable entity type in canonical order, even with no traffic', () => {
    const rows = projectEntityStates([], []);
    expect(rows.map((r) => r.entityType)).toEqual([...SYNC_ENTITY_TYPES]);
    expect(rows.every((r) => r.pending === 0 && r.synced === 0 && r.lastChangeAt === null)).toBe(
      true,
    );
  });

  it('counts queued changes as pending and mirrored records as synced', () => {
    const rows = projectEntityStates(
      [
        queued('organization', 'org-1', '2026-01-01T10:00:00.000Z'),
        queued('membership', 'mem-1', '2026-01-01T11:00:00.000Z'),
        queued('membership', 'mem-2', '2026-01-01T12:00:00.000Z'),
      ],
      [
        record('organization', 'org-1', '2026-01-01T09:00:00.000Z'),
        record('memory', 'mem-note-1', '2026-01-02T09:00:00.000Z'),
        record('memory', 'mem-note-2', '2026-01-02T08:00:00.000Z'),
      ],
    );
    const byType = Object.fromEntries(rows.map((r) => [r.entityType, r]));
    expect(byType.organization).toMatchObject({ pending: 1, synced: 1 });
    expect(byType.membership).toMatchObject({ pending: 2, synced: 0 });
    expect(byType.memory).toMatchObject({ pending: 0, synced: 2 });
    expect(byType.org_prefs).toMatchObject({ pending: 0, synced: 0 });
  });

  it('reports the newest timestamp across both the queue and the mirror', () => {
    const rows = projectEntityStates(
      [queued('organization', 'org-1', '2026-03-01T10:00:00.000Z')],
      [
        record('organization', 'org-1', '2026-03-01T08:00:00.000Z'),
        record('organization', 'org-2', '2026-03-01T09:30:00.000Z'),
      ],
    );
    const org = rows.find((r) => r.entityType === 'organization')!;
    expect(org.lastChangeAt).toBe('2026-03-01T10:00:00.000Z');
  });

  it('takes the mirror timestamp when the mirror is newer than the queue', () => {
    const rows = projectEntityStates(
      [queued('connector_config', 'slack', '2026-03-01T06:00:00.000Z')],
      [record('connector_config', 'notion', '2026-03-01T18:00:00.000Z')],
    );
    const cfg = rows.find((r) => r.entityType === 'connector_config')!;
    expect(cfg.lastChangeAt).toBe('2026-03-01T18:00:00.000Z');
  });

  it('counts tombstones in the mirror like any other reconciled record', () => {
    const rows = projectEntityStates(
      [],
      [
        record('workspace_settings', 'ws-1', '2026-03-01T10:00:00.000Z', {
          deleted: true,
          data: null,
        }),
      ],
    );
    const ws = rows.find((r) => r.entityType === 'workspace_settings')!;
    expect(ws).toMatchObject({ synced: 1, pending: 0, lastChangeAt: '2026-03-01T10:00:00.000Z' });
  });

  it('ignores an entity type this build does not know rather than crashing', () => {
    const alien = { entityType: 'quantum_ledger' as SyncEntityType, entityId: 'x-1' };
    const rows = projectEntityStates(
      [
        {
          queueId: 'q-alien',
          change: record(alien.entityType, alien.entityId, '2026-03-01T10:00:00.000Z'),
        },
      ],
      [record(alien.entityType, alien.entityId, '2026-03-01T10:00:00.000Z')],
    );
    expect(rows).toHaveLength(SYNC_ENTITY_TYPES.length);
    expect(rows.some((r) => r.entityType === alien.entityType)).toBe(false);
    expect(rows.every((r) => r.pending === 0 && r.synced === 0)).toBe(true);
  });
});

describe('projectLiveSyncDetail', () => {
  it('composes status, identity, entity rows, and the conflict log', () => {
    const conflicts: LiveSyncConflict[] = [
      {
        entityType: 'org_prefs',
        entityId: 'prefs-1',
        direction: 'pull',
        resolution: 'last_write_wins',
        at: '2026-03-01T10:00:00.000Z',
      },
    ];
    const detail = projectLiveSyncDetail({
      status: status({ pendingCount: 1, cursor: 42, lastSyncedAt: '2026-03-01T10:00:00.000Z' }),
      orgId: 'org-1',
      deviceId: 'device-abc-123',
      pending: [queued('org_prefs', 'prefs-1', '2026-03-01T11:00:00.000Z')],
      mirrored: [record('org_prefs', 'prefs-1', '2026-03-01T10:00:00.000Z')],
      conflicts,
    });

    expect(detail.orgId).toBe('org-1');
    expect(detail.deviceId).toBe('device-abc-123');
    expect(detail.status.cursor).toBe(42);
    expect(detail.entities).toHaveLength(SYNC_ENTITY_TYPES.length);
    expect(detail.conflicts).toEqual(conflicts);
    const prefs = detail.entities.find((e) => e.entityType === 'org_prefs')!;
    expect(prefs).toMatchObject({
      pending: 1,
      synced: 1,
      lastChangeAt: '2026-03-01T11:00:00.000Z',
    });
  });

  it('copies the conflict log instead of aliasing the engine’s array', () => {
    const conflicts: LiveSyncConflict[] = [];
    const detail = projectLiveSyncDetail({
      status: status(),
      orgId: null,
      deviceId: 'device-1',
      pending: [],
      mirrored: [],
      conflicts,
    });
    conflicts.push({
      entityType: 'memory',
      entityId: 'm-1',
      direction: 'push',
      resolution: 'last_write_wins',
      at: '2026-03-01T10:00:00.000Z',
    });
    expect(detail.conflicts).toHaveLength(0);
  });

  it('is well-formed with no active organization', () => {
    const detail = projectLiveSyncDetail({
      status: status({ state: 'offline', online: false }),
      orgId: null,
      deviceId: 'device-1',
      pending: [],
      mirrored: [],
      conflicts: [],
    });
    expect(detail.orgId).toBeNull();
    expect(detail.status.state).toBe('offline');
    expect(detail.entities.map((e) => e.entityType)).toEqual([...SYNC_ENTITY_TYPES]);
  });
});
