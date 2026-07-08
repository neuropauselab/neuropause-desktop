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
import { canTransitionRecordStatus, matchesRecordSearch } from '@neuropause/shared';

interface RecordFile {
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

export class EnterpriseRecordStore extends EventEmitter {
  private records = new Map<string, EnterpriseEntity>();
  private loaded = false;
  private lastPersist: Promise<void> = Promise.resolve();
  private persisting = false;
  private dirty = false;

  constructor(
    private readonly filePath: string,
    private readonly moduleId: string,
    private readonly kind: string,
    private readonly maxRecords: number = DEFAULT_MAX_RECORDS,
  ) {
    super();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw) as Partial<RecordFile>;
      for (const r of data.records ?? []) if (r?.id) this.records.set(r.id, r);
    } catch {
      /* first run — empty store */
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const file: RecordFile = { moduleId: this.moduleId, records: [...this.records.values()] };
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
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

  get(id: string): EnterpriseEntity | null {
    return this.records.get(id) ?? null;
  }

  /** Records matching the query, newest-updated first. Excludes `deleted` unless asked. */
  list(query: EnterpriseRecordQuery = {}): EnterpriseEntity[] {
    const status = query.status;
    let out = [...this.records.values()].filter((r) => {
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

  /** Count by status (default: everything except `deleted`). */
  count(status?: EnterpriseRecordStatus): number {
    let n = 0;
    for (const r of this.records.values()) {
      if (status ? r.status === status : r.status !== 'deleted') n += 1;
    }
    return n;
  }

  /* ── mutations ── */

  create(input: CreateRecordInput): EnterpriseEntity {
    const now = input.now ?? new Date().toISOString();
    const entity: EnterpriseEntity = {
      id: input.id ?? `rec_${randomUUID()}`,
      moduleId: this.moduleId,
      kind: this.kind,
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
    if (this.records.size > this.maxRecords) this.evictOldest();
    this.touch();
    return entity;
  }

  update(id: string, patch: UpdateRecordInput): EnterpriseEntity | null {
    const prev = this.records.get(id);
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
    const prev = this.records.get(id);
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

  /** Evict the oldest non-active record first, else the oldest overall. */
  private evictOldest(): void {
    const all = [...this.records.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1));
    const victim =
      all.find((r) => r.status === 'deleted') ?? all.find((r) => r.status === 'archived') ?? all[0];
    if (victim) this.records.delete(victim.id);
  }
}
