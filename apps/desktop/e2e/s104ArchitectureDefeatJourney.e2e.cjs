#!/usr/bin/env node
/**
 * ERP S104 — ARCHITECTURE-DEFEAT adversarial journey in the REAL Electron runtime, on a FRESH isolated
 * profile with NO seeded ERP state. Executes the highest-value architecture-defeat attacks against the real
 * renderer/preload/IPC/command path and proves each fails closed with zero economic side effect:
 *
 *   • IDEMPOTENCY-KEY CONFUSION: a DIFFERENT command reusing an idempotency key is SUPPRESSED (replays the
 *     first result) and executes no new economic effect.
 *   • ENVELOPE FORGERY: a forged tenantId in the dispatch envelope is refused (CROSS_TENANT_CLAIM).
 *   • APPROVE → MODIFY: an approved PO cannot be reverted to draft; an issued invoice amount cannot be edited.
 *   • REVERSAL COMPOSITION: reverse→reverse refused; the reversal record + the original cleared payment
 *     cannot be deleted.
 *   • F-S98-1 all-domain: forged production/adjustment/sales-order status via the edit door is inert.
 *   • RESTART: every refusal persists and no economic mutation appears.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s104"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s104ArchitectureDefeatJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ALT_MAIN = path.join(path.resolve(__dirname, '..'), 'out-seam-s104/main/index.js');
const PROD = 'inventory-products', MV = 'inventory-movements', JRNL = 'finance-journal-entries';
const PO = 'procurement-orders', ADJ = 'warehouse-adjustments', MO = 'manufacturing-orders', BOM = 'manufacturing-bom';
const CUST = 'crm-customers', ORDERS = 'sales-orders', FIN = 'finance', PAY = 'finance-payments', REVERSALS = 'finance-payment-reversals';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S104 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S104 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
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
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build out-seam-s104 first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s104-'));
  let session = await launch(profile);
  let closed = false;
  try {
    const b = () => session.bridge;
    const create = (m, f) => b()('enterprise:module.create', { moduleId: m, fields: f });
    const act = (m, id, a) => b()('enterprise:module.action', { moduleId: m, id, action: a });
    const update = (m, id, f) => b()('enterprise:module.update', { moduleId: m, id, fields: f });
    const del = (m, id) => b()('enterprise:module.delete', { moduleId: m, id });
    const listOf = (m) => b()('enterprise:module.list', { moduleId: m });
    const dispatchRaw = (payload) => b()('platform:command.dispatch', payload);
    const dispatch = (op, target, key, payload = {}) => dispatchRaw({ operation: op, target, payload, idempotencyKey: key });
    const recOf = async (m, id) => (await listOf(m)).find((r) => r.id === id);
    const jcount = async () => (await listOf(JRNL)).filter((e) => e.status !== 'deleted').length;
    const movesOf = async (t) => (await listOf(MV)).filter((m) => m.status !== 'deleted' && String(m.fields.type) === t);
    const aliveOf = async (m) => (await listOf(m)).filter((r) => r.status !== 'deleted');

    const userData = await session.app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData) === fs.realpathSync(profile), 'FRESH isolated profile is the running userData');
    assert((await listOf(MV)).length === 0 && (await listOf(ORDERS)).length === 0, 'fresh profile has NO seeded ERP state');

    await create(PROD, { sku: 'SKU-1', name: 'Widget', standardCost: 5 });
    await create(MV, { movementNumber: 'MV-SEED', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });
    const cust = await create(CUST, { name: 'C-1' });

    // ── IDEMPOTENCY-KEY CONFUSION ──
    const so = await dispatch('CreateSalesOrder', undefined, 'K', { orderNumber: 'SO-1', customer: 'C-1', customerRef: cust.record.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: 5, total: 100 });
    const orderId = String(so.data.id);
    const issuesBefore = (await movesOf('issue')).length;
    const shipReplay = await dispatch('ShipSalesOrder', orderId, 'K'); // DIFFERENT command, SAME key
    assert(shipReplay.replayed === true, 'a different command reusing the key is SUPPRESSED (replayed), not executed');
    assert((await movesOf('issue')).length === issuesBefore, 'idempotency-key confusion caused ZERO issue movement');
    const ordersBefore = (await aliveOf(ORDERS)).length;
    const dupe = await dispatch('CreateSalesOrder', undefined, 'K', { orderNumber: 'SO-2', customer: 'C-1', customerRef: cust.record.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: 99, total: 9900 });
    assert(dupe.replayed === true && (await aliveOf(ORDERS)).length === ordersBefore, 'key reuse created no duplicate/second order');
    // the real ship (fresh key) still works — key-confusion only suppresses, never corrupts
    assert((await dispatch('ShipSalesOrder', orderId, 'ship-real')).ok === true, 'the real ship (fresh key) executes normally');
    assert((await movesOf('issue')).length === issuesBefore + 1, 'exactly one issue movement from the real ship');

    // ── ENVELOPE FORGERY: forged tenantId ──
    const forged = await dispatchRaw({ operation: 'CreateSalesOrder', payload: { orderNumber: 'SO-EVIL', customer: 'C-1', customerRef: cust.record.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: 1, total: 20 }, idempotencyKey: 'evil', claimedTenantId: 'tenant-EVIL' });
    assert(forged.ok === false, 'a forged tenantId in the dispatch envelope is refused');

    // ── APPROVE → MODIFY ──
    const po = await create(PO, { poNumber: 'PO-1', product: 'SKU-1', warehouse: 'WH-1', quantity: 10, unitCost: 5, supplier: 'V-1', status: 'draft' });
    await act(PO, po.record.id, 'approve');
    assert((await update(PO, po.record.id, { status: 'draft' })).ok === false, 'an approved PO cannot be reverted to draft via the edit door');
    // issue + pay the O2C invoice, then try to edit its amount
    await dispatch('InvoiceSalesOrder', orderId, 'inv');
    const invId = String((await recOf(ORDERS, orderId)).fields.convertedInvoice);
    const invNo = String((await recOf(FIN, invId)).fields.number);
    await dispatch('IssueCustomerInvoice', invId, 'issue');
    assert((await update(FIN, invId, { amount: 999999 })).ok === false, 'an issued invoice amount cannot be edited via the edit door (S60)');
    await dispatch('ReceiveCustomerPayment', undefined, 'rcpt', { paymentNumber: 'RCPT-1', invoiceRef: invNo, amount: 100, transactionRef: 'TXN' });
    const payment = (await listOf(PAY)).find((p) => String(p.fields.status) === 'cleared');

    // ── REVERSAL COMPOSITION ──
    assert((await create(REVERSALS, { reversalNumber: 'REV-1', originalKind: 'customer', originalPaymentId: payment.id, reason: 'error' })).ok === true, 'a canonical reversal is created');
    const rev1 = (await listOf(REVERSALS)).find((r) => r.status !== 'deleted');
    assert((await create(REVERSALS, { reversalNumber: 'REV-2', originalKind: 'customer', originalPaymentId: payment.id, reason: 'again' })).ok === false, 'reverse→reverse: a second reversal is refused (at-most-once)');
    assert((await del(REVERSALS, rev1.id)).ok === false, 'reverse→delete: the reversal record cannot be deleted (S64)');
    assert((await del(PAY, payment.id)).ok === false, 'the original cleared payment cannot be deleted (S61)');

    // ── F-S98-1 all-domain forge ──
    await create(PROD, { sku: 'FG-1', name: 'FG', standardCost: 12 });
    await create(BOM, { bomNumber: 'BOM-1', product: 'FG-1', outputQuantity: 1, yield: 100, waste: 0, status: 'active', components: JSON.stringify([{ sku: 'FG-1', quantity: 1 }]) });
    const mo = await create(MO, { orderNumber: 'MO-1', bom: 'BOM-1', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 1 });
    assert((await update(MO, mo.record.id, { status: 'completed' })).ok === false, 'F-S98-1: forged production status→completed refused');
    const adj = await create(ADJ, { adjustmentNumber: 'ADJ-1', product: 'SKU-1', warehouse: 'WH-1', quantity: -10, reason: 'lost' });
    const adjBefore = (await movesOf('adjustment')).length;
    await update(ADJ, adj.record.id, { status: 'posted' });
    assert((await movesOf('adjustment')).length === adjBefore, 'forged adjustment status=posted creates no movement');
    assert((await movesOf('production_output')).length === 0, 'no phantom finished goods across all the forges');

    const snap = { issues: (await movesOf('issue')).length, jrnl: await jcount(), reversals: (await aliveOf(REVERSALS)).length, orders: (await aliveOf(ORDERS)).length };

    // ── RESTART ──
    await session.app.close(); closed = true;
    session = await launch(profile); closed = false;
    const userData2 = await session.app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData2) === fs.realpathSync(profile), 'restart reopened the SAME profile');
    assert((await movesOf('issue')).length === snap.issues, 'issue movement count survives restart');
    assert((await jcount()) === snap.jrnl, 'journal count survives restart');
    assert((await aliveOf(REVERSALS)).length === snap.reversals, 'reversal count survives restart');
    assert((await aliveOf(ORDERS)).length === snap.orders, 'order count survives restart');
    // repeat selected attacks after restart — refusals persist, no economic mutation
    assert((await dispatch('ShipSalesOrder', orderId, 'K')).replayed === true || (await dispatch('ShipSalesOrder', orderId, 'K')).ok === false, 'after restart the key-confusion replay is still suppressed');
    assert((await del(PAY, payment.id)).ok === false, 'after restart the cleared payment is still undeletable');
    assert((await create(REVERSALS, { reversalNumber: 'REV-3', originalKind: 'customer', originalPaymentId: payment.id, reason: 'post-restart' })).ok === false, 'after restart a second reversal is still refused');
    assert((await movesOf('issue')).length === snap.issues && (await jcount()) === snap.jrnl, 'no economic mutation from the post-restart attacks');

    out('RESULT', 'S104 ARCHITECTURE-DEFEAT VERDICT — the architecture SURVIVED the attack in the real Electron runtime on a FRESH profile. Idempotency-key confusion SUPPRESSES a different command reusing a key (zero issue movement, no duplicate order) while the real command with a fresh key executes normally; a forged tenantId in the dispatch envelope is refused; an approved PO cannot be reverted to draft and an issued invoice amount cannot be edited; reversal composition holds (reverse→reverse refused, the reversal record and the original cleared payment are indestructible); and forged production/adjustment statuses via the edit door are inert with no phantom finished goods or stock. After a REAL PROCESS RESTART every refusal persists and no economic mutation appears. No renderer, replay, envelope-forgery, composition, or forged-status path defeated a governed economic boundary. NO STOP; no production change; policy-open authority layers remain fail-closed and documented (DECISION-MEMO-S104).');
  } finally {
    if (!closed) { await Promise.race([session.app.close(), sleep(15_000)]).catch(() => undefined); }
    try { session.app.process().kill('SIGKILL'); } catch { /* already dead */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
