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
      // P10 — the Federation Center's pure view-model (no DOM, no React).
      'src/renderer/src/federationCenter/**/*.test.ts',
      // P11 — the Cloud Control Plane's pure view-model (no DOM, no React).
      'src/renderer/src/controlPlane/**/*.test.ts',
      // P12 — the Developer Center's pure view-model (no DOM, no React).
      'src/renderer/src/developerCenter/**/*.test.ts',
      // P13 — the Industry Center's pure view-model (no DOM, no React).
      'src/renderer/src/industryCenter/**/*.test.ts',
      // P14 — the Strategy Center's pure view-model (no DOM, no React).
      'src/renderer/src/strategyCenter/**/*.test.ts',
      // P15 — the Digital Twin Center's pure view-model (no DOM, no React).
      'src/renderer/src/twinCenter/**/*.test.ts',
      // P16 — the Knowledge Fabric Center's pure view-model (no DOM, no React).
      'src/renderer/src/knowledgeCenter/**/*.test.ts',
      // P17 — the Global Orchestration Center's pure view-model (no DOM, no React).
      'src/renderer/src/orchestrationCenter/**/*.test.ts',
      // P18 — the Intelligence Network Center's pure view-model (no DOM, no React).
      'src/renderer/src/networkCenter/**/*.test.ts',
      // P19 — the Autonomous Operations Center's pure view-model (no DOM, no React).
      'src/renderer/src/autonomousOpsCenter/**/*.test.ts',
      // P20 — the Commercial Center's pure view-model (no DOM, no React).
      'src/renderer/src/commercialCenter/**/*.test.ts',
      // Experience Program v1.0 — the Decision Center's pure view-model (no DOM, no React).
      'src/renderer/src/decisionCenter/**/*.test.ts',
      // Intent Experience Program v2.0 — the Intent Home's pure presentation mappings (no DOM, no React).
      'src/renderer/src/intentHome/**/*.test.ts',
      // Product Integrity v1.0 — navigation section registry (pure data: visibility/duplication guardrails).
      'src/renderer/src/shell/**/*.test.ts',
      // Constitutional Settings v1.0 — settings catalog + capability inventory (pure data).
      'src/renderer/src/settings/**/*.test.ts',
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
