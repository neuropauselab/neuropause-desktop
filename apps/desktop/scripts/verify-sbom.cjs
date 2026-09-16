/**
 * S131 — SBOM verifier. Fails CLOSED when the generated SBOM is empty, structurally invalid, does not
 * correspond to the lockfile it claims to describe, or carries a hostile/malformed component identity.
 *
 * Reads ONLY local files (the SBOM + the lockfile) — no network, no secrets — so it runs identically in CI
 * and locally. The pure `validateSbom(sbom, lockfile)` function is exported for unit testing; the CLI runs
 * only when executed directly.
 *
 * CLI: node scripts/verify-sbom.cjs [--sbom <path>] [--lockfile <path>]
 */
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { buildSbom, SAFE_NAME } = require('./generate-sbom.cjs');

/** The expected component identity set derived from the lockfile (the source of truth). */
function expectedComponentIds(lockfile) {
  return new Set(buildSbom(lockfile).components.map((c) => `${c.name}@${c.version}`));
}

/**
 * Validate an SBOM object against the lockfile it should describe. Pure. Returns { ok, errors:[] }.
 * Checks: CycloneDX envelope · non-empty components · every component well-formed (name/version/type/purl)
 * · NO hostile name (path traversal, control chars, unsafe characters) · correspondence to the lockfile
 * (no invented components; count matches the deduped lockfile set).
 */
function validateSbom(sbom, lockfile) {
  const errors = [];
  const fail = (m) => errors.push(m);

  if (!sbom || typeof sbom !== 'object') return { ok: false, errors: ['sbom is not an object'] };
  if (sbom.bomFormat !== 'CycloneDX') fail(`bomFormat must be CycloneDX (got ${JSON.stringify(sbom.bomFormat)})`);
  if (typeof sbom.specVersion !== 'string' || sbom.specVersion === '') fail('specVersion missing');
  if (typeof sbom.version !== 'number') fail('version must be a number');
  if (!Array.isArray(sbom.components)) return { ok: false, errors: [...errors, 'components is not an array'] };
  if (sbom.components.length === 0) fail('components is EMPTY — an SBOM that lists nothing is not a bill of materials');

  const seen = new Set();
  for (const c of sbom.components) {
    const label = (c && c.name) || '<unnamed>';
    if (!c || typeof c !== 'object') { fail('component is not an object'); continue; }
    if (typeof c.name !== 'string' || c.name === '') fail(`component ${label}: missing name`);
    if (typeof c.version !== 'string' || c.version === '') fail(`component ${label}: missing version`);
    if (c.type !== 'library') fail(`component ${label}: type must be 'library'`);
    if (typeof c.purl !== 'string' || !c.purl.startsWith('pkg:npm/')) fail(`component ${label}: purl must start pkg:npm/`);
    // Hostile-name guard: an npm name is a scope?/name of safe chars only. A traversal / control char /
    // newline / unexpected character in a component name is a supply-chain red flag and must not pass.
    if (typeof c.name === 'string') {
      const segs = c.name.startsWith('@') ? c.name.slice(1).split('/') : [c.name];
      const bad =
        c.name.includes('..') ||
        (c.name.startsWith('@') ? segs.length !== 2 : segs.length !== 1) ||
        !segs.every((s) => SAFE_NAME.test(s));
      if (bad) fail(`component ${JSON.stringify(c.name)}: hostile/malformed component name rejected`);
    }
    if (typeof c.name === 'string' && typeof c.version === 'string') {
      const id = `${c.name}@${c.version}`;
      if (seen.has(id)) fail(`duplicate component ${id}`);
      seen.add(id);
    }
  }

  // Correspondence: the SBOM must describe THIS lockfile — no invented components, and the same count.
  if (lockfile) {
    const expected = expectedComponentIds(lockfile);
    for (const id of seen) if (!expected.has(id)) fail(`component ${id} is NOT in the lockfile (invented/mismatched)`);
    if (seen.size !== expected.size) fail(`component count ${seen.size} does not match lockfile ${expected.size}`);
  }

  return { ok: errors.length === 0, errors };
}

function main() {
  const args = process.argv.slice(2);
  const sbomArg = args.indexOf('--sbom');
  const lockArg = args.indexOf('--lockfile');
  const repoRoot = join(__dirname, '..', '..', '..');
  const sbomPath = sbomArg >= 0 ? args[sbomArg + 1] : join(__dirname, '..', 'dist-sbom', 'sbom.cdx.json');
  const lockfilePath = lockArg >= 0 ? args[lockArg + 1] : join(repoRoot, 'package-lock.json');

  if (!existsSync(sbomPath)) { console.error(`[verify-sbom] SBOM not found: ${sbomPath}`); process.exit(1); }
  if (!existsSync(lockfilePath)) { console.error(`[verify-sbom] lockfile not found: ${lockfilePath}`); process.exit(1); }
  const sbom = JSON.parse(readFileSync(sbomPath, 'utf8'));
  const lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8'));
  const { ok, errors } = validateSbom(sbom, lockfile);
  if (!ok) {
    console.error(`[verify-sbom] FAILED (${errors.length} error(s)):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`[verify-sbom] OK — ${sbom.components.length} components correspond to the lockfile`);
}

module.exports = { validateSbom, expectedComponentIds };

if (require.main === module) main();
