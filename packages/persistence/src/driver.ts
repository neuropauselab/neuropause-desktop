/**
 * SQL driver abstraction (NCEA 12.0, Phase 1). ONE seam between the persistence
 * layer and the relational engine. Every repository, the event store, migrations,
 * backup, and tenancy run against a `SqlDriver` — so the SAME code runs on the
 * embedded Postgres used for in-container validation (PGlite) and on a networked
 * production PostgreSQL behind the identical interface. Repositories take a
 * `SqlExecutor` so they compose transparently inside a transaction.
 */
export interface SqlQueryResult<R = Record<string, unknown>> {
  rows: R[];
  affectedRows: number;
}

/** The minimum surface a repository needs — satisfied by the driver AND a transaction. */
export interface SqlExecutor {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<SqlQueryResult<R>>;
  exec(sql: string): Promise<void>;
}

export interface SqlDriver extends SqlExecutor {
  /** Run `fn` in a single ACID transaction; rolls back if it throws. */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly dialect: 'postgres';
  /** The data directory (durable) or ':memory:' (ephemeral). */
  readonly location: string;
}
