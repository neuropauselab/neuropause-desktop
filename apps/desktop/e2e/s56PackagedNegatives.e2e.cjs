#!/usr/bin/env node
/**
 * ERP Session 56 — S55 FENCE ACCEPTANCE against the PACKAGED artifact.
 *
 * Same mechanism class as s51PackagedNegatives (drives only `window.neuropause.invoke`,
 * the door every renderer control uses; fixtures built through LEGITIMATE doors only —
 * no raw-store access exists in a packaged app, which is the point). Honest scope labels:
 * twelve of the fourteen S55 classes are DRIVEN LIVE end-to-end below; the journal
 * store-anchored half and payment bankReconciledAt need states only reachable through
 * flows this harness cannot legitimately mint (a posted balanced JE / a bank-reconciled
 * payment) — for those the INPUT-half refusal is driven live and the store-half is
 * covered by fence-presence bytes + the 13 source pins. Stated, not blurred.
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_DIR = path.resolve(__dirname, '..');
const ALT_MAIN = path.join(APP_DIR, 'out-seam-s45/main/index.js');
const APP_BIN = process.env.NP_APP_BIN || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S56 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S56 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }

async function main() {
  if (!APP_BIN && !fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN}`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s56-neg-'));
  const app = await electron.launch({
    ...(APP_BIN ? { executablePath: APP_BIN } : {}),
    args: [...(APP_BIN ? [] : [ALT_MAIN]), `--user-data-dir=${profile}`],
    env: { ...process.env, NP_E2E_BUILD: '', NEUROPAUSE_E2E: '', ELECTRON_RENDERER_URL: '', NODE_ENV: 'production' },
    timeout: 60_000,
  });
  try {
    const win = await app.firstWindow({ timeout: 45_000 });
    await sleep(APP_BIN ? 4000 : 2500);
    const bridge = (ch, payload) => win.evaluate(([c, p]) => window.neuropause.invoke(c, p), [ch, payload]);
    const create = (m, fields) => bridge('enterprise:module.create', { moduleId: m, fields });
    const update = (m, id, fields) => bridge('enterprise:module.update', { moduleId: m, id, fields });
    const act = (m, id, action) => bridge('enterprise:module.action', { moduleId: m, id, action });
    const rec = (m, id) => bridge('enterprise:module.get', { moduleId: m, id });

    // ── A · JOURNAL (input-half live; store-half = presence + source pins) ──
    const JE_LINES = '[{"account":"1000","debit":100,"credit":0},{"account":"4000","debit":0,"credit":100}]';
    const je = await create('finance-journal-entries', { entryNumber: 'JE-S56', memo: 'draft', lines: JE_LINES });
    assert(je.ok === true, `A: draft journal entry created${je.ok ? '' : ' — ' + JSON.stringify(je.errors)}`);
    const jeForge = await update('finance-journal-entries', je.record.id, { entryNumber: 'JE-S56', memo: 'forged', lines: JE_LINES, postedAt: '2026-09-03T00:00:00.000Z' });
    assert(jeForge.ok === false && /immutable/i.test(String((jeForge.errors || {})._ || '')),
      'A: forging postedAt onto a journal entry REFUSED (guard live in the artifact)');

    // ── B · ACCOUNTING PERIOD (full store-anchored circle: close → edit-clear refused → reopen works) ──
    const pd = await create('finance-periods', { periodKey: '2026-07' });
    assert(pd.ok === true, 'B: accounting period created');
    assert((await act('finance-periods', pd.record.id, 'close')).ok === true, 'B: period CLOSED via the canonical action');
    const pdClear = await update('finance-periods', pd.record.id, { periodKey: '2026-07', closedAt: '' });
    assert(pdClear.ok === false, 'B: NEGATIVE — clearing closedAt via edit REFUSED (edit-door reopen blocked)');
    assert(String((await rec('finance-periods', pd.record.id)).fields.closedAt) !== '', 'B: stored closedAt survived the attack');
    assert((await act('finance-periods', pd.record.id, 'reopen')).ok === true, 'B: canonical reopen action still works (no over-fence)');

    // ── D · VENDOR BILL markers ──
    const vb = await create('finance-vendor-bills', { billNumber: 'VB-S56', vendor: 'Acme', amount: 100 });
    assert(vb.ok === true, 'D: draft vendor bill created');
    const vbForge = await update('finance-vendor-bills', vb.record.id, { billNumber: 'VB-S56', vendor: 'Acme', amount: 100, approvedAt: '2026-09-03T00:00:00.000Z' });
    assert(vbForge.ok === false, 'D: NEGATIVE — hand-setting approvedAt REFUSED (markers action-owned)');
    const vbPaid = await update('finance-vendor-bills', vb.record.id, { billNumber: 'VB-S56', vendor: 'Acme', amount: 100, paidDate: '2026-09-03' });
    assert(vbPaid.ok === false, 'D: NEGATIVE — faking paidDate REFUSED');
    const vbFine = await update('finance-vendor-bills', vb.record.id, { billNumber: 'VB-S56', vendor: 'Acme Industrial', amount: 120 });
    assert(vbFine.ok === true, 'D: a normal draft edit still SAVES (no lockout)');

    // ── E · SALES ORDER tokens ──
    const so = await create('sales-orders', { orderNumber: 'SO-S56', customer: 'C', product: 'SKU-A', quantity: 1, unitPrice: 5 });
    assert(so.ok === true, 'E: sales order created');
    const soTok = await update('sales-orders', so.record.id, { orderNumber: 'SO-S56', customer: 'C', product: 'SKU-A', quantity: 1, unitPrice: 5, convertedInvoice: 'inv_fake' });
    assert(soTok.ok === false, 'E: NEGATIVE — fabricating convertedInvoice REFUSED (duplicate-invoice re-arm blocked)');
    const soPick = await update('sales-orders', so.record.id, { orderNumber: 'SO-S56', customer: 'C', product: 'SKU-A', quantity: 1, unitPrice: 5, pickList: 'pl_fake' });
    assert(soPick.ok === false, 'E: NEGATIVE — fabricating pickList REFUSED');

    // ── F · QUOTE conversion state + token ──
    const qt = await create('sales-quotes', { quoteNumber: 'Q-S56', customer: 'C', subtotal: 100 });
    assert(qt.ok === true, 'F: quote created');
    const qtConv = await update('sales-quotes', qt.record.id, { quoteNumber: 'Q-S56', customer: 'C', subtotal: 100, status: 'converted' });
    assert(qtConv.ok === false, 'F: NEGATIVE — hand-setting status=converted REFUSED');
    const qtTok = await update('sales-quotes', qt.record.id, { quoteNumber: 'Q-S56', customer: 'C', subtotal: 100, convertedOrder: 'so_fake' });
    assert(qtTok.ok === false, 'F: NEGATIVE — fabricating convertedOrder REFUSED');
    const qtSend = await update('sales-quotes', qt.record.id, { quoteNumber: 'Q-S56', customer: 'C', subtotal: 100, status: 'sent' });
    assert(qtSend.ok === true, 'F: draft→sent edit stays FREE (no over-fence)');

    // ── G+L · GOODS RECEIPT: received-row freeze + cancelled-PO eligibility ──
    const gr = await create('procurement-receipts', { grNumber: 'GR-S56', supplier: 'Acme', product: 'SKU-A', warehouse: 'WH-1', quantityOrdered: 5, quantityReceived: 5 });
    assert(gr.ok === true, 'G: goods receipt created (PO-less, the defined flow)');
    assert((await act('procurement-receipts', gr.record.id, 'post')).ok === true, 'G: PO-less receipt POSTS (defined flow preserved — no over-fence)');
    const grSup = await update('procurement-receipts', gr.record.id, { grNumber: 'GR-S56', supplier: 'Somebody Else', product: 'SKU-A', warehouse: 'WH-1', quantityOrdered: 5, quantityReceived: 5, status: 'received' });
    assert(grSup.ok === false, 'G: NEGATIVE — changing supplier on a RECEIVED receipt REFUSED (scorecard key frozen)');
    const grPO = await update('procurement-receipts', gr.record.id, { grNumber: 'GR-S56', supplier: 'Acme', product: 'SKU-A', warehouse: 'WH-1', quantityOrdered: 5, quantityReceived: 5, status: 'received', purchaseOrder: 'po_fake' });
    assert(grPO.ok === false, 'G: NEGATIVE — changing purchaseOrder on a RECEIVED receipt REFUSED (invariant input frozen)');
    const po = await create('procurement-orders', { poNumber: 'PO-S56', supplier: 'Acme', product: 'SKU-A', warehouse: 'WH-1', quantity: 5, unitCost: 2 });
    assert((await act('procurement-orders', po.record.id, 'cancel')).ok === true, 'L: PO cancelled via the canonical action');
    const gr2 = await create('procurement-receipts', { grNumber: 'GR-S56b', supplier: 'Acme', product: 'SKU-A', warehouse: 'WH-1', quantityOrdered: 5, quantityReceived: 5, purchaseOrder: po.record.id });
    const grPost = await act('procurement-receipts', gr2.record.id, 'post');
    assert(grPost.ok === false && /cancelled/i.test(String(grPost.message || '')),
      'L: NEGATIVE — posting a receipt against a CANCELLED PO REFUSED');

    // ── H · SHIPPING ──
    const sh = await create('warehouse-shipping', { shipmentNumber: 'SH-S56', product: 'SKU-A', warehouse: 'WH-1', quantity: 1 });
    assert(sh.ok === true, 'H: shipment created (pending)');
    const shFake = await update('warehouse-shipping', sh.record.id, { shipmentNumber: 'SH-S56', product: 'SKU-A', warehouse: 'WH-1', quantity: 1, status: 'shipped' });
    assert(shFake.ok === false, 'H: NEGATIVE — hand-setting shipped REFUSED (no faked shipments)');
    const shCancel = await update('warehouse-shipping', sh.record.id, { shipmentNumber: 'SH-S56', product: 'SKU-A', warehouse: 'WH-1', quantity: 1, status: 'cancelled' });
    assert(shCancel.ok === true, 'H: pending→cancelled edit stays FREE (no over-fence)');

    // ── I · MULTI-LINE DISPATCH ──
    const md = await create('sales-multiline-dispatches', { dispatchNumber: 'MD-S56', warehouse: 'WH-1', lines: '[{"sku":"SKU-A","quantity":1}]' });
    const mdFake = await update('sales-multiline-dispatches', md.record.id, { dispatchNumber: 'MD-S56', warehouse: 'WH-1', lines: '[{"sku":"SKU-A","quantity":1}]', status: 'dispatched' });
    assert(mdFake.ok === false, 'I: NEGATIVE — hand-setting dispatched REFUSED');

    // ── J · MULTI-LINE RECEIPT ──
    const mr = await create('procurement-multiline-receipts', { receiptNumber: 'MR-S56', warehouse: 'WH-1', lines: '[{"sku":"SKU-A","quantity":1}]' });
    const mrFake = await update('procurement-multiline-receipts', mr.record.id, { receiptNumber: 'MR-S56', warehouse: 'WH-1', lines: '[{"sku":"SKU-A","quantity":1}]', status: 'received' });
    assert(mrFake.ok === false, 'J: NEGATIVE — hand-setting received REFUSED');

    // ── K · STOCK LEDGER ──
    const mv = await create('inventory-movements', { movementNumber: 'MV-S56', type: 'receive', product: 'SKU-A', warehouse: 'WH-1', quantity: 10, unitCost: 5, status: 'posted' });
    assert(mv.ok === true, 'K: posted movement created (create door is the defined mint path)');
    const mvEdit = await update('inventory-movements', mv.record.id, { movementNumber: 'MV-S56', type: 'receive', product: 'SKU-A', warehouse: 'WH-1', quantity: 99, unitCost: 5, status: 'posted' });
    assert(mvEdit.ok === false, 'K: NEGATIVE — rewriting a posted movement quantity REFUSED (ledger immutable)');
    const mvVoid = await update('inventory-movements', mv.record.id, { movementNumber: 'MV-S56', type: 'receive', product: 'SKU-A', warehouse: 'WH-1', quantity: 10, unitCost: 5, status: 'void' });
    assert(mvVoid.ok === true, 'K: posted→void still ALLOWED (the canonical correction path — no over-fence)');
    const mvBack = await update('inventory-movements', mv.record.id, { movementNumber: 'MV-S56', type: 'receive', product: 'SKU-A', warehouse: 'WH-1', quantity: 10, unitCost: 5, status: 'posted' });
    assert(mvBack.ok === false, 'K: NEGATIVE — un-voiding REFUSED (void is terminal)');

    // ── M · ONE DELETE DOOR ──
    const del = await bridge('enterprise:module.setStatus', { moduleId: 'sales-orders', id: so.record.id, status: 'deleted' });
    assert(del.ok === false && /Delete door/i.test(String((del.errors || {})._ || '')),
      "M: NEGATIVE — SetStatus-'deleted' REFUSED (one delete door)");
    const arch = await bridge('enterprise:module.setStatus', { moduleId: 'sales-orders', id: so.record.id, status: 'archived' });
    assert(arch.ok === true, 'M: SetStatus-archived still works (no over-fence)');

    out('SCOPE', 'C (bankReconciledAt) + journal STORE-half: not live-drivable through legitimate packaged doors — covered by fence-presence bytes + the 13 source pins (stated, not blurred)');
    out('RESULT', 'ALL DRIVABLE S55 FENCES HELD IN THE PACKAGED ARTIFACT');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 3000));
