#!/usr/bin/env node
/**
 * ERP Session 47 — "DEVELOPER HANDS OFF THE LAPTOP": the O2C pilot happy path driven ENTIRELY
 * through the real UI — clicks and typing only. NO window.neuropause.invoke, NO seeded state,
 * NO developer intervention after launch. This is the Phase-12 dry-run evidence.
 *
 *   launch (fresh profile) → first-run onboarding (Try Free Locally → keep on device → skip
 *   questions → tour) → Business → CRM: New Customer → Sales: New Sales Order → open order →
 *   Ship → Generate Invoice → Finance: open invoice → Issue → Payments: New Payment (cleared)
 *   → invoice shows Paid.
 *
 * Every write behind these buttons is the governed command spine (S43/S45/S46); this harness
 * proves the BUTTONS reach it — the IPC-level chain is separately proven by o2cRuntime.e2e.cjs.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s45"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/o2cUiJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_DIR = path.resolve(__dirname, '..');
const ALT_MAIN = path.join(APP_DIR, 'out-seam-s45/main/index.js');
// S48 — the SAME journey drives the PACKAGED artifact when NP_APP_BIN points at the .app binary
// (executablePath form); default remains the alternate build (positional-main form).
const APP_BIN = process.env.NP_APP_BIN || '';
const ART = path.join(APP_DIR, 'e2e-artifacts');

function out(k, v) { console.log(`S47 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S47 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!APP_BIN && !fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN}`);
  if (APP_BIN && !fs.existsSync(APP_BIN)) fail(`packaged binary missing: ${APP_BIN}`);
  fs.mkdirSync(ART, { recursive: true });
  const profile = process.env.NP_PROFILE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'np-s47-ui-'));
  fs.mkdirSync(profile, { recursive: true });
  const t0 = Date.now();
  const app = await electron.launch({
    ...(APP_BIN ? { executablePath: APP_BIN } : {}),
    args: [...(APP_BIN ? [] : [ALT_MAIN]), `--user-data-dir=${profile}`],
    env: { ...process.env, NP_E2E_BUILD: '', NEUROPAUSE_E2E: '', ELECTRON_RENDERER_URL: '', NODE_ENV: 'production' },
    timeout: 60_000,
  });
  out('MODE', APP_BIN ? `PACKAGED (${APP_BIN})` : 'alternate build');
  out('PROFILE', profile);
  const win = await app.firstWindow({ timeout: 45_000 });
  await win.waitForLoadState('domcontentloaded');

  const shot = async (tag) => { await win.screenshot({ path: path.join(ART, `s47-${tag}.png`) }).catch(() => {}); };
  const clickByName = async (name, timeout = 12_000) => {
    const btn = win.getByRole('button', { name, exact: true }).first();
    await btn.waitFor({ state: 'visible', timeout });
    await btn.click();
  };

  try {
    // ── 1 · FIRST-RUN ONBOARDING (the real current wizard: welcome → AI processing →
    //         WORKSPACE TYPE → discovery → understanding; clicks only) ──
    await win.getByRole('button', { name: 'Try Free Locally', exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 });
    await clickByName('Try Free Locally');
    await clickByName('Keep it on this device');
    // Workspace-type step — the ERP pilot chooses Business.
    const exploreBiz = win.getByRole('button', { name: 'Explore Business', exact: true }).first();
    await exploreBiz.waitFor({ state: 'visible', timeout: 15_000 });
    await exploreBiz.click();
    out('STEP', 'workspace type: Business chosen');
    // Discovery/understanding steps — skip where offered, continue where required.
    for (let i = 0; i < 10; i++) {
      await sleep(600);
      const aside = await win.locator('aside[aria-label="Primary navigation"]').isVisible().catch(() => false);
      const overlayGone = !(await win.locator('[role="dialog"][aria-modal="true"]').first().isVisible().catch(() => false));
      if (aside && overlayGone) break;
      for (const name of ['Skip these questions', 'Explore on my own', 'Yes, continue', 'Continue', 'Get started', 'Finish', 'Skip tour', 'Skip setup for now', 'Done']) {
        const b = win.getByRole('button', { name, exact: true }).first();
        if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); out('STEP', 'clicked ' + name); break; }
      }
    }
    await win.locator('aside[aria-label="Primary navigation"]').waitFor({ state: 'visible', timeout: 20_000 });
    // Dismiss any product tour that follows.
    for (let i = 0; i < 12; i++) {
      const finish = win.getByRole('button', { name: 'Finish', exact: true }).first();
      if (await finish.isVisible().catch(() => false)) { await finish.click().catch(() => {}); break; }
      const cont = win.getByRole('button', { name: 'Continue', exact: true }).first();
      if (await cont.isVisible().catch(() => false)) { await cont.click().catch(() => {}); await sleep(250); continue; }
      break;
    }
    await win.getByRole('button', { name: 'Skip tour', exact: true }).first().click({ timeout: 2500 }).catch(() => {});
    await sleep(500);
    assert(true, 'first-run onboarding completed by clicks alone (local-first, Business workspace chosen)');

    // ── 2 · BUSINESS WORKSPACE ──
    await win.locator('aside button[aria-label="Business"]').first().click({ timeout: 10_000 });
    await sleep(800);
    const exploreBiz2 = win.getByRole('button', { name: 'Explore Business', exact: true }).first();
    if (await exploreBiz2.isVisible().catch(() => false)) { await exploreBiz2.click(); out('STEP', 'business chooser dismissed'); }
    await win.getByRole('button', { name: /^Sales\b/ }).first().waitFor({ state: 'visible', timeout: 20_000 });
    assert(true, 'Business workspace reached from primary navigation');

    const openFamily = async (label) => {
      await win.getByRole('button', { name: new RegExp(`^${label}`) }).first().click({ timeout: 8000 });
      await sleep(400);
    };
    const openModule = async (title) => {
      const byAria = win.locator(`button[aria-label="Open ${title}"]`).first();
      if (await byAria.count()) {
        await byAria.scrollIntoViewIfNeeded().catch(() => {});
        if (await byAria.isVisible().catch(() => false)) { await byAria.click(); await sleep(500); return; }
      }
      const byText = win.getByRole('button', { name: new RegExp(`^${title}$`) }).first();
      await byText.scrollIntoViewIfNeeded().catch(() => {});
      await byText.click({ timeout: 8000 });
      await sleep(500);
    };
    const modal = () => win.locator('[role="dialog"]').last();
    const clickAction = async (name) => {
      const b = modal().getByRole('button', { name, exact: true }).first();
      await b.waitFor({ state: 'attached', timeout: 8000 });
      await b.scrollIntoViewIfNeeded().catch(() => {});
      await b.click({ timeout: 8000 });
    };
    const fillInModal = async (label, value) => {
      const field = modal().getByLabel(new RegExp(`^${label}`, 'i')).first();
      await field.waitFor({ state: 'visible', timeout: 8000 });
      await field.fill(value);
    };

    // ── 3 · CREATE A CUSTOMER (CRM master data through the product UI) ──
    await openFamily('CRM');
    await clickByName('New Customer'); // family quick action opens the REAL create flow
    await fillInModal('Customer Name', 'Pilot Coffee Co.');
    await modal().getByRole('button', { name: 'Create', exact: true }).click();
    await win.getByText('Pilot Coffee Co.').first().waitFor({ state: 'visible', timeout: 10_000 });
    assert(true, 'customer created through the UI and visible in the list');

    // ── 4 · CREATE A SALES ORDER (the governed S43 create, from the real button) ──
    await openFamily('Sales');
    await clickByName('New Sales Order'); // family quick action opens the REAL create flow
    await fillInModal('Order Number', 'SO-PILOT-1');
    await fillInModal('Customer', 'Pilot Coffee Co.');
    await fillInModal('Total', '750');
    await modal().getByRole('button', { name: 'Create', exact: true }).click();
    // The quick-create already navigated INTO the Sales Orders module — the row appears here.
    await win.getByText('SO-PILOT-1').first().waitFor({ state: 'visible', timeout: 10_000 });
    assert(true, 'sales order created (governed CreateSalesOrder) and visible: SO-PILOT-1');

    // ── 5 · SHIP (governed ShipSalesOrder from the record-detail button) ──
    await win.getByText('SO-PILOT-1').first().click();
    await clickAction('Ship');
    await modal().getByText(/Order shipped\./i).waitFor({ state: 'visible', timeout: 10_000 });
    assert(true, 'order SHIPPED via the governed command; result shown to the user');

    // ── 6 · GENERATE INVOICE (governed InvoiceSalesOrder) ──
    await clickAction('Generate Invoice');
    await modal().getByText(/Invoice generated\./i).waitFor({ state: 'visible', timeout: 10_000 });
    assert(true, 'invoice GENERATED via the governed command; result shown to the user');
    await win.keyboard.press('Escape');
    await sleep(400);

    // ── 7 · ISSUE THE INVOICE (governed IssueCustomerInvoice → Dr AR / Cr Revenue) ──
    await openFamily('Finance');
    await openModule('Finance'); // the invoices module is titled 'Finance' inside the Finance family
    const invoiceCell = win.getByText(/INV-|SO-PILOT-1/).first();
    await invoiceCell.waitFor({ state: 'visible', timeout: 10_000 });
    const invoiceTitle = (await invoiceCell.textContent())?.trim() ?? '';
    await invoiceCell.click();
    await clickAction('Issue');
    await modal().getByText(/Invoice issued\./i).waitFor({ state: 'visible', timeout: 10_000 });
    assert(true, `invoice ISSUED via the governed command (${invoiceTitle})`);
    await win.keyboard.press('Escape');
    await sleep(400);

    // ── 8 · RECEIVE THE PAYMENT (governed ReceiveCustomerPayment → Dr Cash / Cr AR → settle) ──
    // Back to the Finance family landing (breadcrumb), then the quick action.
    await win.getByRole('button', { name: 'Finance', exact: true }).first().click({ timeout: 8000 });
    await sleep(400);
    await clickByName('New Payment'); // Finance family quick action
    await fillInModal('Payment #', 'PAY-PILOT-1');
    await fillInModal('Invoice', invoiceTitle || 'INV');
    await fillInModal('Amount', '750');
    await modal().getByRole('button', { name: 'Create', exact: true }).click();
    await win.getByText('PAY-PILOT-1').first().waitFor({ state: 'visible', timeout: 10_000 });
    assert(true, 'cleared receipt recorded via the governed command: PAY-PILOT-1');

    // ── 9 · SETTLEMENT VISIBLE TO THE USER ──
    await win.getByRole('button', { name: 'Finance', exact: true }).first().click({ timeout: 8000 }); // breadcrumb back
    await sleep(400);
    await openModule('Finance'); // the invoices module // the invoices module is titled 'Finance' inside the Finance family
    await win.getByText(/Paid/i).first().waitFor({ state: 'visible', timeout: 10_000 });
    assert(true, 'invoice shows PAID in the UI — settlement visible from authoritative state');

    const secs = Math.round((Date.now() - t0) / 1000);
    out('TIME_TO_FIRST_SUCCESSFUL_TRANSACTION_SECONDS', secs);
    out('RESULT', 'REAL-USER O2C JOURNEY COMPLETED BY CLICKS ALONE — zero developer intervention');
  } catch (e) {
    await shot('failure');
    const buttons = await win.evaluate(() =>
      Array.from(document.querySelectorAll('button')).map((b) => b.textContent?.trim()).filter(Boolean).slice(0, 60),
    ).catch(() => []);
    out('VISIBLE_BUTTONS_AT_FAILURE', buttons);
    throw e;
  } finally {
    await app.close().catch(() => undefined);
    if (!process.env.NP_KEEP_PROFILE) fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 3000));
