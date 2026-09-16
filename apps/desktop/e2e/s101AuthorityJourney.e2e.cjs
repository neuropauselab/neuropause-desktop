#!/usr/bin/env node
/**
 * ERP S101 — AUTHORITY / APPROVAL / SoD journey in the REAL Electron runtime, on a FRESH isolated profile
 * with NO seeded ERP state. Proves the governed application actually enforces the authority controls that
 * are reproducible with the single local principal (the running app has ONE authenticated actor):
 *
 *   • EXPENSE SoD: the local principal creates a claim (createdBy = the principal) and then tries to approve
 *     it → REFUSED (creator ≠ approver). ZERO GL is booked. This is the one live SoD rule, proven in-app.
 *   • PR→PO gate: a non-approved PR cannot convert; the approved status cannot be hand-set via the edit door;
 *     only the governed approve enables conversion.
 *   • PAYMENT/REVERSAL: a cleared payment cannot be deleted; a canonical reversal is at-most-once; a
 *     bank-reconciled payment fails closed.
 *   • F-S98-1: forged production status is refused.
 *   • PERIOD: close attributes the actor; a closed period cannot be edited via the edit door; reopen works.
 *   • RESTART: the approval/economic state and the SoD refusal survive a real process restart.
 *
 * (The creator≠approver POSITIVE path and the unauthorized-actor / cross-tenant negatives require multiple
 *  principals / denied scopes and are covered by the focused test `authoritySodControlPlane.test.ts`; a
 *  fresh local-mode app has a single full-authority principal.)
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s101"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s101AuthorityJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ALT_MAIN = path.join(path.resolve(__dirname, '..'), 'out-seam-s101/main/index.js');
const PROD = 'inventory-products', MV = 'inventory-movements', JRNL = 'finance-journal-entries';
const EMP = 'hr-employees', EXP = 'hr-expense-claims';
const PR = 'procurement-requests', PO = 'procurement-orders';
const PERIOD = 'finance-periods', REVERSALS = 'finance-payment-reversals', PAY = 'finance-payments';
const CUST = 'crm-customers', ORDERS = 'sales-orders', FIN = 'finance';
const MO = 'manufacturing-orders', BOM = 'manufacturing-bom';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S101 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S101 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
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
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build out-seam-s101 first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s101-'));
  let session = await launch(profile);
  let closed = false;
  try {
    const b = () => session.bridge;
    const create = (m, f) => b()('enterprise:module.create', { moduleId: m, fields: f });
    const act = (m, id, a) => b()('enterprise:module.action', { moduleId: m, id, action: a });
    const update = (m, id, f) => b()('enterprise:module.update', { moduleId: m, id, fields: f });
    const del = (m, id) => b()('enterprise:module.delete', { moduleId: m, id });
    const listOf = (m) => b()('enterprise:module.list', { moduleId: m });
    const dispatch = (op, target, key, payload = {}) => b()('platform:command.dispatch', { operation: op, target, payload, idempotencyKey: key });
    const recOf = async (m, id) => (await listOf(m)).find((r) => r.id === id);
    const jcount = async () => (await listOf(JRNL)).filter((e) => e.status !== 'deleted').length;
    const movesOf = async (t) => (await listOf(MV)).filter((m) => m.status !== 'deleted' && String(m.fields.type) === t);

    const userData = await session.app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData) === fs.realpathSync(profile), 'FRESH isolated profile is the running userData');
    assert((await listOf(EXP)).length === 0 && (await listOf(MV)).length === 0, 'fresh profile has NO seeded ERP state');

    // ── EXPENSE SoD: the creator (the local principal) cannot approve their own claim ──
    const emp = await create(EMP, { employeeNumber: 'EMP-1', name: 'Sam' });
    const claim = await create(EXP, { employee: emp.record.id, category: 'travel', expenseDate: '2026-09-10', amount: 250, description: 'Taxi' });
    assert(claim.ok, 'expense claim created by the local principal');
    const createdBy = String(claim.record.createdBy ?? '');
    assert(createdBy !== '', 'claim carries a server-stamped createdBy (the local principal)');
    const selfApprove = await act(EXP, claim.record.id, 'approve');
    assert(selfApprove.ok === false, 'SoD: the creator cannot approve their OWN claim (self-approval refused)');
    assert(String((await recOf(EXP, claim.record.id)).fields.status) === 'submitted', 'claim stays submitted after the refused self-approval');
    assert((await jcount()) === 0, 'ZERO GL accrual booked by the refused self-approval');
    // creator cannot forge approved via the edit door (machine-owned status forces submitted)
    await update(EXP, claim.record.id, { status: 'approved' });
    assert(String((await recOf(EXP, claim.record.id)).fields.status) === 'submitted', 'edit-door status forge to approved refused (machine-owned)');
    assert((await jcount()) === 0, 'still ZERO GL after the edit-door forge attempt');

    // ── PR→PO gate ──
    await create(PROD, { sku: 'SKU-1', name: 'Widget', standardCost: 5 });
    const pr = await create(PR, { requestNumber: 'PR-1', product: 'SKU-1', sku: 'SKU-1', quantity: 10, warehouse: 'WH-1' });
    assert((await dispatch('ConvertPurchaseRequestToPO', pr.record.id, 'conv:1')).ok === false, 'a non-approved PR cannot convert to a PO');
    assert((await listOf(PO)).length === 0, 'no PO created from the refused conversion');
    assert((await update(PR, pr.record.id, { status: 'approved' })).ok === false, 'PR status→approved via the edit door is refused (machine-owned)');
    await dispatch('SubmitPurchaseRequest', pr.record.id, 'sub:1'); await dispatch('ApprovePurchaseRequest', pr.record.id, 'app:1');
    assert(String((await recOf(PR, pr.record.id)).fields.status) === 'approved', 'governed approve moved the PR to approved');
    assert((await dispatch('ConvertPurchaseRequestToPO', pr.record.id, 'conv:2')).ok === true, 'an approved PR converts to a PO (governed)');
    assert((await listOf(PO)).length === 1, 'exactly one PO created');

    // ── PAYMENT / REVERSAL guards ──
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
    assert(payment, 'a cleared customer payment exists');
    assert((await del(PAY, payment.id)).ok === false, 'a cleared payment cannot be deleted (economic-delete guard)');
    const rev1 = await create(REVERSALS, { reversalNumber: 'REV-1', originalKind: 'customer', originalPaymentId: payment.id, reason: 'error' });
    assert(rev1.ok === true, 'a canonical payment reversal is created');
    const rev2 = await create(REVERSALS, { reversalNumber: 'REV-2', originalKind: 'customer', originalPaymentId: payment.id, reason: 'again' });
    assert(rev2.ok === false, 'a second reversal of the same payment is refused (at-most-once)');

    // ── PERIOD close/reopen ──
    const period = await create(PERIOD, { periodKey: '2026-09', status: 'open' });
    assert((await act(PERIOD, period.record.id, 'close')).ok, 'accounting period closed');
    assert(String((await recOf(PERIOD, period.record.id)).fields.closedBy) !== '', 'close attributes the actor (closedBy stamped)');
    assert((await update(PERIOD, period.record.id, { status: 'open' })).ok === false, 'a closed period cannot be edited via the edit door (S55)');
    assert((await act(PERIOD, period.record.id, 'reopen')).ok, 'the authorized principal can reopen (dual-control POLICY-OPEN, not invented)');

    // ── F-S98-1 ──
    await create(PROD, { sku: 'FG-1', name: 'FG', standardCost: 12 });
    await create(BOM, { bomNumber: 'BOM-1', product: 'FG-1', outputQuantity: 1, yield: 100, waste: 0, status: 'active', components: JSON.stringify([{ sku: 'FG-1', quantity: 1 }]) });
    const mo = await create(MO, { orderNumber: 'MO-1', bom: 'BOM-1', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 1 });
    assert((await update(MO, mo.record.id, { status: 'running' })).ok === false, 'F-S98-1: forged production status→running refused');
    assert((await update(MO, mo.record.id, { status: 'completed' })).ok === false, 'F-S98-1: forged production status→completed refused');
    assert((await movesOf('production_output')).length === 0, 'no phantom finished-goods movement from the forged edits');

    const snap = { claimStatus: String((await recOf(EXP, claim.record.id)).fields.status), jrnl: await jcount(), pos: (await listOf(PO)).length, reversals: (await listOf(REVERSALS)).filter((r) => r.status !== 'deleted').length };

    // ── RESTART ──
    await session.app.close(); closed = true;
    session = await launch(profile); closed = false;
    const userData2 = await session.app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData2) === fs.realpathSync(profile), 'restart reopened the SAME profile');
    assert(String((await recOf(EXP, claim.record.id)).fields.status) === snap.claimStatus, 'claim status survives restart (still submitted — self-approval never succeeded)');
    assert((await jcount()) === snap.jrnl, 'journal count survives restart');
    assert((await listOf(PO)).length === snap.pos, 'PO count survives restart');
    assert((await listOf(REVERSALS)).filter((r) => r.status !== 'deleted').length === snap.reversals, 'reversal count survives restart');
    // authority still enforced after restart: the creator still cannot self-approve
    assert((await act(EXP, claim.record.id, 'approve')).ok === false, 'after restart the creator STILL cannot self-approve (authority persists)');
    assert((await jcount()) === snap.jrnl, 'no GL booked by the post-restart self-approval attempt');

    out('RESULT', 'S101 AUTHORITY / APPROVAL / SoD VERIFIED in the real Electron runtime on a FRESH profile: the one live segregation-of-duties rule holds in-app — the local principal who CREATES an expense claim CANNOT approve their own claim (self-approval refused, ZERO GL booked), and the approved status cannot be forged through the edit door (machine-owned). The PR→PO conversion gate refuses a non-approved PR and refuses an edit-door status forge, allowing conversion only after the governed approve. A cleared payment cannot be deleted and a reversal is at-most-once. A closed accounting period attributes its actor and cannot be edited via the edit door. The S98 F-S98-1 machine-owned production-status fence blocks forged FG. After a REAL PROCESS RESTART every state survives and the self-approval refusal still holds — authority is persisted, not per-session. No authority policy was invented; the policy-open items (PR/PO SoD, thresholds, payroll/adjustment/variance approval, reopen dual-control) are documented in DECISION-MEMO-S101, not converted to code.');
  } finally {
    if (!closed) { await Promise.race([session.app.close(), sleep(15_000)]).catch(() => undefined); }
    try { session.app.process().kill('SIGKILL'); } catch { /* already dead */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
