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
import { readStoreFile, envelopeStamp } from '../storage/storeEnvelope';

interface StoreFile<T> {
  schemaVersion?: number;
  records: T[];
}

export abstract class AppendOnlyJsonStore<T extends { id: string }> {
  protected items: T[] = [];
  private loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  protected constructor(
    private readonly filePath: string,
    private readonly cap: number,
    protected readonly now: () => string,
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    const result = await readStoreFile<Partial<StoreFile<T>>>(this.filePath);
    if (result.state === 'loaded' && Array.isArray(result.data?.records)) {
      this.items = result.data.records.filter((r): r is T => Boolean(r && (r as T).id));
    }
    this.loaded = true;
  }

  protected append(item: T): void {
    this.items.push(item);
    if (this.items.length > this.cap) this.items.splice(0, this.items.length - this.cap);
    this.schedulePersist();
  }

  /** In-place update of an already-appended item; returns the updated item. */
  protected mutate(item: T, patch: Partial<T>): T {
    Object.assign(item, patch);
    this.schedulePersist();
    return item;
  }

  /** Newest first, bounded. */
  list(limit = 100): T[] {
    return [...this.items].reverse().slice(0, Math.max(1, Math.min(limit, 500)));
  }

  count(): number {
    return this.items.length;
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
