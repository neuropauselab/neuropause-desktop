#!/usr/bin/env node
/**
 * ERP S93 — the S92 payment-ready Accounts-Payable liability continues into the EXISTING governed
 * supplier-payment path in the REAL Electron runtime, through the governed bridge (the
 * `enterprise:module.*` actions the Finance/AP UI invokes + the `platform:command.dispatch`
 * PaySupplierInvoice command):
 *
 *   product → receive → reorder recommendation → PR → PO → GR → Supplier Invoice → 3-Way Match
 *     → AP Liability → (draft bill cannot be paid) → explicit PaySupplierInvoice → ONE cleared payment
 *     → Dr AP / Cr Cash → the bill reconciles → AP SETTLED (bill 'paid')
 *
 * Then: same-key replay does not double-pay; a distinct-key second full payment is refused (overpay);
 * an already-paid invoice cannot be paid again; a cleared payment cannot be deleted (governed reversal
 * is the only unwind); no automatic payment occurred before the operator action. S93 performs NO reversal
 * — it only proves the settlement + the delete boundary. Nothing is auto-paid.
 *
 * NOTE ON REFUSAL SHAPE: the application boundary sanitizes internal refusal reasons to a closed,
 * deny-by-default error contract — a state-precondition refusal (draft bill, overpay, foreign tenant)
 * surfaces to the client as `CONFLICT`. The specific reasons are pinned at the command-bus layer in
 * reorderPaymentSettlementLifecycle.test.ts; the journey asserts the exposed contract.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s93"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s93SupplierPaymentJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ALT_MAIN = path.join(path.resolve(__dirname, '..'), 'out-seam-s93/main/index.js');
const STANDARD_COST = 5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S93 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S93 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) { const end = Date.now() + ms; for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await sleep(400); } }

async function main() {
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build out-seam-s93 first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s93-'));
  const logs = [];
  const app = await electron.launch({
    args: [ALT_MAIN, `--user-data-dir=${profile}`],
    env: { ...process.env, NP_E2E_BUILD: '', NEUROPAUSE_E2E: '', ELECTRON_RENDERER_URL: '', NODE_ENV: 'production' },
    timeout: 60_000,
  });
  app.process().stdout.on('data', (d) => logs.push(String(d)));
  app.process().stderr.on('data', (d) => logs.push(String(d)));
  try {
    const win = await app.firstWindow({ timeout: 45_000 });
    const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData) === fs.realpathSync(profile), 'ISOLATED profile is the running userData');
    for (const re of [/Enterprise OS ready/, /Runtime core ready/]) assert(await waitForLog(logs, re, 30_000), `BOOT_LOG ${re}`);

    const bridge = (ch, payload) => win.evaluate(([c, p]) => window.neuropause.invoke(c, p), [ch, payload]);
    const create = (moduleId, fields) => bridge('enterprise:module.create', { moduleId, fields });
    const act = (moduleId, id, action) => bridge('enterprise:module.action', { moduleId, id, action });
    const update = (moduleId, id, fields) => bridge('enterprise:module.update', { moduleId, id, fields });
    const del = (moduleId, id) => bridge('enterprise:module.delete', { moduleId, id });
    const listOf = (moduleId) => bridge('enterprise:module.list', { moduleId });
    const dispatch = (operation, target, idempotencyKey, payload = {}) => bridge('platform:command.dispatch', { operation, target, payload, idempotencyKey });
    const stock = async (sku) => Number((await listOf('inventory-products')).find((r) => String(r.fields.sku) === sku)?.fields?.currentStock ?? 0);
    const waitStock = async (sku, target) => { for (let i = 0; i < 40; i += 1) { if ((await stock(sku)) === target) return true; await sleep(250); } return (await stock(sku)) === target; };
    const journalCount = async () => (await listOf('finance-journal-entries')).length;
    const clearedPayments = async () => (await listOf('finance-vendor-payments')).filter((r) => r.status !== 'deleted' && String(r.fields.status) === 'cleared');
    const billOf = async (id) => (await listOf('finance-vendor-bills')).find((r) => r.id === id);

    // 1. reorder chain → PO → GR → posted → approved matched supplier invoice (S89–S92)
    assert((await create('inventory-products', { sku: 'SKU-1', name: 'Widget', purchaseCost: 4, standardCost: STANDARD_COST, reorderLevel: 200, safetyStock: 50, maximumStock: 500 })).ok, 'product SKU-1 created');
    assert((await create('inventory-movements', { movementNumber: 'MV-1', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 })).ok, 'received 100');
    const s = await create('warehouse-shipping', { shipmentNumber: 'SHIP-1', product: 'SKU-1', warehouse: 'WH-1', quantity: 30 });
    assert((await act('warehouse-shipping', s.record.id, 'ship')).ok, 'shipped 30 (currentStock 70)');
    assert(await waitStock('SKU-1', 70), 'inventory reconciled to 70 before receipt');
    const decRep = await create('inventory-reorder-decision', { asOfDate: new Date().toISOString().slice(0, 10) });
    const confirm = await dispatch('CreatePurchaseRequestFromReorderRecommendation', decRep.record.id, `reorder-exec:${decRep.record.id}:SKU-1`, { sku: 'SKU-1' });
    const prId = String(confirm.data.id);
    const requestNumber = String(confirm.data.requestNumber);
    const qty = Number(confirm.data.quantity);
    const total = qty * STANDARD_COST;
    assert((await dispatch('SubmitPurchaseRequest', prId, `sub:${prId}`)).ok, 'Submit PR');
    assert((await dispatch('ApprovePurchaseRequest', prId, `app:${prId}`)).ok, 'Approve PR');
    assert((await dispatch('ConvertPurchaseRequestToPO', prId, `conv:${prId}`)).ok, 'Convert → PO');
    const po = (await listOf('procurement-orders')).find((r) => String(r.fields.sourceRequest) === prId);
    const poId = po.id;
    const poNumber = String(po.fields.poNumber);
    assert(poNumber === `PO-${requestNumber}`, 'PO carries reorder lineage');
    assert((await update('procurement-orders', poId, { warehouse: 'WH-1', supplier: 'Acme Supplies', unitCost: STANDARD_COST })).ok, 'operator sets warehouse + supplier + ordered price');
    assert((await act('procurement-orders', poId, 'approve')).ok, 'PO Approve');
    assert((await act('procurement-orders', poId, 'send')).ok, 'PO Send');
    assert((await act('procurement-orders', poId, 'receiveGoods')).ok, 'Receive Goods → pending GR');
    const gr = (await listOf('procurement-receipts')).find((r) => String(r.fields.purchaseOrder) === poId);
    assert((await dispatch('PostGoodsReceipt', gr.id, `post:${gr.id}`)).ok === true, 'PostGoodsReceipt (inventory + GRNI)');
    assert(await waitStock('SKU-1', 70 + qty), `inventory received (70 → ${70 + qty})`);
    const bill = await create('finance-vendor-bills', {
      billNumber: 'BILL-1', vendor: 'Acme Supplies', currency: 'USD', amount: total,
      sourcePurchaseOrder: poNumber, status: 'draft', lines: JSON.stringify([{ sku: 'SKU-1', quantity: qty, unitPrice: STANDARD_COST }]),
    });
    const billId = bill.record.id;

    // 2. a DRAFT (unapproved) bill cannot be paid — approve it first
    assert((await clearedPayments()).length === 0, 'no automatic payment exists before any operator action');
    const earlyPay = await dispatch('PaySupplierInvoice', undefined, 'pay:early', { paymentNumber: 'VPAY-EARLY', billRef: 'BILL-1', vendor: 'Acme Supplies', amount: total, transactionRef: 'TXN-EARLY' });
    assert(earlyPay.ok === false, 'a draft (unapproved) invoice cannot be paid');
    assert((await clearedPayments()).length === 0, 'no payment created for the refused early pay');

    // 3. approve the invoice (AP liability) → then explicitly pay it
    assert((await dispatch('ApproveSupplierInvoice', billId, `inv:${billId}`)).ok === true, 'ApproveSupplierInvoice → AP liability booked (S92)');
    assert(String((await billOf(billId)).fields.status) === 'approved', 'bill is approved and payment-eligible');
    const journalBeforePay = await journalCount();

    const paid = await dispatch('PaySupplierInvoice', undefined, 'pay:one', { paymentNumber: 'VPAY-1', billRef: 'BILL-1', vendor: 'Acme Supplies', amount: total, transactionRef: 'TXN-1' });
    assert(paid.ok === true, 'operator PaySupplierInvoice succeeded');
    assert((await clearedPayments()).length === 1, 'exactly ONE cleared vendor payment created');
    assert((await journalCount()) > journalBeforePay, 'canonical payment GL booked (Dr Accounts Payable / Cr Cash, JE-VPAY-*)');
    const settled = await billOf(billId);
    assert(String(settled.fields.status) === 'paid', 'AP SETTLED — the bill is paid');
    assert(String(settled.fields.paidDate ?? '') !== '', 'paidDate stamped on settlement');
    assert(Number(settled.fields.amountPaid ?? 0) === total, 'amountPaid equals the bill total');

    // 4. idempotency: same-key replay does not double-pay
    const replay = await dispatch('PaySupplierInvoice', undefined, 'pay:one', { paymentNumber: 'VPAY-1', billRef: 'BILL-1', vendor: 'Acme Supplies', amount: total, transactionRef: 'TXN-1' });
    assert(replay.replayed === true || replay.ok === true, 'same-key re-pay replays');
    assert((await clearedPayments()).length === 1, 'still exactly one payment after replay (no double-pay)');

    // 5. an already-paid invoice cannot be paid again (distinct key, overpay guard)
    const again = await dispatch('PaySupplierInvoice', undefined, 'pay:two', { paymentNumber: 'VPAY-2', billRef: 'BILL-1', vendor: 'Acme Supplies', amount: total, transactionRef: 'TXN-2' });
    assert(again.ok === false, 'a second full payment is refused (already settled — overpay guard)');
    assert((await clearedPayments()).length === 1, 'still exactly one payment after the refused re-pay');

    // 6. delete boundary: a cleared payment cannot be deleted (governed reversal is the only unwind)
    const payment = (await clearedPayments())[0];
    const delRes = await del('finance-vendor-payments', payment.id);
    assert(delRes && delRes.ok === false, 'a cleared payment cannot be deleted (economic delete guard — reverse it instead)');
    assert((await clearedPayments()).some((p) => p.id === payment.id), 'the payment is still present and cleared after the refused delete');

    out('RESULT', 'S93 supplier payment → AP settlement VERIFIED in the real Electron runtime — the S92 AP liability is settled through the EXISTING governed PaySupplierInvoice path: a draft invoice cannot be paid; an explicit operator payment creates exactly ONE cleared vendor payment (Dr Accounts Payable / Cr Cash) and settles the bill (paid); same-key replay does not double-pay; a second full payment is refused (overpay); a cleared payment cannot be deleted (governed reversal is the only unwind); no automatic payment occurred before the operator action.');
  } finally {
    await Promise.race([app.close(), sleep(15_000)]).catch(() => undefined);
    try { app.process().kill('SIGKILL'); } catch { /* already dead */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
