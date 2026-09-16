/**
 * S131 — packaged-content assertion. Fails CLOSED when the built/packaged output contains prohibited
 * development material. It enforces the repository's ACTUAL packaging rules (electron-builder.yml excludes
 * `**​/*.test.ts`; the release ships `out/**` + package.json) plus a conservative prohibited set that no
 * shipped artifact should ever contain — WITHOUT running electron-builder: it scans the `out/**` tree the
 * existing `build` step already produces, so it runs deterministically in CI on Linux.
 *
 * SCOPE HONESTY (per S131 directive — do not invent a new release policy):
 *   • ENFORCED here: test fixtures/specs, env files, private keys, repo metadata (.git), temp/OS cruft,
 *     custody-protected certification material, and the e2e build-seam SENTINEL FILENAMES the existing
 *     `verify-e2e-strip.sh` guards by content.
 *   • DEFERRED / AMBIGUOUS (documented, NOT silently decided): source maps (`*.map`). The repo has no
 *     explicit ship/strip policy for source maps, so they are flagged ONLY when `--prohibit-source-maps`
 *     is passed. See SESSION131 cert §Packaged-content for the recorded ambiguity.
 *
 * This does NOT replace `verify-e2e-strip.sh` (which greps chunk CONTENT for seed sentinels after a
 * release rebuild); it is the cheaper, always-on FILENAME-level assertion that runs on every PR build.
 *
 * The pure `classifyPackagedPaths(paths, opts)` is exported for unit testing; the CLI walks a directory
 * and runs only when executed directly.
 *
 * CLI: node scripts/verify-packaged-content.cjs [--dir out] [--prohibit-source-maps]
 */
const { existsSync, readdirSync, statSync } = require('node:fs');
const { join, sep } = require('node:path');

/**
 * Normalize a path to forward-slash POSIX segments, stripping a leading scan-root and rejecting nothing —
 * hostile inputs (backslashes, `..`, absolute paths, embedded NUL) are normalized so they cannot slip past
 * a basename/segment match. Returns { segments, basename, lower }.
 */
function normalizePath(p) {
  const raw = String(p);
  // Split on BOTH separators so a Windows-style or mixed path cannot hide a segment.
  const segments = raw.split(/[\\/]+/).filter((s) => s !== '' && s !== '.');
  const basename = segments.length ? segments[segments.length - 1] : '';
  return { segments, basename, lower: basename.toLowerCase(), rawLower: raw.toLowerCase() };
}

// Each rule: { rule, test(info) -> boolean }. Matching is on NORMALIZED segments/basename so a hostile
// filename (extra separators, case, traversal) cannot bypass it.
function prohibitedRules(opts) {
  const o = opts || {};
  const rules = [
    { rule: 'test-file', test: (i) => /\.(test|spec)\.(ts|tsx|js|jsx|cjs|mjs)$/.test(i.lower) },
    { rule: 'test-fixture-dir', test: (i) => i.segments.some((s) => s === '__tests__' || s === '__fixtures__' || s === '__mocks__') },
    { rule: 'env-file', test: (i) => (i.lower === '.env' || /^\.env\./.test(i.lower)) && !i.lower.includes('example') && !i.lower.includes('.sample') },
    { rule: 'private-key', test: (i) => /\.(pem|key|p12|pfx|keystore|jks)$/.test(i.lower) || i.lower === 'id_rsa' || i.lower === 'id_ed25519' || i.lower === 'id_ecdsa' },
    { rule: 'repo-metadata', test: (i) => i.segments.includes('.git') || i.lower === '.gitignore' || i.lower === '.npmrc' },
    { rule: 'temp-or-os-cruft', test: (i) => /\.(tmp|swp|swo|orig|bak)$/.test(i.lower) || i.lower === '.ds_store' || i.lower === 'thumbs.db' },
    { rule: 'custody-protected', test: (i) => i.lower === 'baseline.json' || i.segments.some((s) => s === '.claude') },
    // The e2e build-seam sentinel FILENAMES (content is guarded by verify-e2e-strip.sh; filename here).
    { rule: 'e2e-build-seam', test: (i) => /(^|[^a-z])e2eseed/.test(i.lower) || i.lower.includes('firstrealsendguard') || i.lower.includes('s16verifyrun') },
  ];
  if (o.prohibitSourceMaps) rules.push({ rule: 'source-map', test: (i) => i.lower.endsWith('.map') });
  return rules;
}

/**
 * Classify a list of packaged paths against the prohibited set. Pure. Returns { ok, violations:[{path,rule}] }.
 * NON-EXCLUDING of legitimate content — it only reports prohibited material; a clean list ⇒ ok:true.
 */
function classifyPackagedPaths(paths, opts) {
  const rules = prohibitedRules(opts);
  const violations = [];
  for (const p of paths || []) {
    const info = normalizePath(p);
    if (!info.basename) continue;
    for (const r of rules) {
      if (r.test(info)) { violations.push({ path: String(p), rule: r.rule }); break; }
    }
  }
  return { ok: violations.length === 0, violations };
}

/** Recursively list every file under a directory (POSIX-joined relative paths). */
function walk(dir, base) {
  const root = base || dir;
  const out = [];
  let entries = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) out.push(...walk(full, root));
    else out.push(full.slice(root.length + 1).split(sep).join('/'));
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const dirArg = args.indexOf('--dir');
  const dir = dirArg >= 0 ? args[dirArg + 1] : join(__dirname, '..', 'out');
  const opts = { prohibitSourceMaps: args.includes('--prohibit-source-maps') };
  if (!existsSync(dir)) { console.error(`[packaged-content] scan dir not found: ${dir} (run the build first)`); process.exit(1); }
  const files = walk(dir);
  const { ok, violations } = classifyPackagedPaths(files, opts);
  if (!ok) {
    console.error(`[packaged-content] FAILED — ${violations.length} prohibited file(s) in ${dir}:`);
    for (const v of violations) console.error(`  - [${v.rule}] ${v.path}`);
    process.exit(1);
  }
  console.log(`[packaged-content] OK — ${files.length} packaged file(s) scanned, 0 prohibited`);
}

module.exports = { classifyPackagedPaths, normalizePath, prohibitedRules };

if (require.main === module) main();
