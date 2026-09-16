#!/usr/bin/env node
/**
 * ERP Session 51 — PACKAGED GOVERNANCE NEGATIVES for the S50 procurement fence.
 *
 * Same mechanism class as o2cRuntime (S45/S48 precedent): launch the artifact on a FRESH
 * throwaway --user-data-dir and drive `window.neuropause.invoke` — the exact door every
 * renderer control uses. No new IPC, no privileged backdoor; every probe below is a call any
 * renderer code could make, which is precisely why the refusals must hold in the SHIPPED bundle.
 *
 * Proves, against the PACKAGED artifact:
 *   S50 PO fence: hand-set `received` refused (both directions) · approved→draft reversal
 *   refused · convertedReceipt clear AND fabricate refused · cancelled→draft recovery SAVES.
 *   Governed procurement spine: SubmitPurchaseRequest dispatch works · same-key replay
 *   suppressed (one transition, ever).
 *   S46 origin fence (O2C set, unchanged by S49/S50): the legacy action door refuses a
 *   governed key ('ship') from an external caller.
 *
 * Run (alternate build):  NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s51PackagedNegatives.e2e.cjs
 * Run (packaged):         NP_APP_BIN=<app binary> NODE_PATH=... node e2e/s51PackagedNegatives.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_DIR = path.resolve(__dirname, '..');
const ALT_MAIN = path.join(APP_DIR, 'out-seam-s45/main/index.js');
const APP_BIN = process.env.NP_APP_BIN || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S51 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S51 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }

async function main() {
  if (!APP_BIN && !fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN}`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s51-neg-'));
  const app = await electron.launch({
    ...(APP_BIN ? { executablePath: APP_BIN } : {}),
    args: [...(APP_BIN ? [] : [ALT_MAIN]), `--user-data-dir=${profile}`],
    env: { ...process.env, NP_E2E_BUILD: '', NEUROPAUSE_E2E: '', ELECTRON_RENDERER_URL: '', NODE_ENV: 'production' },
    timeout: 60_000,
  });
  try {
    const win = await app.firstWindow({ timeout: 45_000 });
    const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData) === fs.realpathSync(profile), 'ISOLATED profile is the running userData');
    await sleep(APP_BIN ? 4000 : 2500);

    const bridge = (ch, payload) =>
      win.evaluate(([c, p]) => window.neuropause.invoke(c, p), [ch, payload]);
    const create = (moduleId, fields) => bridge('enterprise:module.create', { moduleId, fields });
    const update = (moduleId, id, fields) => bridge('enterprise:module.update', { moduleId, id, fields });
    const action = (moduleId, id, a) => bridge('enterprise:module.action', { moduleId, id, action: a });
    const rec = (moduleId, id) => bridge('enterprise:module.get', { moduleId, id });
    const PO = 'procurement-orders';
    const PR = 'procurement-requests';
    const BASE = { poNumber: 'PO-S51-1', supplier: 'Acme', product: 'SKU-A', warehouse: 'WH-1', quantity: 10, unitCost: 5 };

    // ── S50 fence, packaged ──
    const po1 = await create(PO, BASE);
    assert(po1.ok === true, 'PO created (CRUD create — the certified PO create door)');
    const id1 = po1.record.id;

    const toReceived = await update(PO, id1, { ...BASE, status: 'received' });
    assert(toReceived.ok === false && /Receive Goods action/i.test(String((toReceived.errors || {}).status || '')),
      'NEGATIVE: hand-set draft→received REFUSED by the shipped S50 fence');
    assert(String((await rec(PO, id1)).fields.status) === 'draft', 'PO status unchanged after the refusal');

    const fake = await update(PO, id1, { ...BASE, convertedReceipt: 'gr_fake' });
    assert(fake.ok === false, 'NEGATIVE: fabricating convertedReceipt REFUSED (idempotency token immutable)');

    assert((await action(PO, id1, 'approve')).ok === true, 'PO approve ACTION works (fence does not touch actions)');
    const revert = await update(PO, id1, { ...BASE, status: 'draft' });
    assert(revert.ok === false && /cannot be silently reverted/i.test(String((revert.errors || {}).status || '')),
      'NEGATIVE: approved→draft reversal REFUSED by the shipped S50 fence');

    assert((await action(PO, id1, 'send')).ok === true, 'PO send ACTION works');
    assert((await action(PO, id1, 'receiveGoods')).ok === true, 'Receive Goods conversion works (raises the GR)');
    const received = await rec(PO, id1);
    assert(String(received.fields.status) === 'received' && String(received.fields.convertedReceipt || '') !== '',
      'PO is received with a stamped goods-receipt link');

    const leave = await update(PO, id1, { ...BASE, status: 'sent', convertedReceipt: received.fields.convertedReceipt });
    assert(leave.ok === false, 'NEGATIVE: leaving received via UPDATE refused');
    const clearTok = await update(PO, id1, { ...BASE, status: 'received', convertedReceipt: '' });
    assert(clearTok.ok === false, 'NEGATIVE: clearing convertedReceipt refused (double-receive re-arm blocked)');
    const again = await action(PO, id1, 'receiveGoods');
    assert(again.ok === false, 'CONTROL: a second Receive Goods stays refused — the token survived every probe');

    // recovery path present in the shipped bundle (no invented policy)
    const po2 = await create(PO, { ...BASE, poNumber: 'PO-S51-2' });
    assert((await action(PO, po2.record.id, 'cancel')).ok === true, 'PO cancel action works');
    const uncancel = await update(PO, po2.record.id, { ...BASE, poNumber: 'PO-S51-2', status: 'draft' });
    assert(uncancel.ok === true, 'POSITIVE: cancelled→draft recovery edit still SAVES (defined path shipped)');

    // ── governed procurement spine + idempotency, packaged ──
    const pr = await bridge('platform:command.dispatch', {
      operation: 'CreatePurchaseRequest', payload: { requestNumber: 'PR-S51-1' }, idempotencyKey: 'np-s51-pr-create',
    });
    assert(pr.ok === true && pr.data && pr.data.id, 'CreatePurchaseRequest dispatch ok (governed spine live in the artifact)');
    const submit = await bridge('platform:command.dispatch', {
      operation: 'SubmitPurchaseRequest', target: pr.data.id, payload: {}, idempotencyKey: 'np-s51-pr-submit',
    });
    assert(submit.ok === true, 'SubmitPurchaseRequest dispatch ok');
    const replay = await bridge('platform:command.dispatch', {
      operation: 'SubmitPurchaseRequest', target: pr.data.id, payload: {}, idempotencyKey: 'np-s51-pr-submit',
    });
    assert(replay.ok === true && replay.replayed === true, 'NEGATIVE: same-key re-dispatch REPLAYS (one transition, ever)');
    assert(String((await rec(PR, pr.data.id)).fields.status) === 'pending', 'PR is pending exactly once');

    // ── S46 origin fence (O2C governed keys), packaged ──
    const shipProbe = await action('sales-orders', 'so_nonexistent', 'ship');
    assert(shipProbe.ok === false && /governed command/i.test(String(shipProbe.error || shipProbe.message || '')),
      'NEGATIVE: legacy action door refuses the governed key BEFORE record resolution (origin fence live)');

    out('RESULT', 'ALL S51 PACKAGED GOVERNANCE NEGATIVES HELD');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 3000));
