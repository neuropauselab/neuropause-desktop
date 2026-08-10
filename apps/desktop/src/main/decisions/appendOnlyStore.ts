/**
 * The tiny persistence substrate the decision subsystem's two stores share.
 *
 * Both Decision Records and Holds are the same shape of thing: an append-mostly
 * list of governance artifacts that must survive a restart, must never fail the
 * operation that produced them, and must not grow without bound. Writing that
 * twice would guarantee the two drift, and a governance record that is only
 * *mostly* durable is worse than none, because it is trusted.
 *
 * Semantics:
 *  - Atomic writes (tmp + rename) so a crash mid-write cannot truncate history.
 *  - Coalesced: a burst of appends drains into one write, never a write storm.
 *  - Fail-quiet: a failed persist is never allowed to unwind the caller's work.
 *  - Capped: oldest entries fall off first, so the file cannot grow forever.
 *
 * Electron-free — the path is injected, so tests run under plain Node.
 */
import { promises as fs } from 'node:fs';
import type { TenantScope } from '@neuropause/shared';
import { ownershipOf, recordInScope } from '@neuropause/shared';
import { readStoreFile, envelopeStamp } from '../storage/storeEnvelope';

/**
 * A process-wide fallback scope, for TESTS ONLY. Mirrors the one on
 * `EnterpriseRecordStore`, and for the same reason: dozens of test files
 * construct these stores directly and would otherwise each have to bind.
 *
 * A per-store binding always wins; `null` still DENIES; and the setter refuses
 * outside a test runner.
 */
let ambientAppendOnlyScope: AppendOnlyScopeSource | null = null;

export function setAmbientAppendOnlyScopeForTests(source: AppendOnlyScopeSource | null): void {
  if (process.env.VITEST === undefined && process.env.NODE_ENV !== 'test') {
    throw new Error(
      'setAmbientAppendOnlyScopeForTests is a test-only seam and must not be called at runtime.',
    );
  }
  ambientAppendOnlyScope = source;
}

interface StoreFile<T> {
  schemaVersion?: number;
  records: T[];
}

/** A record that knows which tenant it belongs to. */
export interface ScopedRecord {
  id: string;
  /** Absent or empty means UNRESOLVED — visible to no tenant. */
  tenantId?: string | null;
  /** Absent means tenant-level: readable from every workspace in the tenant. */
  workspaceId?: string | null;
}

/**
 * The tenant boundary for an append-only store.
 *
 * Same contract as `EnterpriseRecordStore`'s: a FUNCTION because the active
 * workspace changes at runtime, and `null` means DENY rather than "unfiltered".
 */
export type AppendOnlyScopeSource = () => TenantScope | null;

export abstract class AppendOnlyJsonStore<T extends ScopedRecord> {
  /**
   * PRIVATE, and that is the enforcement.
   *
   * It was `protected`, and all five subclasses read it directly — twenty-one
   * sites between them, covering every path an attacker would actually use:
   * `documentStore.get`, `existingByHash`, `all`, `holdStore.open`'s subject
   * de-dupe, `openHolds`, `openCount`, `decisionRecordStore.forSubject`,
   * `opportunityDecisionStore.byId`. Scoping only `list()` and `count()` would
   * have left every one of them global while looking like a fix.
   *
   * Making it private breaks all twenty-one at COMPILE TIME, which is the point:
   * the compiler enumerates the work instead of a reviewer having to.
   */
  private items: T[] = [];
  private scopeSource: AppendOnlyScopeSource | null = null;
  private loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  protected constructor(
    private readonly filePath: string,
    private readonly cap: number,
    protected readonly now: () => string,
  ) {}

  /**
   * Bind the tenant boundary. Chainable, so a store can be constructed and
   * bound in one expression.
   *
   * UNBOUND DENIES — see `visible()`. A store nobody bound holds its records and
   * hands back none of them, which fails loudly in a test rather than quietly in
   * production.
   */
  bindScope(source: AppendOnlyScopeSource): this {
    this.scopeSource = source;
    return this;
  }

  /** Whether a boundary has been bound. For the migration inventory. */
  hasScope(): boolean {
    return this.scopeSource !== null;
  }

  /** The active scope, or `null` meaning DENY. */
  protected scopeOrDeny(): TenantScope | null {
    const source = this.scopeSource ?? ambientAppendOnlyScope;
    return source === null ? null : source();
  }

  /**
   * The scope a WRITE needs. Throws rather than denying quietly.
   *
   * Same asymmetry as `EnterpriseRecordStore.create`: a read that returns
   * nothing is a correct quiet answer, while a write with no owner produces
   * exactly the unresolved record the migration exists to eliminate.
   */
  protected requireScope(what: string): TenantScope {
    const scope = this.scopeOrDeny();
    if (scope === null) {
      throw new Error(
        `Cannot record ${what}: no organization and workspace are active, so it would have no owner.`,
      );
    }
    return scope;
  }

  /**
   * The records this caller may see. `[]` when no scope resolves.
   *
   * EVERY subclass read goes through this. Returning a fresh array rather than a
   * filtered view of the live one is deliberate: a subclass that mutated the
   * result would otherwise mutate the store.
   */
  protected visible(): T[] {
    const scope = this.scopeOrDeny();
    if (scope === null) return [];
    return this.items.filter((item) => recordInScope(item, scope));
  }

  /**
   * Every record, ignoring scope. For ownership counts and eviction bookkeeping.
   *
   * Narrow on purpose and used in exactly two situations: counting how many
   * records nobody owns, and cleaning up something a record owned outside this
   * file when the cap evicts it. Neither returns data to a caller.
   */
  protected allUnscoped(): readonly T[] {
    return this.items;
  }

  /**
   * Put an evicted record back at the front.
   *
   * Exists for one caller: a document with business links must not fall off the
   * end of the cap, because a record that can no longer name its source is worth
   * less than a bounded file. Unscoped because eviction is bookkeeping over the
   * whole file, and it re-admits a record that was already there rather than
   * admitting a new one.
   */
  protected readmit(item: T): void {
    this.items.unshift(item);
  }

  /** Ownership counts across every record. Three integers, no record content. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    let assigned = 0;
    let unresolved = 0;
    for (const item of this.items) {
      if (ownershipOf(item) === 'assigned') assigned += 1;
      else unresolved += 1;
    }
    return { total: this.items.length, assigned, unresolved };
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    const result = await readStoreFile<Partial<StoreFile<T>>>(this.filePath);
    if (result.state === 'loaded' && Array.isArray(result.data?.records)) {
      this.items = result.data.records.filter((r): r is T => Boolean(r && (r as T).id));
    }
    this.loaded = true;
  }

  /**
   * Append a record, STAMPED with the active scope.
   *
   * The stamp happens here rather than in each subclass so a new subclass cannot
   * forget it. Throws when no scope resolves, for the reason `requireScope`
   * explains.
   */
  protected append(item: T): T {
    const scope = this.requireScope(`a ${String(item.id).split('_')[0] ?? 'record'}`);
    /**
     * Stamped IN PLACE, not copied.
     *
     * A copy broke object identity: subclasses append a record and then keep the
     * reference to mutate it later (`holdStore.resolve`, `outcomeRevisionStore`),
     * so the later mutation hit the discarded original and the stored row never
     * changed. Six tests caught it. Mutating the argument is the less elegant
     * option and the correct one — `mutate()` already relies on the same
     * identity.
     */
    const scoped = item as T & ScopedRecord;
    scoped.tenantId = scope.tenantId;
    scoped.workspaceId = scope.workspaceId;
    this.items.push(item);
    if (this.items.length > this.cap) {
      /**
       * Eviction is confined to the WRITING tenant.
       *
       * Splicing the front of a shared array deleted the globally oldest record
       * — another tenant's — which is the same cross-tenant destruction the
       * enterprise record store had, in a store that holds documents and
       * governance decisions.
       */
      const mine = this.items.filter((r) => recordInScope(r, scope));
      const overflow = mine.length - this.cap;
      const evicted = overflow > 0 ? mine.slice(0, overflow) : [];
      if (evicted.length > 0) {
        const doomed = new Set(evicted);
        this.items = this.items.filter((r) => !doomed.has(r));
      }
      // Subclasses that own something OUTSIDE this file — a document's bytes,
      // say — need to know what fell off the end. Governance records own
      // nothing, so the default does nothing.
      this.onEvicted(evicted);
    }
    this.schedulePersist();
    return item;
  }

  /** Called with the entries the cap pushed out. Override to clean up. */
  protected onEvicted(_evicted: readonly T[]): void {
    /* nothing by default */
  }

  /** In-place update of an already-appended item; returns the updated item. */
  /**
   * In-place update of an already-appended item; returns the updated item.
   *
   * REFUSES an out-of-scope item. Subclasses resolve the item through
   * `visible()` so this should be unreachable — which is exactly why it is
   * checked: a future subclass that resolves an item some other way must not
   * find a mutation path that skipped the boundary. `tenantId`/`workspaceId`
   * are never patchable, so a record cannot be moved between tenants.
   */
  protected mutate(item: T, patch: Partial<T>): T | null {
    const scope = this.scopeOrDeny();
    if (scope === null || !recordInScope(item, scope)) return null;
    const { tenantId: _t, workspaceId: _w, ...safe } = patch as Partial<ScopedRecord> & Partial<T>;
    Object.assign(item, safe);
    this.schedulePersist();
    return item;
  }

  /**
   * Drop items and persist.
   *
   * Governance records are append-only and never use this. Documents are not
   * governance records — a person who uploads the wrong file is entitled to
   * remove it, and the removal has to reach disk or it reappears on restart.
   * Returns what was removed so a caller can clean up anything the record
   * owned, such as its bytes.
   */
  protected removeWhere(pred: (item: T) => boolean): T[] {
    const scope = this.scopeOrDeny();
    // No scope, no deletions. A caller-supplied predicate must never be able to
    // reach another tenant's records, so the scope is ANDed in here rather than
    // trusted to each subclass's predicate.
    if (scope === null) return [];
    const removed: T[] = [];
    this.items = this.items.filter((item) => {
      if (!recordInScope(item, scope) || !pred(item)) return true;
      removed.push(item);
      return false;
    });
    if (removed.length > 0) this.schedulePersist();
    return removed;
  }

  /** Newest first, bounded, within scope. */
  list(limit = 100): T[] {
    return this.visible().reverse().slice(0, Math.max(1, Math.min(limit, 500)));
  }

  /**
   * How many records this caller can see.
   *
   * Scoped, because an install-wide count is a disclosure — it answers "does the
   * other tenant have documents" without returning one.
   */
  count(): number {
    return this.visible().length;
  }

  private schedulePersist(): void {
    this.dirty = true;
    if (this.persisting) return;
    this.persisting = true;
    this.lastPersist = this.drain();
  }

  private async drain(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        // The FILE holds every tenant's records — the boundary is a read filter,
        // not separate files. See the trust-boundary note in the security doc.
        const file: StoreFile<T> = { ...envelopeStamp(), records: this.items };
        const tmp = `${this.filePath}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
        await fs.rename(tmp, this.filePath);
      }
    } catch {
      // A failed governance-record write must never fail the act it records.
    } finally {
      this.persisting = false;
    }
  }

  /** Await the in-flight write. Tests and shutdown use this. */
  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }
}
