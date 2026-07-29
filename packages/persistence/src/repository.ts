/**
 * Generic repository (NCEA 12.0, Phase 2/10). ONE repository over the SqlDriver
 * serves every entity table — preserving the in-memory registries' method shapes
 * (get/list/insert/update) so subsystems can be rebound to durable storage
 * WITHOUT changing their runtime APIs. Writes are ACID (via the driver's
 * transactions), updates use OPTIMISTIC CONCURRENCY (a version column; a stale
 * write affects 0 rows and throws), and `upsert` gives idempotent references —
 * the same id updates in place, never forking a second row. Every query is
 * tenant-scoped.
 */
import type { Clock } from '@neuropause/cloud-core';
import type { SqlExecutor } from './driver';

export interface Entity {
  id: string;
}

export interface Stored<T> {
  value: T;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export class OptimisticConcurrencyError extends Error {
  constructor(table: string, id: string, expected: number) {
    super(`optimistic concurrency conflict on ${table}#${id} (expected version ${expected})`);
    this.name = 'OptimisticConcurrencyError';
  }
}

export interface ListOptions {
  where?: Array<{ field: string; value: string }>;
  limit?: number;
  includeDeleted?: boolean;
}

interface Row {
  doc: unknown;
  version: number | string;
  created_at: number | string;
  updated_at: number | string;
}

function toStored<T>(row: Row): Stored<T> {
  const doc = typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc;
  return { value: doc as T, version: Number(row.version), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}

export class TableRepository<T extends Entity> {
  constructor(
    private readonly exec: SqlExecutor,
    private readonly table: string,
    private readonly clock: Clock,
  ) {}

  /** Insert a new row; throws if the (tenant,id) already exists. */
  async insert(tenant: string, entity: T): Promise<Stored<T>> {
    const now = this.clock.now();
    await this.exec.query(
      `INSERT INTO ${this.table} (tenant_id, id, doc, version, created_at, updated_at) VALUES ($1,$2,$3::jsonb,1,$4,$4)`,
      [tenant, entity.id, JSON.stringify(entity), now],
    );
    return { value: entity, version: 1, createdAt: now, updatedAt: now };
  }

  /** Insert or update by id — idempotent reference semantics (never duplicates). */
  async upsert(tenant: string, entity: T): Promise<Stored<T>> {
    const now = this.clock.now();
    const res = await this.exec.query<Row>(
      `INSERT INTO ${this.table} (tenant_id, id, doc, version, created_at, updated_at) VALUES ($1,$2,$3::jsonb,1,$4,$4)
       ON CONFLICT (tenant_id, id) DO UPDATE SET doc = EXCLUDED.doc, version = ${this.table}.version + 1, updated_at = $4, deleted_at = NULL
       RETURNING doc, version, created_at, updated_at`,
      [tenant, entity.id, JSON.stringify(entity), now],
    );
    return toStored<T>(res.rows[0]!);
  }

  async get(tenant: string, id: string): Promise<Stored<T> | undefined> {
    const res = await this.exec.query<Row>(
      `SELECT doc, version, created_at, updated_at FROM ${this.table} WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenant, id],
    );
    return res.rows[0] ? toStored<T>(res.rows[0]) : undefined;
  }

  /** Optimistic update: succeeds only if the stored version matches `expectedVersion`. */
  async update(tenant: string, entity: T, expectedVersion: number): Promise<Stored<T>> {
    const now = this.clock.now();
    const res = await this.exec.query(
      `UPDATE ${this.table} SET doc = $3::jsonb, version = version + 1, updated_at = $4
       WHERE tenant_id = $1 AND id = $2 AND version = $5 AND deleted_at IS NULL`,
      [tenant, entity.id, JSON.stringify(entity), now, expectedVersion],
    );
    if (res.affectedRows === 0) throw new OptimisticConcurrencyError(this.table, entity.id, expectedVersion);
    return { value: entity, version: expectedVersion + 1, createdAt: now, updatedAt: now };
  }

  async list(tenant: string, opts: ListOptions = {}): Promise<Array<Stored<T>>> {
    const clauses = ['tenant_id = $1'];
    const params: unknown[] = [tenant];
    if (!opts.includeDeleted) clauses.push('deleted_at IS NULL');
    for (const w of opts.where ?? []) {
      params.push(w.value);
      clauses.push(`doc->>'${w.field}' = $${params.length}`);
    }
    const limit = opts.limit ? ` LIMIT ${Math.max(1, Math.floor(opts.limit))}` : '';
    const res = await this.exec.query<Row>(
      `SELECT doc, version, created_at, updated_at FROM ${this.table} WHERE ${clauses.join(' AND ')} ORDER BY created_at${limit}`,
      params,
    );
    return res.rows.map((r) => toStored<T>(r));
  }

  async softDelete(tenant: string, id: string): Promise<boolean> {
    const res = await this.exec.query(`UPDATE ${this.table} SET deleted_at = $3 WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, [
      tenant,
      id,
      this.clock.now(),
    ]);
    return res.affectedRows > 0;
  }

  async count(tenant: string): Promise<number> {
    const res = await this.exec.query<{ n: number | string }>(`SELECT count(*)::int AS n FROM ${this.table} WHERE tenant_id = $1 AND deleted_at IS NULL`, [
      tenant,
    ]);
    return Number(res.rows[0]?.n ?? 0);
  }
}
