/**
 * The live cloud-sync engine. Deliberately timer-free: `syncOnce` runs a single
 * cycle (push pending, then pull + apply until caught up) and updates observable
 * status, and `nextRetryDelay` reports how long to wait after failures. A thin
 * scheduler wired to the app lifecycle decides *when* to call syncOnce — which keeps
 * the engine fully unit-testable without fake timers.
 *
 * P13C ROUND 9 — F3. THE ENGINE'S STATE IS PER ORGANIZATION.
 *
 * Every field below used to be a single scalar on the engine: one `cursor`, one
 * `pendingCount`, one `failures`, one `paused`, one conflict log. The engine
 * serves whichever organization the scheduler last pointed it at, and its status
 * is read on `livesync:status` and `livesync:detail` (both `cloud:read`), folded
 * into the Cloud admin overview as `syncOps30d`, and into the control-plane
 * projection. So:
 *
 *   - one organization's applied-change cursor and backlog were shown to every
 *     other organization signed in on the machine;
 *   - one organization's conflict log — entity types and entity ids — was
 *     surfaced to all of them, capped install-wide so a conflict storm in A
 *     evicted B's conflict evidence;
 *   - `setPaused` was the EGRESS TOGGLE: `cloud:manage` is held by each
 *     organization's own administrator, so A's admin could stop B's sync, and
 *     worse could RESUME it after B's admin had stopped it.
 *
 * The state is now keyed by organization, so all five of those become answers
 * about the asking organization only. The keying is not the boundary by itself —
 * the store's seam is — but it is what stops one organization's numbers from
 * being reported as another's.
 */
import {
  classifyError,
  computeBackoff,
  DEFAULT_BACKOFF,
  type BackoffOptions,
  type SyncErrorKind,
} from './backoff';
import type { LiveSyncConflict } from '@neuropause/shared';
import type {
  SyncConflictRef,
  SyncCycleResult,
  SyncState,
  SyncStatus,
  SyncStore,
  SyncTransport,
} from './types';

const PULL_LIMIT = 200;
const MAX_PULL_PAGES = 50;
/**
 * Newest-first cap on the resolved-conflict log surfaced to the UI.
 *
 * PER ORGANIZATION. It was one log for the install, which made it a retention
 * cap one tenant could drive: 50 conflicts in A deleted every record of B's.
 */
const MAX_CONFLICT_LOG = 50;

/**
 * Run one full sync cycle: push pending outbound changes, then pull and apply remote
 * changes until caught up. All I/O is via the injected transport + store.
 */
export async function runSyncCycle(
  transport: SyncTransport,
  store: SyncStore,
  orgId: string,
  deviceId: string,
): Promise<SyncCycleResult> {
  let pushed = 0;
  const conflictRefs: SyncConflictRef[] = [];

  const pending = await store.listPending(orgId);
  if (pending.length > 0) {
    const resp = await transport.push(
      orgId,
      deviceId,
      pending.map((p) => p.change),
    );
    for (const r of resp.results) {
      if (r.status === 'conflict') {
        conflictRefs.push({ entityType: r.entityType, entityId: r.entityId, direction: 'push' });
      }
    }
    pushed = pending.length;
    // All pushed items are acknowledged; any stale/conflict is corrected on pull.
    await store.removePending(
      orgId,
      pending.map((p) => p.queueId),
    );
  }

  let pulled = 0;
  let cursor = await store.getCursor(orgId);
  for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
    const resp = await transport.pull(orgId, cursor, { deviceId, limit: PULL_LIMIT });
    for (const change of resp.changes) {
      /**
       * P13C ROUND 4 — THE RESPONSE IS NOT TRUSTED TO NAME ITS OWN ORGANIZATION.
       *
       * The pull is issued for `orgId`, and every returned change went straight
       * into `store.applyRemote`, which keys the local mirror on
       * `change.orgId`. So a response served on organization A's pull endpoint
       * could write into organization B's local namespace — inbound integrity
       * rather than egress, and it needs a malicious or buggy backend, which is
       * why this is not rated HIGH.
       *
       * The guard already existed one layer down for a single entity type:
       * `memoryLiveSyncBridge` refuses a change whose `orgId` differs from the
       * one it pulled for. Applying the same rule at the loop covers every
       * entity type instead of the one somebody remembered.
       *
       * P13C ROUND 9 — the store and the mirror now enforce the same rule at
       * their own seams, against the OWNER rather than against this argument.
       * This check stays: it is cheaper, it is closer to the response, and two
       * independent refusals is the point.
       */
      if (change.orgId !== orgId) continue;
      const outcome = await store.applyRemote(change);
      if (outcome === 'conflict') {
        conflictRefs.push({
          entityType: change.entityType,
          entityId: change.entityId,
          direction: 'pull',
        });
      }
      pulled += 1;
    }
    cursor = resp.cursor;
    await store.setCursor(orgId, cursor);
    if (!resp.hasMore) break;
  }

  return { pushed, pulled, conflicts: conflictRefs.length, cursor, conflictRefs };
}

export interface SyncEngineOptions {
  transport: SyncTransport;
  store: SyncStore;
  deviceId: string;
  backoff?: BackoffOptions;
  now?: () => number;
}

/** One organization's view of the engine. Nothing here is shared between two. */
interface OrgSyncState {
  state: SyncState;
  failures: number;
  lastError: string | null;
  lastErrorKind: SyncErrorKind | null;
  lastSyncedAt: string | null;
  cursor: number;
  pendingCount: number;
  /** User-requested pause. Distinct from `state`, which only tracks cycle outcomes. */
  paused: boolean;
  /** Newest-first log of conflicts this organization's cycles actually resolved. */
  conflictLog: LiveSyncConflict[];
}

function freshOrgState(): OrgSyncState {
  return {
    state: 'idle',
    failures: 0,
    lastError: null,
    lastErrorKind: null,
    lastSyncedAt: null,
    cursor: 0,
    pendingCount: 0,
    paused: false,
    conflictLog: [],
  };
}

/**
 * What a caller with no resolved organization sees.
 *
 * Zeroes rather than the last organization's numbers. "I have nothing for you"
 * is a true answer; "here is whoever synced last" is the finding.
 */
export const EMPTY_SYNC_STATUS: SyncStatus = {
  state: 'idle',
  online: true,
  pendingCount: 0,
  failures: 0,
  lastError: null,
  lastSyncedAt: null,
  cursor: 0,
};

export class SyncEngine {
  private readonly transport: SyncTransport;
  private readonly store: SyncStore;
  private readonly deviceId: string;
  private readonly backoffOpts: BackoffOptions;
  private readonly now: () => number;

  /**
   * Per-organization state. A `Map` keyed by organization rather than a set of
   * scalars, which is the whole of F3's engine half: an organization that has
   * never synced has no entry, and reading one never creates another's.
   */
  private readonly orgs = new Map<string, OrgSyncState>();

  constructor(opts: SyncEngineOptions) {
    this.transport = opts.transport;
    this.store = opts.store;
    this.deviceId = opts.deviceId;
    this.backoffOpts = opts.backoff ?? DEFAULT_BACKOFF;
    this.now = opts.now ?? Date.now;
  }

  /** Mutable state for one organization, created on first use. */
  private stateFor(orgId: string): OrgSyncState {
    const existing = this.orgs.get(orgId);
    if (existing) return existing;
    const created = freshOrgState();
    this.orgs.set(orgId, created);
    return created;
  }

  /** Read-only state for one organization, WITHOUT creating an entry. */
  private peek(orgId: string | null): OrgSyncState | null {
    return orgId === null ? null : (this.orgs.get(orgId) ?? null);
  }

  /** The status of ONE organization. A null organization gets the empty status. */
  getStatus(orgId: string | null): SyncStatus {
    const org = this.peek(orgId);
    if (org === null) return { ...EMPTY_SYNC_STATUS };
    // A user pause reads as offline without discarding the underlying cycle state,
    // so resuming restores whatever the last cycle actually reported.
    const state: SyncState = org.paused ? 'offline' : org.state;
    return {
      state,
      online: state !== 'offline',
      pendingCount: org.pendingCount,
      failures: org.failures,
      lastError: org.lastError,
      lastSyncedAt: org.lastSyncedAt,
      cursor: org.cursor,
    };
  }

  /**
   * Pause or resume syncing FOR ONE ORGANIZATION. While paused, `syncOnce` is a
   * no-op for it, so its local edits stay queued on the device and nothing of
   * its is pushed or pulled. Another organization's sync is unaffected — which
   * is the fix: this is the egress toggle, and `cloud:manage` is held
   * independently by every organization's own administrator.
   */
  setPaused(orgId: string, paused: boolean): void {
    this.stateFor(orgId).paused = paused;
  }

  isPaused(orgId: string | null): boolean {
    return this.peek(orgId)?.paused ?? false;
  }

  /** The conflicts resolved for ONE organization, newest first (bounded per org). */
  getConflicts(orgId: string | null): LiveSyncConflict[] {
    return [...(this.peek(orgId)?.conflictLog ?? [])];
  }

  /** The last error's kind for one organization, or null after a success. Lets the
   *  scheduler decide whether a retry is worthwhile (see isRetryable). */
  errorKind(orgId: string | null): SyncErrorKind | null {
    return this.peek(orgId)?.lastErrorKind ?? null;
  }

  /** Delay (ms) before this organization's next retry; 0 when healthy. */
  nextRetryDelay(orgId: string | null): number {
    const org = this.peek(orgId);
    if (org === null || org.failures === 0) return 0;
    return computeBackoff(org.failures, this.backoffOpts);
  }

  /**
   * Run one sync cycle for an org, updating that org's status. Never throws:
   * failures are captured in the status (state + lastError) so the scheduler can
   * react. A cycle already in progress is a no-op that returns current status.
   */
  async syncOnce(orgId: string): Promise<SyncStatus> {
    const org = this.stateFor(orgId);
    if (org.paused || org.state === 'syncing') return this.getStatus(orgId);
    org.state = 'syncing';
    try {
      const result = await runSyncCycle(this.transport, this.store, orgId, this.deviceId);
      this.recordConflicts(org, result.conflictRefs);
      org.cursor = result.cursor;
      org.pendingCount = (await this.store.listPending(orgId)).length;
      org.failures = 0;
      org.lastError = null;
      org.lastErrorKind = null;
      org.lastSyncedAt = new Date(this.now()).toISOString();
      org.state = 'idle';
    } catch (err) {
      const kind = classifyError(err);
      org.failures += 1;
      org.lastError = err instanceof Error ? err.message : String(err);
      org.lastErrorKind = kind;
      org.state = kind === 'network' ? 'offline' : 'error';
    }
    return this.getStatus(orgId);
  }

  /** Prepend this cycle's resolved conflicts to the org's log, newest first, and cap it. */
  private recordConflicts(org: OrgSyncState, refs: readonly SyncConflictRef[]): void {
    if (refs.length === 0) return;
    const at = new Date(this.now()).toISOString();
    const entries: LiveSyncConflict[] = refs.map((ref) => ({
      ...ref,
      resolution: 'last_write_wins',
      at,
    }));
    org.conflictLog = [...entries.reverse(), ...org.conflictLog].slice(0, MAX_CONFLICT_LOG);
  }
}
