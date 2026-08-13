import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Vitest config for apps/mobile (Mobile M1-08). Only the PURE logic is tested
 * here (the sealed client, view-model helpers) — never RN components. The
 * shared packages are aliased to their raw TS source (as Metro does), and the
 * Expo tsconfig is bypassed (esbuild uses an empty tsconfig) so the suite runs
 * in plain Node without the React Native toolchain installed.
 */
export default defineConfig({
  esbuild: { tsconfigRaw: {} },
  resolve: {
    alias: {
      '@neuropause/companion-protocol': resolve(
        __dirname,
        '../../packages/companion-protocol/src/index.ts',
      ),
      '@neuropause/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
