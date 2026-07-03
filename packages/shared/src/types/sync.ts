/**
 * Cloud-sync model and conflict resolution, shared by the desktop sync engine and
 * the backend sync API so both sides converge on the same result. Only org-scoped,
 * non-private state syncs (see SyncEntityType); AI Memory, Timeline, and the
 * Knowledge Graph are local-first and never leave the device.
 *
 * Resolution is last-write-wins keyed on a per-record monotonic `version`, with the
 * wall-clock `updatedAt` as a tiebreak. This converges deterministically but does
 * not field-merge truly concurrent edits — an acceptable tradeoff for small
 * settings records. Field-level merge (CRDTs / vector clocks) would be a later,
 * larger change.
 */

export type SyncEntityType =
  | 'organization'
  | 'membership'
  | 'workspace_settings'
  | 'connected_account'
  | 'connector_config'
  | 'org_prefs';

export const SYNC_ENTITY_TYPES: readonly SyncEntityType[] = [
  'organization',
  'membership',
  'workspace_settings',
  'connected_account',
  'connector_config',
  'org_prefs',
];

/** A monotonic high-water mark; the client has seen every change up to this value. */
export type SyncCursor = number;

/**
 * A snapshot of one syncable record. `version` is a per-record counter bumped on
 * every write; `updatedAt` is the wall-clock time of that write. `deleted` is a
 * tombstone so deletions propagate. `data` is the entity payload, opaque to the
 * sync core, and null for tombstones.
 */
export interface SyncRecord<T = unknown> {
  entityType: SyncEntityType;
  entityId: string;
  orgId: string;
  version: number;
  updatedAt: string;
  deleted: boolean;
  data: T | null;
}

/** A change is simply a record snapshot moving in either direction. */
export type SyncChange<T = unknown> = SyncRecord<T>;

export type ConflictStrategy = 'last_write_wins';
export const DEFAULT_CONFLICT_STRATEGY: ConflictStrategy = 'last_write_wins';

/** How an incoming change was reconciled against the current record. */
export type MergeOutcome = 'applied' | 'ignored' | 'conflict';

export interface SyncPushRequest {
  deviceId: string;
  changes: SyncChange[];
}

export type PushItemStatus = 'applied' | 'stale' | 'conflict';

export interface SyncPushItemResult {
  entityType: SyncEntityType;
  entityId: string;
  status: PushItemStatus;
  serverVersion: number;
  serverUpdatedAt: string;
}

export interface SyncPushResponse {
  results: SyncPushItemResult[];
  cursor: SyncCursor;
}

export interface SyncPullRequest {
  orgId: string;
  cursor: SyncCursor;
  entityTypes?: SyncEntityType[];
  limit?: number;
}

export interface SyncPullResponse {
  changes: SyncChange[];
  cursor: SyncCursor;
  hasMore: boolean;
}

/** Whether a record is a tombstone (a propagated deletion). */
export function isTombstone(record: SyncRecord): boolean {
  return record.deleted;
}

/** The version a local write should carry, given the current record (if any). */
export function nextSyncVersion(current: SyncRecord | null): number {
  return (current?.version ?? 0) + 1;
}

/**
 * Order two records by recency: version first (monotonic per record), then
 * updatedAt to separate concurrent writers. Returns -1 if `a` is older, 1 if `a`
 * is newer, 0 if they share a version and timestamp.
 */
export function compareSyncRecords(a: SyncRecord, b: SyncRecord): number {
  if (a.version !== b.version) return a.version < b.version ? -1 : 1;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? -1 : 1;
  return 0;
}

function deterministicWinner<T>(a: SyncRecord<T>, b: SyncRecord<T>): SyncRecord<T> {
  // Exact version + timestamp tie with differing data: converge by comparing the
  // serialized payloads so every device selects the same winner.
  return JSON.stringify(a.data ?? null) >= JSON.stringify(b.data ?? null) ? a : b;
}

/**
 * Reconcile an incoming change against the current record. With no current record
 * the incoming change is applied. Otherwise the strictly-newer side wins; an exact
 * version+timestamp tie with differing data is a genuine concurrent conflict,
 * resolved deterministically so both devices converge.
 */
export function resolveSync<T>(
  current: SyncRecord<T> | null,
  incoming: SyncRecord<T>,
): { winner: SyncRecord<T>; outcome: MergeOutcome } {
  if (!current) return { winner: incoming, outcome: 'applied' };
  const cmp = compareSyncRecords(current, incoming);
  if (cmp < 0) return { winner: incoming, outcome: 'applied' };
  if (cmp > 0) return { winner: current, outcome: 'ignored' };
  return { winner: deterministicWinner(current, incoming), outcome: 'conflict' };
}
