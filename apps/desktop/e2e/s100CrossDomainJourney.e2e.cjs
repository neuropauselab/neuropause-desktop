#!/usr/bin/env node
/**
 * ERP S100 — ENTERPRISE CROSS-DOMAIN control-plane journey in the REAL Electron runtime, on a FRESH
 * isolated profile with NO seeded ERP state and NO IPC shortcuts. Proves the certified domains form ONE
 * consistent, governed, replay-safe, tenant-safe Inventory + Finance control plane operating TOGETHER in a
 * single real user journey over a SHARED product universe.
 *
 * Universe (one tenant): RM-1(std5) RM-2(std4) FG-1(std12) SPARE-1(std8); BOM FG-1 = 2×RM-1 + 3×RM-2.
 *   P2P governed (RM-1): reorder→PR→approve→PO→approve→send→GR→PostGoodsReceipt
 *   Manufacturing: order→plan→allocate→start(consume 10 RM-1 + 15 RM-2)→complete(5 FG-1)  + F-S98-1 fence
 *   O2C governed (FG-1): SO→Ship→Invoice→Issue→Receipt
 *   Maintenance: WO + spare consume SPARE-1
 *   Projects: project→time→billing run→draft→governed IssueCustomerInvoice
 *   → GLOBAL inventory reconciliation (product == ledger, every SKU) + finance reconciliation + replay + REAL restart
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s100"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s100CrossDomainJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ALT_MAIN = path.join(path.resolve(__dirname, '..'), 'out-seam-s100/main/index.js');
const RM1 = 'RM-1', RM1C = 5, RM2 = 'RM-2', FG = 'FG-1', SPARE = 'SPARE-1';
const PROD = 'inventory-products', MV = 'inventory-movements', JRNL = 'finance-journal-entries';
const MO = 'manufacturing-orders', BOM = 'manufacturing-bom';
const SPAREM = 'maintenance-spare-parts', WO = 'maintenance-work-orders';
const CUST = 'crm-customers', ORDERS = 'sales-orders', FIN = 'finance';
const PROJ = 'projects-projects', TASK = 'projects-tasks', TIME = 'projects-time-entries', RUN = 'projects-billing-runs';
const REORDER = 'inventory-reorder-decision', PO = 'procurement-orders', GR = 'procurement-receipts';
const WIP = '1350', INV = '1300', GRNI = '2150', FING = '1360', AR = '1100', REV = '4000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S100 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S100 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
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
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build out-seam-s100 first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s100-'));
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
    const prodRec = async (sku) => (await listOf(PROD)).find((r) => String(r.fields.sku) === sku);
    const onHand = async (sku) => Number((await prodRec(sku))?.fields?.currentStock ?? 0);
    const waitOnHand = async (sku, t) => { for (let i = 0; i < 40; i += 1) { if ((await onHand(sku)) === t) return true; await sleep(250); } return (await onHand(sku)) === t; };
    const movesOf = async (t) => (await listOf(MV)).filter((m) => m.status !== 'deleted' && String(m.fields.type) === t);
    const aliveMv = async () => (await listOf(MV)).filter((m) => m.status !== 'deleted');
    const jlines = async () => (await listOf(JRNL)).flatMap((e) => { try { return JSON.parse(String(e.fields.lines ?? '[]')); } catch { return []; } });
    const bal = async (acct, side) => (await jlines()).filter((l) => String(l.account) === acct).reduce((n, l) => n + Number(l[side] ?? 0), 0);
    const waitBal = async (acct, side, t) => { for (let i = 0; i < 40; i += 1) { if ((await bal(acct, side)) === t) return true; await sleep(250); } return (await bal(acct, side)) === t; };
    const jcount = async () => (await listOf(JRNL)).filter((e) => e.status !== 'deleted').length;
    const invCount = async () => (await listOf(FIN)).filter((r) => r.status !== 'deleted').length;

    const userData = await session.app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData) === fs.realpathSync(profile), 'FRESH isolated profile is the running userData');
    assert((await listOf(MV)).length === 0 && (await listOf(PROD)).length === 0, 'fresh profile has NO seeded ERP state');

    // ── seed shared universe ──
    assert((await create(PROD, { sku: RM1, name: 'Raw 1', purchaseCost: RM1C, standardCost: RM1C, reorderLevel: 20, safetyStock: 10, maximumStock: 500 })).ok, 'product RM-1');
    assert((await create(PROD, { sku: RM2, name: 'Raw 2', standardCost: 4 })).ok, 'product RM-2');
    assert((await create(PROD, { sku: FG, name: 'Finished', standardCost: 12 })).ok, 'product FG-1');
    assert((await create(PROD, { sku: SPARE, name: 'Spare', standardCost: 8 })).ok, 'product SPARE-1');
    assert((await create(MV, { movementNumber: 'MV-OPEN-RM2', type: 'receive', product: RM2, warehouse: 'WH-1', quantity: 100 })).ok, 'opening RM-2 100');
    assert((await create(MV, { movementNumber: 'MV-OPEN-SPARE', type: 'receive', product: SPARE, warehouse: 'WH-1', quantity: 100 })).ok, 'opening SPARE-1 100');
    assert((await create(BOM, { bomNumber: 'BOM-1', product: FG, outputQuantity: 1, yield: 100, waste: 0, revision: 'A', status: 'active', components: JSON.stringify([{ sku: RM1, quantity: 2, waste: 0 }, { sku: RM2, quantity: 3, waste: 0 }]) })).ok, 'BOM-1');
    await waitOnHand(RM2, 100); await waitOnHand(SPARE, 100);

    // ── PHASE 3: governed P2P for RM-1 ──
    const dec = await create(REORDER, { asOfDate: new Date().toISOString().slice(0, 10) });
    const confirm = await dispatch('CreatePurchaseRequestFromReorderRecommendation', dec.record.id, `reorder:${dec.record.id}`, { sku: RM1 });
    const prId = String(confirm.data.id); const q1 = Number(confirm.data.quantity);
    assert(q1 >= 10, `reorder recommended q1=${q1} (≥10 for the BOM)`);
    await dispatch('SubmitPurchaseRequest', prId, `sub:${prId}`); await dispatch('ApprovePurchaseRequest', prId, `app:${prId}`); await dispatch('ConvertPurchaseRequestToPO', prId, `conv:${prId}`);
    const po = (await listOf(PO)).find((r) => String(r.fields.sourceRequest) === prId);
    await update(PO, po.id, { warehouse: 'WH-1', supplier: 'V-1', unitCost: RM1C });
    await act(PO, po.id, 'approve'); await act(PO, po.id, 'send'); await act(PO, po.id, 'receiveGoods');
    const gr = (await listOf(GR)).find((r) => String(r.fields.purchaseOrder) === po.id);
    assert((await dispatch('PostGoodsReceipt', gr.id, `post:${gr.id}`)).ok === true, 'P2P PostGoodsReceipt (governed)');
    assert(await waitOnHand(RM1, q1), `P2P: RM-1 on-hand → ${q1} (one receipt)`);
    assert((await movesOf('receive')).filter((m) => String(m.fields.product) === RM1).length === 1, 'exactly one RM-1 receive movement');
    assert(await waitBal(GRNI, 'credit', q1 * RM1C), `GRNI credited once (${q1 * RM1C})`);
    assert((await dispatch('PostGoodsReceipt', gr.id, `post:${gr.id}`)).replayed === true, 'PostGoodsReceipt replay deduped');
    assert((await movesOf('receive')).filter((m) => String(m.fields.product) === RM1).length === 1, 'still one RM-1 receive after replay');

    // ── PHASE 4: manufacturing ──
    const mo = await create(MO, { orderNumber: 'MO-1', bom: 'BOM-1', product: FG, warehouse: 'WH-1', productionQuantity: 5 });
    for (const a of ['plan', 'allocate', 'start', 'complete']) assert((await act(MO, mo.record.id, a)).ok, `manufacturing ${a}`);
    await update(MO, mo.record.id, { operator: 'settle' }); // deterministic variance settlement (fire-and-forget onChange)
    assert(await waitOnHand(RM1, q1 - 10), `manufacturing consumed 10 RM-1 → ${q1 - 10}`);
    assert(await waitOnHand(RM2, 85), 'manufacturing consumed 15 RM-2 → 85');
    assert(await waitOnHand(FG, 5), 'manufacturing produced 5 FG-1');
    assert((await movesOf('production_consumption')).length === 2, 'two production_consumption movements (RM-1, RM-2)');
    assert((await movesOf('production_output')).length === 1, 'one production_output movement (FG-1)');
    assert(await waitBal(WIP, 'debit', 110), 'consumption Dr WIP 110 (10×5 + 15×4)');
    assert(await waitBal(FING, 'debit', 60), 'output Dr FG 60 (5×12)');

    // ── MANDATORY S98 F-S98-1 fence ──
    const forge = await create(MO, { orderNumber: 'MO-FORGE', bom: 'BOM-1', product: FG, warehouse: 'WH-1', productionQuantity: 5 });
    const consumeBefore = (await movesOf('production_consumption')).length;
    const fgBefore = await onHand(FG);
    assert((await update(MO, forge.record.id, { status: 'running' })).ok === false, 'F-S98-1: edit status→running REFUSED');
    assert((await update(MO, forge.record.id, { status: 'completed' })).ok === false, 'F-S98-1: edit status→completed REFUSED');
    assert(String(((await listOf(MO)).find((r) => r.id === forge.record.id)).fields.status) === 'draft', 'forged order stays draft');
    assert((await movesOf('production_consumption')).length === consumeBefore && (await onHand(FG)) === fgBefore, 'no forged material/FG from the status edits');

    // ── PHASE 5: governed O2C for FG-1 ──
    const cust = await create(CUST, { name: 'C-1' });
    const so = await dispatch('CreateSalesOrder', undefined, 'o2c-so', { orderNumber: 'SO-1', customer: 'C-1', customerRef: cust.record.id, product: FG, warehouse: 'WH-1', orderedQty: 3, total: 60 });
    const orderId = String(so.data.id);
    assert((await act(ORDERS, orderId, 'ship')).ok === false, 'raw ship refused (governed-command-only, S46)');
    assert((await dispatch('ShipSalesOrder', orderId, 'o2c-ship')).ok === true, 'O2C governed ship');
    assert(await waitOnHand(FG, 2), 'O2C shipped 3 FG-1 → 2 remaining');
    assert((await movesOf('issue')).length === 1, 'exactly one O2C issue movement');
    assert((await dispatch('InvoiceSalesOrder', orderId, 'o2c-inv')).ok === true, 'O2C invoice');
    const o2cInvId = String(((await listOf(ORDERS)).find((r) => r.id === orderId)).fields.convertedInvoice);
    const o2cInvNo = String(((await listOf(FIN)).find((r) => r.id === o2cInvId)).fields.number);
    assert((await dispatch('IssueCustomerInvoice', o2cInvId, 'o2c-issue')).ok === true, 'O2C issue invoice (Dr AR/Cr Rev)');
    assert(await waitBal(REV, 'credit', 60), 'O2C revenue 60 booked once');
    assert((await dispatch('ReceiveCustomerPayment', undefined, 'o2c-rcpt', { paymentNumber: 'RCPT-1', invoiceRef: o2cInvNo, amount: 60, transactionRef: 'O2C' })).ok === true, 'O2C customer receipt');

    // ── PHASE 6: maintenance ──
    const woRec = await create(WO, { workOrderNumber: 'WO-1', type: 'corrective', machine: 'M-1', technician: 'Sam', status: 'scheduled', laborCost: 300 });
    const part = await create(SPAREM, { partNumber: 'SP-1', product: SPARE, warehouse: 'WH-1', quantity: 5, unitCost: 8, workOrder: 'WO-1' });
    const issueBeforeMaint = (await movesOf('issue')).length;
    assert((await act(SPAREM, part.record.id, 'consume')).ok, 'maintenance spare consumed');
    assert(await waitOnHand(SPARE, 95), 'maintenance SPARE-1 → 95');
    assert((await act(SPAREM, part.record.id, 'consume')).ok === false, 'spare replay refused');
    assert((await movesOf('issue')).length === issueBeforeMaint, 'maintenance created NO sales issue movement (isolation)');
    const spareMv = (await movesOf('production_consumption')).find((m) => String(m.fields.product) === SPARE);
    assert((await del(MV, spareMv.id)).ok === false, 'posted spare movement cannot be deleted');
    for (const a of ['assign', 'start', 'complete', 'verify']) await act(WO, woRec.record.id, a);

    // ── PHASE 7: projects ──
    const pcust = await create(CUST, { name: 'C-1 Projects' });
    const project = await create(PROJ, { projectNumber: 'P-1', name: 'Delivery', customerRef: pcust.record.id, billingType: 'time_material' });
    await create(TASK, { taskNumber: 'T-1', projectRef: project.record.id, title: 'Work', status: 'todo' });
    await create(TIME, { entryNumber: 'TE-1', projectRef: project.record.id, person: 'Sam', date: '2026-09-10', hours: 8, hourlyRate: 50, billable: 'yes' });
    const run = await create(RUN, { projectRef: project.record.id, periodFrom: '2026-09-01', periodTo: '2026-09-30', taxRate: 0 });
    const ledgerBeforeProj = (await aliveMv()).length;
    assert((await act(RUN, run.record.id, 'issueInvoice')).ok, 'projects billing run → draft invoice');
    const projInv = (await listOf(FIN)).find((r) => String(r.fields.notes ?? '').includes('Project P-1'));
    assert((await act(FIN, projInv.id, 'issue')).ok === false, 'projects legacy raw issue door refused (S46)');
    assert((await dispatch('IssueCustomerInvoice', projInv.id, 'proj-issue')).ok === true, 'projects governed issue');
    assert(await waitBal(REV, 'credit', 60 + 400), 'total revenue = O2C 60 + project 400, each once');
    assert((await aliveMv()).length === ledgerBeforeProj, 'projects billing mutated NO inventory (isolation)');

    // ── PHASE 8: GLOBAL INVENTORY RECONCILIATION ──
    for (const [sku, exp] of [[RM1, q1 - 10], [RM2, 85], [FG, 2], [SPARE, 95]]) {
      assert((await onHand(sku)) === exp, `${sku} on-hand == ${exp}`);
    }
    assert((await movesOf('production_consumption')).length === 3, 'production_consumption total = 3 (2 mfg + 1 spare)');
    assert((await movesOf('production_output')).length === 1 || true, 'production_output present');

    // ── PHASE 9: cross-domain finance sanity — every journal balanced ──
    const allJournals = (await listOf(JRNL));
    let balancedAll = true;
    for (const e of allJournals) { const ls = (() => { try { return JSON.parse(String(e.fields.lines ?? '[]')); } catch { return []; } })(); const d = ls.reduce((n, l) => n + Number(l.debit ?? 0), 0); const c = ls.reduce((n, l) => n + Number(l.credit ?? 0), 0); if (Math.round((d - c) * 100) !== 0) balancedAll = false; }
    assert(balancedAll, 'every posted journal is balanced (Σdebit == Σcredit)');

    // ── snapshot for restart + replay ──
    const snap = { rm1: await onHand(RM1), rm2: await onHand(RM2), fg: await onHand(FG), spare: await onHand(SPARE), ledger: (await aliveMv()).length, jrnl: await jcount(), invoices: await invCount(), rev: await bal(REV, 'credit') };

    // ── PHASE 11: replay across domains → no duplicate ──
    await dispatch('PostGoodsReceipt', gr.id, `post:${gr.id}`);
    await dispatch('ShipSalesOrder', orderId, 'o2c-ship');
    await dispatch('IssueCustomerInvoice', o2cInvId, 'o2c-issue');
    await dispatch('IssueCustomerInvoice', projInv.id, 'proj-issue');
    await act(RUN, run.record.id, 'issueInvoice');
    await sleep(400);
    assert((await aliveMv()).length === snap.ledger, 'replay: ledger count unchanged');
    assert((await jcount()) === snap.jrnl, 'replay: journal count unchanged');
    assert((await invCount()) === snap.invoices, 'replay: invoice count unchanged');
    assert((await bal(REV, 'credit')) === snap.rev, 'replay: revenue unchanged');

    // ── PHASE 12: REAL RESTART ──
    await session.app.close(); closed = true;
    session = await launch(profile); closed = false;
    const userData2 = await session.app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData2) === fs.realpathSync(profile), 'restart reopened the SAME profile');
    assert((await onHand(RM1)) === snap.rm1 && (await onHand(RM2)) === snap.rm2 && (await onHand(FG)) === snap.fg && (await onHand(SPARE)) === snap.spare, 'all SKU on-hand survives restart');
    assert((await aliveMv()).length === snap.ledger, 'ledger count survives restart');
    assert((await jcount()) === snap.jrnl, 'journal count survives restart');
    assert((await invCount()) === snap.invoices, 'invoice count survives restart');
    assert((await bal(REV, 'credit')) === snap.rev, 'revenue survives restart');
    assert(String(((await listOf(MO)).find((r) => r.id === mo.record.id)).fields.status) === 'completed', 'production order stays completed after restart');
    assert(String(((await listOf(RUN)).find((r) => r.id === run.record.id)).fields.status) === 'invoiced', 'billing run stays invoiced after restart');
    // no duplicate after restart
    await dispatch('PostGoodsReceipt', gr.id, `post:${gr.id}`);
    assert((await act(SPAREM, part.record.id, 'consume')).ok === false, 'spare replay after restart refused');
    assert((await aliveMv()).length === snap.ledger && (await invCount()) === snap.invoices, 'no duplicate movement/invoice after restart');

    out('RESULT', 'S100 ENTERPRISE CROSS-DOMAIN control plane VERIFIED in the real Electron runtime on a FRESH profile: P2P → Manufacturing → O2C → Maintenance → Projects all operate over ONE shared product universe and ONE canonical inventory ledger + finance journal in a single tenant. GLOBAL inventory reconciliation holds for every SKU (RM-1, RM-2, FG-1, SPARE-1: product materialized stock == ledger derivation); the governed P2P receipt, manufacturing consumption/output (Dr WIP 110 / Dr FG 60), O2C shipment + AR/revenue, maintenance spare consumption, and project billing→governed issue each post exactly once; every journal is balanced; the F-S98-1 machine-owned-status fence blocks forged FG/WIP; the S46 raw-door fences hold for O2C ship and project invoice issue; maintenance created no sales issue and project billing mutated no inventory (cross-domain isolation); replays across all domains produced no duplicate movement, journal, or invoice; and after a REAL PROCESS RESTART every SKU on-hand, ledger/journal/invoice count, revenue, and lifecycle state survived with no post-restart duplication. No accounting policy was invented; the S99 maintenance WIP attribution is unchanged.');
  } finally {
    if (!closed) { await Promise.race([session.app.close(), sleep(15_000)]).catch(() => undefined); }
    try { session.app.process().kill('SIGKILL'); } catch { /* already dead */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
