/**
 * Module 10 — PostgreSQL connector. The ONLY live-verified connector: it runs
 * genuinely, end-to-end, against a real Postgres engine (embedded PGlite in tests, a
 * networked cluster in production) via the integrations `SqlConnector` over the one
 * persistence `SqlDriver`. Read-only by construction: schema discovery, analytics
 * queries, and a checkpointed sync source. Any non-SELECT/WITH statement is rejected.
 */
import { SqlConnector } from '@neuropause/integrations';
import type { SqlDriver } from '@neuropause/persistence';
import type { SyncSource, SourcePage, SyncRecord } from '@neuropause/integrations';

export interface ColumnInfo { table: string; column: string; type: string; }

const WRITE = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|comment|merge|call)\b/;

function assertReadOnly(sql: string): void {
  const s = sql.trim().toLowerCase();
  if (!(s.startsWith('select') || s.startsWith('with'))) {
    throw new Error('postgres connector is read-only: statements must start with SELECT or WITH');
  }
  if (WRITE.test(s)) throw new Error('postgres connector is read-only: write keyword rejected');
}

export class PostgresConnector {
  private readonly c: SqlConnector;

  constructor(driver: SqlDriver) {
    this.c = new SqlConnector(driver);
  }

  ping(): Promise<boolean> {
    return this.c.ping();
  }

  dialect(): string {
    return this.c.dialect();
  }

  /** Schema discovery over information_schema (public schema). */
  schema(): Promise<ColumnInfo[]> {
    return this.c.query<ColumnInfo>(
      `SELECT table_name AS table, column_name AS column, data_type AS type
       FROM information_schema.columns WHERE table_schema = 'public'
       ORDER BY table_name, ordinal_position`,
    );
  }

  async tables(): Promise<string[]> {
    const rows = await this.c.query<{ table: string }>(
      `SELECT table_name AS table FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    );
    return rows.map((r) => r.table);
  }

  /** Read-only analytics query (SELECT/WITH only). Async so the guard rejects (never throws sync). */
  async query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<R[]> {
    assertReadOnly(sql);
    return this.c.query<R>(sql, params);
  }

  /**
   * A checkpointed SyncSource over a read-only table, for the sync engine. Pulls rows
   * ordered by an id column, page by page, mapping each into a versioned SyncRecord.
   */
  syncSource(table: string, opts: { idColumn?: string; versionColumn?: string } = {}): SyncSource<SyncRecord> {
    const idCol = opts.idColumn ?? 'id';
    const verCol = opts.versionColumn ?? null;
    const query = this.c.query.bind(this.c);
    return {
      async pull(cursor: string | undefined, limit: number): Promise<SourcePage<SyncRecord>> {
        const where = cursor ? `WHERE ${idCol} > $1` : '';
        const params = cursor ? [cursor] : [];
        const rows = await query<Record<string, unknown>>(
          `SELECT * FROM ${table} ${where} ORDER BY ${idCol} LIMIT ${Math.max(1, Math.min(limit, 1000))}`,
          params,
        );
        const items: SyncRecord[] = rows.map((row) => ({ id: String(row[idCol]), version: verCol ? Number(row[verCol]) : 1, ...row }));
        const last = items.length ? items[items.length - 1].id : undefined;
        return { items, hasMore: items.length === limit, ...(last !== undefined ? { nextCursor: last } : {}) };
      },
    };
  }
}
