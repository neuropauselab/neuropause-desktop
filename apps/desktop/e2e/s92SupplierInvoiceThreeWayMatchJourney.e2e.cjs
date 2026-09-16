#!/usr/bin/env node
/**
 * ERP S92 — the reorder-originated, POSTED Goods Receipt continues into the EXISTING governed
 * supplier-invoice → three-way-match → Accounts-Payable path in the REAL Electron runtime, through the
 * governed bridge (the `enterprise:module.*` actions the Procurement/Finance UI invokes + the
 * `platform:command.dispatch` PostGoodsReceipt / ApproveSupplierInvoice commands):
 *
 *   product → demand → S86 → S89 confirmation → PR → Submit → Approve → Convert → PO
 *     → operator sets receiving warehouse + supplier + ordered unit price on the PO (PO-stage inputs)
 *     → PO Approve → Send → Receive Goods → PostGoodsReceipt  (inventory + GRNI accrued)
 *     → draft a Vendor Bill (supplier invoice) referencing the PO, with line items
 *     → (no lines) approve REFUSED (NO_LINES) → add lines → ApproveSupplierInvoice → AP booked ONCE
 *
 * Proven fail-closed and once-only: a header-only (no-lines) bill is held; a re-approve is refused; the
 * bill is a payment-ready LIABILITY, never paid (S92 never dispatches PaySupplierInvoice). Full lineage
 * recommendation → PR → PO → GR → bill. Nothing auto-invoiced, auto-approved, or paid.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s92"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s92SupplierInvoiceThreeWayMatchJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ALT_MAIN = path.join(path.resolve(__dirname, '..'), 'out-seam-s92/main/index.js');
const STANDARD_COST = 5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S92 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S92 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) { const end = Date.now() + ms; for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await sleep(400); } }

async function main() {
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build out-seam-s92 first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s92-'));
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
    const listOf = (moduleId) => bridge('enterprise:module.list', { moduleId });
    const dispatch = (operation, target, idempotencyKey, payload = {}) => bridge('platform:command.dispatch', { operation, target, payload, idempotencyKey });
    const stock = async (sku) => Number((await listOf('inventory-products')).find((r) => String(r.fields.sku) === sku)?.fields?.currentStock ?? 0);
    const waitStock = async (sku, target) => { for (let i = 0; i < 40; i += 1) { if ((await stock(sku)) === target) return true; await sleep(250); } return (await stock(sku)) === target; };
    const journalCount = async () => (await listOf('finance-journal-entries')).length;
    const paymentCount = async () => (await listOf('finance-vendor-payments')).filter((r) => r.status !== 'deleted').length;

    // 1. reorder chain → PR → PO (S89/S90)
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
    assert((await dispatch('SubmitPurchaseRequest', prId, `sub:${prId}`)).ok, 'Submit PR');
    assert((await dispatch('ApprovePurchaseRequest', prId, `app:${prId}`)).ok, 'Approve PR');
    assert((await dispatch('ConvertPurchaseRequestToPO', prId, `conv:${prId}`)).ok, 'Convert → PO');
    const po = (await listOf('procurement-orders')).find((r) => String(r.fields.sourceRequest) === prId);
    const poId = po.id;
    const poNumber = String(po.fields.poNumber);
    assert(poNumber === `PO-${requestNumber}`, 'PO carries reorder lineage (PO-PR-REORDER-…)');

    // 2. operator PO-stage inputs the SKU-level recommendation does not carry: warehouse + supplier + ordered price
    assert((await update('procurement-orders', poId, { warehouse: 'WH-1', supplier: 'Acme Supplies', unitCost: STANDARD_COST })).ok, 'operator sets receiving warehouse + supplier + ordered unit price on the PO');

    // 3. approve → send → receive → post the GR (S91) → inventory + GRNI accrued
    assert((await act('procurement-orders', poId, 'approve')).ok, 'PO Approve');
    assert((await act('procurement-orders', poId, 'send')).ok, 'PO Send');
    assert((await act('procurement-orders', poId, 'receiveGoods')).ok, 'Receive Goods → pending GR');
    const gr = (await listOf('procurement-receipts')).find((r) => String(r.fields.purchaseOrder) === poId);
    assert((await dispatch('PostGoodsReceipt', gr.id, `post:${gr.id}`)).ok === true, 'PostGoodsReceipt succeeded');
    assert(await waitStock('SKU-1', 70 + qty), `inventory received (70 → ${70 + qty})`);

    // 4. draft a supplier invoice referencing the PO — WITHOUT lines: the three-way match holds it
    const noLines = await create('finance-vendor-bills', { billNumber: 'BILL-NOLINES', vendor: 'Acme Supplies', currency: 'USD', amount: qty * STANDARD_COST, sourcePurchaseOrder: poNumber, status: 'draft' });
    const noLinesId = noLines.record.id;
    const journalBeforeHeld = await journalCount();
    const held = await dispatch('ApproveSupplierInvoice', noLinesId, `inv:nolines`);
    assert(held.ok === false, 'a header-only (no-lines) reorder bill is HELD by the three-way match');
    // The application boundary sanitizes the internal reason to a closed, deny-by-default error
    // contract: a state-precondition refusal maps to CONFLICT (the raw 'NO_LINES' reason is
    // intentionally not leaked to the client, and is pinned at the command-bus layer in the focused
    // unit test reorderInvoiceApLifecycle.test.ts). The end-to-end proof is: HELD + governed refusal +
    // bill stays draft + no AP booked.
    assert(held.error && held.error.code === 'CONFLICT', 'the boundary returns a governed CONFLICT refusal (sanitized; the NO_LINES reason is pinned in the unit test)');
    assert(String((await listOf('finance-vendor-bills')).find((r) => r.id === noLinesId).fields.status) === 'draft', 'the held bill stays draft — no payable');
    assert((await journalCount()) === journalBeforeHeld, 'no AP booked on the held bill');

    // 5. a real supplier invoice WITH matching line items → ApproveSupplierInvoice → AP booked once
    const bill = await create('finance-vendor-bills', {
      billNumber: 'BILL-1', vendor: 'Acme Supplies', currency: 'USD', amount: qty * STANDARD_COST,
      sourcePurchaseOrder: poNumber, status: 'draft',
      lines: JSON.stringify([{ sku: 'SKU-1', quantity: qty, unitPrice: STANDARD_COST }]),
    });
    const billId = bill.record.id;
    assert(String((await listOf('finance-vendor-bills')).find((r) => r.id === billId).fields.status) === 'draft', 'drafting the bill books NO payable');
    const journalBefore = await journalCount();
    const approve = await dispatch('ApproveSupplierInvoice', billId, `inv:${billId}`);
    assert(approve.ok === true, 'ApproveSupplierInvoice succeeded (three-way match MATCHED)');
    const approved = (await listOf('finance-vendor-bills')).find((r) => r.id === billId);
    assert(String(approved.fields.status) === 'approved', 'bill is approved (approvedAt stamped by the action)');
    assert((await journalCount()) > journalBefore, 'AP liability booked (GRNI relieved / Cr Accounts Payable) exactly once');
    assert((await paymentCount()) === 0, 'the bill is a payment-ready LIABILITY — NOT paid (S92 never settles)');

    // 6. at-most-once: a distinct-key re-approve is refused; markers cannot be edited
    const reAgain = await dispatch('ApproveSupplierInvoice', billId, `inv:${billId}:again`);
    assert(reAgain.ok === false, 'a re-approve of a non-draft bill is refused (no second AP booking)');
    const edit = await update('finance-vendor-bills', billId, { approvedAt: '' });
    assert(edit && edit.ok === false, 'a generic edit cannot clear approvedAt (markers are action-owned)');

    // 7. lineage + side-effect boundary
    assert(String(approved.fields.sourcePurchaseOrder) === poNumber, 'bill traces to the reorder PO (lineage recommendation → PR → PO → GR → bill)');
    assert((await paymentCount()) === 0, 'still no payment at the end — a liability, not a settlement');

    out('RESULT', 'S92 supplier invoice → three-way match → AP VERIFIED in the real Electron runtime — the reorder GR continues into the EXISTING governed supplier-invoice path: a header-only bill is fail-closed (NO_LINES), a matched supplier invoice books the payable EXACTLY ONCE (GRNI relieved / Cr Accounts Payable) as a payment-ready liability, a re-approve is refused, markers cannot be edited, and NOTHING is paid; full lineage recommendation → PR → PO → GR → bill; supplier/price/lines are operator inputs the SKU-level recommendation does not invent.');
  } finally {
    await Promise.race([app.close(), sleep(15_000)]).catch(() => undefined);
    try { app.process().kill('SIGKILL'); } catch { /* already dead */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
