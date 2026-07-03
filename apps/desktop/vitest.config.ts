import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Platform-core unit/integration tests. The bus, timeline, subscribers, and
// producers are Electron-free, so they run under a plain Node environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/main/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@neuropause/shared': resolve(process.cwd(), '../../packages/shared/src/index.ts'),
    },
  },
});
