#!/usr/bin/env node
// NeuroPause — reproducible HTTP load harness (no external deps).
//
// Drives real backend endpoints at a fixed concurrency, records per-request
// latency with perf_hooks, and reports p50/p90/p95/p99/max + throughput.
// Every number it prints comes from a real request against a running backend.
//
// Usage:
//   node bench/http-load.mjs [--base URL] [--conc N] [--reqs N] [--warmup N] [--json PATH]
// Defaults: base http://127.0.0.1:4000, conc 32, reqs 3000, warmup 300.
//
// Scenarios cover the real route surface: liveness (no DB), the DB-backed store
// read paths, and the observability endpoint. Auth write-path (Argon2) is a
// separate harness because it is deliberately CPU-bound and low-RPS by design.

import { performance } from 'node:perf_hooks';
import { writeFileSync, mkdirSync } from 'node:fs';

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const BASE = arg('--base', process.env.NP_BENCH_BASE || 'http://127.0.0.1:4000');
const CONC = parseInt(arg('--conc', '32'), 10);
const REQS = parseInt(arg('--reqs', '3000'), 10);
const WARMUP = parseInt(arg('--warmup', '300'), 10);
const JSON_OUT = arg('--json', '');

const SCENARIOS = [
  { name: 'GET /health (liveness, no DB)', method: 'GET', path: '/health' },
  { name: 'GET /live (readiness)', method: 'GET', path: '/live' },
  { name: 'GET /metrics (prometheus)', method: 'GET', path: '/metrics' },
  { name: 'GET /store/apps (DB list, 20 rows)', method: 'GET', path: '/store/apps' },
  { name: 'GET /store/apps?q=ai&sort=trending (DB filter+sort)', method: 'GET', path: '/store/apps?q=ai&sort=trending' },
  { name: 'GET /store/featured (DB join)', method: 'GET', path: '/store/featured' },
  { name: 'GET /store/categories (DB agg)', method: 'GET', path: '/store/categories' },
  { name: 'GET /store/apps/:slug (DB point read)', method: 'GET', path: '/store/apps/claude' },
];

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}
const round = (n) => Math.round(n * 100) / 100;

async function once(sc) {
  const t0 = performance.now();
  let ok = false;
  let status = 0;
  try {
    const res = await fetch(BASE + sc.path, {
      method: sc.method,
      headers: sc.headers,
      body: sc.body ? JSON.stringify(sc.body) : undefined,
    });
    status = res.status;
    await res.arrayBuffer(); // drain body — measure full response time
    ok = res.status >= 200 && res.status < 400;
  } catch {
    ok = false;
  }
  return { ms: performance.now() - t0, ok, status };
}

async function runScenario(sc) {
  // Warmup (not measured).
  for (let i = 0; i < WARMUP; i += CONC) {
    await Promise.all(Array.from({ length: Math.min(CONC, WARMUP - i) }, () => once(sc)));
  }
  // Measured phase: keep CONC requests in flight until REQS complete.
  const lat = [];
  let done = 0;
  let started = 0;
  let errors = 0;
  const wallStart = performance.now();
  async function worker() {
    while (started < REQS) {
      started++;
      const r = await once(sc);
      lat.push(r.ms);
      if (!r.ok) errors++;
      done++;
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  const wallMs = performance.now() - wallStart;
  lat.sort((a, b) => a - b);
  const mean = lat.reduce((s, x) => s + x, 0) / lat.length;
  return {
    scenario: sc.name,
    requests: done,
    errors,
    concurrency: CONC,
    throughput_rps: round((done / wallMs) * 1000),
    mean_ms: round(mean),
    p50_ms: round(pct(lat, 50)),
    p90_ms: round(pct(lat, 90)),
    p95_ms: round(pct(lat, 95)),
    p99_ms: round(pct(lat, 99)),
    max_ms: round(pct(lat, 100)),
  };
}

async function main() {
  // Confirm the target is actually up before claiming any numbers.
  try {
    const h = await fetch(BASE + '/health');
    if (!h.ok) throw new Error('health ' + h.status);
  } catch (e) {
    console.error(`Backend not reachable at ${BASE} (${e.message}). Start it first.`);
    process.exit(2);
  }

  const results = [];
  for (const sc of SCENARIOS) results.push(await runScenario(sc));

  const header = `# NeuroPause HTTP load — ${BASE}\n\nconcurrency=${CONC}, measured requests/scenario=${REQS}, warmup=${WARMUP}\n`;
  const cols = ['scenario', 'requests', 'errors', 'throughput_rps', 'mean_ms', 'p50_ms', 'p90_ms', 'p95_ms', 'p99_ms', 'max_ms'];
  const table = [
    '| ' + cols.join(' | ') + ' |',
    '|' + cols.map(() => '---').join('|') + '|',
    ...results.map((r) => '| ' + cols.map((c) => r[c]).join(' | ') + ' |'),
  ].join('\n');
  console.log(header);
  console.log(table);

  if (JSON_OUT) {
    mkdirSync(JSON_OUT.replace(/\/[^/]*$/, ''), { recursive: true });
    writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, conc: CONC, reqs: REQS, warmup: WARMUP, results }, null, 2));
    console.error(`\nJSON written to ${JSON_OUT}`);
  }
}

main();
