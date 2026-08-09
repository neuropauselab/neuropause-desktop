// ../../../../../../var/tmp/v6.mts
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
var root = "/sessions/modest-vigilant-mendel/mnt/neuropause-desktop/apps/desktop";
var pkgs = "/sessions/modest-vigilant-mendel/mnt/neuropause-desktop/packages";
var sharedAlias = {
  "@neuropause/shared": resolve(pkgs, "shared/src/index.ts"),
  "@neuropause/companion-protocol": resolve(pkgs, "companion-protocol/src/index.ts"),
  "@neuropause/solution-packs": resolve(pkgs, "solution-packs/src/index.ts")
};
var BUNDLED = ["@neuropause/shared", "@neuropause/companion-protocol", "@neuropause/solution-packs"];
var OUT = "/var/tmp/np-b6";
var v6_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: BUNDLED })],
    resolve: { alias: sharedAlias },
    build: { outDir: `${OUT}/main`, rollupOptions: { input: { index: resolve(root, "src/main/index.ts") } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: BUNDLED })],
    resolve: { alias: sharedAlias },
    build: { outDir: `${OUT}/preload`, rollupOptions: { input: { index: resolve(root, "src/preload/index.ts") } } }
  },
  renderer: {
    root: resolve(root, "src/renderer"),
    plugins: [react()],
    resolve: { alias: { ...sharedAlias, "@renderer": resolve(root, "src/renderer/src") } },
    build: { outDir: `${OUT}/renderer`, rollupOptions: { input: { index: resolve(root, "src/renderer/index.html") } } }
  }
});
export {
  v6_default as default
};
