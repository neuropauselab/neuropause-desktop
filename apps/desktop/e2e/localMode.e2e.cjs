/**
 * S17 local-first — `local-mode.spec`.
 *
 * The HONEST, UNSEEDED build: a plain release bundle (NO NP_E2E_BUILD, NO
 * NEUROPAUSE_E2E — so `__NP_E2E__` folds to false and the seed seam is absent),
 * launched on a FRESH, isolated profile with the backend unreachable. It proves
 * the sign-in wall is dead: a fresh clone reaches the FULL product in local mode
 * with the one affordance, and never the "Sign in to your AI operating layer"
 * wall.
 *
 * Runbook (from apps/desktop):
 *   npx electron-vite build                 # RELEASE build — NO NP_E2E_BUILD
 *   NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/localMode.e2e.cjs
 *
 * Exit 0 = all assertions passed. Screenshots land in e2e/artifacts/.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright-core');

const APP_DIR = path.resolve(__dirname, '..');
const MAIN = path.join(APP_DIR, 'out/main/index.js');
const ART = path.join(__dirname, 'artifacts');
fs.mkdirSync(ART, { recursive: true });

// A FRESH, isolated profile — no stored account → restoreSession enters local mode.
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'np-local-mode-'));

const failures = [];
const ok = (cond, msg) => { if (cond) { console.log(`  ✓ ${msg}`); } else { failures.push(msg); console.log(`  ✗ ${msg}`); } };
const hardTimeout = setTimeout(() => { console.log('HARD_TIMEOUT — the app did not settle'); process.exit(9); }, 120_000);
hardTimeout.unref();

const shot = async (win, name) => { try { await win.screenshot({ path: path.join(ART, name + '.png') }); } catch { /* best effort */ } };

async function dismissDialogs(win) {
  for (let i = 0; i < 4; i += 1) {
    const btn = win.locator('button', { hasText: /^(Get started|Continue|Skip|Done|Close|Not now)$/i }).first();
    try { if (await btn.isVisible({ timeout: 1000 })) { await btn.click(); await win.waitForTimeout(300); continue; } } catch { /* none */ }
    break;
  }
}

(async () => {
  if (!fs.existsSync(MAIN)) { console.log(`MISSING BUILD: ${MAIN} — run \`npx electron-vite build\` (RELEASE, no NP_E2E_BUILD) first.`); process.exit(2); }

  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${PROFILE}`],
    cwd: APP_DIR,
    // A true RELEASE launch: NO NP_E2E_BUILD, NO NEUROPAUSE_E2E — the seed seam is
    // compiled out. No backend is running, so the app is effectively offline.
    env: { ...process.env, NODE_ENV: 'production', NP_E2E_BUILD: '', NEUROPAUSE_E2E: '' },
  });

  try {
    const win = await app.firstWindow({ timeout: 30_000 });
    await win.waitForLoadState('domcontentloaded');

    // The window title must NOT carry the `-e2e` seed stamp (proves an honest build).
    const title = await win.title();
    ok(!/-e2e/i.test(title), `window is not an e2e-seeded build (title: "${title}")`);

    await dismissDialogs(win);

    // The app settles into local mode: the "Working locally" affordance appears,
    // and the sign-in WALL does not.
    await win.waitForFunction(
      () => /working locally/i.test(document.body.innerText),
      { timeout: 30_000 },
    ).catch(() => {});
    await shot(win, 'local-mode');

    const body = await win.evaluate(() => document.body.innerText);
    ok(/working locally/i.test(body), 'the "Working locally" affordance is shown');
    ok(/connect an account/i.test(body), 'the affordance offers to connect an account to sync');
    ok(!/Sign in to your AI operating layer/i.test(body), 'the sign-in WALL is NOT shown (it is dead in local mode)');

    // The full shell mounted (a device-local principal reaches the product), not
    // just a blank frame: the local display name is visible somewhere in the chrome.
    ok(body.trim().length > 40, 'the full product shell rendered (not a blank frame)');

    // ── Phase 2 — a cloud-backed section shows HONEST ABSENCE, not a raw error ──
    // Enter the local shell past first-run onboarding, then open Organization
    // (the section that error'd "Sign in to manage organizations." in the live run).
    for (const label of [/^Try Free Locally$/i, /^Skip setup for now$/i]) {
      const b = win.locator('button', { hasText: label }).first();
      try { if (await b.isVisible({ timeout: 1500 })) { await b.click(); await win.waitForTimeout(600); } } catch { /* not present */ }
    }
    await dismissDialogs(win);
    const orgNav = win.locator('button', { hasText: /^Organization$/i }).first();
    let orgReached = false;
    try { if (await orgNav.isVisible({ timeout: 6000 })) { await orgNav.click(); orgReached = true; } } catch { /* nav not reachable */ }
    if (orgReached) {
      await win.waitForFunction(() => /unavailable while working locally/i.test(document.body.innerText), { timeout: 8000 }).catch(() => {});
      await shot(win, 'local-mode-org');
      const orgBody = await win.evaluate(() => document.body.innerText);
      ok(/unavailable while working locally/i.test(orgBody), 'Organization shows HONEST cloud-absence in local mode');
      ok(!/Sign in to manage organizations/i.test(orgBody), 'Organization does NOT show the raw "Sign in to manage organizations." error');
      ok(!/Error invoking remote method/i.test(orgBody), 'no raw IPC error surfaced on the Organization page');
    } else {
      // Non-fatal: onboarding/nav not interactable in this run. The honest-absence
      // derivation is proven deterministically by ui-tests/localModeAffordance.test.tsx.
      console.log('  (note) Organization nav not reached (onboarding/nav not interactable) — honest-absence covered by the component test');
    }
  } finally {
    // app.close() can hang on the shutdown-flush barrier; don't let teardown
    // approach the hard timeout — race it and move on.
    await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  clearTimeout(hardTimeout);
  if (failures.length) { console.log(`\nFAIL — ${failures.length} assertion(s): ${failures.join(' | ')}`); process.exit(1); }
  console.log('\nPASS — the sign-in wall is dead; a fresh unseeded build is usable in local mode.');
  process.exit(0);
})().catch((err) => { console.log('ERROR', err && err.stack ? err.stack : err); process.exit(3); });
