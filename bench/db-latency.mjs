#!/usr/bin/env node
// NeuroPause — reproducible Postgres latency harness (uses the backend's own pg dep).
//
// Times representative query shapes against the live database and reports
// p50/p95/p99 per shape. Read-only; safe to re-run. Every number is a real
// round-trip to Postgres.
//
// Usage: DATABASE_URL=... node bench/db-latency.mjs [--iters N] [--json PATH]

import { performance } from 'node:perf_hooks';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// pg is hoisted to the repo-root node_modules by npm workspaces; fall back to the
// backend workspace copy if a future layout un-hoists it.
function loadPg() {
  for (const p of ['../node_modules/pg', '../apps/backend/node_modules/pg', 'pg']) {
    try {
      return require(p);
    } catch {
      /* try next */
    }
  }
  throw new Error('pg module not found (run npm install first)');
}
const { Client } = loadPg();

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const ITERS = parseInt(arg('--iters', '2000'), 10);
const JSON_OUT = arg('--json', '');
const DBURL = process.env.DATABASE_URL;
if (!DBURL) {
  console.error('DATABASE_URL required');
  process.exit(2);
}

const QUERIES = [
  { name: 'point read (application by slug)', sql: `SELECT * FROM applications WHERE slug = $1`, params: ['claude'] },
  { name: 'filtered list (published, limit 24)', sql: `SELECT id,name,slug,status FROM applications WHERE status='published' ORDER BY trending_score DESC LIMIT 24`, params: [] },
  { name: 'aggregate (count by status)', sql: `SELECT status, count(*) FROM applications GROUP BY status`, params: [] },
  { name: 'join (app + latest version)', sql: `SELECT a.slug, max(v.created_at) FROM applications a LEFT JOIN versions v ON v.application_id=a.id GROUP BY a.slug`, params: [] },
  { name: 'index probe (pg_stat: 1 row)', sql: `SELECT 1`, params: [] },
];

const round = (n) => Math.round(n * 100) / 100;
function pct(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function main() {
  const client = new Client({ connectionString: DBURL });
  await client.connect();

  const results = [];
  for (const q of QUERIES) {
    // warmup
    for (let i = 0; i < 100; i++) await client.query(q.sql, q.params).catch(() => {});
    const lat = [];
    let errors = 0;
    for (let i = 0; i < ITERS; i++) {
      const t0 = performance.now();
      try {
        await client.query(q.sql, q.params);
      } catch {
        errors++;
      }
      lat.push(performance.now() - t0);
    }
    lat.sort((a, b) => a - b);
    const mean = lat.reduce((s, x) => s + x, 0) / lat.length;
    results.push({
      query: q.name,
      iters: ITERS,
      errors,
      mean_ms: round(mean),
      p50_ms: round(pct(lat, 50)),
      p95_ms: round(pct(lat, 95)),
      p99_ms: round(pct(lat, 99)),
      max_ms: round(pct(lat, 100)),
    });
  }
  await client.end();

  const cols = ['query', 'iters', 'errors', 'mean_ms', 'p50_ms', 'p95_ms', 'p99_ms', 'max_ms'];
  console.log('| ' + cols.join(' | ') + ' |');
  console.log('|' + cols.map(() => '---').join('|') + '|');
  for (const r of results) console.log('| ' + cols.map((c) => r[c]).join(' | ') + ' |');

  if (JSON_OUT) {
    mkdirSync(JSON_OUT.replace(/\/[^/]*$/, ''), { recursive: true });
    writeFileSync(JSON_OUT, JSON.stringify({ db: DBURL.replace(/:[^:@/]*@/, ':***@'), iters: ITERS, results }, null, 2));
    console.error(`JSON written to ${JSON_OUT}`);
  }
}
main();
