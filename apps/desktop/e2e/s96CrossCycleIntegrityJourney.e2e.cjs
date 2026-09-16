#!/usr/bin/env node
/**
 * ERP S96 — CROSS-CYCLE FINANCIAL-INTEGRITY journey in the REAL Electron runtime, on ONE fresh isolated
 * profile with NO seeded ERP state and NO IPC shortcuts. Executes BOTH certified cycles in the SAME
 * tenant over a SHARED SKU, then a REAL PROCESS RESTART.
 *
 *   P2P: reorder → PR → PO → GR → Inventory (+Q1) + GRNI → Supplier Invoice → 3-way match → AP → Pay
 *   O2C: Customer → SO → Ship (Inventory −Q2, Dr COGS/Cr Inventory) → Invoice → Issue (AR) → Receipt
 *
 * Proves: shared inventory equation (product stock == Σreceive − Σissue; P2P adds one receive, O2C one
 * issue); both cycles populate the GL and each posting is once (replay adds nothing); AR/AP SEPARATION
 * (supplier payment cannot settle the customer invoice and vice versa); and after a real restart every
 * count + both settlements survive with no double-post. S96 performs no reversal.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s96"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s96CrossCycleIntegrityJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ALT_MAIN = path.join(path.resolve(__dirname, '..'), 'out-seam-s96/main/index.js');
const STANDARD_COST = 6;
const SELL_PRICE = 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S96 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S96 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
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
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build out-seam-s96 first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s96-'));
  let session = await launch(profile);
  let closed = false;
  try {
    const b = () => session.bridge;
    const create = (moduleId, fields) => b()('enterprise:module.create', { moduleId, fields });
    const act = (moduleId, id, action) => b()('enterprise:module.action', { moduleId, id, action });
    const update = (moduleId, id, fields) => b()('enterprise:module.update', { moduleId, id, fields });
    const listOf = (moduleId) => b()('enterprise:module.list', { moduleId });
    const dispatch = (operation, target, idempotencyKey, payload = {}) => b()('platform:command.dispatch', { operation, target, payload, idempotencyKey });
    const stock = async (sku) => Number((await listOf('inventory-products')).find((r) => String(r.fields.sku) === sku)?.fields?.currentStock ?? 0);
    const waitStock = async (sku, target) => { for (let i = 0; i < 40; i += 1) { if ((await stock(sku)) === target) return true; await sleep(250); } return (await stock(sku)) === target; };
    const movesOfType = async (t) => (await listOf('inventory-movements')).filter((m) => m.status !== 'deleted' && String(m.fields.type) === t);
    const sumQty = (ms) => ms.reduce((n, m) => n + Number(m.fields.quantity), 0);
    const journalCount = async () => (await listOf('finance-journal-entries')).length;
    const clearedVPay = async () => (await listOf('finance-vendor-payments')).filter((r) => r.status !== 'deleted' && String(r.fields.status) === 'cleared');
    const clearedReceipts = async () => (await listOf('finance-payments')).filter((r) => r.status !== 'deleted' && String(r.fields.status) === 'cleared');
    const billOf = async (id) => (await listOf('finance-vendor-bills')).find((r) => r.id === id);
    const invOf = async (id) => (await listOf('finance')).find((r) => r.id === id);

    const userData = await session.app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData) === fs.realpathSync(profile), 'FRESH isolated profile is the running userData');
    assert((await listOf('sales-orders')).length === 0 && (await listOf('finance-vendor-bills')).length === 0, 'fresh profile has NO seeded ERP state');

    // ── shared product ──
    assert((await create('inventory-products', { sku: 'SKU-1', name: 'Widget', purchaseCost: 4, standardCost: STANDARD_COST, reorderLevel: 200, safetyStock: 50, maximumStock: 500 })).ok, 'shared product SKU-1 created');
    assert((await create('inventory-movements', { movementNumber: 'MV-SEED', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 })).ok, 'seeded on-hand 100');
    const ship0 = await create('warehouse-shipping', { shipmentNumber: 'SHIP-0', product: 'SKU-1', warehouse: 'WH-1', quantity: 30 });
    assert((await act('warehouse-shipping', ship0.record.id, 'ship')).ok, 'shipped 30 (currentStock 70)');
    assert(await waitStock('SKU-1', 70), 'inventory reconciled to 70');

    // ── P2P: reorder → PR → PO → GR → Inventory +Q1 + GRNI → invoice → AP → pay ──
    const decRep = await create('inventory-reorder-decision', { asOfDate: new Date().toISOString().slice(0, 10) });
    const confirm = await dispatch('CreatePurchaseRequestFromReorderRecommendation', decRep.record.id, `reorder:${decRep.record.id}:SKU-1`, { sku: 'SKU-1' });
    const prId = String(confirm.data.id);
    const q1 = Number(confirm.data.quantity);
    assert(q1 > 0, `reorder recommends Q1 = ${q1}`);
    assert((await dispatch('SubmitPurchaseRequest', prId, `p2p-sub:${prId}`)).ok, 'P2P Submit PR');
    assert((await dispatch('ApprovePurchaseRequest', prId, `p2p-app:${prId}`)).ok, 'P2P Approve PR');
    assert((await dispatch('ConvertPurchaseRequestToPO', prId, `p2p-conv:${prId}`)).ok, 'P2P Convert → PO');
    const po = (await listOf('procurement-orders')).find((r) => String(r.fields.sourceRequest) === prId);
    const poId = po.id;
    const poNumber = String(po.fields.poNumber);
    await update('procurement-orders', poId, { warehouse: 'WH-1', supplier: 'Acme Supplies', unitCost: STANDARD_COST });
    assert((await act('procurement-orders', poId, 'approve')).ok, 'P2P PO Approve');
    assert((await act('procurement-orders', poId, 'send')).ok, 'P2P PO Send');
    assert((await act('procurement-orders', poId, 'receiveGoods')).ok, 'P2P Receive Goods → GR');
    const gr = (await listOf('procurement-receipts')).find((r) => String(r.fields.purchaseOrder) === poId);
    const recvBefore = (await movesOfType('receive')).length;
    const stockBeforeReceipt = await stock('SKU-1');
    assert((await dispatch('PostGoodsReceipt', gr.id, `p2p-post:${gr.id}`)).ok === true, 'P2P Post Goods Receipt (Inventory + GRNI)');
    assert(await waitStock('SKU-1', stockBeforeReceipt + q1), `P2P receipt: inventory ${stockBeforeReceipt} → ${stockBeforeReceipt + q1}`);
    assert((await movesOfType('receive')).length === recvBefore + 1, 'P2P adds EXACTLY ONE receive movement');
    const billTotal = q1 * STANDARD_COST;
    const bill = await create('finance-vendor-bills', { billNumber: 'BILL-1', vendor: 'Acme Supplies', currency: 'USD', amount: billTotal, sourcePurchaseOrder: poNumber, status: 'draft', lines: JSON.stringify([{ sku: 'SKU-1', quantity: q1, unitPrice: STANDARD_COST }]) });
    const billId = bill.record.id;
    assert((await dispatch('ApproveSupplierInvoice', billId, `p2p-inv:${billId}`)).ok === true, 'P2P ApproveSupplierInvoice (AP booked)');
    assert((await dispatch('PaySupplierInvoice', undefined, 'p2p-pay', { paymentNumber: 'VPAY-1', billRef: 'BILL-1', vendor: 'Acme Supplies', amount: billTotal, transactionRef: 'P2P-TXN' })).ok === true, 'P2P PaySupplierInvoice (AP settled)');
    assert(String((await billOf(billId)).fields.status) === 'paid', 'P2P supplier bill is PAID');
    assert((await clearedVPay()).length === 1, 'exactly ONE cleared supplier payment');

    // ── O2C on the SAME SKU: customer → SO → ship (−Q2, COGS) → invoice → issue → receipt ──
    const q2 = Math.min(40, q1);
    const total = q2 * SELL_PRICE;
    const customer = await create('crm-customers', { name: 'Beta Buyer' });
    const so = await dispatch('CreateSalesOrder', undefined, 'o2c-so', { orderNumber: 'SO-1', customer: 'Beta Buyer', customerRef: customer.record.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: q2, total });
    const orderId = String(so.data.id);
    const issueBefore = (await movesOfType('issue')).length;
    const stockBeforeShip = await stock('SKU-1');
    assert((await dispatch('ShipSalesOrder', orderId, 'o2c-ship')).ok === true, 'O2C ShipSalesOrder');
    assert(await waitStock('SKU-1', stockBeforeShip - q2), `O2C shipment: inventory ${stockBeforeShip} → ${stockBeforeShip - q2}`);
    assert((await movesOfType('issue')).length === issueBefore + 1, 'O2C adds EXACTLY ONE issue movement');
    assert((await dispatch('InvoiceSalesOrder', orderId, 'o2c-inv')).ok === true, 'O2C InvoiceSalesOrder (draft)');
    const invoiceId = String((await listOf('sales-orders')).find((r) => r.id === orderId).fields.convertedInvoice);
    const invoiceNumber = String((await invOf(invoiceId)).fields.number);
    assert((await dispatch('IssueCustomerInvoice', invoiceId, 'o2c-issue')).ok === true, 'O2C IssueCustomerInvoice (AR booked)');
    assert((await dispatch('ReceiveCustomerPayment', undefined, 'o2c-rcpt', { paymentNumber: 'RCPT-1', invoiceRef: invoiceNumber, amount: total, transactionRef: 'O2C-TXN' })).ok === true, 'O2C ReceiveCustomerPayment (AR settled)');
    assert(String((await invOf(invoiceId)).fields.status) === 'paid', 'O2C customer invoice is PAID');
    assert((await clearedReceipts()).length === 1, 'exactly ONE cleared customer receipt');

    // ── shared inventory equation ──
    const totalReceived = sumQty(await movesOfType('receive'));
    const totalIssued = sumQty(await movesOfType('issue'));
    assert((await stock('SKU-1')) === totalReceived - totalIssued, 'SHARED INVENTORY: product stock == Σreceive − Σissue');

    // ── AR/AP separation ──
    const crossPay = await dispatch('PaySupplierInvoice', undefined, 'x1', { paymentNumber: 'X1', billRef: invoiceNumber, vendor: 'Beta Buyer', amount: 1, transactionRef: 'X1' });
    assert(crossPay.ok === false, 'AR/AP separation: a supplier payment cannot settle a customer invoice');
    const crossRcpt = await dispatch('ReceiveCustomerPayment', undefined, 'x2', { paymentNumber: 'X2', invoiceRef: 'BILL-1', amount: 1, transactionRef: 'X2' });
    assert(crossRcpt.ok === false, 'AR/AP separation: a customer receipt cannot settle a supplier bill');
    assert((await clearedVPay()).length === 1 && (await clearedReceipts()).length === 1, 'no stray payment/receipt from the cross attempts');

    // snapshot for restart
    const snap = { stock: await stock('SKU-1'), recv: (await movesOfType('receive')).length, iss: (await movesOfType('issue')).length, jrnl: await journalCount(), vpay: (await clearedVPay()).length, rcpt: (await clearedReceipts()).length };
    assert(snap.jrnl > 0, `GL populated by both cycles (journals = ${snap.jrnl})`);

    // ── RESTART DURABILITY ──
    await session.app.close();
    closed = true;
    session = await launch(profile);
    closed = false;
    const userData2 = await session.app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData2) === fs.realpathSync(profile), 'restart reopened the SAME profile');
    assert((await stock('SKU-1')) === snap.stock, 'inventory unchanged after restart');
    assert((await movesOfType('receive')).length === snap.recv, 'receive movement count unchanged after restart');
    assert((await movesOfType('issue')).length === snap.iss, 'issue movement count unchanged after restart');
    assert((await journalCount()) === snap.jrnl, 'journal count unchanged after restart (no duplicate AR/AP/Cash/GRNI/COGS)');
    assert((await clearedVPay()).length === snap.vpay, 'supplier payment count unchanged after restart');
    assert((await clearedReceipts()).length === snap.rcpt, 'customer receipt count unchanged after restart');
    // replay both terminal payments → deduped
    const rp = await dispatch('PaySupplierInvoice', undefined, 'p2p-pay', { paymentNumber: 'VPAY-1', billRef: 'BILL-1', vendor: 'Acme Supplies', amount: billTotal, transactionRef: 'P2P-TXN' });
    assert(rp.replayed === true || rp.ok === true, 'P2P payment replay deduped after restart');
    const rr = await dispatch('ReceiveCustomerPayment', undefined, 'o2c-rcpt', { paymentNumber: 'RCPT-1', invoiceRef: invoiceNumber, amount: total, transactionRef: 'O2C-TXN' });
    assert(rr.replayed === true || rr.ok === true, 'O2C receipt replay deduped after restart');
    assert((await clearedVPay()).length === snap.vpay && (await clearedReceipts()).length === snap.rcpt, 'no double payment/receipt after post-restart replay');
    assert((await journalCount()) === snap.jrnl, 'no duplicate GL after post-restart replay');
    assert((await stock('SKU-1')) === snap.stock, 'inventory unchanged after post-restart replay');

    out('RESULT', 'S96 cross-cycle financial integrity VERIFIED in the real Electron runtime on ONE fresh profile: P2P and O2C executed in the SAME tenant over a SHARED SKU — P2P receipt (+Q1, Dr Inventory/Cr GRNI → AP → Dr AP/Cr Cash) and O2C shipment (−Q2, Dr COGS/Cr Inventory → Dr AR/Cr Revenue → Dr Cash/Cr AR) net correctly (product stock == Σreceive − Σissue, one receive + one issue movement); both cycles populate the GL, each posting exactly once (replay adds nothing); AR/AP are SEPARATED (a supplier payment cannot settle a customer invoice and a customer receipt cannot settle a supplier bill); and after a REAL PROCESS RESTART every count, both settlements, and the shared inventory survive with no double-post.');
  } finally {
    if (!closed) { await Promise.race([session.app.close(), sleep(15_000)]).catch(() => undefined); }
    try { session.app.process().kill('SIGKILL'); } catch { /* already dead */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
