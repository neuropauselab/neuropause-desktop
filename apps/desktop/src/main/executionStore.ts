/**
 * ExecutionStore (V5.8) — durable persistence for Execute Engine sessions.
 *
 * The ExecuteEngine stays unaware of storage: it calls an injected `persist`
 * callback; this store implements it. Sessions survive restart, are recovered on
 * launch (in-flight → interrupted, never rerun), and are bounded + retention-
 * pruned. Writes reuse the race-safe atomic pattern proven in HealthHistoryStore
 * (serialized write queue + unique temp filename) so concurrent saves never
 * collide on a shared temp path.
 */
import { promises as fs, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ExecutionSession } from '@neuropause/shared';

interface ExecutionFile {
  sessions: ExecutionSession[];
}

/** Keep at most this many sessions on disk (newest first). */
const MAX_PERSISTED = 500;

export class ExecutionStore {
  private sessions: ExecutionSession[] = [];
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  /** Synchronous load at startup (before the engine seeds its history). */
  loadAllSync(): ExecutionSession[] {
    if (!this.loaded) {
      this.loaded = true;
      try {
        const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<ExecutionFile>;
        this.sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
      } catch {
        this.sessions = [];
      }
    }
    return [...this.sessions];
  }

  /** Upsert a session by id (newest first) and persist. */
  save(session: ExecutionSession): Promise<void> {
    if (!this.loaded) this.loadAllSync();
    const idx = this.sessions.findIndex((s) => s.id === session.id);
    const snapshot: ExecutionSession = { ...session, steps: session.steps.map((x) => ({ ...x })) };
    if (idx >= 0) this.sessions[idx] = snapshot;
    else this.sessions.unshift(snapshot);
    if (this.sessions.length > MAX_PERSISTED) this.sessions.length = MAX_PERSISTED;
    return this.persist();
  }

  /** Replace the whole set (used after startup recovery marks interrupted). */
  replaceAll(sessions: ExecutionSession[]): Promise<void> {
    this.loaded = true;
    this.sessions = sessions.slice(0, MAX_PERSISTED).map((s) => ({ ...s }));
    return this.persist();
  }

  /**
   * Drop sessions whose completedAt is older than the retention window. Returns
   * the number pruned. `retentionMs <= 0` means unlimited (no pruning).
   */
  archiveOlderThan(retentionMs: number, nowMs: number = Date.now()): Promise<number> {
    if (!this.loaded) this.loadAllSync();
    if (retentionMs <= 0) return Promise.resolve(0).then((n) => n);
    const before = this.sessions.length;
    this.sessions = this.sessions.filter((s) => {
      const done = s.completedAt ? Date.parse(s.completedAt) : nowMs;
      return Number.isNaN(done) || nowMs - done <= retentionMs;
    });
    const pruned = before - this.sessions.length;
    return this.persist().then(() => pruned);
  }

  private persist(): Promise<void> {
    const run = this.writeChain.then(() => this.writeNow());
    this.writeChain = run.catch(() => {});
    return run;
  }

  private async writeNow(): Promise<void> {
    const file: ExecutionFile = { sessions: this.sessions };
    const tmp = `${this.filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.mkdir(dirname(this.filePath), { recursive: true }).catch(() => {});
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }
}
