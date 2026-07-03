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
