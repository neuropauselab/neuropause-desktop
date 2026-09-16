#!/usr/bin/env node
/**
 * S48 Phase 8 — RESTART / DURABILITY on the PACKAGED artifact.
 * Relaunches the packaged app on the SAME profile the click-only journey used and proves,
 * through the UI alone, that the durable state survived: no onboarding again, the shipped
 * order still listed, the invoice still PAID. Read-only clicks; no writes.
 *   NP_APP_BIN=<packaged binary> NP_PROFILE_DIR=<journey profile> node e2e/s48Restart.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');

const APP_BIN = process.env.NP_APP_BIN;
const PROFILE = process.env.NP_PROFILE_DIR;
function out(k, v) { console.log(`S48 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S48 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!APP_BIN || !fs.existsSync(APP_BIN)) fail('NP_APP_BIN missing');
  if (!PROFILE || !fs.existsSync(PROFILE)) fail('NP_PROFILE_DIR missing (run the journey first)');
  const before = JSON.parse(fs.readFileSync(`${PROFILE}/platform-command-journal.json`, 'utf8')).records.length;
  const app = await electron.launch({
    executablePath: APP_BIN,
    args: [`--user-data-dir=${PROFILE}`],
    env: { ...process.env, NP_E2E_BUILD: '', NEUROPAUSE_E2E: '', ELECTRON_RENDERER_URL: '', NODE_ENV: 'production' },
    timeout: 60_000,
  });
  try {
    const win = await app.firstWindow({ timeout: 45_000 });
    await win.waitForLoadState('domcontentloaded');
    out('isPackaged', await app.evaluate(({ app: a }) => a.isPackaged));
    // 1 · NO second onboarding — the shell mounts directly (persisted first-run state).
    await win.locator('aside[aria-label="Primary navigation"]').waitFor({ state: 'visible', timeout: 25_000 });
    const wizard = await win.getByRole('button', { name: 'Try Free Locally', exact: true }).first().isVisible().catch(() => false);
    assert(!wizard, 'no repeated onboarding — persisted first-run state honored');
    // 2 · The order survived the restart.
    await win.locator('aside button[aria-label="Business"]').first().click({ timeout: 10_000 });
    await sleep(800);
    const chooser = win.getByRole('button', { name: 'Explore Business', exact: true }).first();
    if (await chooser.isVisible().catch(() => false)) await chooser.click();
    await win.getByRole('button', { name: /^Sales\b/ }).first().click({ timeout: 15_000 });
    await sleep(500);
    await win.locator('button[aria-label="Open Sales Orders"]').first().click({ timeout: 8000 }).catch(async () => {
      await win.getByRole('button', { name: /^Sales Orders$/ }).first().click({ timeout: 8000 });
    });
    await win.getByText('SO-PILOT-1').first().waitFor({ state: 'visible', timeout: 10_000 });
    assert(true, 'SO-PILOT-1 survived the restart (durable store)');
    // 3 · The settled invoice survived.
    await win.getByRole('button', { name: /^Finance\b/ }).first().click({ timeout: 8000 });
    await sleep(500);
    await win.locator('button[aria-label="Open Finance"]').first().click({ timeout: 8000 }).catch(async () => {
      await win.getByRole('button', { name: /^Finance$/ }).first().click({ timeout: 8000 });
    });
    await win.getByText(/Paid/i).first().waitFor({ state: 'visible', timeout: 10_000 });
    assert(true, 'invoice still PAID after restart (durable financial state)');
    // 4 · No duplicate accounting effects appeared from the relaunch.
    const after = JSON.parse(fs.readFileSync(`${PROFILE}/platform-command-journal.json`, 'utf8')).records.length;
    assert(after === before, `journal record count unchanged across restart (${before} → ${after}) — no duplicate effects`);
    out('RESULT', 'RESTART DURABILITY VERIFIED on the packaged artifact');
  } finally {
    await app.close().catch(() => undefined);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 3000));
