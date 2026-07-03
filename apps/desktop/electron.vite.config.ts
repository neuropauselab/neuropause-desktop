import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// Resolve the shared workspace package to its TypeScript source so the
// bundler compiles a single copy of the IPC contracts into every process.
const sharedAlias = {
  '@neuropause/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
};

export default defineConfig({
  main: {
    // Externalize real node_modules deps, but bundle the shared source.
    plugins: [externalizeDepsPlugin({ exclude: ['@neuropause/shared'] })],
    resolve: { alias: sharedAlias },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@neuropause/shared'] })],
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
