import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@neuropause/cloud-core': resolve(__dirname, '../cloud-core/src/index.ts'),
      '@neuropause/shared-cloud': resolve(__dirname, '../shared-cloud/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
