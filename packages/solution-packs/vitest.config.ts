import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Vitest for @neuropause/solution-packs (IP-01). Pure SDK — runs in plain Node.
 * The esbuild tsconfig is bypassed (empty) and @neuropause/shared is aliased to
 * its source, though the SDK only imports TYPES from it (elided at runtime), so
 * no shared runtime is actually loaded.
 */
export default defineConfig({
  esbuild: { tsconfigRaw: {} },
  resolve: {
    alias: {
      '@neuropause/shared': resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
