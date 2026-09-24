import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { pool } from './pool';
import { pilotPool, identityOf, identityKey } from './pilotPool';
import { logger } from '../config/logger';

/**
 * A deliberately small forward-only migration runner. Each .sql file in
 * ./migrations is applied once, in filename order, inside a transaction, and
 * recorded in schema_migrations. Idempotent: re-running applies only new files.
 */
const MIGRATIONS_DIR = join(__dirname, 'migrations');

/* ==========================================================================================
 * ENV04-B — THE MIGRATION TARGET IS EXPLICIT.
 *
 * THE DEFECT: this runner used the PRODUCT pool and nothing else. So `PILOT_DATABASE_URL`
 * could name a genuinely separate database and NOTHING WOULD EVER CREATE ITS SCHEMA — the
 * pilot tables simply would not exist there. ENV04's isolation requirement and the migration
 * path contradicted each other, and the contradiction was invisible because every test ran
 * both stores against one database.
 *
 * WHY ALL MIGRATIONS RUN AGAINST BOTH, rather than splitting them into product and pilot sets:
 * NP-014 measured 12 foreign keys from pilot tables into `users`, and PostgreSQL does not
 * implement cross-database references. A pilot database must therefore carry its OWN `users`
 * — i.e. the full schema — for those constraints to resolve at all. Measured: all migrations
 * apply cleanly to a fresh database and every one of those FKs is enforced there.
 *
 * NP-014's "a separate DATABASE is impossible" stands only for a pilot database whose FKs
 * point at the PRODUCT's `users`. It does not stand for a pilot database that has its own.
 * ========================================================================================== */
export type MigrationTarget = 'PRODUCT' | 'PILOT';

/** Refusal: the pool handed in is not the database this target names. */
export class MigrationTargetMismatch extends Error {
  constructor(readonly target: MigrationTarget, readonly expected: string, readonly actual: string) {
    super(`migration target ${target} expects ${expected} but the pool is connected to ${actual}`);
    this.name = 'MigrationTargetMismatch';
  }
}

/**
 * The pool a target names — derived, never guessed.
 *
 * PILOT resolves through `pilotPool()`, which has NO fallback to DATABASE_URL: if the pilot
 * store is not configured this THROWS rather than silently migrating the product database.
 * That refusal is X3, and it is structural rather than a check someone could forget.
 */
export function poolForTarget(target: MigrationTarget): Pool {
  return target === 'PILOT' ? pilotPool() : pool;
}

/**
 * Refuse a pool that is not actually the target's database.
 *
 * Compared on SERVER-REPORTED identity, not on configuration strings: two different URLs can
 * reach one database, and a check that compares text would pass while the wrong database was
 * migrated. This is what makes X1 (pilot target + product pool) and X2 (product target + pilot
 * pool) refusals rather than silent cross-contamination.
 */
export async function assertTargetPool(target: MigrationTarget, candidate: Pool): Promise<void> {
  const expected = poolForTarget(target);
  if (expected === candidate) return;
  const [e, a] = await Promise.all([identityOf(expected), identityOf(candidate)]);
  if (identityKey(e) !== identityKey(a)) throw new MigrationTargetMismatch(target, identityKey(e), identityKey(a));
}

async function ensureMigrationsTable(target: Pool): Promise<void> {
  await target.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function appliedMigrations(target: Pool): Promise<Set<string>> {
  const { rows } = await target.query<{ filename: string }>('SELECT filename FROM schema_migrations');
  return new Set(rows.map((r) => r.filename));
}

export interface RunMigrationsOptions {
  /** Which store to migrate. Defaults to PRODUCT so every existing caller is unchanged. */
  readonly target?: MigrationTarget;
  /** An explicit pool. Validated against the target; a mismatch is refused, never coerced. */
  readonly pool?: Pool;
}

export async function runMigrations(opts: RunMigrationsOptions = {}): Promise<void> {
  const target = opts.target ?? 'PRODUCT';
  const db = opts.pool ?? poolForTarget(target);
  if (opts.pool) await assertTargetPool(target, opts.pool);
  await ensureMigrationsTable(db);
  const applied = await appliedMigrations(db);
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) {
    logger.info({ target }, 'No pending migrations');
    return;
  }

  for (const file of pending) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      logger.info({ file, target }, 'Applied migration');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ err, file, target }, 'Migration failed; rolled back');
      throw err;
    } finally {
      client.release();
    }
  }
}

// Allow running directly: `tsx src/db/migrate.ts`
// Bundle-safe direct-CLI check: inside the tsup bundle, require.main IS the
// bundle, so the classic guard misfires; require the entry's own filename.
const isDirectCli =
  require.main === module && /(^|[\\/])migrate\.(ts|js)$/.test(require.main?.filename ?? '');
if (isDirectCli) {
  // `tsx src/db/migrate.ts --target=PILOT`. The target is never inferred from which URLs
  // happen to be set: an unspecified target is PRODUCT, explicitly.
  const flag = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1]?.toUpperCase();
  if (flag && flag !== 'PRODUCT' && flag !== 'PILOT') {
    logger.error({ flag }, 'Unknown --target; expected PRODUCT or PILOT');
    process.exit(1);
  }
  const cliTarget: MigrationTarget = flag === 'PILOT' ? 'PILOT' : 'PRODUCT';
  runMigrations({ target: cliTarget })
    .then(() => poolForTarget(cliTarget).end())
    .then(() => {
      logger.info('Migrations complete');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err }, 'Migration run failed');
      process.exit(1);
    });
}
