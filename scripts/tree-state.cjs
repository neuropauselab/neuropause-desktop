#!/usr/bin/env node
// Governed release — tracked-tree state snapshot (build→output custody, B.34 §8 / B.37 §11).
// Records every tracked file AND every untracked-but-not-ignored file with its SHA-256, so
// verify-post-build-integrity.cjs can prove a build did not add, delete or modify source.
// Usage: node scripts/tree-state.cjs <out.json>   (run from the repository root; needs git)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const out = process.argv[2];
if (!out) { console.error('usage: tree-state.cjs <out.json>'); process.exit(2); }

function gitZ(args) {
  const buf = execFileSync('git', args, { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 256 * 1024 * 1024 });
  return buf.toString('utf8').split('\0').filter(Boolean);
}
const tracked = gitZ(['ls-files', '-z']);
const untracked = gitZ(['ls-files', '-z', '--others', '--exclude-standard']);
const paths = [...new Set([...tracked, ...untracked])].sort();

const rows = [];
for (const p of paths) {
  let st;
  try { st = fs.lstatSync(p); } catch { rows.push({ path: p, sha256: 'MISSING' }); continue; }
  if (st.isSymbolicLink()) { rows.push({ path: p, sha256: 'SYMLINK:' + crypto.createHash('sha256').update(fs.readlinkSync(p)).digest('hex') }); continue; }
  if (!st.isFile()) continue;
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(p, 'r');
  try {
    const chunk = Buffer.alloc(1 << 20);
    let n;
    while ((n = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) h.update(chunk.subarray(0, n));
  } finally { fs.closeSync(fd); }
  rows.push({ path: p, sha256: h.digest('hex') });
}
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, JSON.stringify(rows));
console.log(`tree-state: ${rows.length} path(s) (${tracked.length} tracked, ${untracked.length} untracked-not-ignored) -> ${out}`);
