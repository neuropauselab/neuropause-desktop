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
       * ENV04. `src/pilot` reads its store through `db/pilotPool`, which requires
       * PILOT_DATABASE_URL and has NO fallback to DATABASE_URL - that absence of a fallback is
       * the control, and it must not be softened here.
       *
       * The default below points the pilot store at the SAME disposable database as the product
       * store, because these suites seed fixtures through `db/pool` and then assert on what the
       * pilot code sees; pointing them apart would make every fixture invisible to the code
       * under test and the suite would pass on empty tables - the failure shape this programme
       * has hit repeatedly.
       *
       * THIS CONFIGURATION THEREFORE PROVES NOTHING ABOUT ISOLATION, and is not the evidence for
       * it: ENV04 separation is established by `pilotPool.test.ts` and the connected-identity
       * check in `pilot/environment.ts`, which compare the two pools' `current_database()` /
       * `inet_server_addr()` rather than their configuration strings. Set
       * TEST_PILOT_DATABASE_URL to run these suites against a genuinely separate store.
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
