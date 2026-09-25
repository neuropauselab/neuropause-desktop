import { Pool, type PoolClient } from 'pg';
import { logger } from '../config/logger';
import { loadPilotEnv } from '../config/pilotEnv';

/* ==========================================================================================
 * D-034-2 — THE CONTROLLED GOVERNANCE WRITER.
 *
 * HUMAN DECISION, verbatim: "I authorize the design and implementation of a controlled-writer
 * boundary for governance-sensitive database state. The normal runtime credential shall not
 * become the authority writer merely because the application currently performs a technical
 * write." And: "No superuser architecture is authorized. No general administrative database
 * credential is authorized."
 *
 * THE DEFECT THIS EXISTS TO REMOVE, measured at NP-034 §10 against the authoritative store:
 * `np_pilot_runtime` holds INSERT, UPDATE and DELETE on ALL SIXTEEN pilot tables, including
 * `pilot_authority_decisions`, `pilot_role_bindings` and `pilot_environment_identity`. Two of
 * those three have NO application write path at all — the application never writes them — and
 * yet the credential the whole application runs under can write all three directly. So the
 * governance boundary was entirely notional: it lived in the absence of a code path, not in any
 * privilege. That is the NP-026/NP-027 forge path, and an absent code path is not a control,
 * because nothing stops a second code path being written, or raw SQL being issued.
 *
 * WHAT THIS MODULE IS. A SECOND, SEPARATELY CREDENTIALLED CONNECTION whose role holds the
 * governance-table write privileges that the runtime role does not. The runtime keeps everything
 * it needs for participant work and loses the three governance tables. Least privilege in the
 * direction that matters: the credential that faces the request path cannot mint authority.
 *
 * WHAT THIS MODULE IS NOT. It is not an administrative credential and must never become one.
 * It is not a superuser. It grants no capability by itself — every authority check in
 * `evaluateBootstrap` still runs on this connection exactly as it did on the runtime one. It
 * widens nothing: it NARROWS the runtime, and carries the narrow remainder.
 *
 * WHY THE WHOLE TRANSACTION RUNS HERE AND NOT JUST THE INSERT.
 * The obvious implementation — keep reading on the runtime pool and switch only the INSERT to
 * this one — is WRONG, and measurably so. The §8/§9 advisory lock, the admitted-decision read,
 * the existing-binding read and both writes must share ONE transaction on ONE connection, or:
 *   - the advisory lock is taken on a connection that does not perform the write, so it
 *     serialises nothing that matters and the sealed 50/50-versus-0/50 lock proof is void;
 *   - the binding row and its audit row land in different transactions, so a failure between
 *     them leaves an authority whose creation cannot be reconstructed — the "work with no
 *     evidence" shape NP-016 found.
 * So the governed operation opens its transaction HERE, and everything happens on this client.
 * ========================================================================================== */

let lazy: Pool | null = null;
let lastUrl: string | undefined;

export class PilotGovernanceWriterNotConfigured extends Error {
  constructor(detail: string) {
    super(`The controlled governance writer is not configured: ${detail}`);
    this.name = 'PilotGovernanceWriterNotConfigured';
  }
}

/**
 * THE POOL, OR A THROW. Never the runtime pool, never the product pool.
 *
 * NO FALLBACK, deliberately and for the same reason `pilotPool` has none: a
 * `PILOT_GOVERNANCE_DATABASE_URL ?? PILOT_DATABASE_URL` would mean that forgetting to configure
 * the writer silently restores the exact defect this module removes, and would restore it
 * INVISIBLY — the governed write would succeed, on the runtime credential, and every test would
 * stay green. Absence must fail closed and loudly.
 */
export function pilotGovernancePool(governanceUrl?: string): Pool {
  const cfg = loadPilotEnv();
  const url = governanceUrl?.trim() || cfg.governanceDatabaseUrl;
  if (!url) throw new PilotGovernanceWriterNotConfigured('PILOT_GOVERNANCE_DATABASE_URL is not set');

  /*
   * AN IDENTICAL URL IS REFUSED, BECAUSE A SEPARATION THAT IS ONLY NOMINAL IS WORSE THAN NONE.
   * If the governance URL equals the runtime URL, this pool connects as the runtime role and the
   * boundary is fiction — every test would pass, the evidence would read "controlled writer in
   * use", and the forge path would be exactly as open as before. That is a control that cannot
   * fail, which this programme has repeatedly measured to be the most expensive kind of green.
   * Refusing the identical case is what makes the separation checkable rather than asserted.
   *
   * It compares CONFIGURED STRINGS, which is a necessary but not sufficient check: two different
   * URLs could still name the same role. Proving the connected identities actually differ is a
   * runtime observation and belongs to the D-034-3 boot self-check (NP-034 §11), which is NOT
   * implemented in this seam. `governanceWriterIdentity()` below exposes the measurement so the
   * §10 evidence can state it; it is deliberately not wired as a gate here.
   */
  if (cfg.databaseUrl && url === cfg.databaseUrl) {
    throw new PilotGovernanceWriterNotConfigured(
      'PILOT_GOVERNANCE_DATABASE_URL is identical to PILOT_DATABASE_URL, so the writer would ' +
        'connect as the runtime role and the governance boundary would not exist',
    );
  }

  if (lazy && lastUrl === url) return lazy;
  if (lazy) void lazy.end().catch(() => undefined);
  lastUrl = url;
  lazy = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  lazy.on('error', (err) => logger.error({ err }, 'Unexpected pilot governance Postgres pool error'));
  return lazy;
}

export const pilotGovernanceWriterConfigured = (): boolean =>
  Boolean(loadPilotEnv().governanceDatabaseUrl);

/**
 * A governed transaction on the controlled writer's connection.
 *
 * Mirrors `pilotPool.withTransaction` in shape so the governed operation reads the same, and
 * differs only in WHICH CREDENTIAL it runs as — which is the entire point.
 */
export async function withGovernanceTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pilotGovernancePool().connect();
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

export interface GovernanceWriterIdentity {
  readonly database: string;
  readonly role: string;
  readonly isSuperuser: boolean;
}

/**
 * What this connection ACTUALLY is, asked of the server rather than derived from the URL.
 *
 * Published for evidence: a claim that the writer is separately credentialled is a claim about
 * the connected role, and a URL string is not that. `isSuperuser` is included because D-034-2
 * forbids a superuser architecture, so the evidence must be able to show it is false rather
 * than assume it.
 */
export async function governanceWriterIdentity(): Promise<GovernanceWriterIdentity> {
  const { rows } = await pilotGovernancePool().query(
    `SELECT current_database() AS database, current_user AS role,
            (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser`,
  );
  const r = rows[0] as Record<string, unknown>;
  return { database: String(r.database), role: String(r.role), isSuperuser: r.is_superuser === true };
}

/** Test seam only: drops the memoised pool so a disposable database can be swapped in. */
export async function resetPilotGovernancePool(): Promise<void> {
  const p = lazy; lazy = null; lastUrl = undefined;
  if (p) await p.end().catch(() => undefined);
}
