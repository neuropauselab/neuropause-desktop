import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// CLI unit tests run under plain Node; the SDK + shared resolve to source (no build step).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@neuropause/sdk': resolve(process.cwd(), '../sdk/src/index.ts'),
      '@neuropause/shared': resolve(process.cwd(), '../shared/src/index.ts'),
    },
  },
});
