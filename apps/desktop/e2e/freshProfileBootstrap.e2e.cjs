/*
 * NP-007 · FRESH-PROFILE BOOTSTRAP harness — the run that would have caught the 19 Aug ceremony divergence.
 *
 * Launches the real Electron app on a FRESH temp --user-data-dir (the exact environment the ceremony uses; the
 * old harnesses launched on the default dev profile — the coverage gap this closes) and asserts the bootstrap
 * invariants per mode:
 *
 *   FRESH_BOOT_EXPECT=broken  (V1 · reproduce-first, CURRENT build): the S17×seed ordering collision fires —
 *     local mode enters, the org owner row is claimed by the LOCAL principal, the seed swaps the session to the
 *     app principal AFTERWARDS, and tenancy refuses `not_a_member` with the W-7 predicate
 *     (sessionMatchedAMember:false · ownerEmailShape @device.invalid · sessionMatchesOwner:false).
 *   FRESH_BOOT_EXPECT=fixed   (V4 · the ceremony scenario, repaired build): the app principal is established
 *     BEFORE the owner binding — owner bound NOT local, zero `not_a_member`, `connectors:list` LOADS (the
 *     Connector Center gate), and the propose surface answers with a TYPED response (reachable).
 *   FRESH_BOOT_EXPECT=plain   (V3 · S17 non-regression): NO e2e flags — local mode enters and the owner binds
 *     to the LOCAL principal exactly as today; no seed line appears.
 *
 * App-principal mode arms the FG-4 rail flags but performs NO send, NO OAuth, NO external effect; the fresh
 * temp profile is deleted afterwards. ZERO real contact.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright-core');

const APP_DIR = path.resolve(__dirname, '..');
const MAIN = path.join(APP_DIR, 'out/main/index.js');
const EXPECT = process.env.FRESH_BOOT_EXPECT || 'broken';

const failures = [];
const ok = (cond, msg) => { if (cond) { console.log(`  ✓ ${msg}`); } else { failures.push(msg); console.log(`  ✗ ${msg}`); } };
const hardTimeout = setTimeout(() => { console.log('HARD_TIMEOUT'); process.exit(9); }, 120_000);
hardTimeout.unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `np007-${EXPECT}-`));
  console.log(`\nNP-007 fresh-profile bootstrap — mode=${EXPECT} profile=${profile}`);
  const env = { ...process.env, NODE_ENV: 'production', NP_E2E_BUILD: '1' };
  delete env.NEUROPAUSE_E2E; delete env.NEUROPAUSE_E2E_VERIFY;
  if (EXPECT === 'plain') { delete env.NEUROPAUSE_S15_APPPRINCIPAL; delete env.NEUROPAUSE_FIRST_REAL_SEND; }
  else { env.NEUROPAUSE_S15_APPPRINCIPAL = '1'; env.NEUROPAUSE_FIRST_REAL_SEND = '1'; }

  const logs = [];
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${profile}`], cwd: APP_DIR, env, timeout: 45_000,
  });
  app.process().stdout.on('data', (d) => logs.push(String(d)));
  app.process().stderr.on('data', (d) => logs.push(String(d)));
  const win = await app.firstWindow({ timeout: 30_000 });
  await win.waitForLoadState('domcontentloaded');
  await sleep(9000); // startup + seed + first renderer channel calls
  const all = () => logs.join('');

  if (EXPECT === 'plain') {
    ok(!all().includes('NEUROPAUSE_E2E_SEED_v1'), 'no seed ran (mode off)');
    ok(all().includes('Entering device-local mode'), 'S17 local mode entered');
    ok(all().includes('Owner bound to the active principal { local: true }'), 'owner bound to the LOCAL principal (S17 behavior preserved)');
    ok(!all().includes("reason: 'not_a_member'"), 'no membership refusal on the plain local path');
  } else if (EXPECT === 'broken') {
    ok(all().includes('installing seeds — mode=app-principal'), 'the app-principal seed ran (rail armed)');
    ok(all().includes('Owner bound to the active principal { local: true }'), 'REPRODUCED: owner row claimed by the LOCAL principal before the seed');
    ok(all().includes("reason: 'not_a_member'"), "REPRODUCED: tenancy refuses not_a_member");
    ok(/sessionMatchedAMember: false/.test(all()) && /ownerEmailShape: '[^']*@device\.invalid'/.test(all()) && /sessionMatchesOwner: false/.test(all()),
      'REPRODUCED: the W-7 predicate matches the ceremony divergence (session≠member, owner=@device.invalid, session≠owner)');
    const r = await win.evaluate(() => window.neuropause.invoke('connectors:list')).then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, e: String(e) }));
    ok(!r.ok && /not a member/i.test(r.e), `REPRODUCED: connectors:list refused (${r.ok ? 'unexpectedly loaded' : r.e.slice(0, 80)})`);
  } else { // fixed
    ok(all().includes('installing seed principal — mode=app-principal') || all().includes('mode=app-principal'), 'the app-principal seed ran (rail armed)');
    ok(!all().includes('Owner bound to the active principal { local: true }'), 'owner NOT bound to the local principal (the app principal won the binding)');
    ok(!all().includes("reason: 'not_a_member'"), 'ZERO not_a_member refusals on the fresh profile');
    const r = await win.evaluate(() => window.neuropause.invoke('connectors:list')).then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, e: String(e) }));
    ok(r.ok, `connectors:list LOADS — the Connector Center gate is open (${r.ok ? `${Array.isArray(r.v) ? r.v.length : 'object'} returned` : r.e.slice(0, 80)})`);
    // The proposal surface is REACHABLE: a TYPED response (ok:false with a reason is fine — no account is connected),
    // never a tenant/membership refusal thrown across the bridge.
    const p = await win.evaluate(() => window.neuropause.invoke('capability:m365.propose', {
      capabilityId: 'mail.send', purpose: 'np007 reachability check', params: { to: ['neuropause033@gmail.com'], subject: 's', body: 'b' },
    })).then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, e: String(e) }));
    ok(p.ok && typeof p.v === 'object' && 'ok' in p.v, `propose surface reachable with a TYPED response (${p.ok ? JSON.stringify(p.v).slice(0, 80) : p.e.slice(0, 80)})`);
  }

  const proc = app.process();
  await Promise.race([app.close().catch(() => {}), sleep(4000)]);
  try { proc.kill('SIGKILL'); } catch { /* gone */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* temp cleanup best-effort */ }

  console.log(`\n${failures.length === 0 ? 'PASS' : 'FAIL'} — mode=${EXPECT}, ${failures.length} assertion(s) failed.`);
  clearTimeout(hardTimeout);
  process.exit(failures.length === 0 ? 0 : 1);
})().catch((e) => { console.log('HARNESS_ERROR:', e.message); process.exit(3); });
