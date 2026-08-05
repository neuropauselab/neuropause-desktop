/**
 * Ports and status types for the live cloud-sync engine — the real, record-level
 * client that talks to the backend sync API (POST /sync/:orgId/push,
 * GET /sync/:orgId/pull) using the shared sync model.
 *
 * This supersedes the earlier `cloud/sync` simulation (planSync + the domain-level
 * SyncStore), which modelled the sync UX locally before the real backend existed.
 * The engine here treats transport and storage as injected ports so it is fully
 * unit-testable; the concrete HTTP transport and persisted store are wired in a
 * later step.
 */
import type {
  MergeOutcome,
  SyncChange,
  SyncEntityType,
  SyncPullResponse,
  SyncPushResponse,
} from '@neuropause/shared';

/** Transport to the cloud sync API (implemented over HTTP in wiring). */
export interface SyncTransport {
  push(orgId: string, deviceId: string, changes: SyncChange[]): Promise<SyncPushResponse>;
  pull(
    orgId: string,
    cursor: number,
    opts: { deviceId: string; limit?: number; entityTypes?: SyncEntityType[] },
  ): Promise<SyncPullResponse>;
}

/** A change queued for outbound push, tagged with a local queue id. */
export interface QueuedChange {
  queueId: string;
  change: SyncChange;
}

/**
 * Local persistence for the sync engine: the outbound queue, the pull cursor, and
 * applying pulled changes to the local stores. The engine treats it as an opaque
 * port; the concrete implementation lives over the encrypted local store.
 */
export interface SyncStore {
  listPending(orgId: string): Promise<QueuedChange[]>;
  removePending(orgId: string, queueIds: string[]): Promise<void>;
  getCursor(orgId: string): Promise<number>;
  setCursor(orgId: string, cursor: number): Promise<void>;
  /** Apply a pulled remote change locally (resolving against the local copy via the
   *  shared resolveSync) and report the outcome. */
  applyRemote(change: SyncChange): Promise<MergeOutcome>;
}

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  online: boolean;
  pendingCount: number;
  failures: number;
  lastError: string | null;
  lastSyncedAt: string | null;
  cursor: number;
}

/**
 * Identity of a conflict resolved during a cycle. `direction` records which leg
 * surfaced it: `push` when the server reported a conflicting write, `pull` when an
 * incoming change tied with the local copy. Timestamping is left to the engine,
 * which owns the clock.
 */
export interface SyncConflictRef {
  entityType: SyncEntityType;
  entityId: string;
  direction: 'push' | 'pull';
}

export interface SyncCycleResult {
  pushed: number;
  pulled: number;
  /** Always `conflictRefs.length`; kept as a scalar for callers that only count. */
  conflicts: number;
  cursor: number;
  conflictRefs: SyncConflictRef[];
}
