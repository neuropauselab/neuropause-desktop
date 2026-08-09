// ../../../../../../tmp/ev.verify.config.mts
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
var root = "/sessions/hopeful-keen-hopper/mnt/neuropause-desktop/apps/desktop";
var sharedAlias = {
  "@neuropause/shared": resolve(root, "../../packages/shared/src/index.ts"),
  "@neuropause/companion-protocol": resolve(root, "../../packages/companion-protocol/src/index.ts"),
  "@neuropause/solution-packs": resolve(root, "../../packages/solution-packs/src/index.ts")
};
var BUNDLED = ["@neuropause/shared", "@neuropause/companion-protocol", "@neuropause/solution-packs"];
var OUT = "/tmp/np-build-verify";
var ev_verify_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: BUNDLED })],
    resolve: { alias: sharedAlias },
    build: { outDir: `${OUT}/main`, emptyOutDir: false, rollupOptions: { input: { index: resolve(root, "src/main/index.ts") } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: BUNDLED })],
    resolve: { alias: sharedAlias },
    build: { outDir: `${OUT}/preload`, emptyOutDir: false, rollupOptions: { input: { index: resolve(root, "src/preload/index.ts") } } }
  },
  renderer: {
    root: resolve(root, "src/renderer"),
    plugins: [react()],
    resolve: { alias: { ...sharedAlias, "@renderer": resolve(root, "src/renderer/src") } },
    build: { outDir: `${OUT}/renderer`, emptyOutDir: false, rollupOptions: { input: { index: resolve(root, "src/renderer/index.html") } } }
  }
});
export {
  ev_verify_config_default as default
};
