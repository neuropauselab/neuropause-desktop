import type { SyncEntityType, SyncRecord } from '@neuropause/shared';

/** A stored sync record — the shared record plus server-only fields. */
export interface StoredSyncRecord<T = unknown> extends SyncRecord<T> {
  /** Global monotonic sequence assigned on each write; drives pull cursors. */
  seq: number;
  /** The device that last wrote this record (used to avoid echoing on pull). */
  deviceId: string | null;
}

export interface ApplyChangeInput {
  orgId: string;
  entityType: SyncEntityType;
  entityId: string;
  version: number;
  updatedAt: string;
  deleted: boolean;
  data: unknown;
  deviceId: string | null;
}

export interface ChangesSinceOptions {
  entityTypes?: SyncEntityType[];
  limit?: number;
  /** Exclude changes last written by this device (prevents echo). */
  excludeDeviceId?: string | null;
}

export interface ChangesSinceResult {
  changes: StoredSyncRecord[];
  cursor: number;
  hasMore: boolean;
}

export interface SyncRepository {
  getRecord(
    orgId: string,
    entityType: SyncEntityType,
    entityId: string,
  ): Promise<StoredSyncRecord | null>;
  applyChange(input: ApplyChangeInput): Promise<StoredSyncRecord>;
  changesSince(
    orgId: string,
    cursor: number,
    opts?: ChangesSinceOptions,
  ): Promise<ChangesSinceResult>;
  /** The current high-water mark (max seq) for an org, or 0 if none. */
  currentCursor(orgId: string): Promise<number>;
}
