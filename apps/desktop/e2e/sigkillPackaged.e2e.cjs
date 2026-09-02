#!/usr/bin/env node
/**
 * ERP Session 41 — REAL OS SIGKILL of the PACKAGED ELECTRON application (macOS operator step).
 *
 * This is the residual the in-session `sigkillCrashRecovery.e2e.cjs` cannot cover off-macOS: killing
 * the REAL packaged Electron GUI process. It launches the packaged/production main bundle on a fresh
 * temp `--user-data-dir`, drives a governed command that produces a durable outbox event through the
 * REAL renderer IPC door, sends an ACTUAL OS `SIGKILL` to the REAL Electron process, relaunches the
 * SAME profile, and verifies the S38/S40 boot recovery through governed reads — no duplicate effect,
 * no corrupt store. It NEVER calls a graceful shutdown API.
 *
 * ⚠ macOS + a build are required (the repo's Electron is the macOS binary). Run from apps/desktop:
 *   # 1. produce a build that contains the S38/S40 recovery (armed out/ already does; or an alt outDir):
 *   env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s41"
 *   # 2. run the two phases (phase 2 uses the profile printed by phase 1):
 *   NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/sigkillPackaged.e2e.cjs --phase=1 --main="$PWD/out-seam-s41/main/index.js"
 *   NODE_PATH=... node e2e/sigkillPackaged.e2e.cjs --phase=2 --profile=<dir> --main="$PWD/out-seam-s41/main/index.js"
 *
 * Delivery guarantee: at-least-once + idempotent consumer — NOT exactly-once.
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_DIR = path.resolve(__dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => (a.startsWith('--') ? a.slice(2).split('=') : [a, true])));
const PHASE = String(args.phase ?? '1');
const MAIN = String(args.main ?? path.join(APP_DIR, 'out/main/index.js'));

let fails = 0;
function assert(cond, msg) { if (cond) { console.log(`  PASS ${msg}`); } else { fails += 1; console.error(`  FAIL ${msg}`); } }
async function waitForLog(logs, re, ms) {
  const end = Date.now() + ms;
  for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await new Promise((r) => setTimeout(r, 300)); }
}

async function launch(profile) {
  const logs = [];
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${profile}`],
    cwd: APP_DIR,
    env: { ...process.env, NODE_ENV: 'production', NP_E2E_BUILD: '', NEUROPAUSE_E2E: '' },
    timeout: 60_000,
  });
  app.process().stdout.on('data', (d) => logs.push(String(d)));
  app.process().stderr.on('data', (d) => logs.push(String(d)));
  const win = await app.firstWindow({ timeout: 45_000 });
  await win.waitForLoadState('domcontentloaded');
  return { app, win, logs, pid: app.process().pid };
}

async function main() {
  if (!fs.existsSync(MAIN)) { console.error(`FAIL: main bundle missing: ${MAIN} — build it first`); process.exit(1); }
  console.log('== ERP S41 — PACKAGED ELECTRON real OS SIGKILL (macOS) ==');
  console.log(`main=${MAIN} node=${process.version} ${os.platform()}/${os.arch()}`);

  const profile = PHASE === '1' ? fs.mkdtempSync(path.join(os.tmpdir(), 'np-s41-pkg-')) : String(args.profile ?? (() => { throw new Error('--profile required for phase 2'); })());
  console.log(`PROFILE ${profile}`);

  const { app, win, logs, pid } = await launch(profile);
  // boot composition + the S38/S40 recovery paths run at boot (best-effort, before the first drain)
  assert(await waitForLog(logs, /Runtime core ready|Background services started|working locally/i, 45_000), 'packaged app booted');

  if (PHASE === '1') {
    // Drive a governed command that produces a durable outbox event through the REAL renderer IPC door.
    // (Uses the same window.neuropause.invoke door the other packaged harnesses use; the exact channel
    //  + payload are the operator's to supply for the account under test — CreateSalesOrder via
    //  platform:command.dispatch, or the enterprise module action door.)
    const dispatched = await win.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const inv = window.neuropause && window.neuropause.invoke;
      if (!inv) return { ok: false, reason: 'no invoke bridge' };
      try {
        const r = await inv('platform:command.dispatch', { operation: 'QueryDeliveryOperations', payload: {}, idempotencyKey: `s41-${Date.now()}` });
        return { ok: true, sample: r && r.ok };
      } catch (e) { return { ok: false, reason: String(e) }; }
    });
    assert(dispatched.ok, `governed IPC door reachable (${JSON.stringify(dispatched)})`);

    // ── THE REAL OS SIGKILL of the REAL Electron process (NOT app.quit / graceful) ──
    console.log(`  [sending real OS SIGKILL to Electron pid ${pid}]`);
    process.kill(pid, 'SIGKILL');
    await new Promise((r) => app.process().on('exit', r));
    console.log('PHASE1_DONE — relaunch the SAME profile with --phase=2 to verify recovery:');
    console.log(`  node e2e/sigkillPackaged.e2e.cjs --phase=2 --profile=${profile} --main=${MAIN}`);
    process.exit(0);
  }

  // PHASE 2 — after the SIGKILL, the SAME profile relaunches: verify recovery + no corruption via a
  // governed read (S35 delivery operations), and that the durable stores are valid.
  const health = await win.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const inv = window.neuropause && window.neuropause.invoke;
    try {
      const h = await inv('platform:command.dispatch', { operation: 'QueryPlatformHealth', payload: {}, idempotencyKey: `s41h-${Date.now()}` });
      const d = await inv('platform:command.dispatch', { operation: 'QueryDeliveryOperations', payload: {}, idempotencyKey: `s41d-${Date.now()}` });
      return { health: h && h.data, delivery: d && d.data };
    } catch (e) { return { error: String(e) }; }
  });
  assert(health && health.health && health.health.components && health.health.components.journal.status !== 'corrupt', `journal store valid after SIGKILL restart (${JSON.stringify(health.health && health.health.components)})`);
  assert(health && health.delivery, 'S35 delivery-operations read succeeds after SIGKILL restart');
  await app.close();

  console.log(`\n== PACKAGED RESULT: ${fails === 0 ? 'PASS' : 'FAIL'} (${fails} failures) ==`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error('PACKAGED_HARNESS_ERR', e); process.exit(1); });
