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
      // Capability Completion v1.0 — the canonical capability registry (single source of truth).
      'src/renderer/src/capability/**/*.test.ts',
      // Enterprise Business Suite v1.0 — the Business Workspace model (pure data: family grouping + KPIs).
      'src/renderer/src/business/**/*.test.ts',
      // Product Operations v1.0 — the Product Ops lens model (pure data: tones, gaps, deployment targets).
      'src/renderer/src/productOps/**/*.test.ts',
      // Enterprise Administration v1.0 — the admin lens model (pure data: tones, gaps, org/role summaries).
      'src/renderer/src/administration/**/*.test.ts',
      // Phase 2 — reuse-only workspace models (Intelligence / Collaboration / Knowledge / Automation).
      'src/renderer/src/intelligence/**/*.test.ts',
      'src/renderer/src/collaboration/**/*.test.ts',
      'src/renderer/src/knowledge2/**/*.test.ts',
      'src/renderer/src/automationCenter/**/*.test.ts',
      // Phase 3 — the AI Operating Platform's pure tab-lens models (no DOM, no React).
      'src/renderer/src/aiOperations/**/*.test.ts',
      // Phase 5 — the Platform Ecosystem control plane's pure tab-lens models.
      'src/renderer/src/platformEcosystem/**/*.test.ts',
      // Enterprise GA — previously-orphaned renderer model tests, now collected.
      'src/renderer/src/data/**/*.test.ts',
      'src/renderer/src/design/**/*.test.ts',
      'src/renderer/src/developer/**/*.test.ts',
      'src/renderer/src/enterprise/**/*.test.ts',
      // PEDP cycle 2 — shell state (the Workspace tab model) is now under test.
      'src/renderer/src/state/**/*.test.ts',
      // NCEA 11.0 — Mission Control's pure view-model (no DOM, no React): the
      // unification command center over the existing sections + capability registries.
      'src/renderer/src/missionControl/**/*.test.ts',
      // Phase 6 Stage 3 — Universal Search's pure layers (planner, model,
      // pipeline, bench evidence; no DOM, no React).
      'src/renderer/src/search/**/*.test.ts',
    ],
  },
  resolve: {
    alias: {
      // Resolve from THIS config's directory, not the invocation cwd, so the aliases
      // hold no matter where vitest is launched from — matching the `__dirname`
      // convention already used in backend/vitest.config.ts and electron.vite.config.ts.
      '@neuropause/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      // Safety net so an accidental `@renderer/*` import in a collected test still resolves.
      '@renderer': resolve(__dirname, 'src/renderer/src'),
    },
  },
});
