import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const pkg = (name: string): string => resolve(__dirname, `../${name}/src/index.ts`);

export default defineConfig({
  resolve: {
    alias: {
      '@neuropause/runtime': pkg('runtime'),
      '@neuropause/security': pkg('security'),
      '@neuropause/persistence': pkg('persistence'),
      '@neuropause/cloud-core': pkg('cloud-core'),
      '@neuropause/shared-cloud': pkg('shared-cloud'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    server: { deps: { inline: ['@electric-sql/pglite'] } },
    testTimeout: 30000,
  },
});
