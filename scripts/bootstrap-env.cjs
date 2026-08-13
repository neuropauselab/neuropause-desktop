#!/usr/bin/env node
/**
 * Local environment bootstrap (Phase 8 · RC hardening 8.19).
 *
 * `cp .env.example .env` was the one manual step in dev setup, and its failure
 * mode is silent (missing file → localhost defaults with no explanation).
 * This script creates `.env` from `.env.example` when absent, NEVER overwrites
 * an existing `.env` (your secrets are yours), generates fresh random values
 * for any `*_SECRET`/`*_KEY` placeholder left empty in the example, and prints
 * exactly what it did.
 *
 * Usage: node scripts/bootstrap-env.cjs   (or: npm run bootstrap:env)
 */
const { randomBytes } = require('node:crypto');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const envPath = join(root, '.env');
const examplePath = join(root, '.env.example');

if (existsSync(envPath)) {
  console.log('bootstrap-env: .env already exists — left untouched.');
  process.exit(0);
}
if (!existsSync(examplePath)) {
  console.error('bootstrap-env: .env.example is missing — cannot bootstrap.');
  process.exit(1);
}

const lines = readFileSync(examplePath, 'utf8').split('\n');
const generated = [];
const out = lines.map((line) => {
  const m = /^([A-Z0-9_]*(?:SECRET|KEY)[A-Z0-9_]*)=\s*$/.exec(line);
  if (!m) return line;
  const value = randomBytes(32).toString('hex');
  generated.push(m[1]);
  return `${m[1]}=${value}`;
});

writeFileSync(envPath, out.join('\n'), { mode: 0o600 });
console.log(`bootstrap-env: wrote .env from .env.example (mode 0600).`);
if (generated.length > 0) {
  console.log(`bootstrap-env: generated random values for: ${generated.join(', ')}`);
}
console.log('bootstrap-env: review .env before starting the backend (ports, database URLs).');
