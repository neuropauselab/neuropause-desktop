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

interface InboxFile {
  items: InboxNotification[];
}

/** Keep at most this many notifications (newest first). */
export const MAX_INBOX = 200;

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
    if (this.items.length > MAX_INBOX) this.items.length = MAX_INBOX;
    return this.persist();
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
