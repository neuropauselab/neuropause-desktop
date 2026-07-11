import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// SDK unit tests run under plain Node; shared resolves to source (no build step).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@neuropause/shared': resolve(process.cwd(), '../shared/src/index.ts'),
    },
  },
});
