#!/usr/bin/env node
/**
 * Version bump (Phase 8 · RC hardening 8.6) — the ONE way the version moves.
 *
 * The version lives in TWO files that must move together: /package.json and
 * /apps/desktop/package.json. Bumping them by hand is the exact failure that
 * shipped rc.2…rc.13 all labeled `1.0.0-rc.1` (the tag↔version CI guard was
 * added post-hoc; this script removes the manual step that caused it).
 *
 * Usage:
 *   node scripts/bump-version.cjs 1.0.0-rc.15
 *   npm run version:bump -- 1.0.0-rc.15
 *
 * Writes both manifests, verifies they agree, and prints the tag + changelog
 * follow-ups. Refuses malformed semver and refuses to move backwards.
 */
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const FILES = ['package.json', 'apps/desktop/package.json'];

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

for (const m of manifests) {
  m.json.version = target;
  writeFileSync(m.path, `${JSON.stringify(m.json, null, 2)}\n`);
}

const check = manifests.map((m) => JSON.parse(readFileSync(m.path, 'utf8')).version);
if (!check.every((v) => v === target)) {
  console.error('Post-write verification failed — manifests disagree:', check);
  process.exit(1);
}

console.log(`Version: ${current} → ${target} (both manifests in sync)`);
console.log('Next steps:');
console.log(`  1. Add a "## [${target}]" section to CHANGELOG.md`);
console.log('  2. Commit: git add -A && git commit -m "chore(release): v' + target + '"');
console.log(`  3. Tag:    git tag v${target} && git push origin v${target}`);
console.log('     (the release workflows enforce tag == package.json version)');
