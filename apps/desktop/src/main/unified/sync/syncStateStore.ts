/**
 * Durable sync state: per-account, per-resource cursors (for incremental sync)
 * plus the health metrics the Connector Health Dashboard reads (status, last/next
 * sync, duration, entity count, errors, rate-limit window). Electron-free so it
 * unit-tests against a temp path; the singleton lives in `syncStateInstance.ts`.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import type { ConnectorSyncSnapshot, ConnectorModuleStat, UnifiedEntityKind } from '@neuropause/shared';
import { createLogger } from '../../logger';

const log = createLogger('sync-state');

/** Per-resource sync state: the incremental cursor plus the module stats the UI reads. */
export interface ResourceCursor {
  cursor: string | null;
  lastSyncAt: string | null;
  /** Module label/kind/count/status, recorded by the orchestrator each run (optional for back-compat). */
  label?: string;
  kind?: UnifiedEntityKind;
  objectCount?: number;
  status?: ConnectorModuleStat['status'];
  reason?: string | null;
}

/** P4.1 — a dead-lettered sync (retry budget exhausted); persisted so it survives a restart. */
export interface DeadLetterInfo {
  at: string;
  attempts: number;
  error: string | null;
}

export interface AccountSyncState {
  connectorId: string;
  accountId: string;
  status: ConnectorSyncSnapshot['status'];
  lastSyncAt: string | null;
  lastDurationMs: number | null;
  nextSyncAt: string | null;
  entityCount: number;
  lastError: string | null;
  consecutiveFailures: number;
  rateLimitedUntil: string | null;
  // P2.4 write metrics (optional for state persisted before writes existed).
  lastWriteAt?: string | null;
  lastWriteAction?: string | null;
  writeCount?: number;
  failedWrites?: number;
  pendingWrites?: number;
  writeRetryDepth?: number;
  lastWriteLatencyMs?: number | null;
  apiQuotaRemaining?: number | null;
  /** P4.1 — set when a sync exhausts its retry budget; cleared on the next successful sync. */
  deadLetter?: DeadLetterInfo | null;
  resources: Record<string, ResourceCursor>;
}

export type SyncStatePatch = Partial<Omit<AccountSyncState, 'connectorId' | 'accountId' | 'resources'>>;

function key(connectorId: string, accountId: string): string {
  return `${connectorId}::${accountId}`;
}

function defaultState(connectorId: string, accountId: string): AccountSyncState {
  return {
    connectorId,
    accountId,
    status: 'idle',
    lastSyncAt: null,
    lastDurationMs: null,
    nextSyncAt: null,
    entityCount: 0,
    lastError: null,
    consecutiveFailures: 0,
    rateLimitedUntil: null,
    resources: {},
  };
}

/** Build the per-module stats from a state's recorded resources (those the orchestrator has tagged). */
export function stateToModules(s: AccountSyncState): ConnectorModuleStat[] {
  const out: ConnectorModuleStat[] = [];
  for (const [id, r] of Object.entries(s.resources)) {
    if (r.label === undefined) continue; // cursor-only entry, not yet stat-tagged
    out.push({
      id,
      label: r.label,
      kind: r.kind ?? 'activity',
      objectCount: r.objectCount ?? 0,
      status: r.status ?? 'ok',
      reason: r.reason ?? null,
      lastSyncAt: r.lastSyncAt,
    });
  }
  return out;
}

/** Project a state plus a live queue depth into a dashboard snapshot. */
export function stateToSnapshot(s: AccountSyncState, queueSize: number): ConnectorSyncSnapshot {
  return {
    connectorId: s.connectorId,
    accountId: s.accountId,
    status: s.status,
    lastSyncAt: s.lastSyncAt,
    lastDurationMs: s.lastDurationMs,
    nextSyncAt: s.nextSyncAt,
    entityCount: s.entityCount,
    lastError: s.lastError,
    consecutiveFailures: s.consecutiveFailures,
    rateLimitedUntil: s.rateLimitedUntil,
    queueSize,
    lastWriteAt: s.lastWriteAt ?? null,
    lastWriteAction: s.lastWriteAction ?? null,
    writeCount: s.writeCount ?? 0,
    failedWrites: s.failedWrites ?? 0,
    pendingWrites: s.pendingWrites ?? 0,
    writeRetryDepth: s.writeRetryDepth ?? 0,
    lastWriteLatencyMs: s.lastWriteLatencyMs ?? null,
    apiQuotaRemaining: s.apiQuotaRemaining ?? null,
    deadLettered: !!s.deadLetter,
    deadLetterReason: s.deadLetter?.error ?? null,
    modules: stateToModules(s),
  };
}

export class SyncStateStore extends EventEmitter {
  private states = new Map<string, AccountSyncState>();
  private loaded = false;
  /** Serializes persistence so concurrent saves never race on the temp file (see persist()). */
  private writeChain: Promise<void> = Promise.resolve();
  private writeSeq = 0;

  constructor(private readonly filePath: string) {
    super();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const list = JSON.parse(raw) as AccountSyncState[];
      if (Array.isArray(list)) {
        for (const s of list) if (s && s.connectorId && s.accountId) this.states.set(key(s.connectorId, s.accountId), s);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('Failed to read sync state; starting empty', err);
      }
    }
    this.loaded = true;
    log.info('Sync state ready', { accounts: this.states.size });
  }

  /**
   * Persist the full state atomically. Writes are SERIALIZED through a promise chain and each uses a
   * UNIQUE temp filename (pid + counter), so overlapping saves — far more frequent now that every module
   * records its own stats each sync — can never collide on a shared `.tmp` path and hit `ENOENT` on rename.
   */
  private persist(): Promise<void> {
    const run = (): Promise<void> => this.writeAtomic();
    const next = this.writeChain.then(run, run);
    // Keep the chain alive even if one write rejects, but hand the real result back to the caller.
    this.writeChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async writeAtomic(): Promise<void> {
    this.writeSeq = (this.writeSeq + 1) % 1_000_000;
    const tmp = `${this.filePath}.${process.pid}.${this.writeSeq}.tmp`;
    await fs.writeFile(tmp, JSON.stringify([...this.states.values()]), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  /** Current state for an account (defaults if never synced). */
  get(connectorId: string, accountId: string): AccountSyncState {
    return this.states.get(key(connectorId, accountId)) ?? defaultState(connectorId, accountId);
  }

  getCursor(connectorId: string, accountId: string, resourceId: string): string | null {
    return this.get(connectorId, accountId).resources[resourceId]?.cursor ?? null;
  }

  async setCursor(connectorId: string, accountId: string, resourceId: string, cursor: string | null, at: string): Promise<void> {
    const k = key(connectorId, accountId);
    const state = this.states.get(k) ?? defaultState(connectorId, accountId);
    const prev = state.resources[resourceId];
    // Preserve any module stats already recorded for this resource; only advance the cursor.
    state.resources[resourceId] = { ...prev, cursor, lastSyncAt: at };
    this.states.set(k, state);
    await this.persist();
  }

  /**
   * Record the per-module sync stats for one resource (label/kind/objectCount/status/reason),
   * merging over the existing cursor entry so the incremental cursor is never lost. Called by the
   * orchestrator after each resource's paging loop completes.
   */
  async recordResource(
    connectorId: string,
    accountId: string,
    resourceId: string,
    patch: Partial<Omit<ResourceCursor, 'cursor'>>,
  ): Promise<void> {
    const k = key(connectorId, accountId);
    const state = this.states.get(k) ?? defaultState(connectorId, accountId);
    const prev = state.resources[resourceId] ?? { cursor: null, lastSyncAt: null };
    state.resources[resourceId] = { ...prev, ...patch };
    this.states.set(k, state);
    await this.persist();
  }

  async recordRun(connectorId: string, accountId: string, patch: SyncStatePatch): Promise<void> {
    const k = key(connectorId, accountId);
    const state = this.states.get(k) ?? defaultState(connectorId, accountId);
    Object.assign(state, patch);
    this.states.set(k, state);
    await this.persist();
    this.emit('changed', { connectorId, accountId });
  }

  /** P4.1 — dead-letter an account's sync (retry budget exhausted). Durable + idempotent. */
  async recordDeadLetter(connectorId: string, accountId: string, info: DeadLetterInfo): Promise<void> {
    const k = key(connectorId, accountId);
    const state = this.states.get(k) ?? defaultState(connectorId, accountId);
    if (state.deadLetter) return; // already dead-lettered — no duplicate write/broadcast
    state.deadLetter = info;
    this.states.set(k, state);
    await this.persist();
    this.emit('changed', { connectorId, accountId });
  }

  /** P4.1 — clear a dead-letter (on a successful replay/sync). */
  async clearDeadLetter(connectorId: string, accountId: string): Promise<void> {
    const state = this.states.get(key(connectorId, accountId));
    if (!state || !state.deadLetter) return;
    state.deadLetter = null;
    await this.persist();
    this.emit('changed', { connectorId, accountId });
  }

  /** P4.1 — every account currently dead-lettered (for the DLQ view + reconciler). */
  deadLettered(): AccountSyncState[] {
    return [...this.states.values()].filter((s) => Boolean(s.deadLetter));
  }

  /**
   * P4.1 — crash reconciler. An account persisted as `status:'syncing'` was interrupted by a crash
   * (a clean run always leaves a terminal status), so reset it to `idle`; the scheduler re-picks it
   * when due. Cursors and dead-letters are durable and left untouched. Returns how many were reset.
   */
  async reconcile(): Promise<{ reset: number }> {
    let reset = 0;
    for (const s of this.states.values()) {
      if (s.status === 'syncing') {
        s.status = 'idle';
        reset += 1;
      }
    }
    if (reset > 0) await this.persist();
    return { reset };
  }

  /** All known account states (optionally filtered to one connector). */
  all(connectorId?: string): AccountSyncState[] {
    const out: AccountSyncState[] = [];
    for (const s of this.states.values()) {
      if (connectorId && s.connectorId !== connectorId) continue;
      out.push(s);
    }
    return out;
  }
}
