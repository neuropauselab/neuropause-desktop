#!/usr/bin/env node
/**
 * Version bump (Phase 8 · RC hardening 8.6; lockfile repair A.363) — the ONE
 * way the version moves.
 *
 * The version lives in FIVE authoritative fields that must move together:
 * /package.json `.version`, /apps/desktop/package.json `.version`, and the
 * root package-lock.json's `.version`, `.packages[""].version`, and
 * `.packages["apps/desktop"].version`. Bumping the manifests by hand is the
 * exact failure that shipped rc.2…rc.13 all labeled `1.0.0-rc.1`; bumping the
 * manifests WITHOUT the lockfile is the failure that left rc.24 manifests over
 * an rc.21/rc.22 lockfile (found A.348, repaired under issuer directive A.363).
 * npm mirrors these lockfile fields from the manifests on its next lockfile
 * write, so moving them here keeps the lockfile coherent without touching any
 * dependency resolution.
 *
 * Usage:
 *   node scripts/bump-version.cjs 1.0.0-rc.15
 *   npm run version:bump -- 1.0.0-rc.15
 *
 * Writes both manifests plus the lockfile's version fields, verifies all five
 * agree, and prints the tag + changelog follow-ups. Refuses malformed semver
 * and refuses to move backwards.
 */
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const FILES = ['package.json', 'apps/desktop/package.json'];
const LOCKFILE = 'package-lock.json';
// The lockfile entries that mirror the FILES manifests: '' for the root
// manifest, the containing directory for each workspace manifest.
const LOCK_KEYS = FILES.map((rel) =>
  rel === 'package.json' ? '' : rel.slice(0, -'/package.json'.length),
);

function parse(v) {
  const m = SEMVER.exec(String(v ?? '').trim());
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
  if (a.pre.length === 0 && b.pre.length === 0) return 0;
  if (a.pre.length === 0) return 1; // release outranks prerelease
  if (b.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const [x, y] = [a.pre[i], b.pre[i]];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const [nx, ny] = [Number(x), Number(y)];
    const bothNum = Number.isInteger(nx) && Number.isInteger(ny) && String(nx) === x && String(ny) === y;
    if (bothNum && nx !== ny) return nx - ny;
    if (!bothNum && x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

const target = process.argv[2];
const parsed = parse(target);
if (!parsed) {
  console.error(`Usage: node scripts/bump-version.cjs <semver>\nGot: ${JSON.stringify(target)}`);
  process.exit(1);
}

const root = join(__dirname, '..');
const manifests = FILES.map((rel) => {
  const path = join(root, rel);
  return { rel, path, json: JSON.parse(readFileSync(path, 'utf8')) };
});

const current = manifests[0].json.version;
const currentParsed = parse(current);
if (currentParsed && compare(parsed, currentParsed) <= 0) {
  console.error(`Refusing: target ${target} does not advance past current ${current}.`);
  process.exit(1);
}

const lockPath = join(root, LOCKFILE);
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
for (const key of LOCK_KEYS) {
  if (!lock.packages || !lock.packages[key]) {
    console.error(`Refusing: ${LOCKFILE} has no packages[${JSON.stringify(key)}] entry to update.`);
    process.exit(1);
  }
}

for (const m of manifests) {
  m.json.version = target;
  writeFileSync(m.path, `${JSON.stringify(m.json, null, 2)}\n`);
}

lock.version = target;
for (const key of LOCK_KEYS) lock.packages[key].version = target;
writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

const check = manifests.map((m) => JSON.parse(readFileSync(m.path, 'utf8')).version);
const lockCheck = JSON.parse(readFileSync(lockPath, 'utf8'));
check.push(lockCheck.version, ...LOCK_KEYS.map((key) => lockCheck.packages[key].version));
if (!check.every((v) => v === target)) {
  console.error('Post-write verification failed — the five version fields disagree:', check);
  process.exit(1);
}

console.log(`Version: ${current} → ${target} (both manifests + lockfile in sync, 5 fields)`);
console.log('Next steps (INFORMATIONAL ONLY — do not run automatically; commit, tag, push,');
console.log('release, and publication each require separate authorization):');
console.log(`  1. Add a "## [${target}]" section to CHANGELOG.md`);
console.log('  2. Commit: git add -A && git commit -m "chore(release): v' + target + '"');
console.log(`  3. Tag:    git tag v${target} && git push origin v${target}`);
console.log('     (the release workflows enforce tag == package.json version)');
