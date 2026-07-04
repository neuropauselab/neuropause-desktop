import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pool, withTransaction } from './pool';
import { logger } from '../config/logger';

/**
 * Store seeding. The schema lives in migrations/; the catalog content lives in
 * seeds/ and is applied here. Two entry points:
 *
 *   seedStoreIfEmpty() — called on boot. Seeds only when the catalog is empty,
 *     so a fresh checkout comes up with a populated store and nothing is
 *     duplicated on subsequent restarts.
 *
 *   seedStore({ reset }) — with reset:true, truncates the store tables (not the
 *     users table) and re-inserts from scratch. Used by `tsx src/db/seed.ts`.
 */
const SEEDS_DIR = join(__dirname, 'seeds');

// Every store-owned table, child-first is unnecessary because CASCADE handles
// dependencies; RESTART IDENTITY resets the downloads bigserial. The users table
// is deliberately excluded — seed reviewer accounts persist across re-seeds.
const STORE_TABLES = [
  'organizations',
  'developers',
  'developer_verifications',
  'categories',
  'tags',
  'applications',
  'app_tags',
  'versions',
  'update_channels',
  'releases',
  'changelogs',
  'screenshots',
  'pricing_plans',
  'app_ratings',
  'reviews',
  'downloads',
  'installations',
  'bookmarks',
  'collections',
  'collection_apps',
  'featured_apps',
  'app_permissions',
  'plugin_packages',
];

async function isCatalogEmpty(): Promise<boolean> {
  const { rows } = await pool.query<{ count: string }>(
    'SELECT count(*)::int AS count FROM applications',
  );
  return (rows[0]?.count ?? '0') === '0' || Number(rows[0]?.count) === 0;
}

export async function seedStore({ reset = false }: { reset?: boolean } = {}): Promise<void> {
  const sql = await readFile(join(SEEDS_DIR, '0001_store_seed.sql'), 'utf8');
  await withTransaction(async (client) => {
    if (reset) {
      await client.query(`TRUNCATE ${STORE_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
      logger.info('Store tables truncated for re-seed');
    }
    await client.query(sql);
  });
  logger.info('Store catalog seeded');
}

export async function seedStoreIfEmpty(): Promise<void> {
  try {
    if (await isCatalogEmpty()) {
      logger.info('Catalog empty; seeding store');
      await seedStore({ reset: false });
    } else {
      logger.info('Catalog already populated; skipping seed');
    }
  } catch (err) {
    // Seeding is best-effort on boot; never block the server from starting.
    logger.error({ err }, 'Store seed-if-empty failed');
  }
}

// Allow running directly: `tsx src/db/seed.ts` (forces a clean re-seed).
// Bundle-safe direct-CLI check: inside the tsup bundle, require.main IS the
// bundle, so the classic guard misfires; require the entry's own filename.
const isDirectCli =
  require.main === module && /(^|[\\/])seed\.(ts|js)$/.test(require.main?.filename ?? '');
if (isDirectCli) {
  seedStore({ reset: true })
    .then(() => pool.end())
    .then(() => {
      logger.info('Seed complete');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err }, 'Seed run failed');
      process.exit(1);
    });
}
