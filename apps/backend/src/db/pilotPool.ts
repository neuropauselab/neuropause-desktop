import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { logger } from '../config/logger';
import { loadPilotEnv } from '../config/pilotEnv';

/* ==========================================================================================
 * ENV04 — THE PILOT'S OWN CONNECTION.
 *
 * Human decision (consolidated instrument, 24 Sep 2026): "dedicated non-production pilot
 * environment with an actually separate pilot runtime/database connection."
 *
 * Before this module there was exactly ONE `new Pool` in the backend and eight pilot modules
 * imported it, so `PILOT_DATABASE_URL` was compared as a string and connected to zero times.
 * The gate passed while nothing was isolated.
 *
 * NO FALLBACK. There is deliberately no `PILOT_DATABASE_URL ?? DATABASE_URL`. An absent pilot
 * URL yields NO POOL, and every pilot query then throws rather than quietly running against
 * the product database. A fallback here would reproduce the exact defect this module exists to
 * remove, and would do it invisibly.
 *
 * LAZY, because the product pool is constructed at import time from a validated env schema and
 * the pilot's is not: the pilot URL is optional, so constructing eagerly would either crash a
 * product-only boot or force a fallback. Lazy construction lets absence stay absent.
 * ========================================================================================== */

let lazy: Pool | null = null;
let lastUrl: string | undefined;

export class PilotStoreNotConfigured extends Error {
  constructor() {
    super('PILOT_DATABASE_URL is not configured; the pilot store has no connection.');
    this.name = 'PilotStoreNotConfigured';
  }
}

/**
 * The pilot pool, or a throw. Never the product pool.
 *
 * ENV04-A. The URL may be PASSED IN, and when it is, that value is the ONLY one consulted.
 * This is the fix for the two-source defect: a caller that has already loaded a validated
 * configuration hands the SAME value here, instead of this function re-reading a mutable
 * global and possibly connecting somewhere the caller never named.
 *
 * The no-argument form still works — a pilot module deep in a request path should not have to
 * thread configuration through every frame — but it resolves through `loadPilotEnv()`, the one
 * declared reader, rather than touching `process.env` itself.
 */
export function pilotPool(databaseUrl?: string): Pool {
  const url = databaseUrl?.trim() || loadPilotEnv().databaseUrl;
  if (!url) throw new PilotStoreNotConfigured();
  // Rebuild if the configured target changed — tests point this at disposable databases.
  if (lazy && lastUrl === url) return lazy;
  if (lazy) void lazy.end().catch(() => undefined);
  lastUrl = url;
  lazy = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  lazy.on('error', (err) => logger.error({ err }, 'Unexpected pilot Postgres pool error'));
  return lazy;
}

export const pilotStoreConfigured = (): boolean => Boolean(loadPilotEnv().databaseUrl);

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return pilotPool().query<T>(text, params as never[]);
}

/** Pilot transactions begin on the PILOT connection. A pilot transaction must never open on
 *  the product pool, so this deliberately does not delegate to ../db/pool. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pilotPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Server-reported identity of whatever this pool is ACTUALLY connected to. */
export interface DatabaseIdentity {
  readonly database: string;
  readonly user: string;
  readonly host: string | null;
  readonly port: number | null;
}

export async function identityOf(p: Pool): Promise<DatabaseIdentity> {
  const { rows } = await p.query(
    `SELECT current_database() AS database, current_user AS "user",
            host(coalesce(inet_server_addr(), '127.0.0.1'::inet)) AS host,
            inet_server_port() AS port`,
  );
  const r = rows[0] as Record<string, unknown>;
  return {
    database: String(r.database), user: String(r.user),
    host: r.host === null ? null : String(r.host),
    port: r.port === null ? null : Number(r.port),
  };
}

export const identityKey = (i: DatabaseIdentity): string => `${i.host ?? '?'}:${i.port ?? '?'}/${i.database}`;

/** Test seam only: drops the memoised pool so a disposable database can be swapped in. */
export async function resetPilotPool(): Promise<void> {
  const p = lazy; lazy = null; lastUrl = undefined;
  if (p) await p.end().catch(() => undefined);
}
