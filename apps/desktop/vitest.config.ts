import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Platform-core unit/integration tests. The bus, timeline, subscribers, and
// producers are Electron-free, so they run under a plain Node environment.
export default defineConfig({
  test: {
    environment: 'node',
    // Platform-core (main) tests, plus the renderer's PURE view-model logic under
    // `renderer/src/sandbox` (the Sandbox workspace's derivations — no DOM, no React), so
    // the Validation Experience's presentation logic is verified by the same Node gate.
    include: ['src/main/**/*.test.ts', 'src/renderer/src/sandbox/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@neuropause/shared': resolve(process.cwd(), '../../packages/shared/src/index.ts'),
      // Safety net so an accidental `@renderer/*` import in a collected test still resolves.
      '@renderer': resolve(process.cwd(), 'src/renderer/src'),
    },
  },
});
