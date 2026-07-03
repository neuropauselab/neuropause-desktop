import type { SyncEntityType } from '@neuropause/shared';
import type {
  ApplyChangeInput,
  ChangesSinceResult,
  ChangesSinceOptions,
  StoredSyncRecord,
  SyncRepository,
} from './types';

/** An in-memory SyncRepository for unit tests and local development. */
export function createMemorySyncRepository(): SyncRepository {
  const key = (orgId: string, t: SyncEntityType, id: string): string => `${orgId}:${t}:${id}`;
  const store = new Map<string, StoredSyncRecord>();
  let seq = 0;

  return {
    async getRecord(orgId, entityType, entityId) {
      return store.get(key(orgId, entityType, entityId)) ?? null;
    },

    async applyChange(input: ApplyChangeInput): Promise<StoredSyncRecord> {
      seq += 1;
      const record: StoredSyncRecord = {
        entityType: input.entityType,
        entityId: input.entityId,
        orgId: input.orgId,
        version: input.version,
        updatedAt: input.updatedAt,
        deleted: input.deleted,
        data: input.data ?? null,
        deviceId: input.deviceId,
        seq,
      };
      store.set(key(input.orgId, input.entityType, input.entityId), record);
      return record;
    },

    async changesSince(orgId, cursor, opts: ChangesSinceOptions = {}): Promise<ChangesSinceResult> {
      const limit = opts.limit ?? 500;
      let rows = [...store.values()].filter((r) => r.orgId === orgId && r.seq > cursor);
      if (opts.entityTypes && opts.entityTypes.length > 0) {
        const set = new Set(opts.entityTypes);
        rows = rows.filter((r) => set.has(r.entityType));
      }
      if (opts.excludeDeviceId) {
        rows = rows.filter((r) => r.deviceId !== opts.excludeDeviceId);
      }
      rows.sort((a, b) => a.seq - b.seq);
      const page = rows.slice(0, limit);
      const hasMore = rows.length > limit;
      const newCursor = page.length > 0 ? page[page.length - 1].seq : cursor;
      return { changes: page, cursor: newCursor, hasMore };
    },

    async currentCursor(orgId) {
      let max = 0;
      for (const r of store.values()) if (r.orgId === orgId && r.seq > max) max = r.seq;
      return max;
    },
  };
}
