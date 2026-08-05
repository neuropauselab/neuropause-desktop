import { configDefaults, defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@neuropause/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@neuropause/cloud-core': resolve(__dirname, '../../packages/cloud-core/src/index.ts'),
      '@neuropause/shared-cloud': resolve(__dirname, '../../packages/shared-cloud/src/index.ts'),
      '@neuropause/runtime': resolve(__dirname, '../../packages/runtime/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests (real Postgres) live under __integration__ and run via
    // `npm run test:integration`. Keep them out of the default, infra-free run.
    exclude: [...configDefaults.exclude, 'src/__integration__/**'],
    // Dummy values so modules that validate env at import (e.g. the logger) load
    // under test. These are never used to reach a real service — unit/HTTP tests
    // run against the in-memory repository; integration tests set real values.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/neuropause_test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_ACCESS_SECRET: 'test-only-secret-test-only-secret-0123456789',
    },
  },
});
