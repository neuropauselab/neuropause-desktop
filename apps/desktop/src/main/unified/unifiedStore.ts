/**
 * The Unified Store — the single source of truth for canonical entities.
 *
 * Holds every `UnifiedEntity`, keeps the search index in sync, resolves write
 * conflicts (source-authoritative, last-updated-wins with a content tie-break),
 * answers structured queries, and emits `changed` so higher layers (and the
 * renderer) can react. Persisted as JSON today; the same interface can sit on
 * SQLite/Postgres later with no caller changes.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import type {
  TenantScope,
  UnifiedCounts,
  UnifiedEntity,
  UnifiedQuery,
  UnifiedQueryResult,
} from '@neuropause/shared';
import { ownershipOf, recordInScope } from '@neuropause/shared';
import { createLogger } from '../logger';
import { LocalSearchBackend, type SearchBackend } from './searchBackend';
import { registerTenantStore } from '../tenancy/tenantOwnedStore';
import { declareStoreScope } from '../tenancy/storeScope';

/** P13C ROUND 10 — the retention invariant. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'unified-entities',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retentionScope: 'OWNER',
  retentionAuthority: 'OWNER',
  retention:
    'NO CAP. The only removal is `deleteByConnector`, and it is scoped BEFORE it deletes: it resolves ' +
    '`scopeOrDeny()`, walks the entities, and skips every row failing `recordInScope` — so the ids it ' +
    "collects are the caller's own and the `entities.delete(id)` loop cannot reach another tenant's " +
    'row. Deletion is the owner disconnecting their own connector, hence OWNER authority. There is no ' +
    'TTL, no LRU and no size cap anywhere in this file.',
  reason:
    'WHY TENANT: canonical business entities — the customer records themselves. This is the store the ' +
    'whole data plane projects into, so it is the single largest concentration of customer data in ' +
    'the product. It satisfied the gate through `registerTenantStore` alone, which cannot state a ' +
    'retention policy — the gap Round 10 exists to close.',
});

const log = createLogger('unified-store');

/**
 * The tenant boundary for the Unified Store (P13B).
 *
 * A FUNCTION, and `null` means DENY — the same contract as every other scoped
 * store in this codebase. A third spelling of the idea would be a third thing
 * that can disagree with the other two.
 */
export type UnifiedScopeSource = () => TenantScope | null;

/**
 * A process-wide fallback scope, for TESTS ONLY. Same seam, same runtime guard
 * and same justification as `setAmbientAppendOnlyScopeForTests`.
 */
let ambientUnifiedScope: UnifiedScopeSource | null = null;

export function setAmbientUnifiedScopeForTests(source: UnifiedScopeSource | null): void {
  if (process.env.VITEST === undefined && process.env.NODE_ENV !== 'test') {
    throw new Error(
      'setAmbientUnifiedScopeForTests is a test-only seam and must not be called at runtime.',
    );
  }
  ambientUnifiedScope = source;
}

export interface UpsertResult {
  created: number;
  updated: number;
  unchanged: number;
  /** Same-timestamp-but-changed writes the store had to resolve by content. */
  conflicts: number;
}

/** Stable signature of the meaningful fields, for tie-breaking equal timestamps. */
function signature(e: UnifiedEntity): string {
  return JSON.stringify([
    e.title, e.url, e.body, e.status, e.author, e.timestamp, e.endTimestamp,
    e.parentId, e.containerId, e.labels, e.syncState, e.metadata,
  ]);
}

export class UnifiedStore extends EventEmitter {
  private entities = new Map<string, UnifiedEntity>();
  private search: LocalSearchBackend = new LocalSearchBackend();
  private loaded = false;
  private scopeSource: UnifiedScopeSource | null = null;
  /** The most recent write, so `flush()` can await durability. */
  private lastWrite: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    super();
    /**
     * P13C ROUND 3 — PHASE 4. Declare this store to the startup gate. The seam
     * below predates the registry, so the gate could not see it: an unbound
     * instance denied every read (correct) and shipped silently (not correct).
     */
    registerTenantStore('unified-entities', () => this.hasScope());
  }

  /**
   * Bind the tenant boundary. Chainable. UNBOUND DENIES.
   *
   * PROPAGATED TO THE SEARCH INDEX in the same call, deliberately. The index is
   * a second copy of this data with its own reachable read path — five call
   * sites take `unifiedStore.searchBackend` and query it directly, never
   * touching the store — so binding one and not the other would leave the
   * boundary drawn around the copy nobody guards.
   */
  bindScope(source: UnifiedScopeSource): this {
    this.scopeSource = source;
    this.search.bindScope(source);
    return this;
  }

  /** Whether a boundary has been bound. For the migration inventory. */
  hasScope(): boolean {
    return this.scopeSource !== null;
  }

  /** The active scope, or `null` meaning DENY. */
  private scopeOrDeny(): TenantScope | null {
    const source = this.scopeSource ?? ambientUnifiedScope;
    return source === null ? null : source();
  }

  /**
   * The scope a WRITE needs. Throws rather than denying quietly — a synced
   * entity with no owner is invisible to everyone and re-created on every sync,
   * which looks like a broken connector rather than a boundary.
   */
  private requireScope(): TenantScope {
    const scope = this.scopeOrDeny();
    if (scope === null) {
      throw new Error(
        'Cannot write to the unified store: no organization and workspace are active, so the records would have no owner.',
      );
    }
    return scope;
  }

  /** Ownership counts across every record. Three integers, no record content. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    let assigned = 0;
    let unresolved = 0;
    for (const e of this.entities.values()) {
      if (ownershipOf(e) === 'assigned') assigned += 1;
      else unresolved += 1;
    }
    return { total: this.entities.size, assigned, unresolved };
  }

  /** The entity behind an id if this caller may read it, else null. */
  private visible(id: string): UnifiedEntity | null {
    const scope = this.scopeOrDeny();
    if (scope === null) return null;
    const e = this.entities.get(id);
    return e && recordInScope(e, scope) ? e : null;
  }

  /** The backing search index (read-only handle for the search facade). */
  get searchBackend(): SearchBackend {
    return this.search;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const list = JSON.parse(raw) as UnifiedEntity[];
      if (Array.isArray(list)) {
        for (const e of list) if (e && e.id) this.entities.set(e.id, e);
        this.search.index([...this.entities.values()]);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('Failed to read unified store; starting empty', err);
      }
    }
    this.loaded = true;
    log.info('Unified store ready', { entities: this.entities.size });
  }

  /**
   * Await the in-flight write.
   *
   * `persist()` is awaited inline by every mutator here, so there is no
   * coalescing queue to drain — this exists so callers (tests, shutdown) have
   * the same durability handle every other store exposes, rather than each one
   * guessing whether this store needs flushing.
   */
  async flush(): Promise<void> {
    await this.lastWrite;
  }

  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    this.lastWrite = (async () => {
      await fs.writeFile(tmp, JSON.stringify([...this.entities.values()]), { mode: 0o600 });
      await fs.rename(tmp, this.filePath);
    })();
    await this.lastWrite;
  }

  /**
   * Insert/merge a batch. Source is authoritative: an incoming record replaces
   * the stored one when its `updatedAt` is newer, or equal but with changed
   * content. Older incoming records are ignored (a stale re-sync never clobbers
   * fresher local state). Returns per-outcome counts.
   */
  async upsertMany(incoming: UnifiedEntity[], expectedTenantId?: string): Promise<UpsertResult> {
    /**
     * P13B — OWNERSHIP IS STAMPED HERE, FROM THE ACTIVE SCOPE.
     *
     * The adapters that build these records could set `tenantId` themselves;
     * that value is OVERWRITTEN rather than validated, because a write path
     * that accepts a caller's tenant is a write path that can be asked to write
     * into someone else's. There is no argument to this method that can choose
     * an owner.
     *
     * Stamped tenant-level (`workspaceId: null`): a connector is connected by
     * an organization, and its records must stay readable from every workspace
     * in that organization. Scoping them to whichever workspace was open during
     * the sync would hide a tenant's own data from itself.
     */
    const scope = this.requireScope();
    /**
     * THE CALLER'S EXPECTED TENANT MUST STILL BE THE ACTIVE ONE.
     *
     * Found by adversarial review, and it defeated the sync orchestrator's own
     * mitigation. The orchestrator resolves its tenant ONCE before any provider
     * call and comments that a mid-run workspace switch therefore cannot split
     * a sync across two tenants — but the OWNERSHIP STAMP was taken here,
     * live, once per page. A paginated sync started under org A that spans a
     * switch stamped its later pages org B, and `recordInScope` reads the
     * field, not the id, so org B then read org A's synced records as its own.
     *
     * `expectedTenantId` closes the window by making the writer state which
     * tenant it believes it is writing for. It is NOT an authorization — the
     * active scope still decides — it is an assertion that the world has not
     * moved underneath a long-running job. Naming another tenant does not
     * grant anything; it just fails.
     */
    if (expectedTenantId !== undefined && expectedTenantId !== scope.tenantId) {
      throw new Error(
        'The active organization changed while this write was in flight, so it was refused rather than attributed to the wrong one.',
      );
    }
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let conflicts = 0;
    const changed: UnifiedEntity[] = [];

    for (const raw of incoming) {
      const next: UnifiedEntity = { ...raw, tenantId: scope.tenantId, workspaceId: null };
      const prev = this.entities.get(next.id);
      /**
       * A record whose id exists but belongs to ANOTHER tenant is refused, not
       * merged. With tenant-qualified ids this should be unreachable — that is
       * exactly why it is checked. It is the assertion that the id domain is
       * doing its job, and if a future id scheme regresses, this denies instead
       * of resolving one tenant's record against another's by timestamp.
       */
      if (prev && ownershipOf(prev) === 'assigned' && prev.tenantId !== scope.tenantId) {
        unchanged += 1;
        continue;
      }
      if (!prev) {
        this.entities.set(next.id, next);
        changed.push(next);
        created += 1;
        continue;
      }
      const newer = next.updatedAt > prev.updatedAt;
      const sameTimeButChanged = next.updatedAt === prev.updatedAt && signature(next) !== signature(prev);
      if (sameTimeButChanged) conflicts += 1;
      if (newer || sameTimeButChanged) {
        this.entities.set(next.id, next);
        changed.push(next);
        updated += 1;
      } else {
        unchanged += 1;
      }
    }

    if (changed.length > 0) {
      this.search.index(changed);
      await this.persist();
      this.emit('changed', { kind: 'upsert', ids: changed.map((e) => e.id) });
    }
    return { created, updated, unchanged, conflicts };
  }

  /**
   * One entity by id, or null when the caller may not read it.
   *
   * An id is a REFERENCE, NOT AN AUTHORIZATION — and this is the IDOR the
   * `unified:get` IPC channel exposed directly to the renderer. Ids are
   * derived from source coordinates rather than random, so they are guessable
   * by anyone who knows a connector, an account and a provider object id.
   * Indistinguishable from "no such record" on purpose.
   */
  get(id: string): UnifiedEntity | null {
    return this.visible(id);
  }

  /** Soft-delete records (marks syncState='deleted'; query hides them by default). */
  async markDeleted(ids: string[], at: string): Promise<number> {
    const removed: string[] = [];
    for (const id of ids) {
      // P13B — resolved through `visible`, so a caller holding another tenant's
      // id deletes nothing and learns nothing. Applies to batch and delete-all
      // alike: both collect ids and pass them here.
      const e = this.visible(id);
      if (e && e.syncState !== 'deleted') {
        this.entities.set(id, { ...e, syncState: 'deleted', syncedAt: at });
        removed.push(id);
      }
    }
    if (removed.length > 0) {
      this.search.remove(removed);
      await this.persist();
      this.emit('changed', { kind: 'delete', ids: removed });
    }
    return removed.length;
  }

  /** Hard-remove every record for a connector (called on disconnect). */
  /**
   * Drop a connector's synced entities — one ACCOUNT's, when one is named.
   *
   * The account filter is not optional politeness: a connector can hold two
   * accounts (a sales portal and a support portal), and disconnecting one used
   * to delete the other's data too, because this only ever filtered on
   * `connectorId`. Silent, and unrecoverable without a re-sync that the
   * remaining account had no reason to run.
   */
  async removeConnector(connectorId: string, accountId?: string): Promise<number> {
    /**
     * P13B — a disconnect purges only the disconnecting TENANT's records.
     *
     * Two tenants can connect the same provider (the same Slack workspace, even
     * the same account). Without the scope check, one of them disconnecting
     * hard-deleted the other's synced data — unrecoverable without a re-sync
     * the other tenant had no reason to run, and triggered by an action they
     * could not see. The account filter below already exists for the analogous
     * within-tenant case, which is why the omission of the tenant one stood out.
     */
    const scope = this.scopeOrDeny();
    if (scope === null) return 0;
    const ids: string[] = [];
    for (const [id, e] of this.entities) {
      if (!recordInScope(e, scope)) continue;
      if (e.connectorId !== connectorId) continue;
      if (accountId !== undefined && e.accountId !== accountId) continue;
      ids.push(id);
    }
    for (const id of ids) this.entities.delete(id);
    if (ids.length > 0) {
      this.search.remove(ids);
      await this.persist();
      this.emit('changed', { kind: 'delete', ids });
    }
    return ids.length;
  }

  /**
   * The structured query. SCOPED FIRST, before any caller-supplied predicate.
   *
   * This is the method the audit called "the input to every briefing, finding
   * and analytics rollup" — twenty-two production call sites pass
   * `{limit: 1_000_000}` and treat the result as the whole world. It is also
   * the re-projection source for both memory and the graph, so the boundary
   * drawn here is the one those two inherit. `total` is computed from the
   * filtered set, so the pagination count cannot report records the caller
   * cannot see.
   */
  query(q: UnifiedQuery): UnifiedQueryResult {
    const scope = this.scopeOrDeny();
    if (scope === null) return { items: [], total: 0, nextCursor: null };
    const kinds = q.kinds && q.kinds.length > 0 ? new Set(q.kinds) : null;
    const text = q.text?.trim().toLowerCase();
    const filtered: UnifiedEntity[] = [];
    for (const e of this.entities.values()) {
      // Ownership before everything. No later predicate can reinstate a record
      // this caller may not read.
      if (!recordInScope(e, scope)) continue;
      if (!q.includeDeleted && e.syncState === 'deleted') continue;
      if (kinds && !kinds.has(e.kind)) continue;
      if (q.connectorId && e.connectorId !== q.connectorId) continue;
      if (q.accountId && e.accountId !== q.accountId) continue;
      if (q.containerId && e.containerId !== q.containerId) continue;
      if (q.parentId && e.parentId !== q.parentId) continue;
      if (q.status && e.status !== q.status) continue;
      if (q.since && e.updatedAt < q.since) continue;
      if (q.until && e.updatedAt > q.until) continue;
      if (text && !(`${e.title} ${e.body ?? ''}`.toLowerCase().includes(text))) continue;
      filtered.push(e);
    }

    const sortBy = q.sortBy ?? 'updatedAt';
    const dir = q.order === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      const av = sortBy === 'title' ? a.title : (a[sortBy] ?? '');
      const bv = sortBy === 'title' ? b.title : (b[sortBy] ?? '');
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });

    const total = filtered.length;
    const offset = q.cursor ? Math.max(0, parseInt(q.cursor, 10) || 0) : 0;
    const limit = q.limit ?? 50;
    const items = filtered.slice(offset, offset + limit);
    const nextOffset = offset + limit;
    return { items, total, nextCursor: nextOffset < total ? String(nextOffset) : null };
  }

  /**
   * Counts for THIS CALLER only.
   *
   * Broadcast to the renderer on every mutation, so an unscoped version was a
   * continuous readout of another tenant's activity: how many records they
   * hold, of which kinds, through which connectors, and — via `lastUpdatedAt` —
   * when they last did anything. No record content, and enough to be worth
   * withholding on its own.
   */
  counts(): UnifiedCounts {
    const scope = this.scopeOrDeny();
    if (scope === null) return { total: 0, byKind: {}, byConnector: {}, lastUpdatedAt: null };
    const byKind: Record<string, number> = {};
    const byConnector: Record<string, number> = {};
    let total = 0;
    let lastUpdatedAt: string | null = null;
    for (const e of this.entities.values()) {
      if (!recordInScope(e, scope)) continue;
      if (e.syncState === 'deleted') continue;
      total += 1;
      byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
      byConnector[e.connectorId] = (byConnector[e.connectorId] ?? 0) + 1;
      if (!lastUpdatedAt || e.updatedAt > lastUpdatedAt) lastUpdatedAt = e.updatedAt;
    }
    return { total, byKind, byConnector, lastUpdatedAt };
  }

  /** Count of live records for a connector, within this caller's tenant. */
  countForConnector(connectorId: string): number {
    const scope = this.scopeOrDeny();
    if (scope === null) return 0;
    let n = 0;
    for (const e of this.entities.values()) {
      if (!recordInScope(e, scope)) continue;
      if (e.syncState !== 'deleted' && e.connectorId === connectorId) n += 1;
    }
    return n;
  }
}
