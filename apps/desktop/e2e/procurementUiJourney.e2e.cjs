#!/usr/bin/env node
/**
 * ERP Session 49 — PROCUREMENT REAL-USER JOURNEY, clicks and typing only (the buy-side twin of
 * o2cUiJourney). Fresh throwaway profile, NO IPC shortcuts, NO seeding, NO developer steps:
 *
 *   launch → first-run onboarding → Business → Procurement → New Purchase Request →
 *   open PR → Submit → Approve → Create Purchase Order → PO visible in Purchase Orders.
 *
 * Every write behind those buttons is the governed command spine (S17 commands, S49 wiring).
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s45"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/procurementUiJourney.e2e.cjs
 * (NP_APP_BIN switches it to a packaged binary, same as the o2c journey.)
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_DIR = path.resolve(__dirname, '..');
const ALT_MAIN = path.join(APP_DIR, 'out-seam-s45/main/index.js');
const APP_BIN = process.env.NP_APP_BIN || '';
const ART = path.join(APP_DIR, 'e2e-artifacts');

function out(k, v) { console.log(`S49 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S49 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!APP_BIN && !fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN}`);
  fs.mkdirSync(ART, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s49-ui-'));
  const app = await electron.launch({
    ...(APP_BIN ? { executablePath: APP_BIN } : {}),
    args: [...(APP_BIN ? [] : [ALT_MAIN]), `--user-data-dir=${profile}`],
    env: { ...process.env, NP_E2E_BUILD: '', NEUROPAUSE_E2E: '', ELECTRON_RENDERER_URL: '', NODE_ENV: 'production' },
    timeout: 60_000,
  });
  const win = await app.firstWindow({ timeout: 45_000 });
  await win.waitForLoadState('domcontentloaded');
  const shot = async (tag) => { await win.screenshot({ path: path.join(ART, `s49-${tag}.png`) }).catch(() => {}); };
  const clickByName = async (name, timeout = 12_000) => {
    const btn = win.getByRole('button', { name, exact: true }).first();
    await btn.waitFor({ state: 'visible', timeout });
    await btn.click();
  };
  const modal = () => win.locator('[role="dialog"]').last();
  const clickAction = async (name) => {
    const b = modal().getByRole('button', { name, exact: true }).first();
    await b.waitFor({ state: 'attached', timeout: 8000 });
    await b.scrollIntoViewIfNeeded().catch(() => {});
    await b.click({ timeout: 8000 });
  };

  try {
    // ── onboarding (S47-proven click route) ──
    await win.getByRole('button', { name: 'Try Free Locally', exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 });
    await clickByName('Try Free Locally');
    await clickByName('Keep it on this device');
    const exploreBiz = win.getByRole('button', { name: 'Explore Business', exact: true }).first();
    await exploreBiz.waitFor({ state: 'visible', timeout: 15_000 });
    await exploreBiz.click();
    for (let i = 0; i < 10; i++) {
      await sleep(600);
      const aside = await win.locator('aside[aria-label="Primary navigation"]').isVisible().catch(() => false);
      const overlayGone = !(await win.locator('[role="dialog"][aria-modal="true"]').first().isVisible().catch(() => false));
      if (aside && overlayGone) break;
      for (const name of ['Skip these questions', 'Yes, continue', 'Continue', 'Finish', 'Skip tour']) {
        const b = win.getByRole('button', { name, exact: true }).first();
        if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); break; }
      }
    }
    await win.locator('aside[aria-label="Primary navigation"]').waitFor({ state: 'visible', timeout: 20_000 });
    await win.getByRole('button', { name: 'Skip tour', exact: true }).first().click({ timeout: 2500 }).catch(() => {});
    await sleep(500);
    assert(true, 'onboarding completed by clicks alone');

    // ── Business → Procurement family ──
    await win.locator('aside button[aria-label="Business"]').first().click({ timeout: 10_000 });
    await sleep(800);
    const chooser = win.getByRole('button', { name: 'Explore Business', exact: true }).first();
    if (await chooser.isVisible().catch(() => false)) await chooser.click();
    await win.getByRole('button', { name: /^Procurement/ }).first().waitFor({ state: 'visible', timeout: 20_000 });
    await win.getByRole('button', { name: /^Procurement/ }).first().click();
    await sleep(500);
    assert(true, 'Procurement family reached');

    // ── governed PR create (quick action) ──
    await clickByName('New Purchase Request');
    const field = modal().getByLabel(/^Request #/i).first();
    await field.waitFor({ state: 'visible', timeout: 8000 });
    await field.fill('PR-PILOT-1');
    await modal().getByRole('button', { name: 'Create', exact: true }).click();
    await win.getByText('PR-PILOT-1').first().waitFor({ state: 'visible', timeout: 10_000 });
    assert(true, 'purchase request created (governed CreatePurchaseRequest): PR-PILOT-1');

    // ── Submit → Approve → Create Purchase Order (all governed) ──
    await win.getByText('PR-PILOT-1').first().click();
    await clickAction('Submit');
    await modal().getByText(/Request submitted\./i).waitFor({ state: 'visible', timeout: 10_000 });
    assert(true, 'PR SUBMITTED via the governed command');
    await clickAction('Approve');
    await modal().getByText(/Request approved\./i).waitFor({ state: 'visible', timeout: 10_000 });
    assert(true, 'PR APPROVED via the governed command');
    await clickAction('Create Purchase Order');
    await modal().getByText(/Purchase order created\./i).waitFor({ state: 'visible', timeout: 10_000 });
    assert(true, 'PR CONVERTED to a purchase order via the governed command');
    await win.keyboard.press('Escape');
    await sleep(400);

    // ── the PO is real and visible ──
    await win.getByRole('button', { name: 'Procurement', exact: true }).first().click({ timeout: 8000 }).catch(() => {});
    await sleep(400);
    const openPO = win.locator('button[aria-label="Open Purchase Orders"]').first();
    if (await openPO.count()) { await openPO.scrollIntoViewIfNeeded().catch(() => {}); await openPO.click(); }
    else await win.getByRole('button', { name: /^Purchase Orders$/ }).first().click({ timeout: 8000 });
    await win.getByText(/PO-|PR-PILOT-1/).first().waitFor({ state: 'visible', timeout: 10_000 });
    assert(true, 'the created Purchase Order is visible in Purchase Orders');

    out('RESULT', 'REAL-USER PROCUREMENT JOURNEY COMPLETED BY CLICKS ALONE — zero developer intervention');
  } catch (e) {
    await shot('failure');
    const buttons = await win.evaluate(() =>
      Array.from(document.querySelectorAll('button')).map((b) => b.textContent?.trim()).filter(Boolean).slice(0, 70),
    ).catch(() => []);
    out('VISIBLE_BUTTONS_AT_FAILURE', buttons);
    throw e;
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 3000));
