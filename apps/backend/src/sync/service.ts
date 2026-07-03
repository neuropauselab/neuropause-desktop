/**
 * The server-side sync service. `pushChanges` reconciles a batch of client changes
 * against stored state using the shared `resolveSync` (last-write-wins), writing the
 * winner — and advancing the global seq — only when it differs from what is stored.
 * `pullChanges` returns an org's changes above a cursor, excluding the caller's own
 * device so it isn't echoed its own writes.
 */
import type {
  SyncChange,
  SyncEntityType,
  SyncPushItemResult,
  SyncPushResponse,
  SyncRecord,
} from '@neuropause/shared';
import { resolveSync } from '@neuropause/shared';
import type { StoredSyncRecord, SyncRepository } from './types';

function toSyncRecord(stored: StoredSyncRecord | null): SyncRecord | null {
  if (!stored) return null;
  return {
    entityType: stored.entityType,
    entityId: stored.entityId,
    orgId: stored.orgId,
    version: stored.version,
    updatedAt: stored.updatedAt,
    deleted: stored.deleted,
    data: stored.data,
  };
}

function toChange(stored: StoredSyncRecord): SyncChange {
  return {
    entityType: stored.entityType,
    entityId: stored.entityId,
    orgId: stored.orgId,
    version: stored.version,
    updatedAt: stored.updatedAt,
    deleted: stored.deleted,
    data: stored.data,
  };
}

export async function pushChanges(
  repo: SyncRepository,
  orgId: string,
  deviceId: string,
  changes: SyncChange[],
): Promise<SyncPushResponse> {
  const results: SyncPushItemResult[] = [];

  for (const incoming of changes) {
    const current = toSyncRecord(
      await repo.getRecord(orgId, incoming.entityType, incoming.entityId),
    );
    // Force the change into the route's org scope regardless of what the client sent.
    const scoped: SyncRecord = { ...incoming, orgId };
    const { winner, outcome } = resolveSync(current, scoped);
    const changed = winner !== current;

    if (changed) {
      const stored = await repo.applyChange({
        orgId,
        entityType: winner.entityType,
        entityId: winner.entityId,
        version: winner.version,
        updatedAt: winner.updatedAt,
        deleted: winner.deleted,
        data: winner.data,
        deviceId,
      });
      results.push({
        entityType: stored.entityType,
        entityId: stored.entityId,
        status: outcome === 'conflict' ? 'conflict' : 'applied',
        serverVersion: stored.version,
        serverUpdatedAt: stored.updatedAt,
      });
    } else {
      results.push({
        entityType: incoming.entityType,
        entityId: incoming.entityId,
        status: outcome === 'conflict' ? 'conflict' : 'stale',
        serverVersion: current ? current.version : incoming.version,
        serverUpdatedAt: current ? current.updatedAt : incoming.updatedAt,
      });
    }
  }

  const cursor = await repo.currentCursor(orgId);
  return { results, cursor };
}

export async function pullChanges(
  repo: SyncRepository,
  orgId: string,
  cursor: number,
  opts: { entityTypes?: SyncEntityType[]; limit?: number; deviceId?: string } = {},
): Promise<{ changes: SyncChange[]; cursor: number; hasMore: boolean }> {
  const res = await repo.changesSince(orgId, cursor, {
    entityTypes: opts.entityTypes,
    limit: opts.limit,
    excludeDeviceId: opts.deviceId ?? null,
  });
  return { changes: res.changes.map(toChange), cursor: res.cursor, hasMore: res.hasMore };
}
