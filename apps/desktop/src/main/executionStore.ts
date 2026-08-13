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
import type { TenantScope } from '@neuropause/shared';
import { TenantOwnership } from './tenancy/tenantOwnedStore';
import { declareStoreScope } from './tenancy/storeScope';

/**
 * P13C ROUND 10 — the structural scope declaration. See tenancy/storeScope.ts.
 *
 * Two of this program's install-wide caps were in THIS FILE, four hours apart
 * (`save`, then `replaceAll`), and it still satisfied the gate on
 * `new TenantOwnership(...)`, which takes no retention argument. There is
 * a third removal below that neither fix touched; it is named honestly.
 */
declareStoreScope({
  name: 'execute-engine-sessions',
  scope: 'TENANT',
  persistence: 'file',
  /** Nothing deletes a session through a user surface; the engine writes, boot recovery replaces. */
  authority: 'SYSTEM',
  classification: 'CUSTOMER_DERIVED',
  retentionScope: 'OWNER',
  retentionAuthority: 'SYSTEM',
  retention:
    'Three removals. (1) `save` caps at MAX_PERSISTED=500 through `TenantOwnership.pruneOwn`, ' +
    'which evicts only the CALLER\'S oldest by `startedAt`; it was `sessions.length = 500`, ' +
    "install-wide and newest-first, so one tenant's activity truncated another's durable history " +
    '(Round 5). (2) `replaceAll` — boot recovery, which runs before any organization is active — ' +
    'buckets by `session.tenantId` and slices 500 WITHIN EACH BUCKET; it was a flat ' +
    '`slice(0, 500)` over a newest-first file, which is the same defect re-applied on every start ' +
    'that found an interrupted session. (3) `archiveOlderThan(retentionMs)` drops every session ' +
    'whose `completedAt` is older than the window REGARDLESS OF OWNER. It is uniform and ' +
    'age-based rather than volume-based, so no tenant can aim it at another, and it has NO ' +
    'PRODUCTION CALLER — `executionStore.test.ts` is the only caller in the repo. If a retention ' +
    'setting is ever wired to it, the window must come from the owning tenant and the sweep must ' +
    'be per owner, or it becomes one tenant\'s policy deleting another tenant\'s evidence.',
  reason:
    '`ExecutionSession.result` is the full structured output of every executed action — an ' +
    'assistant answer, an automation run, a memory recall, the executive snapshot, a workforce ' +
    'job. Nothing reads the file except boot recovery, and the ring it feeds filters on read, so ' +
    'this is the DESTRUCTION half of the boundary rather than the disclosure half.',
});

interface ExecutionFile {
  sessions: ExecutionSession[];
}

/** Keep at most this many sessions on disk (newest first). */
const MAX_PERSISTED = 500;

export class ExecutionStore {
  /**
   * P13C ROUND 5 — TENANT-SCOPED. The durable half of a ring that was made
   * per-tenant one round ago.
   *
   * `ExecutionSession.result` is the full structured output of every executed
   * action — an assistant answer, an automation run, a memory recall, the whole
   * executive snapshot, a workforce job. Round 2 fixed the in-memory ring: reads
   * filter on owner and `pruneHistoryForOwner` evicts per tenant. THE FILE
   * BEHIND IT WAS NOT TOUCHED, so a flat 500-row cap still evicted install-wide
   * — a busy tenant destroyed another tenant's durable execution record, and
   * after a restart `seedHistory` could not restore what the file had dropped.
   *
   * Not a disclosure: nothing reads this file except boot recovery, and the ring
   * it feeds filters on read. It is the destruction half of the same defect, and
   * it is the reason retention keeps appearing in this program — a cap is a
   * write, and writes need owners too.
   */
  private readonly tenancy = new TenantOwnership('execute-engine-sessions');

  /** Bind the tenant boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.tenancy.hasScope();
  }
  /** Unscoped ownership counts, for the migration inventory. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    return this.tenancy.countOwnership(this.sessions);
  }

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
    /**
     * PER-TENANT CAP. Was `sessions.length = MAX_PERSISTED`, install-wide and
     * newest-first, so one tenant's activity truncated another's durable
     * history. `pruneOwn` evicts only the caller's oldest.
     */
    this.sessions = this.tenancy.pruneOwn(
      this.sessions,
      MAX_PERSISTED,
      (a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0),
    );
    return this.persist();
  }

  /** Replace the whole set (used after startup recovery marks interrupted). */
  /** Replace the persisted set. Boot recovery only. */
  replaceAll(sessions: ExecutionSession[]): Promise<void> {
    this.loaded = true;
    /**
     * P13C ROUND 5 — THE BOOT PATH HAD THE SAME FLAT CAP `save()` JUST LOST.
     *
     * `save()` was changed to `pruneOwn` and this line was not, so every boot
     * that found an interrupted session re-applied an install-wide,
     * newest-first `slice(0, 500)` — and the file is newest-first, so a tenant
     * generating 500 sessions pushed another tenant's rows past the cut and the
     * next start deleted them permanently.
     *
     * Found by the sweep, in the fix from four hours earlier. The lesson is the
     * one this program keeps relearning: a retention cap is a WRITE, and there
     * is always more than one of them.
     *
     * Recovery runs before any organization is active, so there is no caller to
     * scope to. The cap is therefore applied PER OWNER over the whole file,
     * which is what `pruneOwn` would do if a scope existed and is the only
     * correct answer when one does not.
     */
    const byOwner = new Map<string, ExecutionSession[]>();
    for (const session of sessions) {
      const owner = session.tenantId ?? '';
      const bucket = byOwner.get(owner);
      if (bucket) bucket.push(session);
      else byOwner.set(owner, [session]);
    }
    this.sessions = [...byOwner.values()]
      .flatMap((bucket) => bucket.slice(0, MAX_PERSISTED))
      .map((s) => ({ ...s }));
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
