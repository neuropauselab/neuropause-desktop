// Metro config (Mobile M1-08). apps/mobile lives OUTSIDE the desktop npm
// workspaces, so the shared packages are resolved by path: Metro watches the
// monorepo root and aliases the @neuropause/* packages to their raw TypeScript
// source (they are Hermes-portable — pure TS, no Node/Electron/DOM).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];
config.resolver.extraNodeModules = {
  '@neuropause/companion-protocol': path.resolve(monorepoRoot, 'packages/companion-protocol/src'),
  '@neuropause/shared': path.resolve(monorepoRoot, 'packages/shared/src'),
};

module.exports = config;
