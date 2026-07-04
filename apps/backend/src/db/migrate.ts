import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pool } from './pool';
import { logger } from '../config/logger';

/**
 * A deliberately small forward-only migration runner. Each .sql file in
 * ./migrations is applied once, in filename order, inside a transaction, and
 * recorded in schema_migrations. Idempotent: re-running applies only new files.
 */
const MIGRATIONS_DIR = join(__dirname, 'migrations');

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function appliedMigrations(): Promise<Set<string>> {
  const { rows } = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations');
  return new Set(rows.map((r) => r.filename));
}

export async function runMigrations(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await appliedMigrations();
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) {
    logger.info('No pending migrations');
    return;
  }

  for (const file of pending) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      logger.info({ file }, 'Applied migration');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ err, file }, 'Migration failed; rolled back');
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
  runMigrations()
    .then(() => pool.end())
    .then(() => {
      logger.info('Migrations complete');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err }, 'Migration run failed');
      process.exit(1);
    });
}
