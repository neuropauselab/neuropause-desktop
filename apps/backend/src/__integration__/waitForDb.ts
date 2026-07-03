import { Client } from 'pg';

/**
 * Integration-test global setup: block until Postgres accepts connections before
 * any test runs. Tolerates a database that is still starting up (e.g. a freshly
 * launched `docker run` container), which otherwise surfaces as ECONNRESET on the
 * first query. Fails clearly if the database never becomes reachable.
 */
export default async function setup(): Promise<void> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) return; // vitest.integration.config.ts already fails fast when unset

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
      try {
        await client.end();
      } catch {
        // connection never opened — ignore
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(
    `Postgres at TEST_DATABASE_URL was not ready within 20s. Last error: ${String(lastError)}`,
  );
}
