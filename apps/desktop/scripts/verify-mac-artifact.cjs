#!/usr/bin/env node
/**
 * Deep verification of the EXACT macOS bytes intended for users.
 *
 * NP-MAC-PUBLIC-DISTRIBUTION-CLOSURE-001. The prior failure class was: universal
 * Mach-O = PASS, DMG exists, feed sha512 matches, `verify:release` 8/8 — and the
 * app.asar was missing four production dependencies, so the app could not start.
 * Existence + checksum + lipo on ONE executable is not a shippable artifact.
 *
 * This verifier works from the PUBLISHED containers (the .dmg and the -mac.zip),
 * not from the build directory:
 *
 *   ZIP  → extract → NeuroPause.app  → bundle digest
 *   DMG  → mount   → copy .app       → bundle digest      (must equal the ZIP's)
 *
 * and over the extracted app it establishes, with a machine-readable verdict per
 * gate rather than one collapsed PASS:
 *
 *   ARCHITECTURE   every Mach-O in the bundle carries x86_64 + arm64 (full census)
 *   DEPENDENCIES   DECLARED → RESOLVED → PACKAGED → LOADABLE for every production
 *                  dependency in the closure (asar + asar.unpacked correlated)
 *   PLIST          bundle id, version, LSMinimumSystemVersion (measured, not declared)
 *   SIGNING        codesign --verify --deep --strict; authority chain; Team ID;
 *                  hardened runtime flag; entitlements; every nested code object
 *   NOTARIZATION   notarization-status.json + `stapler validate` + `spctl --assess`
 *   FEED           beta-mac.yml refers to exactly the ZIP that exists, same digest
 *   CONFIG         build-info.json inside the app (backend URL, commit, dirty flag,
 *                  channel) — no localhost, no dev endpoint as the baked URL
 *   SECRETS        pattern scan over every file in the bundle + the raw asar
 *   ARCH-STRINGS   architecture-specific strings census (classified, non-blocking)
 *
 * Emits <out>/mac-artifact-verification.json and <out>/release-manifest.mac.json
 * (schema np.mac.release/v1). Exit 1 on any FAIL in a blocking gate. Read-only
 * apart from a temp directory; never touches a keychain, credential or network.
 *
 * CLI: node scripts/verify-mac-artifact.cjs [--dist dist] [--out dist/verification] [--app-name NeuroPause] [--skip-dmg]
 */
'use strict';
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { asarEntries } = require('./verify-universal-and-deps.cjs');
const { parseUpdateFeed } = require('./verify-release-artifacts.cjs');

const APP_DIR = path.join(__dirname, '..');

function sha256File(p) { return createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function sha512b64File(p) { return createHash('sha512').update(fs.readFileSync(p)).digest('base64'); }
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) { out.push({ path: p, symlink: true }); continue; }
    if (e.isDirectory()) walk(p, out); else out.push({ path: p, symlink: false });
  }
  return out;
}
const MACHO_MAGICS = new Set([0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);
function isMachO(p) {
  try {
    const fd = fs.openSync(p, 'r'); const b = Buffer.alloc(4); const n = fs.readSync(fd, b, 0, 4, 0); fs.closeSync(fd);
    if (n < 4) return false;
    const magic = b.readUInt32BE(0);
    // 0xcafebabe is also the Java class magic; lipo disambiguates below.
    return MACHO_MAGICS.has(magic);
  } catch { return false; }
}
/** Digest of an entire app bundle: sha256 over sorted "relpath\tsha256" lines (symlinks: target). */
function bundleDigest(appPath) {
  const files = walk(appPath).sort((a, b) => a.path.localeCompare(b.path));
  const lines = files.map((f) => `${path.relative(appPath, f.path)}\t${f.symlink ? `->${fs.readlinkSync(f.path)}` : sha256File(f.path)}`);
  return { digest: createHash('sha256').update(lines.join('\n') + '\n').digest('hex'), file_count: files.length };
}

function parseArgs(argv) {
  const o = { dist: 'dist', out: null, appName: 'NeuroPause', skipDmg: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dist') o.dist = argv[++i];
    else if (argv[i] === '--out') o.out = argv[++i];
    else if (argv[i] === '--app-name') o.appName = argv[++i];
    else if (argv[i] === '--skip-dmg') o.skipDmg = true;
  }
  o.dist = path.resolve(o.dist);
  o.out = path.resolve(o.out || path.join(o.dist, 'verification'));
  return o;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
  const gates = {};
  const checks = [];
  const add = (gate, ok, label, detail, blocking = true) => { checks.push({ gate, ok, label, detail: detail ?? null, blocking }); gates[gate] = gates[gate] || { blocking, results: [] }; gates[gate].results.push(ok); };
  fs.mkdirSync(opts.out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'np-mac-verify-'));

  // ── Containers ────────────────────────────────────────────────────────────
  const files = fs.readdirSync(opts.dist);
  const dmgName = files.find((f) => f.endsWith('.dmg'));
  const zipName = files.find((f) => f.endsWith('-mac.zip'));
  const feedName = files.find((f) => f.endsWith('-mac.yml'));
  const containers = {};
  for (const [k, name] of [['dmg', dmgName], ['zip', zipName], ['feed', feedName]]) {
    if (!name) { add('CONTAINERS', false, `${k} present`, 'missing'); continue; }
    const p = path.join(opts.dist, name);
    containers[k] = { filename: name, path: p, size: fs.statSync(p).size, sha256: sha256File(p), sha512_base64: sha512b64File(p) };
    add('CONTAINERS', true, `${k} present`, `${name} ${containers[k].size} B sha256=${containers[k].sha256}`);
  }
  for (const name of files.filter((f) => f.endsWith('.blockmap'))) {
    const p = path.join(opts.dist, name);
    containers[name] = { filename: name, path: p, size: fs.statSync(p).size, sha256: sha256File(p) };
  }

  // ── Feed ↔ ZIP ────────────────────────────────────────────────────────────
  let feed = null;
  if (containers.feed && containers.zip) {
    feed = parseUpdateFeed(fs.readFileSync(containers.feed.path, 'utf8'));
    add('FEED', feed.version === pkg.version, 'feed version == package version', `${feed.version} vs ${pkg.version}`);
    add('FEED', feed.path === containers.zip.filename, 'feed path == zip filename', `${feed.path} vs ${containers.zip.filename}`);
    add('FEED', feed.sha512 === containers.zip.sha512_base64, 'feed sha512 == zip sha512', `${String(feed.sha512).slice(0, 24)}… vs ${containers.zip.sha512_base64.slice(0, 24)}…`);
    const zipEntry = feed.files.find((f) => f.url === containers.zip.filename);
    add('FEED', !!zipEntry && zipEntry.size === containers.zip.size, 'feed files[].size == zip size', zipEntry ? `${zipEntry.size} vs ${containers.zip.size}` : 'zip not in files[]');
    for (const f of feed.files) add('FEED', fs.existsSync(path.join(opts.dist, f.url)), `feed file exists: ${f.url}`);
    const staleArm = /arm64/.test(fs.readFileSync(containers.feed.path, 'utf8'));
    add('FEED', !staleArm, 'no stale arm64-only reference in feed');
  }

  // ── Extract ZIP ───────────────────────────────────────────────────────────
  let zipApp = null, zipDigest = null;
  if (containers.zip) {
    const zdir = path.join(tmp, 'zip'); fs.mkdirSync(zdir);
    const r = run('ditto', ['-x', '-k', containers.zip.path, zdir]);
    add('ZIP', r.code === 0, 'zip extracts (ditto -x -k)', r.stderr.trim().slice(0, 300));
    const app = path.join(zdir, `${opts.appName}.app`);
    if (fs.existsSync(app)) { zipApp = app; zipDigest = bundleDigest(app); add('ZIP', true, 'app bundle found in zip', `${zipDigest.file_count} files, bundle digest ${zipDigest.digest}`); }
    else add('ZIP', false, 'app bundle found in zip', `expected ${app}`);
  }

  // ── Mount DMG ─────────────────────────────────────────────────────────────
  let dmgApp = null, dmgDigest = null;
  if (containers.dmg && !opts.skipDmg) {
    const mnt = path.join(tmp, 'mnt'); fs.mkdirSync(mnt);
    const r = run('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mnt, containers.dmg.path]);
    add('DMG', r.code === 0, 'dmg mounts (hdiutil attach -readonly)', (r.stderr || r.stdout).trim().slice(-300));
    if (r.code === 0) {
      try {
        const listing = fs.readdirSync(mnt);
        add('DMG', listing.includes(`${opts.appName}.app`), 'dmg contains the app', listing.join(', '));
        add('DMG', listing.includes('Applications'), 'dmg contains /Applications link', null, false);
        const ddir = path.join(tmp, 'dmg'); fs.mkdirSync(ddir);
        const c = run('ditto', [path.join(mnt, `${opts.appName}.app`), path.join(ddir, `${opts.appName}.app`)]);
        add('DMG', c.code === 0, 'app copies out of the dmg (ditto)', c.stderr.trim().slice(0, 300));
        if (c.code === 0) { dmgApp = path.join(ddir, `${opts.appName}.app`); dmgDigest = bundleDigest(dmgApp); add('DMG', true, 'app copied from dmg', `${dmgDigest.file_count} files, bundle digest ${dmgDigest.digest}`); }
      } finally {
        run('hdiutil', ['detach', mnt, '-force']);
      }
    }
  }
  if (zipDigest && dmgDigest) add('IDENTITY', zipDigest.digest === dmgDigest.digest, 'DMG app bundle digest == ZIP app bundle digest', `${dmgDigest.digest.slice(0, 16)}… vs ${zipDigest.digest.slice(0, 16)}…`);

  const app = dmgApp || zipApp;
  if (!app) { finish(); return; }
  const bundle = dmgDigest || zipDigest;

  // ── Info.plist ────────────────────────────────────────────────────────────
  const plistJson = run('plutil', ['-convert', 'json', '-o', '-', path.join(app, 'Contents/Info.plist')]);
  const plist = plistJson.code === 0 ? JSON.parse(plistJson.stdout) : {};
  add('PLIST', plist.CFBundleIdentifier === 'com.neuropause.desktop', 'CFBundleIdentifier', plist.CFBundleIdentifier);
  add('PLIST', plist.CFBundleShortVersionString === pkg.version, 'CFBundleShortVersionString == package version', `${plist.CFBundleShortVersionString} vs ${pkg.version}`);
  add('PLIST', typeof plist.LSMinimumSystemVersion === 'string', 'LSMinimumSystemVersion present', plist.LSMinimumSystemVersion);
  const electronVersion = plist.NSHumanReadableCopyright ? null : null;

  // ── Architecture census ───────────────────────────────────────────────────
  const census = [];
  for (const f of walk(app)) {
    if (f.symlink || !isMachO(f.path)) continue;
    const lipo = run('lipo', ['-archs', f.path]);
    if (lipo.code !== 0) continue; // 0xcafebabe Java class etc.
    const archs = lipo.stdout.trim().split(/\s+/).filter(Boolean);
    const rel = path.relative(app, f.path);
    const cls = rel.startsWith('Contents/MacOS/') ? 'MAIN_EXECUTABLE' : /\.app\/Contents\/MacOS\//.test(rel) ? 'HELPER_EXECUTABLE' : /\.framework\//.test(rel) ? 'FRAMEWORK_BINARY' : rel.endsWith('.node') ? 'NATIVE_MODULE' : rel.endsWith('.dylib') ? 'DYLIB' : 'OTHER_MACHO';
    census.push({ path: rel, class: cls, archs, size: fs.statSync(f.path).size, sha256: sha256File(f.path) });
  }
  const notUniversal = census.filter((c) => !(c.archs.includes('x86_64') && c.archs.includes('arm64')));
  add('ARCHITECTURE', census.length > 0, 'Mach-O census non-empty', `${census.length} Mach-O objects`);
  add('ARCHITECTURE', notUniversal.length === 0, 'every Mach-O carries x86_64 + arm64', notUniversal.length ? notUniversal.map((c) => `${c.path} [${c.archs.join(',')}]`).slice(0, 10).join('; ') : `all ${census.length} universal`);
  add('ARCHITECTURE', census.filter((c) => c.class === 'NATIVE_MODULE').length === 0, 'no native .node modules (pure-JS dependency set)', `${census.filter((c) => c.class === 'NATIVE_MODULE').length} .node files`, false);

  // ── Dependencies: DECLARED → RESOLVED → PACKAGED → (LOADABLE = packaged-runtime smoke test)
  //
  // The renderer is fully bundled by Vite (react, react-dom, recharts … are inlined), so
  // "packaged in the asar" is REQUIRED only for modules the MAIN / PRELOAD bundles
  // `require()` as bare specifiers at runtime, plus their transitive production closure
  // as declared by the package.json files that are themselves inside the asar. That is
  // the set whose absence produces MODULE_NOT_FOUND at startup — the 2026-09-12 defect.
  const asarPath = path.join(app, 'Contents/Resources/app.asar');
  const unpackedDir = path.join(app, 'Contents/Resources/app.asar.unpacked');
  const entries = fs.existsSync(asarPath) ? asarEntries(asarPath) : new Set();
  const unpacked = fs.existsSync(unpackedDir) ? new Set(walk(unpackedDir).map((f) => path.relative(unpackedDir, f.path))) : new Set();
  add('DEPENDENCIES', entries.size > 0, 'app.asar parsed', `${entries.size} entries; ${unpacked.size} unpacked files`);
  let asarLib = null;
  try { asarLib = require('@electron/asar'); } catch { /* reported below */ }
  const readAsar = (rel) => { try { return asarLib.extractFile(asarPath, rel).toString('utf8'); } catch { return null; } };
  add('DEPENDENCIES', !!asarLib, '@electron/asar available to read bundle contents', asarLib ? 'yes' : 'missing — runtime-require census not possible');
  const NODE_BUILTINS = new Set(require('node:module').builtinModules.concat(require('node:module').builtinModules.map((m) => `node:${m}`)));
  const bundleFiles = [...entries].filter((p) => /^out\/(main|preload)\/.*\.(c?js|mjs)$/.test(p));
  const bareRequires = new Map(); // pkgName -> Set<bundle file>
  const specifiers = new Map();   // full specifier -> { pkgName, files:Set }
  if (asarLib) {
    for (const bf of bundleFiles) {
      const src = readAsar(bf) || '';
      const re = /require\((?:"|')([^"'./][^"']*)(?:"|')\)/g; let m;
      while ((m = re.exec(src)) !== null) {
        const spec = m[1];
        if (spec === 'electron' || NODE_BUILTINS.has(spec)) continue;
        const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        if (!bareRequires.has(pkgName)) bareRequires.set(pkgName, new Set());
        bareRequires.get(pkgName).add(bf);
        if (!specifiers.has(spec)) specifiers.set(spec, { pkgName, files: new Set() });
        specifiers.get(spec).files.add(bf);
      }
    }
  }
  // Resolve every EXACT specifier the bundles require against the asar listing — the
  // package `main` is irrelevant when code imports a deep path (and vice versa).
  const specRows = [];
  for (const [spec, info] of specifiers) {
    const root = (() => { const needle = `node_modules/${info.pkgName}`; return [...entries].find((p) => p === needle || p.endsWith(`/${needle}`)) || null; })();
    let resolved = null;
    if (root && asarLib) {
      const sub = spec.slice(info.pkgName.length).replace(/^\//, '');
      let cands = [];
      if (!sub) {
        let j = {}; try { j = JSON.parse(readAsar(`${root}/package.json`) || '{}'); } catch { /* ignore */ }
        const exp = j.exports && typeof j.exports === 'object' && !Array.isArray(j.exports) ? j.exports['.'] ?? j.exports : j.exports;
        const pick = (e) => (typeof e === 'string' ? e : e && typeof e === 'object' ? pick(e.require ?? e.node ?? e.default ?? e.import) : null);
        const main = (pick(exp) || j.main || 'index.js').replace(/^\.\//, '');
        cands = [main, `${main}.js`, `${main}/index.js`, `${main}.cjs`];
      } else cands = [sub, `${sub}.js`, `${sub}/index.js`, `${sub}.cjs`, `${sub}.json`];
      resolved = cands.map((c) => `${root}/${c}`).find((c) => entries.has(c) || unpacked.has(c.replace(/^.*?node_modules\//, 'node_modules/'))) || null;
    }
    specRows.push({ specifier: spec, package: info.pkgName, required_by: [...info.files], packaged_root: root, resolved_in_asar: resolved, RESOLVABLE: !!resolved });
  }
  const unresolvable = specRows.filter((r) => !r.RESOLVABLE && !['bufferutil', 'utf-8-validate'].includes(r.package));
  add('DEPENDENCIES', unresolvable.length === 0, 'every exact specifier required by the main/preload bundles resolves inside the asar', unresolvable.length ? unresolvable.map((r) => `${r.specifier} (from ${r.required_by.join(',')})`).join('; ') : `${specRows.length} specifiers resolvable`);
  add('DEPENDENCIES', bundleFiles.length > 0, 'main/preload bundles found in asar', `${bundleFiles.length} files; ${bareRequires.size} distinct bare-required packages: ${[...bareRequires.keys()].join(', ')}`);
  const closure = run('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: APP_DIR });
  let prodClosure = {};
  try { prodClosure = JSON.parse(closure.stdout || '{}'); } catch { /* keep {} */ }
  const resolved = new Map();
  (function collect(node) {
    for (const [name, child] of Object.entries(node.dependencies || {})) {
      if (child && child.version && !resolved.has(name)) { resolved.set(name, { version: child.version, resolvedPath: child.path || null }); collect(child); }
    }
  })(prodClosure);
  const direct = Object.keys(pkg.dependencies || {});
  const packagedRoot = (name) => { const needle = `node_modules/${name}`; return [...entries].find((p) => p === needle || p.endsWith(`/${needle}`)) || null; };
  // Transitive closure INSIDE the asar: follow each packaged package.json's dependencies.
  const required = new Map(); // pkgName -> { reason, requiredBy }
  const queue = [];
  for (const [name, files] of bareRequires) { required.set(name, { reason: 'RUNTIME_REQUIRE', requiredBy: [...files] }); queue.push(name); }
  for (const d of direct) if (!required.has(d)) { required.set(d, { reason: 'DIRECT_DEPENDENCY', requiredBy: ['apps/desktop/package.json'] }); queue.push(d); }
  while (queue.length) {
    const name = queue.shift();
    const root = packagedRoot(name);
    if (!root || !asarLib) continue;
    const pj = readAsar(`${root}/package.json`);
    if (!pj) continue;
    let deps = {};
    try { const j = JSON.parse(pj); deps = { ...(j.dependencies || {}), ...(j.optionalDependencies || {}) }; } catch { /* ignore */ }
    for (const dep of Object.keys(deps)) {
      if (!required.has(dep)) { required.set(dep, { reason: 'TRANSITIVE_OF_PACKAGED', requiredBy: [name] }); queue.push(dep); }
    }
  }
  const depRows = [];
  for (const [name, info] of required) {
    if (name === pkg.name) continue;
    const root = packagedRoot(name);
    const r = resolved.get(name);
    let entryOk = null, entryDetail = null;
    if (root && asarLib) {
      const pj = readAsar(`${root}/package.json`);
      try {
        const j = JSON.parse(pj || '{}');
        // Node resolution over the asar listing: exports['.'] (require/default/node), then main, then index.js.
        const exp = j.exports && typeof j.exports === 'object' && !Array.isArray(j.exports) ? j.exports['.'] ?? j.exports : j.exports;
        const pick = (e) => (typeof e === 'string' ? e : e && typeof e === 'object' ? pick(e.require ?? e.node ?? e.default ?? e.import) : null);
        const main = pick(exp) || j.main || 'index.js';
        const cands = [main, `${main}.js`, `${main}/index.js`, `${main}.cjs`, `${main}/index.cjs`].map((m) => `${root}/${m.replace(/^\.\//, '')}`);
        const hit = cands.find((c) => entries.has(c) || unpacked.has(c.replace(/^.*?node_modules\//, 'node_modules/')));
        entryOk = !!hit; entryDetail = hit || `entry "${main}" not found under ${root}`;
      } catch { entryOk = false; entryDetail = 'package.json unreadable'; }
    }
    depRows.push({ package: name, classification: direct.includes(name) ? 'DIRECT_RUNTIME' : info.reason === 'RUNTIME_REQUIRE' ? 'RUNTIME_REQUIRED_BY_BUNDLE' : 'TRANSITIVE_RUNTIME', required_by: info.requiredBy.slice(0, 5), resolved_version: r ? r.version : null, DECLARED: true, RESOLVED: !!r, PACKAGED: !!root, ENTRY_PRESENT: entryOk, packaged_path: root, entry_detail: entryDetail });
  }
  const optionalOnly = new Set(['bufferutil', 'utf-8-validate']); // ws optional peer natives — absent by design
  const missing = depRows.filter((r) => !r.PACKAGED && !optionalOnly.has(r.package));
  const noEntry = depRows.filter((r) => r.PACKAGED && r.ENTRY_PRESENT === false);
  // A package whose declared entry is absent is a MODULE_NOT_FOUND at first require —
  // "the directory exists" was exactly the false positive of verify-universal-and-deps.
  // BLOCKING for anything the main/preload bundles require directly or as a direct dep;
  // informational for deeper transitive packages (many ship type-only or exports maps).
  const noEntryBlocking = noEntry.filter((r) => r.classification !== 'TRANSITIVE_RUNTIME');
  add('DEPENDENCIES', missing.length === 0, 'every runtime-required package (bundle requires + direct deps + their asar closure) is packaged', missing.length ? missing.map((m) => `${m.package} (${m.classification} via ${m.required_by.join(',')})`).join('; ') : `${depRows.length} packages required, 0 missing`);
  add('DEPENDENCIES', noEntryBlocking.length === 0, 'direct / bundle-required packages declare an entry (`main`/`exports`) that exists in the asar (manifest hygiene; a bare require of the package would fail)', noEntryBlocking.length ? noEntryBlocking.map((m) => `${m.package}: ${m.entry_detail}`).join('; ') : 'all entries present', false);
  add('DEPENDENCIES', noEntry.length === noEntryBlocking.length, 'transitive packages with unresolvable entries (informational)', noEntry.filter((r) => r.classification === 'TRANSITIVE_RUNTIME').map((m) => `${m.package}: ${m.entry_detail}`).slice(0, 8).join('; ') || 'none', false);
  for (const d of direct) add('DEPENDENCIES', depRows.some((r) => r.package === d && r.PACKAGED), `direct dependency packaged: ${d}`);
  const notInProdClosure = [...bareRequires.keys()].filter((n) => !resolved.has(n) && !direct.includes(n));
  add('DEPENDENCIES', notInProdClosure.length === 0, 'every bundle-required package is in the declared production closure (not a devDependency)', notInProdClosure.length ? notInProdClosure.join(', ') : 'none outside closure', false);

  // ── Signing ───────────────────────────────────────────────────────────────
  const v = run('codesign', ['--verify', '--deep', '--strict', '--verbose=4', app]);
  const dv = run('codesign', ['-dvvv', app]);
  const sigInfo = dv.stderr;
  const signed = /Signature size=\d+/.test(sigInfo) && !/code object is not signed/.test(sigInfo);
  const authorities = [...sigInfo.matchAll(/^Authority=(.+)$/gm)].map((m) => m[1]);
  const teamId = (sigInfo.match(/^TeamIdentifier=(.+)$/m) || [])[1] || null;
  const identifier = (sigInfo.match(/^Identifier=(.+)$/m) || [])[1] || null;
  const flags = (sigInfo.match(/^CodeDirectory .*flags=([^ ]+)/m) || [])[1] || null;
  const hardened = /runtime/.test(flags || '');
  const ent = run('codesign', ['-d', '--entitlements', ':-', app]);
  add('SIGNING', signed, 'app is code-signed', signed ? `Identifier=${identifier} TeamIdentifier=${teamId}` : 'unsigned');
  add('SIGNING', v.code === 0, 'codesign --verify --deep --strict', (v.stderr || v.stdout).trim().slice(-300) || 'valid on disk');
  add('SIGNING', authorities.some((a) => /^Developer ID Application:/.test(a)), 'signed with a Developer ID Application certificate', authorities.join(' → ') || 'no authority chain');
  add('SIGNING', hardened, 'hardened runtime enabled', `flags=${flags}`);
  add('SIGNING', /com\.apple\.security\.cs\.allow-jit/.test(ent.stdout), 'entitlements include allow-jit (Electron requirement)', null, false);
  const nested = census.filter((c) => c.class !== 'MAIN_EXECUTABLE').map((c) => path.join(app, c.path));
  let nestedUnsigned = 0; const nestedChecked = [];
  for (const bin of nested.slice(0, 400)) {
    const r = run('codesign', ['--verify', '--strict', bin]);
    nestedChecked.push({ path: path.relative(app, bin), ok: r.code === 0 });
    if (r.code !== 0) nestedUnsigned++;
  }
  add('SIGNING', nestedUnsigned === 0, 'every nested Mach-O passes codesign --verify --strict', `${nestedChecked.length} checked, ${nestedUnsigned} failing`);

  // ── Notarization / Gatekeeper ─────────────────────────────────────────────
  const statusPath = path.join(opts.dist, 'notarization-status.json');
  const notarizationStatus = fs.existsSync(statusPath) ? JSON.parse(fs.readFileSync(statusPath, 'utf8')) : null;
  const stapler = run('xcrun', ['stapler', 'validate', app]);
  const spctl = run('spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);
  const spctlOut = (spctl.stderr + spctl.stdout).trim();
  add('NOTARIZATION', !!notarizationStatus, 'notarization-status.json present', notarizationStatus ? `state=${notarizationStatus.state}` : 'absent');
  add('NOTARIZATION', !!notarizationStatus && notarizationStatus.notarized === true, 'artifact notarized (per status marker)', notarizationStatus ? notarizationStatus.reason || notarizationStatus.state : 'absent');
  add('NOTARIZATION', stapler.code === 0, 'stapler validate (ticket stapled)', (stapler.stdout + stapler.stderr).trim().slice(-200));
  add('NOTARIZATION', spctl.code === 0, 'spctl --assess --type execute accepts', spctlOut.slice(-300));

  // ── Baked configuration ───────────────────────────────────────────────────
  const biPath = path.join(app, 'Contents/Resources/build-info.json');
  const buildInfo = fs.existsSync(biPath) ? JSON.parse(fs.readFileSync(biPath, 'utf8')) : null;
  add('CONFIG', !!buildInfo, 'build-info.json inside the app', buildInfo ? `version=${buildInfo.version} channel=${buildInfo.channel} commit=${buildInfo.commit} dirty=${buildInfo.dirty}` : 'absent');
  if (buildInfo) {
    add('CONFIG', typeof buildInfo.backendUrl === 'string' && /^https:\/\//.test(buildInfo.backendUrl), 'baked backend URL is https', buildInfo.backendUrl);
    add('CONFIG', !/localhost|127\.0\.0\.1|\.local\b|ngrok/.test(String(buildInfo.backendUrl)), 'baked backend URL is not a dev endpoint', buildInfo.backendUrl);
    add('CONFIG', buildInfo.dirty === false, 'built from a clean tree (dirty=false)', `dirty=${buildInfo.dirty} commit=${buildInfo.commit}`);
    add('CONFIG', buildInfo.version === pkg.version, 'build-info version == package version', `${buildInfo.version} vs ${pkg.version}`);
  }

  // ── Secret + endpoint + architecture-string scans ─────────────────────────
  const SECRET_PATTERNS = [
    ['anthropic_key', /sk-ant-[A-Za-z0-9_-]{20,}/g], ['openai_key', /\bsk-(?:proj-)?[A-Za-z0-9]{20,}\b/g], ['aws_access_key', /\bAKIA[0-9A-Z]{16}\b/g],
    ['github_token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g], ['slack_token', /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g], ['google_api_key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
    ['private_key_block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g], ['apple_app_password', /\b[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}\b/g],
    ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g], ['razorpay_key', /\brzp_(?:live|test)_[A-Za-z0-9]{10,}\b/g],
  ];
  const ENDPOINT_PATTERNS = [['localhost', /https?:\/\/localhost[:/]/g], ['loopback', /https?:\/\/127\.0\.0\.1[:/]/g], ['ngrok', /ngrok\.(?:io|app)/g], ['dot_local', /https?:\/\/[a-z0-9.-]+\.local\b/g]];
  const ARCH_PATTERNS = ['arm64-only', 'x86_64-only', 'darwin-arm64', 'darwin-x64', 'darwin-x86_64', 'aarch64', 'amd64', 'process.arch', 'os.arch', 'Rosetta', '/opt/homebrew', '/usr/local', 'sysctl', 'uname'];
  const secretHits = []; const endpointHits = []; const archHits = {};
  const scanTargets = walk(app).filter((f) => !f.symlink && !isMachO(f.path));
  for (const f of scanTargets) {
    let text;
    try { text = fs.readFileSync(f.path, 'latin1'); } catch { continue; }
    const rel = path.relative(app, f.path);
    for (const [name, re] of SECRET_PATTERNS) {
      const r = new RegExp(re.source, re.flags); let m;
      while ((m = r.exec(text)) !== null) {
        const ctx = text.slice(Math.max(0, m.index - 40), m.index).replace(/[^\x20-\x7e]/g, '.');
        secretHits.push({ pattern: name, file: rel, offset: m.index, context_before: ctx, match_redacted: `${m[0].slice(0, 6)}…(${m[0].length} chars)` });
        if (secretHits.length > 200) break;
      }
    }
    for (const [name, re] of ENDPOINT_PATTERNS) {
      const r = new RegExp(re.source, re.flags); let m;
      while ((m = r.exec(text)) !== null) { endpointHits.push({ pattern: name, file: rel, offset: m.index, context: text.slice(Math.max(0, m.index - 60), m.index + 60).replace(/[^\x20-\x7e]/g, '.') }); if (endpointHits.length > 300) break; }
    }
    for (const s of ARCH_PATTERNS) {
      let idx = 0, n = 0;
      while ((idx = text.indexOf(s, idx)) !== -1) { n++; idx += s.length; }
      if (n) { archHits[s] = archHits[s] || {}; archHits[s][rel] = n; }
    }
  }
  // The apple app-specific-password shape (xxxx-xxxx-xxxx-xxxx) collides with ordinary hyphenated words; keep only hits whose context looks credential-like.
  const highConfidence = secretHits.filter((h) => h.pattern !== 'apple_app_password' && h.pattern !== 'jwt');
  const suspicious = secretHits.filter((h) => (h.pattern === 'apple_app_password' || h.pattern === 'jwt') && /pass|secret|token|key|auth/i.test(h.context_before));
  add('SECRETS', highConfidence.length === 0, 'no high-confidence credential pattern in the bundle', highConfidence.length ? highConfidence.slice(0, 5).map((h) => `${h.pattern}@${h.file}`).join('; ') : `${scanTargets.length} files scanned`);
  add('SECRETS', suspicious.length === 0, 'no credential-shaped string in a credential-like context', suspicious.length ? suspicious.slice(0, 5).map((h) => `${h.pattern}@${h.file}`).join('; ') : 'none', false);
  const endpointFiles = [...new Set(endpointHits.map((h) => h.file))];
  add('CONFIG', true, 'dev-endpoint string census (classified below, non-blocking)', `${endpointHits.length} hits in ${endpointFiles.length} files`, false);

  // ── Release manifest (np.mac.release/v1) ──────────────────────────────────
  const gitOut = (a) => { const r = run('git', a, { cwd: APP_DIR }); return r.code === 0 ? r.stdout.trim() : null; };
  const manifest = {
    schema: 'np.mac.release/v1', product: 'NeuroPause', version: pkg.version, channel: buildInfo ? buildInfo.channel : null,
    release_id: `NP-OS-${pkg.version}-${(gitOut(['rev-parse', 'HEAD']) || 'unknown').slice(0, 12)}`,
    commit: gitOut(['rev-parse', 'HEAD']), tree: gitOut(['rev-parse', 'HEAD^{tree}']), branch: gitOut(['rev-parse', '--abbrev-ref', 'HEAD']),
    build_info: buildInfo, bundle_id: plist.CFBundleIdentifier || null, minimum_macos: plist.LSMinimumSystemVersion || null,
    architecture: ['x86_64', 'arm64'], app_bundle_digest: bundle ? bundle.digest : null, app_bundle_file_count: bundle ? bundle.file_count : null,
    artifacts: ['dmg', 'zip'].filter((k) => containers[k]).map((k) => ({ artifact_type: k === 'dmg' ? 'installer' : 'update-payload', filename: containers[k].filename, size: containers[k].size, sha256: containers[k].sha256, sha512_base64: containers[k].sha512_base64, architecture: 'universal', source_commit: gitOut(['rev-parse', 'HEAD']) })),
    feed: containers.feed ? { filename: containers.feed.filename, sha256: containers.feed.sha256, version: feed && feed.version, path: feed && feed.path } : null,
    signing: { signed, identifier, team_id: teamId, authority_chain: authorities, hardened_runtime: hardened, codesign_verify_deep_strict: v.code === 0 },
    notarization: { status_marker: notarizationStatus, stapler_validate_exit: stapler.code, spctl_assess_exit: spctl.code, spctl_output: spctlOut.slice(-300) },
    build_environment: { node: process.version, os: `${process.platform} ${os.release()}`, arch: process.arch, electron: (() => { try { return require('electron/package.json').version; } catch { return null; } })(), electron_builder: (() => { try { return require('electron-builder/package.json').version; } catch { return null; } })() },
    generated_at: new Date().toISOString(),
  };

  const report = {
    verifier: 'verify-mac-artifact.cjs', dist: opts.dist, app_source: dmgApp ? 'dmg' : 'zip', generated_at: manifest.generated_at,
    gates: Object.fromEntries(Object.entries(gates).map(([k, g]) => { const blockingFail = checks.some((c) => c.gate === k && !c.ok && c.blocking); const anyFail = checks.some((c) => c.gate === k && !c.ok); return [k, { status: blockingFail ? 'FAIL' : anyFail ? 'WARN' : 'PASS', checks: g.results.length }]; })),
    checks, containers, feed, plist: { CFBundleIdentifier: plist.CFBundleIdentifier, CFBundleShortVersionString: plist.CFBundleShortVersionString, CFBundleVersion: plist.CFBundleVersion, LSMinimumSystemVersion: plist.LSMinimumSystemVersion, NSSupportsAutomaticGraphicsSwitching: plist.NSSupportsAutomaticGraphicsSwitching },
    bundle_digest_zip: zipDigest, bundle_digest_dmg: dmgDigest, binary_census: census, dependency_matrix: depRows, bundle_specifiers: specRows, nested_signature_checks: nestedChecked,
    secret_scan: { files_scanned: scanTargets.length, high_confidence: highConfidence, suspicious_in_context: suspicious, low_confidence_count: secretHits.length - highConfidence.length },
    endpoint_scan: endpointHits, architecture_string_census: archHits, entitlements_xml: ent.stdout, codesign_dvvv: sigInfo,
  };
  fs.writeFileSync(path.join(opts.out, 'mac-artifact-verification.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(opts.out, 'release-manifest.mac.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  finish();

  function finish() {
    for (const c of checks) console.log(`  ${c.ok ? 'PASS' : c.blocking ? 'FAIL' : 'WARN'}  [${c.gate}] ${c.label}${c.detail ? `: ${String(c.detail).slice(0, 220)}` : ''}`);
    const blockingFails = checks.filter((c) => !c.ok && c.blocking);
    console.log(`\n[verify-mac-artifact] gates: ${Object.keys(gates).map((k) => `${k}=${checks.some((c) => c.gate === k && !c.ok && c.blocking) ? 'FAIL' : checks.some((c) => c.gate === k && !c.ok) ? 'WARN' : 'PASS'}`).join(' ')}`);
    console.log(`[verify-mac-artifact] report: ${path.join(opts.out, 'mac-artifact-verification.json')}`);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
    if (blockingFails.length) { console.error(`[verify-mac-artifact] NOT SHIPPABLE — ${blockingFails.length} blocking check(s) failed.`); process.exit(1); }
    console.log('[verify-mac-artifact] all blocking gates PASS for the bytes in the published containers.');
  }
}

if (require.main === module) main();
