/**
 * Notification Inbox Store (Phase 6 Stage 5) — durable persistence for
 * delivered notifications, in the proven ExecutionStore pattern (synchronous
 * load, serialized atomic writes, bounded retention). The store is dumb: it
 * holds what the EXISTING delivery engine delivered through its (previously
 * typed-only) `notification-center` channel. It generates nothing, schedules
 * nothing, and gates nothing — cadence, priority, DND, and mutes all happened
 * upstream. Electron-free: the file path is injected.
 */
import { promises as fs, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { InboxNotification, NotificationInboxPage, TenantScope } from '@neuropause/shared';
import { ownershipOf, recordInScope } from '@neuropause/shared';
import { registerTenantStore } from '../tenancy/tenantOwnedStore';
import { declareStoreScope } from '../tenancy/storeScope';

/**
 * P13C ROUND 10 — NEW-H1. The structural scope declaration. See tenancy/storeScope.ts.
 *
 * The file satisfied the gate through `registerTenantStore` alone, which asks
 * "is a boundary bound?" and never asks "what does a REMOVAL reach?". The answer
 * was: everybody's rows. Stating retention is the point of this declaration.
 */
declareStoreScope({
  name: 'notification-inbox',
  scope: 'TENANT',
  persistence: 'file',
  /**
   * The only user-facing mutation is `notifications:markRead`, which flips read
   * state on the CALLER'S OWN rows and is gated by no role. Delivery itself is
   * SYSTEM work: the engine writes under the event's tenant principal, never
   * under a person's authority.
   */
  authority: 'USER',
  classification: 'CUSTOMER_DERIVED',
  /**
   * P13C ROUND 10 — the enum half of NEW-H1, which is the half that can be
   * checked. The prose below said "capped PER OWNER" from the moment the fix
   * landed, and prose is what let the install-wide version ship for nine rounds.
   * `TENANT` + `INSTALL` now throws at construction, so the pre-fix behaviour is
   * no longer expressible in a declaration at all.
   */
  retentionScope: 'OWNER',
  retentionAuthority: 'SYSTEM',
  retention:
    'The inbox is capped PER OWNER (MAX_INBOX rows for each (tenant, workspace) pair — exactly the ' +
    'pair `recordInScope` enforces on every read) as of Round 10. It was ONE install-wide ' +
    'truncation — `items.length = MAX_INBOX` over the single shared array, then persisted — and ' +
    "because `add` unshifts, the rows it dropped were the globally oldest: another tenant's. A " +
    'tenant delivering past the cap deleted every other tenant\'s notifications from disk while all ' +
    'four reads (`visible`, `markRead`, `page`, the (scope,id) de-dupe) stayed perfectly scoped. ' +
    'Rows with no resolvable owner are retained in their own bucket, evictable by nobody else\'s ' +
    'traffic and visible to nobody. There is no other delete path: `add` replaces only same-(scope,id) ' +
    'rows and `markRead` removes nothing. ' +
    'THE TRIGGER IS PER OWNER TOO, not just the victim selection: `capPerOwner` counts into a ' +
    "per-bucket tally and drops only rows past that bucket's own budget — there is no " +
    '`if (this.items.length > MAX_INBOX)` over the shared array left to fire on somebody else\'s ' +
    'volume, which is the half of this finding class that survives a correct-looking eviction. ' +
    '`writeNow()` serializes `this.items` whole and applies no second cap, so the bytes on disk ' +
    'cannot disagree with memory.',
  reason:
    'A notification BODY is business data — the delivered title interpolates the subject\'s name, the ' +
    'connector id, the job id — and item ids are stable per SUBJECT, so two organizations\' alerts ' +
    'about the same kind of subject collide by construction. TENANT rather than WORKSPACE because a ' +
    'bus-driven delivery runs under a tenant-level principal and is stamped workspace-wide (visible ' +
    "from any of that tenant's workspaces); a session-stamped row carries a workspace and is narrowed " +
    'to it, which the retention key honours by bucketing on the same pair the read filter uses.',
});

interface InboxFile {
  items: InboxNotification[];
}

/**
 * Keep at most this many notifications PER OWNER (newest first).
 *
 * Per owner, not per install. See the `retention` line above and `capPerOwner`.
 */
export const MAX_INBOX = 200;

/**
 * The retention budget a row is charged to.
 *
 * It must be EXACTLY the boundary `recordInScope` enforces, or the cap deletes
 * rows the reads say belong to somebody else. `recordInScope` denies a different
 * tenant, treats an absent/empty workspace as tenant-wide, and denies a
 * different workspace — so the pair `(tenantId, workspaceId)` with empty
 * normalised to `null` is the owner, and every row inside one bucket has an
 * IDENTICAL visibility set. Eviction inside a bucket can therefore only remove
 * rows from the very caller whose write caused it.
 *
 * JSON-encoded rather than joined, so a tenant id containing the separator
 * cannot collapse two owners into one budget. A row with no tenant is
 * `[null, null]`, which no owned row can produce (an owned row's tenant is a
 * non-empty string), so unowned rows get their own bucket rather than sharing
 * one with a real tenant.
 */
function inboxOwnerKey(row: { tenantId?: string | null; workspaceId?: string | null }): string {
  const tenant = typeof row.tenantId === 'string' && row.tenantId !== '' ? row.tenantId : null;
  const workspace = typeof row.workspaceId === 'string' && row.workspaceId !== '' ? row.workspaceId : null;
  return JSON.stringify([tenant, workspace]);
}

export class InboxStore {
  private items: InboxNotification[] = [];
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();
  private scopeSource: (() => TenantScope | null) | null = null;

    /**
   * P13C ROUND 3 — PHASE 4. Declare this store to the startup gate.
   *
   * The seam below predates the registry, so the gate could not see it: an
   * unbound instance denied every read (correct) but shipped silently (not
   * correct). One line, so the next store has no excuse to skip it.
   */
  constructor(private readonly filePath: string) {
    registerTenantStore('notification-inbox', () => this.hasScope());
  }

  /** Bind the tenant boundary. Unbound denies. Chainable. */
  /** True once a boundary is bound. Evidence for the startup gate. */
  hasScope(): boolean {
    return this.scopeSource !== null;
  }

  bindScope(source: () => TenantScope | null): this {
    this.scopeSource = source;
    return this;
  }

  private scopeOrDeny(): TenantScope | null {
    return this.scopeSource === null ? null : this.scopeSource();
  }

  /**
   * The items this caller may see.
   *
   * A notification BODY carries business data — the delivered title interpolates
   * the subject's name, the connector id, the job id. So an unscoped inbox meant
   * one tenant's job failure produced a named notification in another tenant's
   * list.
   */
  private visible(): InboxNotification[] {
    const scope = this.scopeOrDeny();
    if (scope === null) return [];
    return this.items.filter((x) => recordInScope(x, scope));
  }

  loadAllSync(): InboxNotification[] {
    if (!this.loaded) {
      this.loaded = true;
      try {
        const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<InboxFile>;
        this.items = Array.isArray(parsed.items) ? parsed.items : [];
      } catch {
        this.items = [];
      }
    }
    return [...this.items];
  }

  /** Ownership counts across every item. Three integers, no content. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    if (!this.loaded) this.loadAllSync();
    let assigned = 0;
    for (const x of this.items) if (ownershipOf(x) === 'assigned') assigned += 1;
    return { total: this.items.length, assigned, unresolved: this.items.length - assigned };
  }

  /** Add a delivered item. Re-delivery of the same id REPLACES (marks unread again). */
  add(item: InboxNotification): Promise<void> {
    if (!this.loaded) this.loadAllSync();
    const scope = this.scopeOrDeny();
    // No tenant, no notification. Delivering it unowned would make it invisible
    // to everyone AND count against the cap, so refusing is the honest outcome.
    if (scope === null) return Promise.resolve();
    const stamped: InboxNotification = {
      ...item,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
    };
    /**
     * The de-dupe key is (SCOPE, id), not id.
     *
     * Item ids are deliberately "stable per SUBJECT, not per occurrence" so a
     * repeated alert does not pile up. Across tenants that made them COLLIDE:
     * two tenants' notifications about the same subject overwrote each other, so
     * one tenant's alert silently replaced the other's.
     */
    this.items = this.items.filter(
      (x) => !(x.id === item.id && recordInScope(x, scope)),
    );
    this.items.unshift(stamped);
    this.capPerOwner();
    return this.persist();
  }

  /**
   * Hold the newest MAX_INBOX rows FOR EACH OWNER. P13C ROUND 10 — NEW-H1.
   *
   * WHAT THIS REPLACED, AND WHY EVERY READ BEING CORRECT DID NOT HELP
   *
   *     if (this.items.length > MAX_INBOX) this.items.length = MAX_INBOX;
   *
   * One shared array, truncated by whoever wrote last, then `persist()` wrote
   * the truncated result to disk. `add()` unshifts, so the rows that fell off
   * the end were the globally oldest — which, the moment a second tenant
   * existed, meant somebody else's. Tenant B holding three notifications lost
   * all three, from memory AND from `inbox.json`, when tenant A delivered 200.
   *
   * A filter HIDES a row; a cap DELETES one. `visible()`, `markRead()`,
   * `page()` and the (scope,id) de-dupe were all hardened in P12 and all stayed
   * green through the whole regression, because none of them is the write.
   *
   * `this.items` is newest-first by construction (`add` unshifts, `markRead`
   * maps in place, the load preserves file order), so walking it front-to-back
   * visits each owner's rows newest-first and the first MAX_INBOX seen for a
   * bucket are the ones to keep. Same shape as
   * `ecosystem/marketplace/marketplaceStore.event()` and
   * `graph/graphStore.capHistoryPerTenant()`.
   *
   * THE HONEST TRADE, STATED: an install with more tenants now holds more rows.
   * The alternative is one customer able to delete another's, which is the
   * finding.
   */
  private capPerOwner(): void {
    const perOwner = new Map<string, number>();
    const kept = new Set<InboxNotification>();
    let overflowed = false;
    for (const row of this.items) {
      const key = inboxOwnerKey(row);
      const n = perOwner.get(key) ?? 0;
      if (n < MAX_INBOX) {
        kept.add(row);
        perOwner.set(key, n + 1);
      } else {
        overflowed = true;
      }
    }
    if (overflowed) this.items = this.items.filter((row) => kept.has(row));
  }

  /** Mark specific ids (or every item) read. Returns how many changed. */
  markRead(ids: string[] | 'all'): Promise<number> {
    if (!this.loaded) this.loadAllSync();
    const scope = this.scopeOrDeny();
    if (scope === null) return Promise.resolve(0);
    const set = ids === 'all' ? null : new Set(ids);
    let changed = 0;
    this.items = this.items.map((x) => {
      // `'all'` means all of MINE. It used to clear every tenant's unread state.
      if (!recordInScope(x, scope)) return x;
      if (!x.read && (set === null || set.has(x.id))) {
        changed += 1;
        return { ...x, read: true };
      }
      return x;
    });
    if (changed === 0) return Promise.resolve(0);
    return this.persist().then(() => changed);
  }

  page(limit = 50): NotificationInboxPage {
    if (!this.loaded) this.loadAllSync();
    const mine = this.visible();
    return {
      items: mine.slice(0, Math.max(1, limit)),
      unread: mine.filter((x) => !x.read).length,
      // Scoped: an install-wide total is the badge telling one tenant how busy
      // another one is.
      total: mine.length,
    };
  }

  unreadCount(): number {
    if (!this.loaded) this.loadAllSync();
    return this.visible().filter((x) => !x.read).length;
  }

  private persist(): Promise<void> {
    const run = this.writeChain.then(() => this.writeNow());
    this.writeChain = run.catch(() => {});
    return run;
  }

  private async writeNow(): Promise<void> {
    const file: InboxFile = { items: this.items };
    const tmp = `${this.filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.mkdir(dirname(this.filePath), { recursive: true }).catch(() => {});
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }
}
