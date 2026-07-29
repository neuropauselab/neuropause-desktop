import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const pkg = (name: string): string => resolve(__dirname, `../${name}/src/index.ts`);

export default defineConfig({
  resolve: {
    alias: {
      '@neuropause/runtime': pkg('runtime'),
      '@neuropause/security': pkg('security'),
      '@neuropause/persistence': pkg('persistence'),
      '@neuropause/cloud-core': pkg('cloud-core'),
      '@neuropause/shared-cloud': pkg('shared-cloud'),
      '@neuropause/connectors': pkg('connectors'),
      '@neuropause/integrations': pkg('integrations'),
      '@neuropause/ai-runtime': pkg('ai-runtime'),
      '@neuropause/nems': pkg('nems'),
      '@neuropause/connectivity': pkg('connectivity'),
      '@neuropause/intelligence': pkg('intelligence'),
      '@neuropause/automation': pkg('automation'),
      '@neuropause/operations': pkg('operations'),
      '@neuropause/execution': pkg('execution'),
      '@neuropause/federation': pkg('federation'),
      '@neuropause/cloudops': pkg('cloudops'),
      '@neuropause/business': pkg('business'),
      '@neuropause/industry': pkg('industry'),
      '@neuropause/workplace': pkg('workplace'),
      '@neuropause/workforce': pkg('workforce'),
      '@neuropause/autonomous-ops': pkg('autonomous-ops'),
      '@neuropause/commercial': pkg('commercial'),
      '@neuropause/production': pkg('production'),
      '@neuropause/deploy': pkg('deploy'),
      '@neuropause/infrastructure': pkg('infrastructure'),
      '@neuropause/integration-platform': pkg('integration-platform'),
      '@neuropause/reliability': pkg('reliability'),
      '@neuropause/customer-deployment': pkg('customer-deployment'),
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'], server: { deps: { inline: ['@electric-sql/pglite'] } }, testTimeout: 30000 },
});
