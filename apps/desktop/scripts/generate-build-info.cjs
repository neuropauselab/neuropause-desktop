/**
 * Writes resources/build-info.json before packaging. Read at runtime by
 * src/main/buildInfo.ts to identify the build (version / commit / channel /
 * build time) for the updater and the Release Diagnostics surface.
 *
 * Overridable via env: NEUROPAUSE_CHANNEL, NEUROPAUSE_BUILD_COMMIT.
 */
const { execSync } = require('node:child_process');
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

function git(args) {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

const pkg = require('../package.json');

/**
 * Derive the update channel from the version's prerelease tag so a single
 * version string drives everything: `-internal.*` → internal, any other
 * prerelease (`-rc.*`, `-beta.*`) → beta, no prerelease → stable. An explicit
 * NEUROPAUSE_CHANNEL still overrides.
 */
function channelFromVersion(version) {
  const dash = version.indexOf('-');
  if (dash === -1) return 'stable';
  return version.slice(dash + 1).startsWith('internal') ? 'internal' : 'beta';
}

const info = {
  version: pkg.version,
  channel: process.env.NEUROPAUSE_CHANNEL || channelFromVersion(pkg.version),
  commit: process.env.NEUROPAUSE_BUILD_COMMIT || git('rev-parse --short HEAD') || 'unknown',
  buildTime: new Date().toISOString(),
};

const dir = join(__dirname, '..', 'resources');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log('[build-info]', JSON.stringify(info));
