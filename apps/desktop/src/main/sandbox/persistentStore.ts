/**
 * AI Sandbox — persistence base (S1).
 *
 * The reusable store substrate every sandbox store extends. It captures the
 * proven pattern already used across the app (EventEmitter for live refresh +
 * debounced atomic writes with a unique temp filename so concurrent saves never
 * collide, 0600) exactly once, so the concrete stores only own their data + queries.
 * Electron-free — the file path is injected, so every store unit-tests on a temp file.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

export abstract class PersistentStore<F> extends EventEmitter {
  protected loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  constructor(protected readonly filePath: string) {
    super();
  }

  /** Serialize the in-memory state to the persisted file shape. */
  protected abstract snapshot(): F;
  /** Rebuild the in-memory state from a (possibly partial) persisted file. */
  protected abstract hydrate(data: Partial<F>): void;

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      this.hydrate(JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<F>);
    } catch {
      // First run / unreadable — start empty.
    }
    this.loaded = true;
  }

  /** Signal a mutation: notify listeners + schedule a durable write. */
  protected changed(): void {
    this.emit('changed');
    this.schedulePersist();
  }

  /** Await any in-flight persist (tests). */
  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
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
        await this.write();
      }
    } catch {
      // Best-effort persistence; in-memory state remains the source of truth this session.
    } finally {
      this.persisting = false;
    }
  }

  private async write(): Promise<void> {
    const tmp = `${this.filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.mkdir(dirname(this.filePath), { recursive: true }).catch(() => undefined);
    await fs.writeFile(tmp, JSON.stringify(this.snapshot()), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }
}
