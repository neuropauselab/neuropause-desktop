#!/usr/bin/env node
/**
 * ERP Session 41 — REAL OS SIGKILL crash-recovery certification (platform-command core).
 *
 * This parent spawns `sigkillCrashChild.ts` as a REAL separate OS process running the REAL production
 * `DurableCommandJournal` (S40 intent-first + S38 stale-PROCESSING recovery) against REAL durable
 * files, waits for the child to reach a precise crash boundary (it prints `READY` and hangs), then
 * sends an ACTUAL OS `SIGKILL` (kill -9). A FRESH child then recovers, and this harness verifies the
 * S38/S40 semantics through governed reads.
 *
 * This is REAL OS SIGKILL of a REAL process across a REAL process boundary exercising REAL production
 * persistence/recovery code — materially stronger than the in-memory abandon-and-reload of S37/S38/S40.
 * It is NOT the packaged Electron GUI (macOS-only; see sigkillPackaged.e2e.cjs for the operator's Mac
 * step). Delivery guarantee remains at-least-once + idempotent — NOT exactly-once.
 *
 * Run (from apps/desktop):
 *   NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/sigkillCrashRecovery.e2e.cjs
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_DIR = path.resolve(__dirname, '..');
const CHILD = path.join(APP_DIR, 'e2e', 'sigkillCrashChild.ts');
// Run the real production TS in a child via `node --import tsx` (tsx resolves from the hoisted
// workspace node_modules; NODE_PATH points there). This is a REAL OS process, killable with SIGKILL.
const RUNNER = process.execPath;
const RUNNER_PREFIX = ['--import', 'tsx'];
const ENV = { ...process.env, NODE_PATH: process.env.NODE_PATH || path.join(APP_DIR, '..', '..', 'node_modules') };

let passes = 0;
let fails = 0;
function ok(msg) { passes += 1; console.log(`  PASS ${msg}`); }
function bad(msg) { fails += 1; console.error(`  FAIL ${msg}`); }
function assert(cond, msg) { (cond ? ok : bad)(msg); }

function newDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `np-s41-${tag}-`));
}

/** Spawn a crash-phase child; resolve once it prints READY (boundary reached). */
function spawnUntilReady(dir, phase, { key = 'k', tenant = 'tenant-A', order = 'SO-1' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(RUNNER, [...RUNNER_PREFIX, CHILD, dir, phase, key, tenant, order], { cwd: APP_DIR, env: ENV });
    let buf = '';
    let settled = false;
    const to = setTimeout(() => { if (!settled) { settled = true; child.kill('SIGKILL'); reject(new Error(`timeout waiting READY (${phase})`)); } }, 30_000);
    child.stdout.on('data', (d) => {
      buf += String(d);
      if (!settled && /(^|\n)READY(\n|$)/.test(buf)) { settled = true; clearTimeout(to); resolve(child); }
    });
    child.stderr.on('data', (d) => process.stderr.write(`  [child ${phase}] ${d}`));
    child.on('exit', (code, sig) => { if (!settled) { settled = true; clearTimeout(to); reject(new Error(`child exited before READY (${phase}) code=${code} sig=${sig}`)); } });
  });
}

/** Send a REAL OS SIGKILL to the child process and wait for it to actually die. */
function sigkill(child) {
  return new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
    process.kill(child.pid, 'SIGKILL'); // ACTUAL OS kill -9 across the process boundary
  });
}

/** Run a clean phase to completion; resolve with the parsed RESULT JSON. */
function runToResult(dir, phase, { key = 'k', tenant = 'tenant-A', order = 'SO-1' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(RUNNER, [...RUNNER_PREFIX, CHILD, dir, phase, key, tenant, order], { cwd: APP_DIR, env: ENV });
    let buf = '';
    const to = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`timeout (${phase})`)); }, 30_000);
    child.stdout.on('data', (d) => { buf += String(d); });
    child.stderr.on('data', (d) => process.stderr.write(`  [child ${phase}] ${d}`));
    child.on('exit', (code) => {
      clearTimeout(to);
      const m = buf.match(/RESULT (.+)/);
      if (code === 0 && m) resolve(JSON.parse(m[1]));
      else reject(new Error(`phase ${phase} failed code=${code} out=${buf.slice(0, 400)}`));
    });
  });
}

/** Kill a child at `phase`, assert the kill signal, then recover in a fresh process. */
async function killAndRecover(dir, phase, opts) {
  const child = await spawnUntilReady(dir, phase, opts);
  const pid = child.pid;
  const { signal } = await sigkill(child);
  if (signal !== 'SIGKILL') throw new Error(`expected SIGKILL, got signal=${signal}`);
  console.log(`  [killed pid ${pid} at ${phase} with real OS SIGKILL]`);
  return runToResult(dir, 'recover', opts);
}

async function scenarioBeforeEffect(i) {
  const dir = newDir('A');
  const rec = await killAndRecover(dir, 'before-effect', { key: `kA${i}` });
  assert(rec.orders === 0, `A rep${i}: no domain effect after kill-before-effect (orders=${rec.orders})`);
  assert(rec.held.includes(`kA${i}`), `A rep${i}: orphaned intent → HELD`);
  const retry = await runToResult(dir, 'retry', { key: `kA${i}` });
  assert(retry.error === 'RECONCILIATION_REQUIRED' && retry.orders === 0, `A rep${i}: retry HOLD, still no effect`);
  fs.rmSync(dir, { recursive: true, force: true });
}

async function scenarioAfterEffect(i) {
  const dir = newDir('B');
  const rec = await killAndRecover(dir, 'after-effect', { key: `kB${i}` });
  assert(rec.orders === 1, `B rep${i}: domain effect durable after kill-in-window (orders=${rec.orders})`);
  assert(rec.records === 0, `B rep${i}: NO committed command (the dual-write window state)`);
  assert(rec.held.includes(`kB${i}`), `B rep${i}: intent survives → HELD (RECONCILIATION_REQUIRED)`);
  const retry = await runToResult(dir, 'retry', { key: `kB${i}` });
  assert(retry.error === 'RECONCILIATION_REQUIRED', `B rep${i}: retry returns HOLD (no re-execute)`);
  assert(retry.orders === 1, `B rep${i}: NO second domain effect (orders still 1)`);
  fs.rmSync(dir, { recursive: true, force: true });
}

async function scenarioAfterCommit(i) {
  const dir = newDir('C');
  const rec = await killAndRecover(dir, 'after-commit', { key: `kC${i}` });
  assert(rec.records === 1, `C rep${i}: committed command survives restart`);
  assert(rec.delivered === 1, `C rep${i}: existing relay delivers the recovered event exactly once`);
  assert(rec.outbox.every((s) => s === 'DELIVERED'), `C rep${i}: outbox → DELIVERED`);
  assert(rec.orders === 1, `C rep${i}: exactly one domain effect`);
  // idempotency of delivery across a second recover pass
  const again = await runToResult(dir, 'recover', { key: `kC${i}` });
  assert(again.delivered === 1, `C rep${i}: second recovery does not duplicate delivery`);
  fs.rmSync(dir, { recursive: true, force: true });
}

async function scenarioProcessing(i) {
  const dir = newDir('P');
  const rec = await killAndRecover(dir, 'processing', { key: `kP${i}` });
  assert(rec.reclaimedProcessing.reclaimed === 1, `S38 rep${i}: stale PROCESSING reclaimed → RETRYABLE`);
  assert(rec.delivered === 1, `S38 rep${i}: relay delivers the reclaimed event exactly once`);
  assert(rec.outbox.every((s) => s === 'DELIVERED'), `S38 rep${i}: outbox → DELIVERED`);
  assert(rec.orders === 1, `S38 rep${i}: no duplicate domain effect`);
  fs.rmSync(dir, { recursive: true, force: true });
}

async function scenarioActiveProcessing() {
  const dir = newDir('active');
  const r = await runToResult(dir, 'active-processing', { key: 'kActive' });
  assert(r.status === 'PROCESSING' && r.reclaimed === 0, `ACTIVE PROCESSING not reclaimed in the live process (status=${r.status}, reclaimed=${r.reclaimed})`);
  fs.rmSync(dir, { recursive: true, force: true });
}

async function scenarioTwoTenant() {
  const dir = newDir('tenant');
  // Tenant A crashes in the dual-write window on a SHARED key → orphan.
  await killAndRecover(dir, 'after-effect', { key: 'shared', tenant: 'tenant-A', order: 'SO-A' });
  // Tenant B uses the SAME key — must succeed (isolated), never blocked by A's HOLD.
  const b = await runToResult(dir, 'commit-ok', { key: 'shared', tenant: 'tenant-B', order: 'SO-B' });
  assert(b.ok && b.records === 1 && b.orders === 1, `TENANT: B same-key commits (isolated from A's HOLD)`);
  // Tenant A same key is still HELD; A's recover shows A's state only.
  const a = await runToResult(dir, 'retry', { key: 'shared', tenant: 'tenant-A', order: 'SO-A2' });
  assert(a.error === 'RECONCILIATION_REQUIRED' && a.orders === 1, `TENANT: A same-key still HELD, no second A effect`);
  const bRec = await runToResult(dir, 'recover', { key: 'shared', tenant: 'tenant-B' });
  assert(bRec.held.length === 0, `TENANT: B has no held intent (A's HOLD never leaked to B)`);
  fs.rmSync(dir, { recursive: true, force: true });
}

async function scenarioRepeatedRestart() {
  const dir = newDir('repeat');
  await killAndRecover(dir, 'after-effect', { key: 'kRepeat' });
  // Recovery must be stable + idempotent across repeated restarts.
  for (let i = 0; i < 3; i += 1) {
    const r = await runToResult(dir, 'recover', { key: 'kRepeat' });
    assert(r.held.includes('kRepeat') && r.orders === 1 && r.records === 0, `REPEAT restart ${i}: HOLD stable, no duplicate`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

async function main() {
  console.log('== ERP S41 — REAL OS SIGKILL crash-recovery certification (platform-command core) ==');
  console.log(`node ${process.version} on ${os.platform()}/${os.arch()} — real process boundary, real kill -9\n`);

  console.log('Window A — SIGKILL BEFORE domain effect (5 reps):');
  for (let i = 1; i <= 5; i += 1) await scenarioBeforeEffect(i);

  console.log('Window B — SIGKILL AFTER domain effect / BEFORE journal commit — the S40 dual-write window (5 reps):');
  for (let i = 1; i <= 5; i += 1) await scenarioAfterEffect(i);

  console.log('Window C — SIGKILL AFTER journal commit / BEFORE delivery (5 reps):');
  for (let i = 1; i <= 5; i += 1) await scenarioAfterCommit(i);

  console.log('S38 — SIGKILL during outbox PROCESSING (5 reps):');
  for (let i = 1; i <= 5; i += 1) await scenarioProcessing(i);

  console.log('Active-PROCESSING safety, two-tenant isolation, repeated restart:');
  await scenarioActiveProcessing();
  await scenarioTwoTenant();
  await scenarioRepeatedRestart();

  console.log(`\n== RESULT: ${passes} passed, ${fails} failed ==`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error('HARNESS_ERR', e); process.exit(1); });
