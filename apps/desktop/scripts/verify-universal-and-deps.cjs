/**
 * Asserts two things about a PACKAGED macOS app that no existing check covers,
 * both of which were real, silent failures caught on 2026-09-12:
 *
 *   1. ARCH — the shipped Mach-O actually contains BOTH slices (x86_64 + arm64).
 *      `verify-release-artifacts.cjs` is deliberately arch-agnostic (it matches
 *      `*.dmg` / `*-mac.zip`), and `mac.gatekeeperAssess: false` disables
 *      electron-builder's own spctl probe, so an arm64-only regression in
 *      electron-builder.yml would ship and NOTHING would report it. Worse than the
 *      original bug: an Intel user who already installed a universal build keeps a
 *      working app but their updater dies with ERR_UPDATER_NO_FILES_PROVIDED,
 *      because MacUpdater.filterFilesForArch drops any URL containing "arm64" on an
 *      x64 process, leaving zero candidate files.
 *
 *   2. RUNTIME DEPENDENCIES — every `dependencies` entry of apps/desktop/package.json
 *      is present inside Contents/Resources/app.asar. A build produced in a tree with
 *      symlinked node_modules packaged an asar MISSING 4 of 8 production deps,
 *      including `electron-updater` — which the main process requires at startup. The
 *      DMG mounted, the app bundle looked complete, `lipo` reported a correct
 *      universal binary, and `verify:release` passed 8/8. Nothing in the pipeline
 *      looked inside the asar, because the only content check that exists
 *      (`verify-packaged-content.cjs`) asserts what must be ABSENT, never what must
 *      be PRESENT.
 *
 * Fails CLOSED. Intended to run after electron-builder in `package:mac`.
 *
 * CLI: node scripts/verify-universal-and-deps.cjs [--dist dist] [--app-name NeuroPause]
 */
'use strict';

const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync, openSync, readSync, closeSync } = require('node:fs');
const { join } = require('node:path');

const REQUIRED_SLICES = ['x86_64', 'arm64'];

/** Read the asar header and return the set of top-level-ish paths it contains. */
function asarEntries(asarPath) {
  // asar format: 8-byte pickle header, then a JSON directory tree.
  const fd = openSync(asarPath, 'r');
  try {
    const sizeBuf = Buffer.alloc(16);
    readSync(fd, sizeBuf, 0, 16, 0);
    const jsonSize = sizeBuf.readUInt32LE(12);
    const jsonBuf = Buffer.alloc(jsonSize);
    readSync(fd, jsonBuf, 0, jsonSize, 16);
    const tree = JSON.parse(jsonBuf.toString('utf8').replace(/\0+$/, ''));
    const out = new Set();
    const walk = (node, prefix) => {
      if (!node || !node.files) return;
      for (const name of Object.keys(node.files)) {
        const p = prefix ? `${prefix}/${name}` : name;
        out.add(p);
        walk(node.files[name], p);
      }
    };
    walk(tree, '');
    return out;
  } finally {
    closeSync(fd);
  }
}

function verify(distDir, appName, io = {}) {
  const log = io.log || console.log;
  const checks = [];
  const add = (ok, label, detail) => checks.push({ ok, label, detail });

  const appDir = join(distDir, 'mac-universal', `${appName}.app`);
  if (!existsSync(appDir)) {
    // Not a universal build layout. Report rather than silently pass.
    add(false, 'universal app bundle present', `expected ${appDir} — is mac.target[].arch still [universal]?`);
    return { ok: false, checks };
  }
  add(true, 'universal app bundle present', appDir);

  // 1. ARCH
  const bin = join(appDir, 'Contents', 'MacOS', appName);
  if (!existsSync(bin)) {
    add(false, 'main executable present', bin);
  } else {
    let archs = '';
    try {
      archs = execFileSync('lipo', ['-archs', bin], { encoding: 'utf8' }).trim();
    } catch (e) {
      add(false, 'lipo -archs readable', String((e && e.message) || e));
    }
    if (archs) {
      const have = archs.split(/\s+/);
      for (const slice of REQUIRED_SLICES) {
        add(have.includes(slice), `slice present: ${slice}`, `lipo -archs -> "${archs}"`);
      }
    }
  }

  // 2. RUNTIME DEPENDENCIES
  const pkgPath = join(__dirname, '..', 'package.json');
  const deps = Object.keys(JSON.parse(readFileSync(pkgPath, 'utf8')).dependencies || {});
  const asar = join(appDir, 'Contents', 'Resources', 'app.asar');
  if (!existsSync(asar)) {
    add(false, 'app.asar present', asar);
  } else {
    let entries;
    try {
      entries = asarEntries(asar);
    } catch (e) {
      add(false, 'app.asar header parsed', String((e && e.message) || e));
    }
    if (entries) {
      add(true, 'app.asar header parsed', `${entries.size} entries`);
      for (const dep of deps) {
        // a dep is satisfied if its node_modules directory appears at any depth
        const needle = `node_modules/${dep}`;
        const present = entries.has(needle) || [...entries].some((p) => p.endsWith(`/${needle}`) || p.startsWith(`${needle}/`));
        add(present, `dependency packaged: ${dep}`, present ? '' : 'ABSENT from app.asar — the app will throw MODULE_NOT_FOUND at startup');
      }
    }
  }

  for (const c of checks) log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.detail ? `: ${c.detail}` : ''}`);
  return { ok: checks.every((c) => c.ok), checks };
}

function parseArgs(argv) {
  const opts = { dist: 'dist', appName: 'NeuroPause' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dist' && argv[i + 1]) opts.dist = argv[++i];
    else if (argv[i] === '--app-name' && argv[i + 1]) opts.appName = argv[++i];
  }
  return opts;
}

if (require.main === module) {
  const { dist, appName } = parseArgs(process.argv.slice(2));
  console.log(`[verify-universal] dist=${dist} app=${appName}.app`);
  const { ok } = verify(dist, appName);
  if (!ok) {
    console.error('[verify-universal] FAILED — the packaged app is not shippable. See FAIL lines above.');
    process.exit(1);
  }
  console.log('[verify-universal] OK — both slices present and every runtime dependency is packaged.');
}

module.exports = { verify, asarEntries };
