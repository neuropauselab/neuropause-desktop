/**
 * Writes resources/build-info.json before packaging. Read at runtime by
 * src/main/buildInfo.ts to identify the build (version / commit / channel /
 * build time) for the updater and the Release Diagnostics surface.
 *
 * Overridable via env: NEUROPAUSE_CHANNEL, NEUROPAUSE_BUILD_COMMIT.
 */
const { execSync } = require('node:child_process');
const { writeFileSync, mkdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

function git(args) {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
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

/**
 * Phase 8 (8.6): bake the CURRENT version's changelog section into the build.
 * The update feed is a generic provider (it carries no release notes), so the
 * only place notes can come from is the build itself. Extracted verbatim from
 * CHANGELOG.md's matching "## [<version>]" section, capped at 4000 chars;
 * absent section → null (never fabricated). Surfaced in Release Diagnostics.
 */
function releaseNotesFromChangelog(version) {
  try {
    const changelog = readFileSync(join(__dirname, '..', '..', '..', 'CHANGELOG.md'), 'utf8');
    const heading = `## [${version}]`;
    const start = changelog.indexOf(heading);
    if (start === -1) return null;
    const rest = changelog.slice(start);
    const next = rest.indexOf('\n## ', heading.length);
    const section = (next === -1 ? rest : rest.slice(0, next)).trim();
    return section.length > 4000 ? `${section.slice(0, 4000)}\n…` : section;
  } catch {
    return null;
  }
}

const info = {
  // Backend URL baked into packaged builds (packaged apps have no env vars).
  backendUrl: process.env.NEUROPAUSE_BACKEND_URL || null,
  releaseNotes: releaseNotesFromChangelog(pkg.version),
  // Public OAuth client ids for connectors, baked for packaged builds. The
  // _CLIENT_ID suffix filter guarantees secrets are never captured.
  connectorClientIds: Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => /^NEUROPAUSE_[A-Z0-9_]+_CLIENT_ID$/.test(k) && v,
    ),
  ),
  version: pkg.version,
  channel: process.env.NEUROPAUSE_CHANNEL || channelFromVersion(pkg.version),
  commit: process.env.NEUROPAUSE_BUILD_COMMIT || git('rev-parse --short HEAD') || 'unknown',
  buildTime: new Date().toISOString(),
};

const dir = join(__dirname, '..', 'resources');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log('[build-info]', JSON.stringify(info));
