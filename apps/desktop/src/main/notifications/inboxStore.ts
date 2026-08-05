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
import type { InboxNotification, NotificationInboxPage } from '@neuropause/shared';

interface InboxFile {
  items: InboxNotification[];
}

/** Keep at most this many notifications (newest first). */
export const MAX_INBOX = 200;

export class InboxStore {
  private items: InboxNotification[] = [];
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

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

  /** Add a delivered item. Re-delivery of the same id REPLACES (marks unread again). */
  add(item: InboxNotification): Promise<void> {
    if (!this.loaded) this.loadAllSync();
    this.items = this.items.filter((x) => x.id !== item.id);
    this.items.unshift({ ...item });
    if (this.items.length > MAX_INBOX) this.items.length = MAX_INBOX;
    return this.persist();
  }

  /** Mark specific ids (or every item) read. Returns how many changed. */
  markRead(ids: string[] | 'all'): Promise<number> {
    if (!this.loaded) this.loadAllSync();
    const set = ids === 'all' ? null : new Set(ids);
    let changed = 0;
    this.items = this.items.map((x) => {
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
    return {
      items: this.items.slice(0, Math.max(1, limit)),
      unread: this.items.filter((x) => !x.read).length,
      total: this.items.length,
    };
  }

  unreadCount(): number {
    if (!this.loaded) this.loadAllSync();
    return this.items.filter((x) => !x.read).length;
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
