import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/db/migrate.ts'],
  format: ['cjs'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // ANCHORED. The previous /@neuropause\/shared/ matched @neuropause/shared and
  // @neuropause/shared-cloud but NOT @neuropause/cloud-core or @neuropause/runtime,
  // leaving those as external requires that dangle in the runtime image.
  noExternal: [/^@neuropause\//],
});
