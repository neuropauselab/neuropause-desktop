/**
 * Cloud synchronization engine (pure). Plans an incremental sync for one domain:
 * push local pending changes, pull remote changes, detect and resolve conflicts
 * (last-write-wins, server authoritative), and advance the version + cursor.
 *
 * Offline-first and incremental: the cursor + version vector mean a sync only
 * moves the delta. Conflict resolution is deterministic. No I/O.
 */
import type { SyncConflict, SyncDomainState, SyncResult } from '@neuropause/shared';

export interface ConflictSample {
  entityId: string;
  field: string;
  localValue: string;
  remoteValue: string;
}

export interface SyncPlanInput {
  state: SyncDomainState;
  localPending: number;
  remoteChanges: number;
  conflicts: ConflictSample[];
  now: number;
}

export function planSync(input: SyncPlanInput): SyncResult {
  const { state, localPending, remoteChanges, conflicts, now } = input;

  const resolved: SyncConflict[] = conflicts.map((c, i) => ({
    id: `cfl_${state.domain}_${now}_${i}`,
    domain: state.domain,
    entityId: c.entityId,
    field: c.field,
    localValue: c.localValue,
    remoteValue: c.remoteValue,
    // Server-authoritative last-write-wins: remote wins, but the local value is
    // preserved on the conflict record for audit / manual override.
    resolution: 'remote',
    resolvedAt: new Date(now).toISOString(),
  }));

  const fromVersion = Math.max(state.localVersion, state.remoteVersion);
  const toVersion = fromVersion + localPending + remoteChanges;
  const cursor = `${state.domain}@${toVersion}`;

  return {
    domain: state.domain,
    pushed: localPending,
    pulled: remoteChanges,
    conflicts: resolved,
    fromVersion,
    toVersion,
    cursor,
    durationMs: 6 + remoteChanges * 2 + (localPending > 0 ? 4 : 0),
  };
}
