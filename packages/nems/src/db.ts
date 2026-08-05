/**
 * Tiny query helpers over the ONE persistence SqlDriver (Wave 1). Every NEMS
 * repository runs parameterized SQL through the same driver the rest of the
 * platform uses — no second database, no ORM. Helpers keep tenant-scoping explicit.
 */
import type { SqlExecutor } from '@neuropause/persistence';

export async function one<R = Record<string, unknown>>(db: SqlExecutor, sql: string, params: unknown[] = []): Promise<R | undefined> {
  const res = await db.query<R>(sql, params);
  return res.rows[0];
}

export async function many<R = Record<string, unknown>>(db: SqlExecutor, sql: string, params: unknown[] = []): Promise<R[]> {
  const res = await db.query<R>(sql, params);
  return res.rows;
}

export async function run(db: SqlExecutor, sql: string, params: unknown[] = []): Promise<number> {
  const res = await db.query(sql, params);
  return res.affectedRows;
}

/** JSON round-trips for JSONB columns (PGlite returns objects; we pass strings on write). */
export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}
