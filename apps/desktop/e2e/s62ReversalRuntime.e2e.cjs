#!/usr/bin/env node
/**
 * ERP Session 62 — GOVERNED PAYMENT REVERSAL in the REAL Electron runtime.
 *
 * Proves the S61 reversal capability, now LIVE via the FG-ERP-S61-REVERSAL-REGISTER
 * registration, in the production composition root (initEnterprise) — the one thing
 * the in-sandbox vitest suites (which build their own registry) cannot reach.
 *
 * Launches the ALTERNATE release build (out-seam-s62 — NEVER the armed out/, per the
 * NP-008 armed-build law; the o2cRuntime/journalRuntime precedent) on a FRESH throwaway
 * --user-data-dir and drives, exactly as UI controls do (`window.neuropause.invoke`):
 *
 *   CUSTOMER: CreateSalesOrder → ShipSalesOrder → InvoiceSalesOrder → IssueCustomerInvoice
 *     → ReceiveCustomerPayment (invoice PAID) → capture original payment
 *     → ReverseCustomerPayment → original UNCHANGED · reversal record exists · invoice RE-OPENS
 *     → replay (idempotent) · second reverse REFUSED (one-reversal rule)
 *     → DELETE cleared payment REFUSED (D6)
 *   VENDOR:   PO → approve → GR → post → bill → approve → PaySupplierInvoice (cleared)
 *     → capture original vendor payment → ReverseVendorPayment → original UNCHANGED · bill RE-OPENS
 *     → replay (idempotent)
 *   DURABLE:  platform-command-journal.json on disk carries CustomerPaymentReversed +
 *             VendorPaymentReversed (one each — no duplicate event on replay).
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s62"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s62ReversalRuntime.e2e.cjs
 * ZERO external effect: every mutation is a local ERP record inside the throwaway profile.
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_DIR = path.resolve(__dirname, '..');
const ALT_MAIN = path.join(APP_DIR, 'out-seam-s62/main/index.js');
const APP_BIN = process.env.NP_APP_BIN || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S62 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S62 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) {
  const end = Date.now() + ms;
  for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await sleep(400); }
}

async function main() {
  if (!APP_BIN && !fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build it first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s62-rev-'));
  const logs = [];
  const app = await electron.launch({
    ...(APP_BIN ? { executablePath: APP_BIN } : {}),
    args: [...(APP_BIN ? [] : [ALT_MAIN]), `--user-data-dir=${profile}`],
    env: { ...process.env, NP_E2E_BUILD: '', NEUROPAUSE_E2E: '', ELECTRON_RENDERER_URL: '', NODE_ENV: 'production' },
    timeout: 60_000,
  });
  app.process().stdout.on('data', (d) => logs.push(String(d)));
  app.process().stderr.on('data', (d) => logs.push(String(d)));
  try {
    const win = await app.firstWindow({ timeout: 45_000 });
    const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData) === fs.realpathSync(profile), 'ISOLATED profile is the running userData');
    if (!APP_BIN) {
      for (const re of [/Enterprise OS ready/, /Runtime core ready/]) {
        assert(await waitForLog(logs, re, 30_000), `BOOT_LOG ${re}`);
      }
    } else { await sleep(4000); }

    const bridge = (ch, payload) => win.evaluate(([c, p]) => window.neuropause.invoke(c, p), [ch, payload]);
    const dispatch = (operation, o = {}) =>
      bridge('platform:command.dispatch', {
        operation, ...(o.target ? { target: o.target } : {}), payload: o.payload ?? {},
        idempotencyKey: o.idem, ...(o.claimedTenantId ? { claimedTenantId: o.claimedTenantId } : {}),
      });
    const create = (moduleId, fields) => bridge('enterprise:module.create', { moduleId, fields });
    const act = (moduleId, id, action) => bridge('enterprise:module.action', { moduleId, id, action });
    const record = (moduleId, id) => bridge('enterprise:module.get', { moduleId, id });
    const del = (moduleId, id, force) => bridge('enterprise:module.delete', { moduleId, id, ...(force ? { force: true } : {}) });

    // ═══ CUSTOMER reversal journey ═══
    assert((await create('inventory-products', { sku: 'SKU-A', name: 'Widget', standardCost: 5 })).ok, 'seed product');
    assert((await create('inventory-movements', { movementNumber: 'MV-1', type: 'receive', product: 'SKU-A', warehouse: 'WH-1', quantity: 100 })).ok, 'seed on-hand stock');
    const so = await dispatch('CreateSalesOrder', { payload: { orderNumber: 'SO-REV-1', customer: 'Acme Inc.', product: 'SKU-A', warehouse: 'WH-1', orderedQty: 40, currency: 'USD', total: 900 }, idem: 'c-so' });
    assert(so.ok && so.data && so.data.id, 'CreateSalesOrder ok');
    assert((await dispatch('ShipSalesOrder', { target: so.data.id, idem: 'c-ship' })).ok, 'ShipSalesOrder ok');
    const inv = await dispatch('InvoiceSalesOrder', { target: so.data.id, idem: 'c-inv' });
    assert(inv.ok && inv.data.invoiceId, 'InvoiceSalesOrder ok');
    const invId = inv.data.invoiceId;
    assert((await dispatch('IssueCustomerInvoice', { target: invId, idem: 'c-iss' })).ok, 'IssueCustomerInvoice ok (Dr AR / Cr Revenue)');
    const pay = await dispatch('ReceiveCustomerPayment', { payload: { paymentNumber: 'PAY-REV-1', invoiceRef: invId, amount: 900, method: 'bank_transfer' }, idem: 'c-pay' });
    assert(pay.ok && pay.data.id, 'ReceiveCustomerPayment ok (cleared, Dr Cash / Cr AR)');
    const payId = pay.data.id;
    assert(String((await record('finance', invId)).fields.status) === 'paid', 'invoice PAID before reversal');
    const paySnapshot = JSON.stringify((await record('finance-payments', payId)).fields);

    const rev = await dispatch('ReverseCustomerPayment', { target: payId, payload: { reason: 'bounced cheque' }, idem: 'c-rev' });
    assert(rev.ok, 'ReverseCustomerPayment ok via live IPC');
    assert(JSON.stringify((await record('finance-payments', payId)).fields) === paySnapshot, 'ORIGINAL payment byte-identical after reversal (immutable)');
    const invAfter = await record('finance', invId);
    assert(String(invAfter.fields.status) === 'issued', 'invoice RE-OPENS to issued');
    assert(Number(invAfter.fields.amountPaid) === 0, 'invoice amountPaid back to 0 (receivable restored)');
    const revReplay = await dispatch('ReverseCustomerPayment', { target: payId, payload: { reason: 'bounced cheque' }, idem: 'c-rev' });
    assert(revReplay.ok && revReplay.replayed === true, 'same-key reversal REPLAYS (one reversal, ever)');
    const revAgain = await dispatch('ReverseCustomerPayment', { target: payId, payload: { reason: 'again' }, idem: 'c-rev2' });
    assert(revAgain.ok === false, 'second reversal of the same payment REFUSED (one-reversal rule)');
    const delPay = await del('finance-payments', payId, true);
    assert(delPay.ok === false, 'DELETE of a cleared payment REFUSED even with force (D6)');
    assert(String((await record('finance-payments', payId)).status) !== 'deleted', 'payment NOT deleted');

    // ═══ VENDOR reversal journey ═══
    const po = await create('procurement-orders', { poNumber: 'PO-REV', supplier: 'Globex', warehouse: 'WH-1', currency: 'USD', lines: JSON.stringify([{ sku: 'SKU-A', quantity: 16, unitPrice: 5 }]) });
    assert(po.ok, 'seed PO');
    assert((await act('procurement-orders', po.record.id, 'approve')).ok, 'PO approved');
    const gr = await create('procurement-receipts', { grNumber: 'GR-REV', purchaseOrder: po.record.id, supplier: 'Globex', product: 'SKU-A', warehouse: 'WH-1', quantityReceived: 16, lines: JSON.stringify([{ sku: 'SKU-A', quantity: 16, poLine: 1 }]) });
    assert(gr.ok, 'seed GR');
    assert((await act('procurement-receipts', gr.record.id, 'post')).ok, 'GR posted (Dr Inventory / Cr GRNI)');
    const bill = await create('finance-vendor-bills', { billNumber: 'BILL-REV', vendor: 'Globex', currency: 'USD', amount: 80, sourcePurchaseOrder: po.record.id, lines: JSON.stringify([{ sku: 'SKU-A', quantity: 16, unitPrice: 5 }]) });
    assert(bill.ok, 'seed vendor bill');
    assert((await act('finance-vendor-bills', bill.record.id, 'approve')).ok, 'bill approved (three-way match)');
    const vpay = await dispatch('PaySupplierInvoice', { payload: { paymentNumber: 'VPAY-REV', billRef: bill.record.id, amount: 80, method: 'bank_transfer' }, idem: 'v-pay' });
    assert(vpay.ok && vpay.data.id, 'PaySupplierInvoice ok (cleared, Dr AP / Cr Cash)');
    const vpayId = vpay.data.id;
    const vpaySnapshot = JSON.stringify((await record('finance-vendor-payments', vpayId)).fields);

    const vrev = await dispatch('ReverseVendorPayment', { target: vpayId, payload: { reason: 'duplicate payment' }, idem: 'v-rev' });
    assert(vrev.ok, 'ReverseVendorPayment ok via live IPC');
    assert(JSON.stringify((await record('finance-vendor-payments', vpayId)).fields) === vpaySnapshot, 'ORIGINAL vendor payment byte-identical after reversal (immutable)');
    const billAfter = await record('finance-vendor-bills', bill.record.id);
    assert(Number(billAfter.fields.amountPaid) === 0, 'bill amountPaid back to 0 (payable restored)');
    assert(String(billAfter.fields.status) === 'approved', 'bill RE-OPENS to approved');
    const vrevReplay = await dispatch('ReverseVendorPayment', { target: vpayId, payload: { reason: 'duplicate payment' }, idem: 'v-rev' });
    assert(vrevReplay.ok && vrevReplay.replayed === true, 'same-key vendor reversal REPLAYS (one reversal, ever)');
    const delVpay = await del('finance-vendor-payments', vpayId, true);
    assert(delVpay.ok === false, 'DELETE of a cleared vendor payment REFUSED even with force (D6)');

    // ═══ DURABLE journal — one reversal event each, no duplicate on replay ═══
    const journalPath = path.join(userData, 'platform-command-journal.json');
    assert(fs.existsSync(journalPath), 'durable platform-command-journal.json exists on disk');
    const text = fs.readFileSync(journalPath, 'utf8');
    for (const ev of ['CustomerPaymentReversed', 'VendorPaymentReversed']) {
      assert(text.includes(ev), `durable journal carries ${ev}`);
      const count = (text.match(new RegExp(ev, 'g')) || []).length;
      assert(count === 1, `exactly ONE ${ev} event (no duplicate on replay) — found ${count}`);
    }

    out('RESULT', 'GOVERNED PAYMENT REVERSAL (customer + vendor) VERIFIED in the real Electron runtime (alternate build, fresh profile) — original immutable, document re-opened, idempotent replay, D6 delete refused');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
