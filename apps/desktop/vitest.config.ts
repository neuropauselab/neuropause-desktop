import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Platform-core unit/integration tests. The bus, timeline, subscribers, and
// producers are Electron-free, so they run under a plain Node environment.
export default defineConfig({
  test: {
    environment: 'node',
    // Platform-core (main) tests, plus the renderer's PURE view-model logic under
    // `renderer/src/sandbox` (the Sandbox workspace's derivations) and `renderer/src/connectors`
    // (the Enterprise Connector Center's view-model — no DOM, no React), so those presentation
    // derivations are verified by the same Node gate.
    include: [
      'src/main/**/*.test.ts',
      // P9 — the Enterprise Marketplace's pure view-model (no DOM, no React).
      'src/renderer/src/marketplace/**/*.test.ts',
      'src/renderer/src/sandbox/**/*.test.ts',
      'src/renderer/src/connectors/**/*.test.ts',
      // P6 — the Cloud Platform Center's pure view-model (no DOM, no React).
      'src/renderer/src/infrastructure/**/*.test.ts',
      // P7.1 — the Enterprise Operations Center's pure view-model (no DOM, no React).
      'src/renderer/src/operationsCenter/**/*.test.ts',
      // P8.6 — the Enterprise Workforce Center's pure view-model (no DOM, no React).
      'src/renderer/src/workforceCenter/**/*.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@neuropause/shared': resolve(process.cwd(), '../../packages/shared/src/index.ts'),
      // Safety net so an accidental `@renderer/*` import in a collected test still resolves.
      '@renderer': resolve(process.cwd(), 'src/renderer/src'),
    },
  },
});
