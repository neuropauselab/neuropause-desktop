import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// Resolve the shared workspace packages to their TypeScript source so the
// bundler compiles a single copy of the IPC contracts into every process.
const sharedAlias = {
  '@neuropause/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
  '@neuropause/companion-protocol': resolve(__dirname, '../../packages/companion-protocol/src/index.ts'),
  '@neuropause/solution-packs': resolve(__dirname, '../../packages/solution-packs/src/index.ts'),
};

/**
 * Workspace packages that ship RAW TYPESCRIPT (`"main": "./src/index.ts"`) and
 * must therefore be BUNDLED, never externalized.
 *
 * `externalizeDepsPlugin` externalizes everything in `dependencies`. Left
 * externalized, Electron resolves these to their `.ts` entry at runtime and
 * Node's ESM loader fails on the first extensionless import inside them:
 *
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find module
 *   '…/packages/companion-protocol/src/errors' imported from …/src/index.ts
 *
 * `@neuropause/shared` was already excluded for this reason; the other two
 * workspace packages have the same package shape and need the same treatment.
 * Real node_modules dependencies (electron-updater, ws) stay external.
 */
const BUNDLED_WORKSPACE_PACKAGES = [
  '@neuropause/shared',
  '@neuropause/companion-protocol',
  '@neuropause/solution-packs',
];

export default defineConfig({
  main: {
    // Externalize real node_modules deps, but bundle the shared source.
    plugins: [externalizeDepsPlugin({ exclude: BUNDLED_WORKSPACE_PACKAGES })],
    resolve: { alias: sharedAlias },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: BUNDLED_WORKSPACE_PACKAGES })],
    resolve: { alias: sharedAlias },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        ...sharedAlias,
        '@renderer': resolve(__dirname, 'src/renderer/src'),
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
});
