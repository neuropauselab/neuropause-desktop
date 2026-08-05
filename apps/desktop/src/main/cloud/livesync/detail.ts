/**
 * The pure projection behind `livesync:detail` — the Cloud → Sync panel's view of the
 * REAL engine. It folds the engine's own two sources of truth (the durable outbound
 * queue and the local mirror of reconciled records) into one row per syncable entity
 * type. Nothing here is estimated or simulated: `pending` is the queue, `synced` is
 * the mirror, `lastChangeAt` is the newest `updatedAt` across both.
 *
 * Every entity type in SYNC_ENTITY_TYPES is always emitted, in the canonical order,
 * so the table has stable rows rather than appearing and disappearing with traffic.
 */
import { SYNC_ENTITY_TYPES } from '@neuropause/shared';
import type {
  LiveSyncConflict,
  LiveSyncDetail,
  LiveSyncEntityState,
  LiveSyncStatus,
  SyncEntityType,
  SyncRecord,
} from '@neuropause/shared';
import type { QueuedChange } from './types';

export interface LiveSyncDetailInput {
  status: LiveSyncStatus;
  orgId: string | null;
  deviceId: string;
  /** Outbound changes still queued for the active org. */
  pending: readonly QueuedChange[];
  /** Records reconciled into the local mirror for the active org. */
  mirrored: readonly SyncRecord[];
  /** Conflicts the engine resolved, newest first. */
  conflicts: readonly LiveSyncConflict[];
}

/** The newer of two ISO timestamps; either may be null. */
function newer(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b ? a : b;
}

/** One row per syncable entity type, in canonical order. */
export function projectEntityStates(
  pending: readonly QueuedChange[],
  mirrored: readonly SyncRecord[],
): LiveSyncEntityState[] {
  const rows = new Map<SyncEntityType, LiveSyncEntityState>(
    SYNC_ENTITY_TYPES.map((entityType) => [
      entityType,
      { entityType, pending: 0, synced: 0, lastChangeAt: null },
    ]),
  );

  for (const { change } of pending) {
    const row = rows.get(change.entityType);
    if (!row) continue; // an entity type this build does not know — ignore, never crash
    row.pending += 1;
    row.lastChangeAt = newer(row.lastChangeAt, change.updatedAt);
  }

  for (const record of mirrored) {
    const row = rows.get(record.entityType);
    if (!row) continue;
    row.synced += 1;
    row.lastChangeAt = newer(row.lastChangeAt, record.updatedAt);
  }

  return [...rows.values()];
}

/** Compose the full detail payload the renderer consumes. */
export function projectLiveSyncDetail(input: LiveSyncDetailInput): LiveSyncDetail {
  return {
    status: input.status,
    orgId: input.orgId,
    deviceId: input.deviceId,
    entities: projectEntityStates(input.pending, input.mirrored),
    conflicts: [...input.conflicts],
  };
}
