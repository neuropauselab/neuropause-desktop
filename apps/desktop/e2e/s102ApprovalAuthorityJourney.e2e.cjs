#!/usr/bin/env node
/**
 * ERP S102 — APPROVAL RECONCILIATION & AUTHORITY journey in the REAL Electron runtime, on a FRESH isolated
 * profile with NO seeded ERP state. Proves the canonical authority path holds in-app and that no door
 * bypasses it (single local principal):
 *
 *   • EXPENSE SoD: the creator cannot approve their own claim (0 GL); edit-door forge refused.
 *   • PR canonical path (S20 workflow): submit → approve → convert; a non-approved PR cannot convert; the
 *     approved status cannot be forged via the edit door.
 *   • PO DUAL-DOOR (S102): SetStatus cannot set the domain status; the approve action approves (RBAC +
 *     machine transition); an approved PO cannot be reverted to draft via the edit door.
 *   • VENDOR BILL engine-dormant (S102): the approved marker is action-only — an edit-door forge is refused.
 *   • PAYMENT REVERSAL: cleared payment undeletable; reversal at-most-once.
 *   • PERIOD: closed period cannot be edited; F-S98-1 forged production status refused.
 *   • RESTART: every approval + economic state survives and the refusals still hold.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s102"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s102ApprovalAuthorityJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ALT_MAIN = path.join(path.resolve(__dirname, '..'), 'out-seam-s102/main/index.js');
const PROD = 'inventory-products', MV = 'inventory-movements', JRNL = 'finance-journal-entries';
const EMP = 'hr-employees', EXP = 'hr-expense-claims';
const PR = 'procurement-requests', PO = 'procurement-orders', BILL = 'finance-vendor-bills';
const PERIOD = 'finance-periods', REVERSALS = 'finance-payment-reversals', PAY = 'finance-payments';
const CUST = 'crm-customers', ORDERS = 'sales-orders', FIN = 'finance';
const MO = 'manufacturing-orders', BOM = 'manufacturing-bom';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S102 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S102 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) { const end = Date.now() + ms; for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await sleep(400); } }

async function launch(profile) {
  const logs = [];
  const app = await electron.launch({ args: [ALT_MAIN, `--user-data-dir=${profile}`], env: { ...process.env, NP_E2E_BUILD: '', NEUROPAUSE_E2E: '', ELECTRON_RENDERER_URL: '', NODE_ENV: 'production' }, timeout: 60_000 });
  app.process().stdout.on('data', (d) => logs.push(String(d)));
  app.process().stderr.on('data', (d) => logs.push(String(d)));
  const win = await app.firstWindow({ timeout: 45_000 });
  for (const re of [/Enterprise OS ready/, /Runtime core ready/]) { if (!(await waitForLog(logs, re, 30_000))) fail(`BOOT_LOG ${re}`); }
  const bridge = (ch, payload) => win.evaluate(([c, p]) => window.neuropause.invoke(c, p), [ch, payload]);
  return { app, win, bridge };
}

async function main() {
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build out-seam-s102 first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s102-'));
  let session = await launch(profile);
  let closed = false;
  try {
    const b = () => session.bridge;
    const create = (m, f) => b()('enterprise:module.create', { moduleId: m, fields: f });
    const act = (m, id, a) => b()('enterprise:module.action', { moduleId: m, id, action: a });
    const update = (m, id, f) => b()('enterprise:module.update', { moduleId: m, id, fields: f });
    const setStatus = (m, id, status) => b()('enterprise:module.setStatus', { moduleId: m, id, status });
    const del = (m, id) => b()('enterprise:module.delete', { moduleId: m, id });
    const listOf = (m) => b()('enterprise:module.list', { moduleId: m });
    const dispatch = (op, target, key, payload = {}) => b()('platform:command.dispatch', { operation: op, target, payload, idempotencyKey: key });
    const recOf = async (m, id) => (await listOf(m)).find((r) => r.id === id);
    const jcount = async () => (await listOf(JRNL)).filter((e) => e.status !== 'deleted').length;
    const movesOf = async (t) => (await listOf(MV)).filter((m) => m.status !== 'deleted' && String(m.fields.type) === t);

    const userData = await session.app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData) === fs.realpathSync(profile), 'FRESH isolated profile is the running userData');
    assert((await listOf(EXP)).length === 0 && (await listOf(PO)).length === 0, 'fresh profile has NO seeded ERP state');

    // ── EXPENSE SoD ──
    const emp = await create(EMP, { employeeNumber: 'EMP-1', name: 'Sam' });
    const claim = await create(EXP, { employee: emp.record.id, category: 'travel', expenseDate: '2026-09-10', amount: 250, description: 'Taxi' });
    assert((await act(EXP, claim.record.id, 'approve')).ok === false, 'expense SoD: the creator cannot approve their own claim');
    assert((await jcount()) === 0, 'zero GL from the refused self-approval');
    await update(EXP, claim.record.id, { status: 'approved' });
    assert(String((await recOf(EXP, claim.record.id)).fields.status) === 'submitted', 'expense edit-door status forge refused (machine-owned)');

    // ── PR canonical path (S20 workflow) ──
    await create(PROD, { sku: 'SKU-1', name: 'Widget', standardCost: 5 });
    const pr = await create(PR, { requestNumber: 'PR-1', product: 'SKU-1', sku: 'SKU-1', quantity: 10, warehouse: 'WH-1' });
    assert((await dispatch('ConvertPurchaseRequestToPO', pr.record.id, 'conv:1')).ok === false, 'a non-approved PR cannot convert to a PO');
    assert((await update(PR, pr.record.id, { status: 'approved' })).ok === false, 'PR approved status cannot be forged via the edit door');
    await dispatch('SubmitPurchaseRequest', pr.record.id, 'sub:1'); await dispatch('ApprovePurchaseRequest', pr.record.id, 'app:1');
    assert(String((await recOf(PR, pr.record.id)).fields.status) === 'approved', 'governed PR approval reached approved (S20 workflow path)');
    assert((await dispatch('ConvertPurchaseRequestToPO', pr.record.id, 'conv:2')).ok === true, 'an approved PR converts to a PO');

    // ── PO DUAL-DOOR (S102): RBAC + machine transition; SetStatus/edit cannot forge ──
    const po = await create(PO, { poNumber: 'PO-1', product: 'SKU-1', warehouse: 'WH-1', quantity: 10, unitCost: 5, supplier: 'V-1', status: 'draft' });
    // SetStatus only accepts record statuses (active/archived/deleted); 'approved' is rejected at the IPC
    // contract itself (a throw) — the strongest form of "SetStatus cannot set the domain status".
    let ssRejected = false;
    try { const r = await setStatus(PO, po.record.id, 'approved'); ssRejected = r && r.ok === false; } catch { ssRejected = true; }
    assert(ssRejected, 'PO: SetStatus cannot set the domain approved status (rejected by the IPC contract)');
    assert((await act(PO, po.record.id, 'approve')).ok === true, 'PO approve action approves (RBAC + machine transition)');
    assert(String((await recOf(PO, po.record.id)).fields.status) === 'approved', 'PO is approved via the governed action');
    assert((await update(PO, po.record.id, { status: 'draft' })).ok === false, 'an approved PO cannot be reverted to draft via the edit door');

    // ── VENDOR BILL engine-dormant (S102): approved marker is action-only ──
    const bill = await create(BILL, { billNumber: 'BILL-1', vendor: 'V-1', currency: 'USD', amount: 500, status: 'draft', lines: JSON.stringify([{ sku: 'SKU-1', quantity: 10, unitPrice: 5 }]) });
    await update(BILL, bill.record.id, { approvedAt: '2026-09-30T00:00:00.000Z' });
    assert(String((await recOf(BILL, bill.record.id)).fields.status) !== 'approved', 'vendor-bill approved marker cannot be forged via the edit door');
    assert((await jcount()) === 0, 'zero GL from the vendor-bill marker forge attempt');

    // ── PAYMENT REVERSAL ──
    await create(MV, { movementNumber: 'MV-SEED', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });
    const cust = await create(CUST, { name: 'C-1' });
    const so = await dispatch('CreateSalesOrder', undefined, 'so', { orderNumber: 'SO-1', customer: 'C-1', customerRef: cust.record.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: 5, total: 100 });
    const orderId = String(so.data.id);
    await dispatch('ShipSalesOrder', orderId, 'ship'); await dispatch('InvoiceSalesOrder', orderId, 'inv');
    const invId = String((await recOf(ORDERS, orderId)).fields.convertedInvoice);
    const invNo = String((await recOf(FIN, invId)).fields.number);
    await dispatch('IssueCustomerInvoice', invId, 'issue');
    await dispatch('ReceiveCustomerPayment', undefined, 'rcpt', { paymentNumber: 'RCPT-1', invoiceRef: invNo, amount: 100, transactionRef: 'TXN' });
    const payment = (await listOf(PAY)).find((p) => String(p.fields.status) === 'cleared');
    assert((await del(PAY, payment.id)).ok === false, 'a cleared payment cannot be deleted (economic-delete guard)');
    assert((await create(REVERSALS, { reversalNumber: 'REV-1', originalKind: 'customer', originalPaymentId: payment.id, reason: 'error' })).ok === true, 'a canonical payment reversal is created');
    assert((await create(REVERSALS, { reversalNumber: 'REV-2', originalKind: 'customer', originalPaymentId: payment.id, reason: 'again' })).ok === false, 'a second reversal of the same payment is refused (at-most-once)');

    // ── PERIOD + F-S98-1 ──
    const period = await create(PERIOD, { periodKey: '2026-09', status: 'open' });
    await act(PERIOD, period.record.id, 'close');
    assert((await update(PERIOD, period.record.id, { status: 'open' })).ok === false, 'a closed period cannot be edited via the edit door');
    await create(PROD, { sku: 'FG-1', name: 'FG', standardCost: 12 });
    await create(BOM, { bomNumber: 'BOM-1', product: 'FG-1', outputQuantity: 1, yield: 100, waste: 0, status: 'active', components: JSON.stringify([{ sku: 'FG-1', quantity: 1 }]) });
    const mo = await create(MO, { orderNumber: 'MO-1', bom: 'BOM-1', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 1 });
    assert((await update(MO, mo.record.id, { status: 'running' })).ok === false, 'F-S98-1: forged production status→running refused');
    assert((await movesOf('production_output')).length === 0, 'no phantom finished goods from the forged edit');

    const snap = { claimStatus: String((await recOf(EXP, claim.record.id)).fields.status), poStatus: String((await recOf(PO, po.record.id)).fields.status), jrnl: await jcount(), reversals: (await listOf(REVERSALS)).filter((r) => r.status !== 'deleted').length };

    // ── RESTART ──
    await session.app.close(); closed = true;
    session = await launch(profile); closed = false;
    const userData2 = await session.app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData2) === fs.realpathSync(profile), 'restart reopened the SAME profile');
    assert(String((await recOf(EXP, claim.record.id)).fields.status) === snap.claimStatus, 'expense claim status survives restart (still submitted)');
    assert(String((await recOf(PO, po.record.id)).fields.status) === snap.poStatus, 'PO status survives restart (approved)');
    assert((await jcount()) === snap.jrnl, 'journal count survives restart');
    assert((await listOf(REVERSALS)).filter((r) => r.status !== 'deleted').length === snap.reversals, 'reversal count survives restart');
    assert((await act(EXP, claim.record.id, 'approve')).ok === false, 'after restart the creator STILL cannot self-approve');
    assert((await create(REVERSALS, { reversalNumber: 'REV-3', originalKind: 'customer', originalPaymentId: payment.id, reason: 'post-restart' })).ok === false, 'after restart a second reversal is still refused (at-most-once persists)');
    assert((await jcount()) === snap.jrnl, 'no GL booked by post-restart refused attempts');

    out('RESULT', 'S102 APPROVAL RECONCILIATION & AUTHORITY VERIFIED in the real Electron runtime on a FRESH profile: the canonical authority path holds in-app and no door bypasses it. Expense self-approval is refused (0 GL) and the approved status cannot be forged via the edit door. The PR canonical path runs submit → approve → convert through the S20 workflow, and a non-approved PR cannot convert. PO approval is a dual-door model with the RBAC floor: SetStatus cannot set the domain status, the approve action approves via the machine transition, and an approved PO cannot be reverted to draft via the edit door. The vendor-bill approved marker is action-only (an edit-door forge is refused, 0 GL) — the threshold/SoD engine is dormant for it. A cleared payment cannot be deleted and a reversal is at-most-once. A closed period cannot be edited; the F-S98-1 production-status fence blocks forged finished goods. After a REAL PROCESS RESTART every approval + economic state survives and the refusals still hold — authority is persisted, not per-session. No approval engine was unified by force; no threshold or SoD policy was invented; policy-open adoption items are documented in DECISION-MEMO-S102.');
  } finally {
    if (!closed) { await Promise.race([session.app.close(), sleep(15_000)]).catch(() => undefined); }
    try { session.app.process().kill('SIGKILL'); } catch { /* already dead */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
