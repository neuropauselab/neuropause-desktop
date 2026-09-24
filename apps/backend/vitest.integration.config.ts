import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Integration test config. These tests run against a REAL Postgres and are NOT
 * part of the default `npm test` run (which is infra-free and has zero skips).
 *
 * Run them with a throwaway database:
 *   TEST_DATABASE_URL=postgres://localhost:5432/neuropause_test npm run test:integration
 *
 * The suite applies migrations and TRUNCATEs its tables between tests, so point
 * it only at a disposable database.
 */
const dbUrl = process.env.TEST_DATABASE_URL;
if (!dbUrl) {
  throw new Error(
    'Integration tests require a real Postgres.\n' +
      'Set TEST_DATABASE_URL, e.g.:\n' +
      '  TEST_DATABASE_URL=postgres://localhost:5432/neuropause_test npm run test:integration',
  );
}

export default defineConfig({
  resolve: {
    alias: {
      '@neuropause/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/__integration__/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: dbUrl,
      /*
       * ENV04-R2. `src/pilot` reads its store through `db/pilotPool`, which requires
       * PILOT_DATABASE_URL and has NO fallback to DATABASE_URL — that absence of a fallback is
       * the control, and it must not be softened here.
       *
       * SET TEST_PILOT_DATABASE_URL TO A GENUINELY SEPARATE DATABASE. That is the configuration
       * ENV04 actually describes, and it is the one the ENV04-R2 suites measure: the pilot
       * suites migrate with `runMigrations({ target: 'PILOT' })` and seed through the pilot pool,
       * so the fixture and the code under test share one store while the PRODUCT store stays a
       * different database.
       *
       * The `?? dbUrl` fallback keeps older suites that predate ENV04 runnable against a single
       * database. WHEN IT IS TAKEN, ISOLATION IS NOT UNDER TEST — `resolvePilotEnvironment`
       * correctly answers PILOT_STORE_SAME_DATABASE, and any suite asserting a resolved pilot
       * environment will fail by design rather than pass on a weaker configuration.
       */
      PILOT_DATABASE_URL: process.env.TEST_PILOT_DATABASE_URL ?? dbUrl,
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      JWT_ACCESS_SECRET:
        process.env.JWT_ACCESS_SECRET ?? 'integration-secret-integration-secret-0123',
    },
    // One shared database — run serially so tests don't clobber each other.
    fileParallelism: false,
    hookTimeout: 30_000,
    // Wait for Postgres to accept connections before running (tolerates a
    // still-starting container).
    globalSetup: ['./src/__integration__/waitForDb.ts'],
  },
});
