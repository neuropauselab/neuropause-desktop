import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// The cloud packages resolve to their TS source (mirrors the backend config).
export default defineConfig({
  resolve: {
    alias: {
      '@neuropause/cloud-core': resolve(__dirname, '../../packages/cloud-core/src/index.ts'),
      '@neuropause/shared-cloud': resolve(__dirname, '../../packages/shared-cloud/src/index.ts'),
      '@neuropause/cloud-sdk': resolve(__dirname, '../../packages/cloud-sdk/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
