import { Client } from 'pg';

/**
 * Integration-test global setup: ensure Postgres is reachable AND the target test
 * database exists before any test runs.
 *
 * - Tolerates a still-starting server (e.g. a freshly launched `docker run` container),
 *   which otherwise surfaces as ECONNRESET on the first query.
 * - Auto-creates the `TEST_DATABASE_URL` database if it does not exist yet, so
 *   `npm run test:integration` works straight from a bare `npm run infra:up` — no
 *   manual `createdb neuropause_test` step. (Each test file still runs the migrations.)
 *
 * Fails clearly if the server never becomes reachable.
 */
export default async function setup(): Promise<void> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) return; // vitest.integration.config.ts already fails fast when unset

  const dbName = decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ''));
  // Maintenance connection (same server + credentials, the always-present `postgres` db)
  // used only to create the target database when it is missing.
  const adminUrl = new URL(connectionString);
  adminUrl.pathname = '/postgres';

  const deadlineMs = Date.now() + 20_000;
  let lastError: unknown;

  while (Date.now() < deadlineMs) {
    const client = new Client({ connectionString });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return; // ready
    } catch (error) {
      lastError = error;
      await client.end().catch(() => {
        // connection never opened — ignore
      });

      // Server is up but the target database does not exist yet (SQLSTATE 3D000):
      // create it via the maintenance database, then retry immediately.
      if ((error as { code?: string }).code === '3D000') {
        const admin = new Client({ connectionString: adminUrl.toString() });
        try {
          await admin.connect();
          // dbName comes from TEST_DATABASE_URL (a controlled test identifier); quote it.
          await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
        } catch (createError) {
          // 42P04 = a parallel worker created it first; that's fine.
          if ((createError as { code?: string }).code !== '42P04') lastError = createError;
        } finally {
          await admin.end().catch(() => {});
        }
        continue;
      }

      // Server not accepting connections yet — back off and retry.
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(
    `Postgres at TEST_DATABASE_URL was not ready within 20s. Last error: ${String(lastError)}`,
  );
}
