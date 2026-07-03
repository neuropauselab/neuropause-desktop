/**
 * The live cloud-sync engine. Deliberately timer-free: `syncOnce` runs a single
 * cycle (push pending, then pull + apply until caught up) and updates observable
 * status, and `nextRetryDelay` reports how long to wait after failures. A thin
 * scheduler wired to the app lifecycle decides *when* to call syncOnce — which keeps
 * the engine fully unit-testable without fake timers.
 */
import {
  classifyError,
  computeBackoff,
  DEFAULT_BACKOFF,
  type BackoffOptions,
  type SyncErrorKind,
} from './backoff';
import type { SyncCycleResult, SyncState, SyncStatus, SyncStore, SyncTransport } from './types';

const PULL_LIMIT = 200;
const MAX_PULL_PAGES = 50;

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
  let conflicts = 0;

  const pending = await store.listPending(orgId);
  if (pending.length > 0) {
    const resp = await transport.push(
      orgId,
      deviceId,
      pending.map((p) => p.change),
    );
    conflicts += resp.results.filter((r) => r.status === 'conflict').length;
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
      const outcome = await store.applyRemote(change);
      if (outcome === 'conflict') conflicts += 1;
      pulled += 1;
    }
    cursor = resp.cursor;
    await store.setCursor(orgId, cursor);
    if (!resp.hasMore) break;
  }

  return { pushed, pulled, conflicts, cursor };
}

export interface SyncEngineOptions {
  transport: SyncTransport;
  store: SyncStore;
  deviceId: string;
  backoff?: BackoffOptions;
  now?: () => number;
}

export class SyncEngine {
  private readonly transport: SyncTransport;
  private readonly store: SyncStore;
  private readonly deviceId: string;
  private readonly backoffOpts: BackoffOptions;
  private readonly now: () => number;

  private state: SyncState = 'idle';
  private failures = 0;
  private lastError: string | null = null;
  private lastErrorKind: SyncErrorKind | null = null;
  private lastSyncedAt: string | null = null;
  private cursor = 0;
  private pendingCount = 0;

  constructor(opts: SyncEngineOptions) {
    this.transport = opts.transport;
    this.store = opts.store;
    this.deviceId = opts.deviceId;
    this.backoffOpts = opts.backoff ?? DEFAULT_BACKOFF;
    this.now = opts.now ?? Date.now;
  }

  getStatus(): SyncStatus {
    return {
      state: this.state,
      online: this.state !== 'offline',
      pendingCount: this.pendingCount,
      failures: this.failures,
      lastError: this.lastError,
      lastSyncedAt: this.lastSyncedAt,
      cursor: this.cursor,
    };
  }

  /** The last error's kind, or null after a success. Lets the scheduler decide
   *  whether a retry is worthwhile (see isRetryable). */
  get errorKind(): SyncErrorKind | null {
    return this.lastErrorKind;
  }

  /** Delay (ms) before the next retry given consecutive failures; 0 when healthy. */
  nextRetryDelay(): number {
    return this.failures > 0 ? computeBackoff(this.failures, this.backoffOpts) : 0;
  }

  /**
   * Run one sync cycle for an org, updating status. Never throws: failures are
   * captured in the status (state + lastError) so the scheduler can react. A cycle
   * already in progress is a no-op that returns current status.
   */
  async syncOnce(orgId: string): Promise<SyncStatus> {
    if (this.state === 'syncing') return this.getStatus();
    this.state = 'syncing';
    try {
      const result = await runSyncCycle(this.transport, this.store, orgId, this.deviceId);
      this.cursor = result.cursor;
      this.pendingCount = (await this.store.listPending(orgId)).length;
      this.failures = 0;
      this.lastError = null;
      this.lastErrorKind = null;
      this.lastSyncedAt = new Date(this.now()).toISOString();
      this.state = 'idle';
    } catch (err) {
      const kind = classifyError(err);
      this.failures += 1;
      this.lastError = err instanceof Error ? err.message : String(err);
      this.lastErrorKind = kind;
      this.state = kind === 'network' ? 'offline' : 'error';
    }
    return this.getStatus();
  }
}
