/*
 * NeuroPause OS — Wave 2 / S5.4 Phase 0. Real-Electron READ-BACK loop (mock Graph only).
 *
 * Extends the S14 governed-send e2e with the missing half of the circle: after the certified path returns
 * ACKNOWLEDGED (mock Graph 202), an INDEPENDENT read-back runs and reaches a real terminal — executor-success is
 * NEVER the claim (constitutional §2 #14). TEST-VERIFIED at the real-application level — NOT LIVE: no credentials, no
 * OAuth consent, no real external contact. The Graph send AND the read-back Sent Items / Inbox are answered by the
 * compile-stripped in-process mock (src/main/e2e/mockGraph.ts); the READ-ONLY oracle (verifyGovernedSend → verifyEffect)
 * is the REAL production code.
 *
 * For each harness knob the mock steers the mailbox and we assert the certified terminal the oracle reaches:
 *   NEUROPAUSE_E2E_VERIFY=success → Sent Items echoes the send            → TERMINAL=VERIFIED_SUCCESS
 *   NEUROPAUSE_E2E_VERIFY=bounce  → Inbox carries an NDR for the recipient → TERMINAL=VERIFY_FAILED
 *   NEUROPAUSE_E2E_VERIFY=hold    → nothing observed (bounded backoff)     → TERMINAL=HOLD  (never auto-promoted)
 *
 * The send is driven through the certified IPC path via the preload bridge (the UI drive is already proven in S14-A);
 * the novel assertion here is the read-back terminal, observed in the main-process log.
 *
 * Build once:  NP_E2E_BUILD=1 npx electron-vite build
 * Run:         node e2e/mailReadBack.e2e.cjs      (exit 0 = all three terminals proven; artifacts in e2e/artifacts/)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright-core');

const APP_DIR = path.resolve(__dirname, '..');
const MAIN = path.join(APP_DIR, 'out/main/index.js');
const ART = path.join(__dirname, 'artifacts');
fs.mkdirSync(ART, { recursive: true });

const MOCK_ACCOUNT_ID = 'e2e-entra-acct'; // must match src/main/e2e/e2eSeed.ts
const RECIPIENT = 'neuropause033@gmail.com';
const CASES = [
  { knob: 'success', terminal: 'VERIFIED_SUCCESS' },
  { knob: 'bounce', terminal: 'VERIFY_FAILED' },
  { knob: 'hold', terminal: 'HOLD' },
];

const failures = [];
const ok = (cond, msg) => { if (cond) { console.log(`  ✓ ${msg}`); } else { failures.push(msg); console.log(`  ✗ ${msg}`); } };
const hardTimeout = setTimeout(() => { console.log('HARD_TIMEOUT — the read-back loop did not complete'); process.exit(9); }, 300_000);
hardTimeout.unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForLog(logs, re, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = logs.join('').match(re);
    if (hit) return hit;
    await sleep(500);
  }
  return null;
}

async function runCase({ knob, terminal }) {
  console.log(`\nREAD-BACK knob=${knob} — expect TERMINAL=${terminal}:`);
  const logs = [];
  // NP-007: a FRESH temp profile per launch — the proof covers the fresh-profile bootstrap, not dev-profile state.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `np-readback-${knob}-`));
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${profile}`], cwd: APP_DIR,
    env: { ...process.env, NODE_ENV: 'production', NP_E2E_BUILD: '1', NEUROPAUSE_E2E: '1', NEUROPAUSE_E2E_VERIFY: knob },
    timeout: 45_000,
  });
  app.process().stdout.on('data', (d) => logs.push(String(d)));
  app.process().stderr.on('data', (d) => logs.push(String(d)));
  const win = await app.firstWindow({ timeout: 30_000 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(6000); // let the e2e seed install (principal + connected mock account + Graph mock)

  // Drive the governed send through the certified path via the preload bridge. This hits the mock Graph (202),
  // which records the send and fires the READ-ONLY read-back over the real reader (its fetch loops back to the mock).
  const res = await win.evaluate(([ch, payload]) => window.neuropause.invoke(ch, payload), [
    'connectors:m365.execute',
    { connectorId: 'microsoft-entra', accountId: MOCK_ACCOUNT_ID, actionId: 'mail.send',
      params: { to: [RECIPIENT], subject: `NeuroPause read-back ${knob}`, body: 'The demo is Friday.' }, confirmed: true },
  ]).catch((e) => ({ ok: false, message: String(e) }));
  ok(res && (res.ok || /ACKNOWLEDGED/i.test(JSON.stringify(res))), `certified path ACKNOWLEDGED the governed send (${JSON.stringify(res).slice(0, 120)})`);
  ok(logs.join('').includes('mock Graph intercepted'), 'the executor hit the MOCK Graph, not the real one');

  const hit = await waitForLog(logs, /\[NEUROPAUSE_E2E_VERIFY_v1\] TERMINAL=([A-Z_]+)/, 20_000);
  ok(!!hit, 'the independent read-back ran and logged a terminal');
  ok(hit && hit[1] === terminal, `read-back terminal is ${terminal} (saw ${hit ? hit[1] : 'none'})`);
  // Honesty guards: 'hold' must NOT be laundered into a success, and a success terminal must carry a corroborated id.
  if (knob === 'hold') ok(hit && hit[1] !== 'VERIFIED_SUCCESS', "HOLD is never auto-promoted to VERIFIED_SUCCESS");
  if (knob === 'success') ok(/internetMessageId=<mock-/.test(logs.join('')), 'VERIFIED_SUCCESS carries a corroborated (mock) internetMessageId');

  await win.screenshot({ path: path.join(ART, `readback-${knob}.png`) }).catch(() => {});
  const proc = app.process();
  await Promise.race([app.close().catch(() => {}), sleep(4000)]);
  try { proc.kill('SIGKILL'); } catch { /* gone */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* temp cleanup best-effort */ }
}

(async () => {
  for (const c of CASES) {
    try { await runCase(c); }
    catch (e) { failures.push(`knob=${c.knob} harness error: ${e.message}`); console.log(`  ✗ knob=${c.knob} harness error: ${e.message}`); }
  }
  console.log(`\n${failures.length === 0 ? 'PASS' : 'FAIL'} — ${failures.length} assertion(s) failed. Artifacts: ${ART}`);
  clearTimeout(hardTimeout);
  process.exit(failures.length === 0 ? 0 : 1);
})().catch((e) => { console.log('E2E_HARNESS_ERROR:', e.message); process.exit(3); });
