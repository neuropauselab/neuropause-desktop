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
  /**
   * P13C ROUND 17 — PROVENANCE.
   *
   * `commit` was baked from `rev-parse HEAD` with NO check on the working
   * tree, so an artifact built over uncommitted changes ASSERTED a commit
   * whose tree it did not contain. On 12 Aug three different things carried
   * version `1.0.0-rc.15`: the tag (`8522dca`), a build claiming `8c570cd`,
   * and the bits inside it, which were `8c570cd` plus two unapplied patches.
   * Nothing downstream could tell them apart, and `verify-release-artifacts`
   * could not either — it checks that the feed hash matches the binary, which
   * says nothing about where the binary came from.
   *
   * `dirty` and `branch` are recorded, and `commit` gains a `-dirty` suffix so
   * the single most-quoted field carries the warning even when somebody reads
   * only that one. An empty `git status --porcelain` is the check; a repo git
   * cannot answer for at all reports `dirty: null` rather than a comforting
   * false.
   */
  branch: process.env.NEUROPAUSE_BUILD_BRANCH || git('rev-parse --abbrev-ref HEAD') || null,
  dirty: buildTreeDirty(),
  buildTime: new Date().toISOString(),
};

/** True when the working tree has uncommitted changes; null when unknowable. */
function buildTreeDirty() {
  if (process.env.NEUROPAUSE_BUILD_COMMIT) return false; // caller asserts provenance (CI)
  /**
   * `git()` returns '' both for "clean tree" and for "git failed", which are
   * opposite facts. Ask a question git can only answer when it works: if
   * `rev-parse --is-inside-work-tree` is not 'true' we are not in a usable
   * repo, and the honest answer is `null` — unknown — rather than a
   * comforting `false`.
   */
  if (git('rev-parse --is-inside-work-tree') !== 'true') return null;
  return git('status --porcelain') !== '';
}

if (info.dirty === true && info.commit !== 'unknown' && !info.commit.endsWith('-dirty')) {
  info.commit = `${info.commit}-dirty`;
}
if (info.dirty === true) {
  console.warn(
    '[build-info] WARNING: building over a DIRTY working tree. This artifact ' +
      `does not correspond to commit ${info.commit.replace(/-dirty$/, '')} alone. ` +
      'Commit or stash before producing a release.',
  );
}

const dir = join(__dirname, '..', 'resources');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log('[build-info]', JSON.stringify(info));
