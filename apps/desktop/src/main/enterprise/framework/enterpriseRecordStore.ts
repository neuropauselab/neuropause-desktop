/**
 * EnterpriseRecordStore — the generic, offline-first persistence every ERP
 * module inherits. One store instance backs one module; records are the flat
 * `EnterpriseEntity` shape, persisted as atomic JSON under userData (the proven
 * pattern used by the org / decision / automation stores).
 *
 * Electron-free by construction (the file path is injected), so it unit-tests on
 * a temp file. It holds no module-specific logic — validation, permissions, and
 * lifecycle side-effects (audit / timeline / broadcast) live in the module +
 * registry layers, keeping this store pure and reusable across every module.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  EnterpriseEntity,
  EnterpriseFieldValue,
  EnterpriseRecordMeta,
  EnterpriseRecordQuery,
  EnterpriseRecordStatus,
} from '@neuropause/shared';
import type { TenantScope } from '@neuropause/shared';
import {
  canTransitionRecordStatus,
  matchesRecordSearch,
  ownershipOf,
  recordInScope,
} from '@neuropause/shared';
import { envelopeStamp, readStoreFile } from '../../storage/storeEnvelope';
import { createLogger } from '../../logger';

const log = createLogger('enterprise-record-store');

interface RecordFile {
  /** Phase 8 (8.3): store schema stamp — absent on legacy files (= v1). */
  schemaVersion?: number;
  moduleId: string;
  records: EnterpriseEntity[];
}

/** Assembled, already-validated data for a new record. */
export interface CreateRecordInput {
  title: string;
  fields: Record<string, EnterpriseFieldValue>;
  tags?: string[];
  metadata?: EnterpriseRecordMeta;
  actor?: string | null;
  now?: string;
  /** Explicit id (tests / deterministic seeds); otherwise a uuid. */
  id?: string;
}

/** A partial change to an existing record. `fields`/`metadata` merge, not replace. */
export interface UpdateRecordInput {
  title?: string;
  fields?: Record<string, EnterpriseFieldValue>;
  tags?: string[];
  metadata?: EnterpriseRecordMeta;
  actor?: string | null;
  now?: string;
}

const DEFAULT_MAX_RECORDS = 50_000;

/**
 * Where the caller is allowed to read and write.
 *
 * A FUNCTION, not a value, because the active workspace changes at runtime and
 * a value captured at construction would be the "decorative field" failure the
 * Program 10 service authorizer already documented: a scope that was correct at
 * boot and wrong after a switch.
 *
 * Returning `null` means "I cannot tell you" — during cold start, with no
 * session, or when the active workspace names an organization that does not
 * exist. Every read below treats `null` as DENY, not as "unfiltered".
 */
export type TenantScopeSource = () => TenantScope | null;

/**
 * A process-wide fallback scope, for TESTS ONLY.
 *
 * WHY THIS EXISTS, AND WHY IT IS SAFE
 *
 * `bindScope` is called once for all 106 production stores, through the module
 * registry. But 85 test files construct modules directly through their
 * `create*Module(path)` factories, which never touch the registry — so every one
 * of them would have to bind by hand, and 85 hand-edits is 85 chances to bind
 * the wrong thing.
 *
 * The fallback closes that with one line in a test setup file. It is safe
 * because of three properties, all of which have to hold:
 *
 *  1. A per-store binding ALWAYS wins. Production binds every store explicitly,
 *     so production never reads this value.
 *  2. It starts `null`, and null still DENIES. Forgetting to set it fails the
 *     tests rather than opening the boundary.
 *  3. The setter REFUSES outside a test runner. Not by convention — it throws.
 *
 * Property 3 is the one that matters. Without it this is an ambient global that
 * some future code path sets in production, which would be a boundary with a
 * documented bypass.
 */
let ambientScopeSource: TenantScopeSource | null = null;

/**
 * Set the test-only fallback scope. Throws outside a test runner.
 *
 * The guard reads `VITEST`, which the runner sets and which nothing in the
 * packaged app sets. An environment check is weaker than a compile-time
 * separation would be, and a compile-time separation is not available here
 * because the production and test code import the same module — so the check is
 * a throw rather than a silent no-op, which makes a misuse a crash at the call
 * site instead of a quiet permission grant.
 */
export function setAmbientTenantScopeForTests(source: TenantScopeSource | null): void {
  if (process.env.VITEST === undefined && process.env.NODE_ENV !== 'test') {
    throw new Error(
      'setAmbientTenantScopeForTests is a test-only seam and must not be called at runtime.',
    );
  }
  ambientScopeSource = source;
}

/** How many records a store holds, split by whether their owner is known. */
export interface RecordOwnershipCounts {
  total: number;
  assigned: number;
  unresolved: number;
}

export class EnterpriseRecordStore extends EventEmitter {
  private records = new Map<string, EnterpriseEntity>();
  private loaded = false;
  private lastPersist: Promise<void> = Promise.resolve();
  private persisting = false;
  private dirty = false;

  /**
   * The tenant boundary for this store.
   *
   * Unbound until `bindScope` is called, and UNBOUND DENIES — see
   * `scopeOrDeny`. This is the enforcement mechanism the program rests on:
   * there is no unscoped read on this class, so a new caller cannot accidentally
   * perform a global one, and 106 stores are covered by one predicate instead of
   * 140 hand-written filters.
   */
  private scopeSource: TenantScopeSource | null = null;

  constructor(
    private readonly filePath: string,
    private readonly moduleId: string,
    private readonly kind: string,
    private readonly maxRecords: number = DEFAULT_MAX_RECORDS,
  ) {
    super();
  }

  /**
   * Bind the tenant boundary.
   *
   * A method rather than a constructor argument, and the trade-off is worth
   * naming. A required constructor argument would be stronger — it would make an
   * unscoped store unconstructable — but there are 106 production instances and
   * 24 test files, and threading it through every module factory in one commit
   * is a 130-file diff where one missed site fails open silently. Binding leaves
   * a window, so the window is closed the other way: UNBOUND DENIES. A store
   * nobody bound returns nothing, which fails loudly in a test rather than
   * quietly in production.
   */
  bindScope(source: TenantScopeSource): this {
    this.scopeSource = source;
    // Returns `this` so a store can be constructed and bound in one expression.
    // That matters for the ~40 test sites: an appended call is a mechanical,
    // reviewable edit, where threading a constructor argument through would have
    // touched 130 files and any missed one fails open.
    return this;
  }

  /** Whether a boundary has been bound. For the migration inventory. */
  hasScope(): boolean {
    return this.scopeSource !== null;
  }

  /**
   * The active scope, or `null` meaning DENY. Named as a decision, not a read.
   *
   * An explicit per-store binding always wins over the test fallback, so
   * production — which binds every store through the registry — never consults
   * the fallback at all.
   */
  private scopeOrDeny(): TenantScope | null {
    const source = this.scopeSource ?? ambientScopeSource;
    return source === null ? null : source();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    // Phase 8 (8.3): envelope read — ENOENT is the only "empty" signal; a
    // corrupt or future-versioned file is QUARANTINED beside itself (bytes
    // preserved for recovery) instead of being silently treated as first-run.
    const result = await readStoreFile<Partial<RecordFile>>(this.filePath);
    if (result.state === 'loaded' && result.data) {
      for (const r of result.data.records ?? []) if (r?.id) this.records.set(r.id, r);
    } else if (result.state !== 'first-run') {
      this.quarantinedTo = result.quarantinedTo;
      this.emit('quarantined', { moduleId: this.moduleId, path: result.quarantinedTo });
    }
    this.loaded = true;
  }

  /** Where a corrupt/newer store file was preserved at load, if any. */
  quarantinedTo: string | null = null;

 private async persist(): Promise<void> {
    const file: RecordFile = { ...envelopeStamp(), moduleId: this.moduleId, records: [...this.records.values()] };
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    // Windows: antivirus/indexer can briefly hold the destination, failing rename
    // with EPERM/EACCES/EBUSY. Retry with short backoff before giving up.
    for (let attempt = 1; ; attempt++) {
      try {
        await fs.rename(tmp, this.filePath);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        const retryable = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
        if (!retryable || attempt >= 5) throw err;
        await new Promise((r) => setTimeout(r, 20 * attempt));
      }
    }
  }

  private schedulePersist(): void {
    this.dirty = true;
    if (this.persisting) return;
    this.persisting = true;
    this.lastPersist = this.drainPersist();
  }

  private async drainPersist(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        await this.persist();
      }
    } catch (err) {
      /**
       * A FAILED BACKGROUND WRITE IS LOGGED, NEVER UNHANDLED.
       *
       * This was the only store in the codebase whose background writer had no
       * catch — `AppendOnlyJsonStore.drain`, `MemoryStore.drainPersist` and
       * `GraphStore.drainPersist` all have one. `schedulePersist` assigns the
       * promise to `lastPersist` and does NOT await it (that is the point of
       * coalescing), so anything thrown here became an unhandled rejection
       * rather than an error anyone could see: in production that can take down
       * the main process on a transient disk fault, and it cannot be caught by
       * the caller because the caller has already returned.
       *
       * Surfaced by a real race — a store persisting in the background while
       * its directory is removed underneath it, which macOS reports as EINVAL
       * on rename and Linux as ENOENT. The durability contract is unchanged:
       * `flush()` still awaits the in-flight write, and callers that need the
       * bytes on disk still use it.
       */
      log.error('Enterprise record store persist failed', {
        moduleId: this.moduleId,
        error: String(err),
      });
    } finally {
      this.persisting = false;
    }
  }

  /** Await any in-flight write (used by tests + graceful shutdown). */
  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  private touch(): void {
    this.schedulePersist();
    this.emit('changed');
  }

  /* ── reads ── */

  /**
   * One record by id, or null.
   *
   * Returns the SAME `null` for "does not exist", "belongs to another tenant"
   * and "no scope could be resolved". Indistinguishable on purpose: a distinct
   * error for the middle case would confirm a record with that id exists
   * somewhere, turning every id-addressed read into an existence oracle.
   */
  get(id: string): EnterpriseEntity | null {
    const scope = this.scopeOrDeny();
    if (scope === null) return null;
    const record = this.records.get(id);
    if (record === undefined) return null;
    return recordInScope(record, scope) ? record : null;
  }

  /** Records matching the query, newest-updated first. Excludes `deleted` unless asked. */
  list(query: EnterpriseRecordQuery = {}): EnterpriseEntity[] {
    const scope = this.scopeOrDeny();
    // No scope, no rows. NOT "no scope, all rows" — which is what a filter
    // written as `if (scope) …` degrades to, and why this is an early return.
    if (scope === null) return [];
    const status = query.status;
    let out = [...this.records.values()].filter((r) => {
      if (!recordInScope(r, scope)) return false;
      if (status) return r.status === status;
      return r.status !== 'deleted';
    });
    if (query.search) out = out.filter((r) => matchesRecordSearch(r, query.search as string));
    out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return typeof query.limit === 'number' ? out.slice(0, query.limit) : out;
  }

  search(query: string, limit = 50): EnterpriseEntity[] {
    return this.list({ search: query, limit });
  }

  /**
   * Count by status (default: everything except `deleted`), WITHIN SCOPE.
   *
   * Scoped for the same reason the reads are: an install-wide count is a
   * disclosure. It told every tenant how many customers the install held, it was
   * printed into every export's README as "N of M in the module", and one
   * consumer used it as a cache-invalidation signature — which made it a live
   * oracle for another tenant's write activity.
   */
  count(status?: EnterpriseRecordStatus): number {
    const scope = this.scopeOrDeny();
    if (scope === null) return 0;
    let n = 0;
    for (const r of this.records.values()) {
      if (!recordInScope(r, scope)) continue;
      if (status ? r.status === status : r.status !== 'deleted') n += 1;
    }
    return n;
  }

  /* ── migration surface ────────────────────────────────────────────────── */

  /**
   * Ownership counts across EVERY record, ignoring scope.
   *
   * The one deliberate exception to the boundary, and it is safe because it
   * returns three integers and no record content — no id, no title, no field
   * value. Without it the migration inventory would be written from assumption,
   * and "how many records has nobody claimed" is exactly the question an
   * operator has to be able to ask.
   */
  ownershipCounts(): RecordOwnershipCounts {
    let assigned = 0;
    let unresolved = 0;
    for (const r of this.records.values()) {
      if (r.status === 'deleted') continue;
      if (ownershipOf(r) === 'assigned') assigned += 1;
      else unresolved += 1;
    }
    return { total: assigned + unresolved, assigned, unresolved };
  }

  /**
   * Claim unresolved records for a tenant. Explicit, audited, never automatic.
   *
   * The ONLY way a pre-P11 record gains an owner. Not called at load, not on
   * first read, and not when a tenant finds a module empty — each of those would
   * be a guess dressed as a migration. A record that already has an owner is
   * never touched.
   *
   * Returns how many it claimed, so the caller audits a number it did not
   * compute itself.
   */
  claimUnresolved(scope: TenantScope, opts: { actor?: string | null; now?: string } = {}): number {
    const now = opts.now ?? new Date().toISOString();
    let claimed = 0;
    for (const [id, record] of this.records) {
      if (ownershipOf(record) === 'assigned') continue;
      this.records.set(id, {
        ...record,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        rev: record.rev + 1,
        updatedAt: now,
        updatedBy: opts.actor ?? record.updatedBy,
      });
      claimed += 1;
    }
    if (claimed > 0) this.touch();
    return claimed;
  }

  /* ── mutations ── */

  /**
   * Create a record inside the active scope.
   *
   * THROWS when no scope can be resolved, and that asymmetry with the reads is
   * deliberate. A read that returns nothing is a correct, quiet answer — the
   * caller sees an empty list. A write with no owner would produce exactly the
   * unresolved record this program exists to eliminate, silently, at runtime,
   * forever. So a read denies and a write refuses out loud.
   */
  create(input: CreateRecordInput): EnterpriseEntity {
    const scope = this.scopeOrDeny();
    if (scope === null) {
      throw new Error(
        `Cannot create a ${this.kind} record: no organization and workspace are active, so it would have no owner.`,
      );
    }
    const now = input.now ?? new Date().toISOString();
    const entity: EnterpriseEntity = {
      id: input.id ?? `rec_${randomUUID()}`,
      moduleId: this.moduleId,
      kind: this.kind,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      title: input.title,
      status: 'active',
      fields: { ...input.fields },
      tags: input.tags ? [...input.tags] : [],
      rev: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: input.actor ?? null,
      updatedBy: input.actor ?? null,
      metadata: { ...(input.metadata ?? {}) },
    };
    this.records.set(entity.id, entity);
    // Eviction is confined to the writing tenant. See `evictOldest`.
    if (this.records.size > this.maxRecords) this.evictOldest(scope);
    this.touch();
    return entity;
  }

  /**
   * Patch a record. Out-of-scope ids resolve to `null`, exactly like a miss.
   *
   * Reads through `this.get(id)` rather than the raw Map on purpose — that is
   * the only scoped door, and a mutation that used the Map directly would be a
   * cross-tenant WRITE, which is strictly worse than a cross-tenant read.
   */
  update(id: string, patch: UpdateRecordInput): EnterpriseEntity | null {
    const prev = this.get(id);
    if (!prev || prev.status === 'deleted') return null;
    const now = patch.now ?? new Date().toISOString();
    const next: EnterpriseEntity = {
      ...prev,
      title: patch.title !== undefined ? patch.title : prev.title,
      fields: patch.fields ? { ...prev.fields, ...patch.fields } : prev.fields,
      tags: patch.tags ? [...patch.tags] : prev.tags,
      metadata: patch.metadata ? { ...prev.metadata, ...patch.metadata } : prev.metadata,
      rev: prev.rev + 1,
      updatedAt: now,
      updatedBy: patch.actor ?? prev.updatedBy,
    };
    this.records.set(id, next);
    this.touch();
    return next;
  }

  setStatus(
    id: string,
    status: EnterpriseRecordStatus,
    opts: { actor?: string | null; now?: string } = {},
  ): EnterpriseEntity | null {
    // Scoped read, not the raw Map. `softDelete` routes through here, so this
    // one line is also what stops a cross-tenant DELETE.
    const prev = this.get(id);
    if (!prev) return null;
    if (prev.status === status) return prev;
    if (!canTransitionRecordStatus(prev.status, status)) return null;
    const now = opts.now ?? new Date().toISOString();
    const next: EnterpriseEntity = {
      ...prev,
      status,
      rev: prev.rev + 1,
      updatedAt: now,
      updatedBy: opts.actor ?? prev.updatedBy,
    };
    this.records.set(id, next);
    this.touch();
    return next;
  }

  /** Soft-delete (status → 'deleted'); the record is retained for sync/audit. */
  softDelete(
    id: string,
    opts: { actor?: string | null; now?: string } = {},
  ): EnterpriseEntity | null {
    return this.setStatus(id, 'deleted', opts);
  }

  /**
   * Evict the writing tenant's oldest non-active record first, else its oldest.
   *
   * SCOPED, and this was a cross-tenant DATA-DESTRUCTION bug. The sort was
   * global and the victim was `all[0]` — the oldest record in the file — so one
   * tenant's writes deleted another tenant's rows, oldest first, which on a real
   * install means whoever had been there longest. Hard delete from the Map: no
   * soft-delete, no `deleted` status, no audit line, no lifecycle event, no
   * recovery. The reachable path is not theoretical — the Data Plane importer
   * writes through `create` and accepts 200,000 rows per table against a 50,000
   * record cap.
   *
   * This makes `maxRecords` a PER-TENANT cap rather than a per-store one. That
   * is the correct semantics and worth saying out loud: a shared cap is a
   * cross-tenant denial of service by construction, because filling it is
   * something any tenant can do.
   */
  private evictOldest(scope: TenantScope): void {
    const mine = [...this.records.values()]
      .filter((r) => recordInScope(r, scope))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1));
    const victim =
      mine.find((r) => r.status === 'deleted') ??
      mine.find((r) => r.status === 'archived') ??
      mine[0];
    if (victim) this.records.delete(victim.id);
  }
}
