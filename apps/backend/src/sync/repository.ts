import type { SyncEntityType } from '@neuropause/shared';
import { query } from '../db/pool';
import type {
  ApplyChangeInput,
  ChangesSinceOptions,
  ChangesSinceResult,
  StoredSyncRecord,
  SyncRepository,
} from './types';

interface Row {
  org_id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  version: number;
  updated_at: Date;
  deleted: boolean;
  data: unknown;
  device_id: string | null;
  seq: string; // BIGINT arrives as string
}

function toRecord(r: Row): StoredSyncRecord {
  return {
    orgId: r.org_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    version: r.version,
    updatedAt: r.updated_at.toISOString(),
    deleted: r.deleted,
    data: r.data ?? null,
    deviceId: r.device_id,
    seq: Number(r.seq),
  };
}

export function createPgSyncRepository(): SyncRepository {
  return {
    async getRecord(orgId, entityType, entityId) {
      const { rows } = await query<Row>(
        'SELECT * FROM sync_state WHERE org_id = $1 AND entity_type = $2 AND entity_id = $3',
        [orgId, entityType, entityId],
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async applyChange(input: ApplyChangeInput): Promise<StoredSyncRecord> {
      const data =
        input.data === null || input.data === undefined ? null : JSON.stringify(input.data);
      const { rows } = await query<Row>(
        `INSERT INTO sync_state
           (org_id, entity_type, entity_id, version, updated_at, deleted, data, device_id, seq)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, nextval('sync_state_seq'))
         ON CONFLICT (org_id, entity_type, entity_id) DO UPDATE SET
           version = EXCLUDED.version,
           updated_at = EXCLUDED.updated_at,
           deleted = EXCLUDED.deleted,
           data = EXCLUDED.data,
           device_id = EXCLUDED.device_id,
           seq = nextval('sync_state_seq')
         RETURNING *`,
        [
          input.orgId,
          input.entityType,
          input.entityId,
          input.version,
          input.updatedAt,
          input.deleted,
          data,
          input.deviceId,
        ],
      );
      return toRecord(rows[0]);
    },

    async changesSince(orgId, cursor, opts: ChangesSinceOptions = {}): Promise<ChangesSinceResult> {
      const limit = Math.min(opts.limit ?? 500, 1000);
      const params: unknown[] = [orgId, cursor];
      let sql = 'SELECT * FROM sync_state WHERE org_id = $1 AND seq > $2';
      if (opts.entityTypes && opts.entityTypes.length > 0) {
        params.push(opts.entityTypes);
        sql += ` AND entity_type = ANY($${params.length})`;
      }
      if (opts.excludeDeviceId) {
        params.push(opts.excludeDeviceId);
        sql += ` AND device_id IS DISTINCT FROM $${params.length}`;
      }
      params.push(limit + 1);
      sql += ` ORDER BY seq ASC LIMIT $${params.length}`;
      const { rows } = await query<Row>(sql, params);
      const hasMore = rows.length > limit;
      const page = (hasMore ? rows.slice(0, limit) : rows).map(toRecord);
      const newCursor = page.length > 0 ? page[page.length - 1].seq : cursor;
      return { changes: page, cursor: newCursor, hasMore };
    },

    async currentCursor(orgId) {
      const { rows } = await query<{ max: string | null }>(
        'SELECT MAX(seq)::text AS max FROM sync_state WHERE org_id = $1',
        [orgId],
      );
      return rows[0]?.max ? Number(rows[0].max) : 0;
    },
  };
}
