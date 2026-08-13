import { defineConfig } from 'vitest/config';

// Companion protocol tests — pure logic, Node environment, no aliases needed
// (the package has no cross-workspace imports; Hermes-portability is enforced
// by `types: []` + lib ES2022 in tsconfig, not by the test runner).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
