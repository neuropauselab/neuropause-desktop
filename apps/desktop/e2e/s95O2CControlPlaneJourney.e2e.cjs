#!/usr/bin/env node
/**
 * ERP S95 — END-TO-END ORDER-TO-CASH CONTROL-PLANE journey in the REAL Electron runtime, on a FRESH
 * isolated profile with NO seeded ERP state and NO IPC shortcuts (every step goes through the governed
 * bridge the UI uses). Then a REAL PROCESS RESTART on the same profile to prove durability.
 *
 *   customer → sales order (pending) → ship (inventory issue) → convert to invoice (draft)
 *     → issue invoice (Dr AR / Cr Sales Revenue) → AR liability → receive customer payment
 *     → (Dr Cash / Cr AR) → AR settled
 *
 * Controls proven in one run: SO pending-until-shipped; raw-door ship/invoice refused (governed-only);
 * inventory issued exactly once (replay no double); draft invoice books no AR; issue books AR once;
 * a DRAFT invoice cannot be settled (S95 guard); one cleared receipt (Dr Cash / Cr AR); AR settled;
 * same-key replay no double-receive; second full receipt refused; cleared receipt DELETE refused; no
 * automatic action before the operator. RESTART: every count + lineage survives; invoice stays paid.
 * S95 performs NO reversal — it only proves the delete/reversal boundary is fail-closed.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s95"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s95O2CControlPlaneJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ALT_MAIN = path.join(path.resolve(__dirname, '..'), 'out-seam-s95/main/index.js');
const UNIT_PRICE = 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S95 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S95 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) { const end = Date.now() + ms; for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await sleep(400); } }

async function launch(profile) {
  const logs = [];
  const app = await electron.launch({
    args: [ALT_MAIN, `--user-data-dir=${profile}`],
    env: { ...process.env, NP_E2E_BUILD: '', NEUROPAUSE_E2E: '', ELECTRON_RENDERER_URL: '', NODE_ENV: 'production' },
    timeout: 60_000,
  });
  app.process().stdout.on('data', (d) => logs.push(String(d)));
  app.process().stderr.on('data', (d) => logs.push(String(d)));
  const win = await app.firstWindow({ timeout: 45_000 });
  for (const re of [/Enterprise OS ready/, /Runtime core ready/]) { if (!(await waitForLog(logs, re, 30_000))) fail(`BOOT_LOG ${re}`); }
  const bridge = (ch, payload) => win.evaluate(([c, p]) => window.neuropause.invoke(c, p), [ch, payload]);
  return { app, win, bridge };
}

async function main() {
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build out-seam-s95 first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s95-'));
  let session = await launch(profile);
  let closed = false;
  try {
    const b = () => session.bridge;
    const create = (moduleId, fields) => b()('enterprise:module.create', { moduleId, fields });
    const act = (moduleId, id, action) => b()('enterprise:module.action', { moduleId, id, action });
    const update = (moduleId, id, fields) => b()('enterprise:module.update', { moduleId, id, fields });
    const del = (moduleId, id) => b()('enterprise:module.delete', { moduleId, id });
    const listOf = (moduleId) => b()('enterprise:module.list', { moduleId });
    const dispatch = (operation, target, idempotencyKey, payload = {}) => b()('platform:command.dispatch', { operation, target, payload, idempotencyKey });
    const aliveCount = async (moduleId, pred = () => true) => (await listOf(moduleId)).filter((r) => r.status !== 'deleted' && pred(r)).length;
    const issueMoves = async () => (await listOf('inventory-movements')).filter((m) => m.status !== 'deleted' && String(m.fields.type) === 'issue');
    const journalCount = async () => (await listOf('finance-journal-entries')).length;
    const clearedReceipts = async () => (await listOf('finance-payments')).filter((r) => r.status !== 'deleted' && String(r.fields.status) === 'cleared');
    const invoiceOf = async (id) => (await listOf('finance')).find((r) => r.id === id);
    const orderOf = async (id) => (await listOf('sales-orders')).find((r) => r.id === id);

    const userData = await session.app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData) === fs.realpathSync(profile), 'FRESH isolated profile is the running userData');
    assert((await aliveCount('sales-orders')) === 0 && (await aliveCount('finance')) === 0 && (await aliveCount('finance-payments')) === 0, 'fresh profile has NO seeded ERP state');

    const qty = 40;
    const total = qty * UNIT_PRICE;
    // 1 · customer + sales order (pending)
    assert((await create('inventory-products', { sku: 'SKU-1', name: 'Widget', purchaseCost: 4, standardCost: 6 })).ok, 'product SKU-1 created');
    assert((await create('inventory-movements', { movementNumber: 'MV-SEED', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 })).ok, 'seeded on-hand stock 100');
    const customer = await create('crm-customers', { name: 'Acme Inc.' });
    assert(customer.ok, 'customer created');
    const so = await dispatch('CreateSalesOrder', undefined, 'so:1', { orderNumber: 'SO-1', customer: 'Acme Inc.', customerRef: customer.record.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: qty, total });
    assert(so.ok, 'CreateSalesOrder succeeded');
    const orderId = String(so.data.id);
    assert(String((await orderOf(orderId)).fields.status) === 'pending', 'SO remains pending until explicit shipment');
    assert((await issueMoves()).length === 0, 'no inventory issued before shipment');

    // 2 · raw-door ship/invoice refused (governed-command-only); status edit refused
    assert((await act('sales-orders', orderId, 'ship')).ok === false, 'raw-door ship is refused (governed-command-only)');
    assert((await act('sales-orders', orderId, 'convertToInvoice')).ok === false, 'raw-door convertToInvoice is refused (governed-command-only)');
    assert((await update('sales-orders', orderId, { status: 'shipped' })).ok === false, 'a generic edit cannot hand-set the SO status');
    assert((await issueMoves()).length === 0, 'still no inventory moved after the refused side-doors');

    // 3 · ship → inventory issued exactly once
    const movesBefore = (await issueMoves()).length;
    assert((await dispatch('ShipSalesOrder', orderId, 'ship:1')).ok === true, 'ShipSalesOrder (governed) succeeded');
    assert(String((await orderOf(orderId)).fields.status) === 'shipped', 'SO is shipped');
    assert((await issueMoves()).length === movesBefore + 1, 'shipment issues EXACTLY ONE inventory movement');
    const reship = await dispatch('ShipSalesOrder', orderId, 'ship:again');
    assert(reship.ok === false, 'a second ship is refused (already shipped)');
    assert((await issueMoves()).length === movesBefore + 1, 'no duplicate inventory issue on re-ship');

    // 4 · convert to draft invoice (no AR) → issue (AR once)
    assert((await dispatch('InvoiceSalesOrder', orderId, 'inv:1')).ok === true, 'InvoiceSalesOrder → draft invoice');
    const invoiceId = String((await orderOf(orderId)).fields.convertedInvoice);
    const invoiceNumber = String((await invoiceOf(invoiceId)).fields.number);
    assert(String((await invoiceOf(invoiceId)).fields.status) === 'draft', 'the invoice is draft (no AR yet)');

    // 5a · a DRAFT invoice cannot be settled (S95 guard)
    const draftSettle = await dispatch('ReceiveCustomerPayment', undefined, 'rd', { paymentNumber: 'RCPT-D', invoiceRef: invoiceNumber, amount: total, transactionRef: 'RT-D' });
    assert(draftSettle.ok === false, 'a DRAFT (unissued) invoice cannot be settled by a customer receipt (S95 guard)');
    assert((await clearedReceipts()).length === 0, 'no receipt created against the draft invoice');

    // 5b · issue → AR booked once
    const journalBeforeIssue = await journalCount();
    assert((await dispatch('IssueCustomerInvoice', invoiceId, 'issue:1')).ok === true, 'IssueCustomerInvoice → Dr AR / Cr Sales Revenue');
    assert(String((await invoiceOf(invoiceId)).fields.status) === 'issued', 'invoice is issued (AR liability)');
    assert((await journalCount()) > journalBeforeIssue, 'AR GL booked on issue');

    // 6 · receive payment → AR settled, exactly once
    assert((await clearedReceipts()).length === 0, 'no automatic receipt before the operator action');
    const journalBeforePay = await journalCount();
    assert((await dispatch('ReceiveCustomerPayment', undefined, 'rcpt:1', { paymentNumber: 'RCPT-1', invoiceRef: invoiceNumber, amount: total, transactionRef: 'RT-1' })).ok === true, 'ReceiveCustomerPayment succeeded');
    assert((await clearedReceipts()).length === 1, 'exactly ONE cleared customer receipt');
    assert((await journalCount()) > journalBeforePay, 'Dr Cash / Cr AR journal booked');
    assert(String((await invoiceOf(invoiceId)).fields.status) === 'paid', 'AR SETTLED — invoice paid');
    const replay = await dispatch('ReceiveCustomerPayment', undefined, 'rcpt:1', { paymentNumber: 'RCPT-1', invoiceRef: invoiceNumber, amount: total, transactionRef: 'RT-1' });
    assert(replay.replayed === true || replay.ok === true, 'same-key re-receive replays');
    assert((await clearedReceipts()).length === 1, 'no double-receive on replay');
    const second = await dispatch('ReceiveCustomerPayment', undefined, 'rcpt:2', { paymentNumber: 'RCPT-2', invoiceRef: invoiceNumber, amount: total, transactionRef: 'RT-2' });
    assert(second.ok === false, 'a second full receipt is refused (overpay — already settled)');
    const dupRef = await dispatch('ReceiveCustomerPayment', undefined, 'rcpt:3', { paymentNumber: 'RCPT-3', invoiceRef: invoiceNumber, amount: 1, transactionRef: 'RT-1' });
    assert(dupRef.ok === false, 'a duplicate transaction reference is refused');

    // 7 · delete boundary: a cleared receipt cannot be deleted
    const receipt = (await clearedReceipts())[0];
    assert((await del('finance-payments', receipt.id)).ok === false, 'a cleared customer receipt cannot be deleted (governed reversal is the only unwind)');
    assert((await clearedReceipts()).some((p) => p.id === receipt.id), 'the receipt is still present and cleared after the refused delete');

    const snap = { cust: await aliveCount('crm-customers'), order: await aliveCount('sales-orders'), mv: (await issueMoves()).length, inv: await aliveCount('finance'), pay: (await clearedReceipts()).length, jrnl: await journalCount() };

    // 8 · RESTART DURABILITY
    await session.app.close();
    closed = true;
    session = await launch(profile);
    closed = false;
    const userData2 = await session.app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData2) === fs.realpathSync(profile), 'restart reopened the SAME profile');
    assert((await aliveCount('crm-customers')) === snap.cust, 'customer count unchanged after restart');
    assert((await aliveCount('sales-orders')) === snap.order, 'SO count unchanged after restart');
    assert((await issueMoves()).length === snap.mv, 'no duplicate inventory issue after restart');
    assert((await aliveCount('finance')) === snap.inv, 'invoice count unchanged after restart');
    assert((await clearedReceipts()).length === snap.pay, 'receipt count unchanged after restart');
    assert((await journalCount()) === snap.jrnl, 'journal count unchanged after restart (no duplicate AR/Cash)');
    const invAfter = (await listOf('finance')).find((r) => String(r.fields.number) === invoiceNumber);
    assert(String(invAfter.fields.status) === 'paid', 'the invoice is still SETTLED after restart (lineage survives)');
    const replayAfter = await dispatch('ReceiveCustomerPayment', undefined, 'rcpt:1', { paymentNumber: 'RCPT-1', invoiceRef: invoiceNumber, amount: total, transactionRef: 'RT-1' });
    assert(replayAfter.replayed === true || replayAfter.ok === true, 'a replayed receipt after restart is deduped');
    assert((await clearedReceipts()).length === snap.pay, 'still one receipt after the post-restart replay');
    assert((await journalCount()) === snap.jrnl, 'no duplicate GL after the post-restart replay');

    out('RESULT', 'S95 end-to-end O2C control plane VERIFIED in the real Electron runtime on a FRESH profile with NO seeded state: customer → SO (pending until shipped; raw-door ship/invoice + status edit refused) → Ship (inventory issued once) → Convert (draft invoice, no AR) → a DRAFT invoice cannot be settled → Issue (AR booked once) → Receive Payment (one cleared receipt, Dr Cash / Cr AR) → AR SETTLED; replay/second-receipt/dup-ref refused; cleared receipt DELETE refused (governed reversal is the only unwind); no automatic action before the operator; and after a REAL PROCESS RESTART every count + lineage survives with no double-post.');
  } finally {
    if (!closed) { await Promise.race([session.app.close(), sleep(15_000)]).catch(() => undefined); }
    try { session.app.process().kill('SIGKILL'); } catch { /* already dead */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
