/*
 * NeuroPause OS — S5.4 · the BRAIN-PROPOSED loop in the REAL Electron app (mock Graph only).
 *
 * The ceremony's steps 2/3/5/6, proven in-app in mock before any real contact:
 *   step 2 — PROPOSE: `capability:m365.propose` returns ok AND `brainReview` (the lane composed the real substrate,
 *            built the certified L6 Proposal, and stashed it for the FG-10 gate);
 *   step 3 — ASK data: all eight review fields are present and name the mandated recipient;
 *   step 5 — EXECUTE (unedited): the certified path runs and the main log carries `L6-GATE ADMIT` — the send was
 *            Brain-PROPOSED, not merely governed; single-use: a second identical send is NOT re-admitted;
 *   step 6 — READ-BACK: the independent oracle reaches TERMINAL=VERIFIED_SUCCESS over the mock mailbox.
 *
 * TEST-VERIFIED at the real-application level — NOT LIVE: no credentials, no consent, no real contact. The renderer
 * panel RENDER of brainReview is pinned by ui-tests (m365WritePanelBrainReview); this harness proves the main-side
 * data + gate + read-back in the running app.
 *
 * Build once:  NP_E2E_BUILD=1 npx electron-vite build
 * Run:         node e2e/brainPropose.e2e.cjs
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright-core');

const APP_DIR = path.resolve(__dirname, '..');
const MAIN = path.join(APP_DIR, 'out/main/index.js');
const ART = path.join(__dirname, 'artifacts');
fs.mkdirSync(ART, { recursive: true });

const MOCK_ACCOUNT_ID = 'e2e-entra-acct';
const RECIPIENT = 'neuropause033@gmail.com';
const PARAMS = { to: [RECIPIENT], subject: 'NeuroPause brain-proposed rehearsal', body: 'The demo is Friday.' };

const failures = [];
const ok = (cond, msg) => { if (cond) { console.log(`  ✓ ${msg}`); } else { failures.push(msg); console.log(`  ✗ ${msg}`); } };
const hardTimeout = setTimeout(() => { console.log('HARD_TIMEOUT'); process.exit(9); }, 180_000);
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

(async () => {
  const logs = [];
  // NP-007: a FRESH temp profile — the proof must cover the fresh-profile bootstrap the ceremony uses, not the
  // default dev profile's pre-existing org state (the 19 Aug coverage gap).
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-brainpropose-'));
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${profile}`], cwd: APP_DIR,
    env: { ...process.env, NODE_ENV: 'production', NP_E2E_BUILD: '1', NEUROPAUSE_E2E: '1', NEUROPAUSE_E2E_VERIFY: 'success' },
    timeout: 45_000,
  });
  app.process().stdout.on('data', (d) => logs.push(String(d)));
  app.process().stderr.on('data', (d) => logs.push(String(d)));
  const win = await app.firstWindow({ timeout: 30_000 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(6000); // e2e seed (principal + mock account + mock Graph)

  const bridge = (ch, payload) => win.evaluate(([c, p]) => window.neuropause.invoke(c, p), [ch, payload]);

  // ── Step 2 — PROPOSE through the real channel; the lane must return brainReview. ─────────────────────────────
  console.log('\nStep 2 — Brain proposes (capability:m365.propose):');
  const propose = await bridge('capability:m365.propose', {
    capabilityId: 'mail.send', accountId: MOCK_ACCOUNT_ID, purpose: 'ceremony rehearsal', params: PARAMS,
  }).catch((e) => ({ ok: false, message: String(e) }));
  ok(propose && propose.ok === true, `propose ok (${JSON.stringify(propose).slice(0, 140)})`);
  ok(propose && propose.brainReview != null, 'response carries brainReview — the lane built + stashed a certified L6 Proposal');

  // ── Step 3 — the eight ASK fields, present and honest. ───────────────────────────────────────────────────────
  console.log('\nStep 3 — the eight review fields (ASK data):');
  const r = (propose && propose.brainReview) || {};
  const eight = ['purpose', 'target', 'action', 'risk', 'evidenceRefs', 'expectedEffect', 'verificationPlan', 'expiry'];
  ok(eight.every((k) => r[k] != null && String(r[k]).length > 0), `all eight fields present (${eight.filter((k) => r[k] == null).join(',') || 'none missing'})`);
  ok(String(r.action).includes(RECIPIENT), `action names the mandated recipient (${String(r.action)})`);
  ok(String(r.verificationPlan).includes('send-corroboration'), 'verification plan is the honest oracle plan (send-corroboration, not delivery)');

  // ── Step 5 — EXECUTE unedited → the FG-10 gate must ADMIT (Brain-proposed, not merely governed). ─────────────
  console.log('\nStep 5 — governed execution with the UNEDITED mandate:');
  const exec = await bridge('connectors:m365.execute', {
    connectorId: 'microsoft-entra', accountId: MOCK_ACCOUNT_ID, actionId: 'mail.send', params: PARAMS, confirmed: true,
  }).catch((e) => ({ ok: false, message: String(e) }));
  ok(exec && exec.ok === true, `certified path ACKNOWLEDGED (${JSON.stringify(exec).slice(0, 120)})`);
  ok(logs.join('').includes('mock Graph intercepted'), 'the executor hit the MOCK Graph, not the real one');
  const admit = await waitForLog(logs, /L6-GATE ADMIT capability=mail\.send/, 10_000);
  ok(!!admit, 'the main log carries L6-GATE ADMIT — the send was Brain-PROPOSED and re-derived clean at execution time');

  // ── Step 6 — the independent read-back reaches its terminal. ─────────────────────────────────────────────────
  console.log('\nStep 6 — independent read-back:');
  const term = await waitForLog(logs, /\[NEUROPAUSE_E2E_VERIFY_v1\] TERMINAL=([A-Z_]+)/, 20_000);
  ok(term && term[1] === 'VERIFIED_SUCCESS', `read-back terminal is VERIFIED_SUCCESS (saw ${term ? term[1] : 'none'})`);

  // ── Single-use in-app: the SAME send again is NOT re-admitted (stash consumed at step 5). ────────────────────
  console.log('\nSingle-use — a second identical execute is NOT re-admitted:');
  await bridge('connectors:m365.execute', {
    connectorId: 'microsoft-entra', accountId: MOCK_ACCOUNT_ID, actionId: 'mail.send', params: PARAMS, confirmed: true,
  }).catch(() => null);
  await sleep(2000);
  const admits = (logs.join('').match(/L6-GATE ADMIT/g) || []).length;
  ok(admits === 1, `exactly one L6-GATE ADMIT across two identical sends (saw ${admits}) — the proposal is single-use`);

  await win.screenshot({ path: path.join(ART, 'brainPropose.png') }).catch(() => {});
  const proc = app.process();
  await Promise.race([app.close().catch(() => {}), sleep(4000)]);
  try { proc.kill('SIGKILL'); } catch { /* gone */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* temp cleanup best-effort */ }

  console.log(`\n${failures.length === 0 ? 'PASS' : 'FAIL'} — ${failures.length} assertion(s) failed. Artifacts: ${ART}`);
  clearTimeout(hardTimeout);
  process.exit(failures.length === 0 ? 0 : 1);
})().catch((e) => { console.log('E2E_HARNESS_ERROR:', e.message); process.exit(3); });
