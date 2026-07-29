/**
 * Embedded-Postgres driver (NCEA 12.0). Wraps @electric-sql/pglite — a real
 * PostgreSQL engine compiled to WASM that runs in-process with genuine ACID
 * transactions and on-disk persistence. This is what makes the persistence layer
 * VERIFIABLE in-container: the exact SQL schema, migrations, transactions, and
 * durability are exercised against real Postgres, and "survives restart" is
 * proven by reopening the same data directory. A networked production PostgreSQL
 * (via node-postgres) implements this identical `SqlDriver` interface — same code,
 * different endpoint — and is the deployment target (infra-pending here).
 */
import { PGlite } from '@electric-sql/pglite';
import type { SqlDriver, SqlExecutor, SqlQueryResult } from './driver';

interface PgliteLike {
  query<R>(sql: string, params?: unknown[]): Promise<{ rows: R[]; affectedRows?: number }>;
  exec(sql: string): Promise<unknown>;
}

function wrap(db: PgliteLike): SqlExecutor {
  return {
    async query<R = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlQueryResult<R>> {
      const res = await db.query<R>(sql, params);
      return { rows: res.rows, affectedRows: res.affectedRows ?? 0 };
    },
    async exec(sql: string): Promise<void> {
      await db.exec(sql);
    },
  };
}

export class PgliteDriver implements SqlDriver {
  readonly dialect = 'postgres' as const;
  private readonly base: SqlExecutor;

  constructor(
    private readonly pg: PGlite,
    readonly location: string,
  ) {
    this.base = wrap(pg as unknown as PgliteLike);
  }

  query<R = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlQueryResult<R>> {
    return this.base.query<R>(sql, params);
  }

  exec(sql: string): Promise<void> {
    return this.base.exec(sql);
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return this.pg.transaction(async (tx) => fn(wrap(tx as unknown as PgliteLike))) as Promise<T>;
  }

  async close(): Promise<void> {
    await this.pg.close();
  }
}

/**
 * Open an embedded-Postgres driver. Pass a `dataDir` for durable, restart-surviving
 * storage; omit it for an ephemeral in-memory database (tests, ETL scratch).
 */
export async function createPgliteDriver(dataDir?: string): Promise<PgliteDriver> {
  const pg = new PGlite(dataDir);
  await pg.query('SELECT 1'); // force readiness before first use
  return new PgliteDriver(pg, dataDir ?? ':memory:');
}
