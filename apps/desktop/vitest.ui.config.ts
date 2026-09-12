/**
 * UI verification suite — the new screens rendered into a real DOM and driven
 * with real clicks against the REAL main-process handlers.
 *
 * Separate from `vitest.config.ts` on purpose. The default suite is a Node
 * environment with zero DOM dependencies, which keeps 6000+ tests fast and
 * dependency-light; this one needs jsdom + Testing Library, and it is the only
 * place a React component is actually mounted. Run it with `npm run test:ui`.
 *
 * What it verifies that a model test cannot: that a screen renders at all,
 * that a button is wired to a handler, that state refreshes from the backend
 * after a write rather than from optimistic local state, and that an empty
 * state says something honest instead of rendering blank.
 */
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['ui-tests/**/*.test.tsx'],
    setupFiles: ['ui-tests/setup.ts', './vitest.setup.ts'],
    // Individual waits in here go up to 8000 ms on purpose — a real import
    // commits to disk mid-test, and a slow Windows CI runner needs the room.
    // Vitest's 5000 ms default kills the test BEFORE such a wait can elapse,
    // so a missing button surfaces as an opaque suite-level timeout instead of
    // the locator's own "unable to find an element" report. 30 s clears the
    // longest chain in a single test (a 5 s mount wait plus three 8 s
    // post-import waits) while still failing a genuinely hung test in seconds.
    testTimeout: 30_000,
    // Testing Library must go through Vite's resolver, not Node's require, so
    // the react/react-dom aliases below apply to it too. Externalized, it
    // resolves its own React copy and every hook call fails with a null
    // dispatcher — a confusing symptom for a mundane cause.
    server: { deps: { inline: [/@testing-library/] } },
  },
  resolve: {
    // React must be ONE instance. Testing Library pulls in its own react-dom
    // resolution path, and two copies produce the famously unhelpful
    // "Cannot read properties of null (reading 'useState')" instead of a
    // sensible error.
    dedupe: ['react', 'react-dom'],
    alias: {
      react: resolve(__dirname, '../../node_modules/react'),
      'react-dom': resolve(__dirname, '../../node_modules/react-dom'),
      '@neuropause/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@neuropause/companion-protocol': resolve(
        __dirname,
        '../../packages/companion-protocol/src/index.ts',
      ),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@main': resolve(__dirname, 'src/main'),
    },
  },
});
