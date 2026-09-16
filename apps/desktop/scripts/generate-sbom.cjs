/**
 * S131 — Software Bill of Materials (SBOM) generator + build provenance.
 *
 * Produces a machine-readable CycloneDX 1.5 SBOM of the resolved dependency graph, built PURELY from the
 * committed `package-lock.json` (lockfileVersion 3). No network, no install, no second build system — it is
 * a deterministic fold over the lockfile the repo already commits, mirroring the offline, side-effect-free
 * posture of `generate-notices.cjs` and `verify-release-artifacts.cjs`.
 *
 * WHY: the repo had license ATTRIBUTION (`THIRD-PARTY-NOTICES.md`) but no machine-readable bill of
 * materials (SLSA audit §3, §6.4). This closes that gap at the CI/repository level with zero product
 * runtime change.
 *
 * DETERMINISM: `buildSbom(lockfile)` is a pure function — components are deduped by name@version and sorted
 * by purl, and NO volatile field (timestamp / random serialNumber) is emitted into the component document.
 * Provenance (commit / repo / workflow / timestamp / sbom digest) is a SEPARATE injected block, so the
 * SBOM itself is byte-stable for a given lockfile and its tests are deterministic.
 *
 * PROVENANCE: `buildProvenance(env)` binds commit SHA, repository, workflow, build identity, build
 * timestamp and the SBOM digest. CI-only fields (GITHUB_*) are populated from the environment when present
 * and are honestly `null` when run locally (OPERATOR/CI-PENDING), never fabricated.
 *
 * CLI: node scripts/generate-sbom.cjs [--lockfile <path>] [--out <dir>]
 *   writes <out>/sbom.cdx.json and <out>/provenance.json (default out dir: dist-sbom/).
 * The pure functions are exported for unit testing; the CLI runs only when executed directly.
 */
const { createHash } = require('node:crypto');
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { execSync } = require('node:child_process');

const SPEC_VERSION = '1.5';

/** Safe character set for an npm package name segment (scope + name). Anything else is hostile. */
const SAFE_NAME = /^[a-z0-9._~-]+$/i;

/** Derive the package name for a lockfile v3 `node_modules/...` key (handles scopes + nesting). */
function nameFromKey(key, declaredName) {
  if (declaredName && typeof declaredName === 'string') return declaredName;
  const idx = key.lastIndexOf('node_modules/');
  const tail = idx >= 0 ? key.slice(idx + 'node_modules/'.length) : key;
  // tail is either `name` or `@scope/name` (no further slashes at this depth in a v3 key tail).
  return tail;
}

/** purl for an npm component; scope's leading @ is percent-encoded per the purl spec. */
function npmPurl(name, version) {
  const encoded = name.startsWith('@') ? `%40${name.slice(1)}` : name;
  return `pkg:npm/${encoded}@${version}`;
}

/**
 * Build a deterministic CycloneDX 1.5 SBOM object from a parsed package-lock.json (v3).
 * Pure: no clock, no randomness, no IO. Components are deduped by name@version and sorted by purl.
 */
function buildSbom(lockfile) {
  const packages = (lockfile && lockfile.packages) || {};
  const byKeyName = new Map(); // name@version -> component
  for (const key of Object.keys(packages)) {
    if (!key.startsWith('node_modules/')) continue; // skip the root ("") and workspace roots
    const entry = packages[key] || {};
    if (entry.link) continue; // workspace symlink — not a third-party component
    const version = entry.version;
    if (!version || typeof version !== 'string') continue; // no resolved version ⇒ not a real component
    const name = nameFromKey(key, entry.name);
    if (!name) continue;
    const id = `${name}@${version}`;
    if (byKeyName.has(id)) continue; // dedupe nested duplicates
    const component = {
      type: 'library',
      name,
      version,
      purl: npmPurl(name, version),
      scope: entry.dev ? 'optional' : 'required',
    };
    // Integrity is stored as an honest property (npm's `sha512-<base64>` is not CycloneDX hex hash form).
    if (entry.integrity && typeof entry.integrity === 'string') {
      component.properties = [{ name: 'npm:integrity', value: entry.integrity }];
    }
    byKeyName.set(id, component);
  }
  const components = [...byKeyName.values()].sort((a, b) => a.purl.localeCompare(b.purl));
  return {
    bomFormat: 'CycloneDX',
    specVersion: SPEC_VERSION,
    version: 1,
    metadata: {
      component: {
        type: 'application',
        name: (lockfile && lockfile.name) || 'neuropause-desktop',
        version: (lockfile && lockfile.version) || '0.0.0',
      },
      tools: [{ vendor: 'NeuroPause', name: 'generate-sbom.cjs', version: '1' }],
    },
    components,
  };
}

/** Stable digest of a JSON document (sorted-key canonical form) — the identity the provenance binds to. */
function jsonDigest(obj) {
  const canonical = JSON.stringify(sortKeys(obj));
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

/**
 * Build the build-provenance record. CI-only fields come from the environment (GitHub Actions) and are
 * honestly `null` when absent locally — never invented. `sbomDigest` binds this provenance to a specific
 * SBOM document. `commit` falls back to a local `git rev-parse` when GITHUB_SHA is absent.
 */
function buildProvenance(env, sbomDigest, gitCommit) {
  const e = env || {};
  return {
    _type: 'neuropause-build-provenance/v1',
    predicateType: 'https://slsa.dev/provenance/v1',
    // Precise honesty: this is self-attested provenance metadata, NOT signed SLSA provenance.
    attestationLevel: 'SELF_ATTESTED_UNSIGNED',
    subject: { sbomDigest: sbomDigest || null },
    build: {
      repository: e.GITHUB_REPOSITORY || null,
      commit: e.GITHUB_SHA || gitCommit || null,
      ref: e.GITHUB_REF || null,
      workflow: e.GITHUB_WORKFLOW || null,
      runId: e.GITHUB_RUN_ID || null,
      runAttempt: e.GITHUB_RUN_ATTEMPT || null,
      builderIdentity: e.GITHUB_ACTIONS === 'true' ? (e.RUNNER_NAME || 'github-hosted') : 'local',
      hosted: e.GITHUB_ACTIONS === 'true',
      timestamp: new Date().toISOString(),
    },
  };
}

function localGitCommit() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

function main() {
  const args = process.argv.slice(2);
  const lockArg = args.indexOf('--lockfile');
  const outArg = args.indexOf('--out');
  const repoRoot = join(__dirname, '..', '..', '..');
  const lockfilePath = lockArg >= 0 ? args[lockArg + 1] : join(repoRoot, 'package-lock.json');
  const outDir = outArg >= 0 ? args[outArg + 1] : join(__dirname, '..', 'dist-sbom');

  if (!existsSync(lockfilePath)) {
    console.error(`[sbom] lockfile not found: ${lockfilePath}`);
    process.exit(1);
  }
  const lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8'));
  const sbom = buildSbom(lockfile);
  const sbomDigest = jsonDigest(sbom);
  const provenance = buildProvenance(process.env, sbomDigest, localGitCommit());

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'sbom.cdx.json'), JSON.stringify(sbom, null, 2) + '\n', 'utf8');
  writeFileSync(join(outDir, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n', 'utf8');
  console.log(`[sbom] ${sbom.components.length} components → ${join(outDir, 'sbom.cdx.json')}`);
  console.log(`[sbom] digest ${sbomDigest}`);
  console.log(`[sbom] provenance commit=${provenance.build.commit ?? 'null'} hosted=${provenance.build.hosted}`);
}

module.exports = { buildSbom, buildProvenance, jsonDigest, npmPurl, nameFromKey, SAFE_NAME, SPEC_VERSION };

if (require.main === module) main();
