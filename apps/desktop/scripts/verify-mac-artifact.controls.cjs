#!/usr/bin/env node
/**
 * POSITIVE + NEGATIVE CONTROLS for verify-mac-artifact.cjs
 * (NP-MAC-PUBLIC-DISTRIBUTION-CLOSURE-001 §23/§24/§42).
 *
 * A verifier that has only ever passed proves nothing about its ability to
 * detect the defect it exists for. This harness takes a real dist directory and:
 *
 *   POSITIVE  runs the verifier unchanged and records which gates PASS;
 *   NEG-DEP   rebuilds the ZIP with `node_modules/ws` deleted from app.asar
 *             (the 2026-09-12 missing-dependency class)   → expects DEPENDENCIES=FAIL
 *   NEG-ENTRY rebuilds the ZIP with electron-updater's entry file deleted but its
 *             directory kept (the directory-exists false positive) → DEPENDENCIES=FAIL
 *   NEG-ARCH  rebuilds the ZIP with the x86_64 slice stripped from the main
 *             executable (`lipo -remove x86_64`)           → expects ARCHITECTURE=FAIL
 *   NEG-BYTE  flips one byte inside the ZIP, feed untouched → expects FEED=FAIL (sha512)
 *   NEG-NAME  points the feed at a filename that does not exist → expects FEED=FAIL
 *   NEG-URL   bakes a localhost backend URL into build-info.json → expects CONFIG=FAIL
 *
 * Each negative fixture lives in its own temp dist directory; the real dist is
 * never modified. Exit 0 only when every control behaves as expected.
 *
 * CLI: node scripts/verify-mac-artifact.controls.cjs --dist <dir> [--out <dir>]
 */
'use strict';
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const asar = require('@electron/asar');

function arg(name, fallback = null) { const i = process.argv.indexOf(`--${name}`); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback; }
function run(cmd, args, opts = {}) { const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, ...opts }); return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }; }
const sha512b64 = (p) => createHash('sha512').update(fs.readFileSync(p)).digest('base64');

const DIST = path.resolve(arg('dist', 'dist'));
const OUT = path.resolve(arg('out', path.join(DIST, 'verification')));
const VERIFIER = path.join(__dirname, 'verify-mac-artifact.cjs');
fs.mkdirSync(OUT, { recursive: true });

function verify(distDir, label) {
  const out = path.join(OUT, `controls-${label}`);
  const r = run('node', [VERIFIER, '--dist', distDir, '--out', out, '--skip-dmg']);
  let gates = null;
  try { gates = JSON.parse(fs.readFileSync(path.join(out, 'mac-artifact-verification.json'), 'utf8')).gates; } catch { /* verifier crashed */ }
  return { exit: r.code, gates, tail: (r.stdout + r.stderr).split('\n').filter((l) => /FAIL/.test(l)).slice(0, 6).join('\n') };
}

function fixture(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `np-ctrl-${label}-`));
  const files = fs.readdirSync(DIST);
  const zip = files.find((f) => f.endsWith('-mac.zip'));
  const feed = files.find((f) => f.endsWith('-mac.yml'));
  for (const f of [zip, feed, 'notarization-status.json'].filter(Boolean)) if (fs.existsSync(path.join(DIST, f))) fs.copyFileSync(path.join(DIST, f), path.join(dir, f));
  return { dir, zip: path.join(dir, zip), feed: path.join(dir, feed), zipName: zip };
}

function refeed(fx) {
  const text = fs.readFileSync(fx.feed, 'utf8');
  const size = fs.statSync(fx.zip).size;
  const digest = sha512b64(fx.zip);
  // Only the zip entry is rewritten; the dmg entry (absent from the fixture dir) is left as-is.
  const lines = text.split('\n');
  let inZip = false;
  const outLines = lines.map((l) => {
    if (/^\s*-\s*url:/.test(l)) inZip = l.includes(fx.zipName);
    if (inZip && /^\s+sha512:/.test(l)) return l.replace(/sha512: .*/, `sha512: ${digest}`);
    if (inZip && /^\s+size:/.test(l)) return l.replace(/size: \d+/, `size: ${size}`);
    if (/^sha512:/.test(l)) return `sha512: ${digest}`;
    return l;
  });
  fs.writeFileSync(fx.feed, outLines.join('\n'));
}

async function mutateApp(fx, cb) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'np-ctrl-work-'));
  if (run('ditto', ['-x', '-k', fx.zip, work]).code !== 0) throw new Error('extract failed');
  const app = path.join(work, 'NeuroPause.app');
  await cb(app);
  fs.rmSync(fx.zip);
  if (run('ditto', ['-c', '-k', '--keepParent', app, fx.zip]).code !== 0) throw new Error('re-zip failed');
  refeed(fx); // keep the feed self-consistent so the ONLY difference under test is the mutation
  fs.rmSync(work, { recursive: true, force: true });
}

async function repackAsar(app, cb) {
  const asarPath = path.join(app, 'Contents/Resources/app.asar');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'np-asar-'));
  asar.extractAll(asarPath, tmp);
  await cb(tmp);
  fs.rmSync(asarPath);
  await asar.createPackage(tmp, asarPath);
  fs.rmSync(tmp, { recursive: true, force: true });
}

const results = [];
const expect = (label, r, gate, want, extra) => {
  const got = r.gates ? (r.gates[gate] && r.gates[gate].status) || 'ABSENT' : 'NO_REPORT';
  const ok = got === want && (extra ? extra(r) : true);
  results.push({ control: label, gate, expected: want, observed: got, verifier_exit: r.exit, ok, fail_lines: r.tail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${gate} expected ${want}, observed ${got} (verifier exit ${r.exit})`);
};

(async () => {
  console.log('[controls] POSITIVE — unmodified dist');
  const pos = verify(DIST, 'positive');
  // POSITIVE: no BLOCKING failure in these gates. WARN (informational checks such as a
  // package manifest whose `main` is stale) is acceptable; FAIL is not.
  for (const g of ['CONTAINERS', 'FEED', 'ZIP', 'PLIST', 'ARCHITECTURE', 'DEPENDENCIES', 'SIGNING', 'CONFIG', 'SECRETS']) {
    const got = pos.gates ? (pos.gates[g] && pos.gates[g].status) || 'ABSENT' : 'NO_REPORT';
    const ok = got === 'PASS' || got === 'WARN';
    results.push({ control: 'POSITIVE', gate: g, expected: 'PASS|WARN', observed: got, verifier_exit: pos.exit, ok });
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  POSITIVE: ${g} expected PASS|WARN, observed ${got}`);
  }
  results.push({ control: 'POSITIVE', gate: 'NOTARIZATION', expected: '(recorded, not asserted)', observed: pos.gates && pos.gates.NOTARIZATION && pos.gates.NOTARIZATION.status, verifier_exit: pos.exit, ok: true });

  console.log('[controls] NEG-DEP — node_modules/ws removed from app.asar');
  { const fx = fixture('dep'); await mutateApp(fx, (app) => repackAsar(app, (t) => fs.rmSync(path.join(t, 'node_modules/ws'), { recursive: true, force: true }))); const r = verify(fx.dir, 'neg-dep'); expect('NEG-DEP', r, 'DEPENDENCIES', 'FAIL', (x) => x.exit === 1); }

  console.log('[controls] NEG-ENTRY — electron-updater directory kept, its entry file removed');
  { const fx = fixture('entry'); await mutateApp(fx, (app) => repackAsar(app, (t) => { const pj = JSON.parse(fs.readFileSync(path.join(t, 'node_modules/electron-updater/package.json'), 'utf8')); fs.rmSync(path.join(t, 'node_modules/electron-updater', pj.main), { force: true }); })); const r = verify(fx.dir, 'neg-entry'); expect('NEG-ENTRY', r, 'DEPENDENCIES', 'FAIL', (x) => x.exit === 1); }

  console.log('[controls] NEG-ARCH — x86_64 slice stripped from the main executable');
  { const fx = fixture('arch'); await mutateApp(fx, (app) => { const bin = path.join(app, 'Contents/MacOS/NeuroPause'); const r = run('lipo', [bin, '-remove', 'x86_64', '-output', bin]); if (r.code !== 0) throw new Error(`lipo failed: ${r.stderr}`); }); const r = verify(fx.dir, 'neg-arch'); expect('NEG-ARCH', r, 'ARCHITECTURE', 'FAIL', (x) => x.exit === 1); }

  console.log('[controls] NEG-BYTE — one byte flipped inside the ZIP, feed untouched');
  { const fx = fixture('byte'); const buf = fs.readFileSync(fx.zip); buf[Math.floor(buf.length / 2)] ^= 0xff; fs.writeFileSync(fx.zip, buf); const r = verify(fx.dir, 'neg-byte'); expect('NEG-BYTE', r, 'FEED', 'FAIL', (x) => x.exit === 1); }

  console.log('[controls] NEG-NAME — feed points at a filename that does not exist');
  { const fx = fixture('name'); fs.writeFileSync(fx.feed, fs.readFileSync(fx.feed, 'utf8').replace(/NeuroPause-1\.0\.0-rc\.30-universal-mac\.zip/g, 'NeuroPause-1.0.0-rc.30-arm64-mac.zip')); const r = verify(fx.dir, 'neg-name'); expect('NEG-NAME', r, 'FEED', 'FAIL', (x) => x.exit === 1); }

  console.log('[controls] NEG-URL — localhost backend URL baked into build-info.json');
  { const fx = fixture('url'); await mutateApp(fx, (app) => { const p = path.join(app, 'Contents/Resources/build-info.json'); const j = JSON.parse(fs.readFileSync(p, 'utf8')); j.backendUrl = 'http://localhost:4000'; fs.writeFileSync(p, JSON.stringify(j, null, 2)); }); const r = verify(fx.dir, 'neg-url'); expect('NEG-URL', r, 'CONFIG', 'FAIL', (x) => x.exit === 1); }

  const report = { harness: 'verify-mac-artifact.controls.cjs', dist: DIST, generated_at: new Date().toISOString(), results, all_ok: results.every((r) => r.ok) };
  fs.writeFileSync(path.join(OUT, 'verifier-controls.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[controls] ${report.all_ok ? 'ALL CONTROLS BEHAVE AS EXPECTED' : 'CONTROL FAILURE — the verifier cannot be trusted'} — ${path.join(OUT, 'verifier-controls.json')}`);
  process.exit(report.all_ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
