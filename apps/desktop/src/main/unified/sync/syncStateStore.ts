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
import type { TenantScope } from '@neuropause/shared';
import { TenantOwnership } from '../../tenancy/tenantOwnedStore';
import { declareStoreScope } from '../../tenancy/storeScope';

/** P13C ROUND 10 — the retention invariant. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'connector-sync-state',
  scope: 'WORKSPACE',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retentionScope: 'OWNER',
  retentionAuthority: 'OWNER',
  retention:
    'NO CAP AND NO TTL — cursors and health rows are kept until their account is disconnected. The ' +
    'one removal is `forget(connectorId, accountId)`, called from disconnect, which deletes exactly ' +
    "the row for that account. HONEST LIMIT: the Map key is `connectorId::accountId` with no " +
    'workspace segment, so the guarantee that it cannot reach another workspace rests on `accountId` ' +
    "being a random `shortId('acct')` minted per connection, not on a check in this method. That is a " +
    'borrowed guarantee and is written down rather than assumed; the same shape was tightened in ' +
    '`connectorStore.remove` in Round 10 and this one is recorded as the remaining instance.',
  reason:
    'WHY WORKSPACE: a sync cursor names a provider resource path and a health row carries provider ' +
    "error strings and entity counts for one connected account, which is that workspace's " +
    'operational detail. The seam is the `TenantOwnership` below, bound at the composition root.',
});

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
  /**
   * P13C ROUND 5 — the workspace this connected account belongs to.
   *
   * Optional because rows written before this round have no owner. They are not
   * attributed on load — a legacy row is adopted only by the first write that
   * has a resolvable owner, and that write can only come through the
   * workspace-filtered connector store, so the writer IS the owner.
   */
  tenantId?: string | null;
  workspaceId?: string | null;
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
  /**
   * P13C ROUND 5 — WORKSPACE-SCOPED, not tenant-scoped.
   *
   * A connection is a WORKSPACE object — this subsystem's own composition root
   * says so, which is why the sync scheduler fans out per workspace rather than
   * per tenant. So the boundary here is the workspace, and scoping it to the
   * tenant would be the wrong shape twice over: too coarse to isolate two
   * workspaces, and it would not match the key the rows already have.
   *
   * Most fields are install-level plumbing — cursors, durations, retry depth,
   * quota. What makes it more than counters: `lastError`, `reason` and
   * `deadLetter.error` are VERBATIM PROVIDER ERROR STRINGS, which routinely name
   * objects and ids, and `entityCount`/`objectCount` count that workspace's
   * records per module.
   *
   * Its safety today is inherited: the enumeration path goes through
   * `connectorStore`, which is workspace-filtered, so a caller can only name
   * accounts in their own workspace. This store's own `get()` denied nothing —
   * it returned a default state for an unknown key — and `all()` /
   * `deadLettered()` are install-wide accessors sitting unused, waiting for the
   * dead-letter view somebody will eventually build.
   */
  private readonly tenancy = new TenantOwnership('connector-sync-state');

  /** Bind the workspace boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.tenancy.hasScope();
  }

  /**
   * WHY THIS STAMPS AN OWNER RATHER THAN RE-KEYING THE MAP.
   *
   * Re-keying to `(workspace, connector, account)` is the shape used elsewhere
   * in this program and it is the wrong trade here: every existing row would
   * become unreachable on upgrade, the stored cursors with it, and every
   * connected account would perform a full re-sync against the provider. A
   * security fix that triggers an install-wide re-sync storm — with the rate
   * limits and cost that implies — is a fix people turn off.
   *
   * The key stays; the OWNER goes on the record. Reads filter on it, and a row
   * written before this round has no owner and is returned by no install-wide
   * accessor.
   */
  private ownerOf(): { tenantId: string; workspaceId: string } | null {
    const scope = this.tenancy.scopeOrDeny();
    if (scope === null || !scope.tenantId) return null;
    return { tenantId: scope.tenantId, workspaceId: scope.workspaceId };
  }

  /** Whether a row belongs to the caller's workspace. Unowned rows belong to nobody. */
  private mine(state: AccountSyncState): boolean {
    const owner = this.ownerOf();
    if (owner === null) return false;
    return state.tenantId === owner.tenantId && state.workspaceId === owner.workspaceId;
  }

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
  /**
   * Forget an account's cursors and health entirely.
   *
   * Called on disconnect. A stale cursor is worse than none: reconnecting
   * would resume from a checkpoint recorded against a credential that no
   * longer exists, silently skipping everything the provider changed in
   * between.
   */
  async forget(connectorId: string, accountId: string): Promise<void> {
    if (!this.states.delete(key(connectorId, accountId))) return;
    await this.persist();
    this.emit('changed', { connectorId, accountId });
  }

  /**
   * One account's sync state.
   *
   * DELIBERATELY NOT FILTERED, and this is the honest half of the F-triage.
   *
   * Its protection is INHERITED: every reachable path enumerates accounts
   * through `connectorStore`, which is workspace-filtered and returns nothing
   * when unbound, so a caller cannot name an account outside their workspace to
   * begin with. I did add a filter here and it broke live sync — the
   * orchestrator writes under a workspace principal and reads back through
   * paths that legitimately resolve differently, so the filter denied the
   * writer its own row.
   *
   * Rather than ship a plausible-looking check that fails the product, the
   * boundary is applied where it is BOTH correct and unambiguous — the two
   * install-wide accessors below — and this one is left inherited, said out
   * loud, and recorded in the migration inventory as PARTIAL. A borrowed
   * guarantee that is written down is worth more than an invented one that is
   * wrong.
   */
  get(connectorId: string, accountId: string): AccountSyncState {
    return this.states.get(key(connectorId, accountId)) ?? defaultState(connectorId, accountId);
  }

  getCursor(connectorId: string, accountId: string, resourceId: string): string | null {
    return this.get(connectorId, accountId).resources[resourceId]?.cursor ?? null;
  }

  async setCursor(connectorId: string, accountId: string, resourceId: string, cursor: string | null, at: string): Promise<void> {
    const k = key(connectorId, accountId);
    const state = this.stateFor(k, connectorId, accountId);
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
    const state = this.stateFor(k, connectorId, accountId);
    const prev = state.resources[resourceId] ?? { cursor: null, lastSyncAt: null };
    state.resources[resourceId] = { ...prev, ...patch };
    this.states.set(k, state);
    await this.persist();
  }

  async recordRun(connectorId: string, accountId: string, patch: SyncStatePatch): Promise<void> {
    const k = key(connectorId, accountId);
    const state = this.stateFor(k, connectorId, accountId);
    Object.assign(state, patch);
    this.states.set(k, state);
    await this.persist();
    this.emit('changed', { connectorId, accountId });
  }

  /** P4.1 — dead-letter an account's sync (retry budget exhausted). Durable + idempotent. */
  async recordDeadLetter(connectorId: string, accountId: string, info: DeadLetterInfo): Promise<void> {
    const k = key(connectorId, accountId);
    const state = this.stateFor(k, connectorId, accountId);
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

  /**
   * Resolve-or-create a state row, stamped with the CALLER'S workspace.
   *
   * A write with no resolvable owner still proceeds — the sync orchestrator runs
   * under a workspace principal and a missing one means the row is legacy — but
   * it is left unowned, which means no install-wide accessor will return it.
   */
  private stateFor(k: string, connectorId: string, accountId: string): AccountSyncState {
    const state = this.states.get(k) ?? defaultState(connectorId, accountId);
    /**
     * Stamp the writing workspace, without changing who can READ the row.
     *
     * The stamp is what makes the two install-wide accessors below filterable.
     * It is evidence-based: this key is only reachable through the
     * workspace-filtered connector store, so the writer IS the owner.
     */
    const owner = this.ownerOf();
    if (owner !== null && !state.tenantId) {
      state.tenantId = owner.tenantId;
      state.workspaceId = owner.workspaceId;
    }
    return state;
  }

  /**
   * P4.1 — every account currently dead-lettered, FOR THE CALLER'S WORKSPACE.
   *
   * Install-wide, this returned every workspace's dead-letter rows including
   * `deadLetter.error` — verbatim provider error text, which routinely names
   * objects and ids. It has no production caller yet, which is precisely when a
   * boundary is cheapest to add.
   */
  deadLettered(): AccountSyncState[] {
    return [...this.states.values()].filter((s) => Boolean(s.deadLetter) && this.mine(s));
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

  /**
   * P13C ROUND 6 — `all()` IS DELETED.
   *
   * It returned every account's sync state across every workspace, unfiltered,
   * and it had ZERO callers — not in the main process, not in the renderer, not
   * in a test. Round 5 recorded it as "latent, no caller" and left it, which is
   * the wrong resolution twice over: it is an unfiltered install-wide accessor
   * sitting in a store whose other accessors are deliberately narrow, so the
   * next person to want "all the accounts" finds a method that already exists,
   * already compiles, and looks sanctioned. Dead code is not a smaller risk than
   * live code; it is the same risk with nobody watching it.
   *
   * Deleted rather than filtered, because a scoped `all()` would still be an
   * invitation and there is nothing to keep working. Anything genuinely needing
   * a cross-workspace view is a new deliberate decision with its own review, not
   * a method that was already there.
   *
   * `deadLettered()` remains and is scoped. `get()` remains unfiltered and its
   * borrowed guarantee is documented at its declaration — a filter there broke
   * live sync and was reverted rather than shipped as a plausible-looking check.
   */
}
