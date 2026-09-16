#!/usr/bin/env node
/**
 * ERP S97 — INVENTORY + WAREHOUSE control-plane journey in the REAL Electron runtime, on a FRESH
 * isolated profile with NO seeded ERP state and NO IPC shortcuts. Certifies the stock-movement ledger
 * as the CANONICAL stock authority used by both P2P (receive) and O2C (issue), plus reservations, ATP,
 * ledger immutability (edit AND delete — F-S97-1), and durability across a real restart.
 *
 *   product/warehouse → P2P receipt (PO→GR→PostGoodsReceipt, +Q1) → reserve (SO reserveStock)
 *     → ATP snapshot (available + incoming) → O2C issue (SO ship, −Q2) → negatives → restart
 *
 * Proves: product on-hand/reserved/available materialize the ledger; receive/issue each post exactly
 * one movement; reservation lowers available without changing on-hand; ATP = available + incoming and
 * mutates no stock; a POSTED movement can be neither EDITED nor DELETED (F-S97-1 guard); and after a
 * real restart the ledger + stock + reservations survive.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s97"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s97InventoryWarehouseJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ALT_MAIN = path.join(path.resolve(__dirname, '..'), 'out-seam-s97/main/index.js');
const STANDARD_COST = 6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S97 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S97 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
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
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build out-seam-s97 first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s97-'));
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
    const prod = async () => (await listOf('inventory-products')).find((r) => String(r.fields.sku) === 'SKU-1');
    const onHand = async () => Number((await prod())?.fields?.currentStock ?? 0);
    const reserved = async () => Number((await prod())?.fields?.reservedStock ?? 0);
    const available = async () => Number((await prod())?.fields?.availableStock ?? 0);
    const waitOnHand = async (t) => { for (let i = 0; i < 40; i += 1) { if ((await onHand()) === t) return true; await sleep(250); } return (await onHand()) === t; };
    const movesOf = async (t) => (await listOf('inventory-movements')).filter((m) => m.status !== 'deleted' && String(m.fields.type) === t);

    const userData = await session.app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData) === fs.realpathSync(profile), 'FRESH isolated profile is the running userData');
    assert((await listOf('inventory-movements')).length === 0 && (await listOf('inventory-products')).length === 0, 'fresh profile has NO seeded ERP state');

    // product (the master) + on-hand via P2P; use the reorder→PO→GR→PostGoodsReceipt receiving path
    assert((await create('inventory-products', { sku: 'SKU-1', name: 'Widget', purchaseCost: 4, standardCost: STANDARD_COST, reorderLevel: 200, safetyStock: 50, maximumStock: 500 })).ok, 'product master SKU-1 created');
    assert((await create('inventory-movements', { movementNumber: 'MV-SEED', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 })).ok, 'seeded 100 on-hand (one receive movement)');
    const s0 = await create('warehouse-shipping', { shipmentNumber: 'SHIP-0', product: 'SKU-1', warehouse: 'WH-1', quantity: 30 });
    assert((await act('warehouse-shipping', s0.record.id, 'ship')).ok, 'warehouse ship 30');
    assert(await waitOnHand(70), 'on-hand reconciled to 70 (product materializes the ledger)');

    // P2P receipt
    const dec = await create('inventory-reorder-decision', { asOfDate: new Date().toISOString().slice(0, 10) });
    const confirm = await dispatch('CreatePurchaseRequestFromReorderRecommendation', dec.record.id, `r:${dec.record.id}`, { sku: 'SKU-1' });
    const prId = String(confirm.data.id); const q1 = Number(confirm.data.quantity);
    await dispatch('SubmitPurchaseRequest', prId, `sub:${prId}`); await dispatch('ApprovePurchaseRequest', prId, `app:${prId}`); await dispatch('ConvertPurchaseRequestToPO', prId, `conv:${prId}`);
    const po = (await listOf('procurement-orders')).find((r) => String(r.fields.sourceRequest) === prId);
    await update('procurement-orders', po.id, { warehouse: 'WH-1', supplier: 'Acme', unitCost: STANDARD_COST });
    await act('procurement-orders', po.id, 'approve'); await act('procurement-orders', po.id, 'send'); await act('procurement-orders', po.id, 'receiveGoods');
    const gr = (await listOf('procurement-receipts')).find((r) => String(r.fields.purchaseOrder) === po.id);
    const recvBefore = (await movesOf('receive')).length;
    assert((await dispatch('PostGoodsReceipt', gr.id, `post:${gr.id}`)).ok === true, 'P2P PostGoodsReceipt');
    assert(await waitOnHand(70 + q1), `P2P receipt: on-hand 70 → ${70 + q1}`);
    assert((await movesOf('receive')).length === recvBefore + 1, 'receiving posts EXACTLY ONE receive movement');

    // reservations (SO reserveStock)
    const customer = await create('crm-customers', { name: 'Beta' });
    const soR = await dispatch('CreateSalesOrder', undefined, 'sor', { orderNumber: 'SO-R', customer: 'Beta', customerRef: customer.record.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: 25, total: 250 });
    const onBeforeRes = await onHand();
    assert((await act('sales-orders', String(soR.data.id), 'reserveStock')).ok, 'reserve 25 (SO reserveStock)');
    await sleep(400);
    assert((await onHand()) === onBeforeRes, 'reservation does NOT change on-hand (no phantom inventory)');
    assert((await reserved()) === 25, 'reserved == 25');
    assert((await available()) === onBeforeRes - 25, 'available == on-hand − reserved');
    assert((await act('sales-orders', String(soR.data.id), 'reserveStock')).ok === false, 'a duplicate reservation is refused');

    // ATP snapshot: ATP = available + incoming; mutates no stock
    const onBeforeAtp = await onHand();
    const atp = await create('inventory-atp', { asOfDate: '2026-09-01' });
    assert(atp.ok, 'ATP snapshot generated');
    assert(Number(atp.record.fields.totalAvailable) === (await available()), 'ATP available == ledger available');
    assert(Number(atp.record.fields.totalAtp) === Number(atp.record.fields.totalAvailable) + Number(atp.record.fields.totalIncoming), 'ATP == available + incoming');
    assert((await onHand()) === onBeforeAtp, 'generating an ATP report moved NO stock');

    // O2C issue (SO ship)
    const soS = await dispatch('CreateSalesOrder', undefined, 'sos', { orderNumber: 'SO-S', customer: 'Beta', customerRef: customer.record.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: 40, total: 400 });
    const issBefore = (await movesOf('issue')).length;
    const onBeforeShip = await onHand();
    assert((await act('sales-orders', String(soS.data.id), 'ship')).ok === false, 'raw-door ship refused (governed-command-only)');
    assert((await dispatch('ShipSalesOrder', String(soS.data.id), 'ship')).ok === true, 'O2C ShipSalesOrder (governed)');
    assert(await waitOnHand(onBeforeShip - 40), `O2C issue: on-hand ${onBeforeShip} → ${onBeforeShip - 40}`);
    assert((await movesOf('issue')).length === issBefore + 1, 'shipping posts EXACTLY ONE issue movement');

    // NEGATIVES — immutable ledger: a posted movement can be neither edited nor DELETED (F-S97-1)
    const anyReceive = (await movesOf('receive'))[0];
    assert((await update('inventory-movements', anyReceive.id, { quantity: 999 })).ok === false, 'a posted movement cannot be edited (immutable ledger)');
    const onBeforeDel = await onHand();
    const delRes = await del('inventory-movements', anyReceive.id);
    assert(delRes && delRes.ok === false, 'F-S97-1: a POSTED stock movement cannot be DELETED (would silently corrupt on-hand)');
    await sleep(400);
    assert((await onHand()) === onBeforeDel, 'on-hand UNCHANGED after the refused delete (corruption closed)');

    // snapshot for restart
    const snap = { on: await onHand(), res: await reserved(), avail: await available(), recv: (await movesOf('receive')).length, iss: (await movesOf('issue')).length, ledger: (await listOf('inventory-movements')).filter((m) => m.status !== 'deleted').length };

    // RESTART
    await session.app.close(); closed = true;
    session = await launch(profile); closed = false;
    const userData2 = await session.app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData2) === fs.realpathSync(profile), 'restart reopened the SAME profile');
    assert((await onHand()) === snap.on, 'on-hand unchanged after restart');
    assert((await reserved()) === snap.res, 'reserved unchanged after restart');
    assert((await available()) === snap.avail, 'available unchanged after restart');
    assert((await movesOf('receive')).length === snap.recv, 'receive movement count unchanged after restart');
    assert((await movesOf('issue')).length === snap.iss, 'issue movement count unchanged after restart');
    assert((await listOf('inventory-movements')).filter((m) => m.status !== 'deleted').length === snap.ledger, 'ledger count unchanged after restart');
    // ATP recomputed after restart is stable
    const atp2 = await create('inventory-atp', { asOfDate: '2026-09-05' });
    assert(Number(atp2.record.fields.totalAvailable) === snap.avail, 'ATP available stable after restart');

    out('RESULT', 'S97 inventory + warehouse control plane VERIFIED in the real Electron runtime on a FRESH profile: the stock-movement ledger is the CANONICAL authority (product on-hand/reserved/available materialize it); P2P receiving and O2C shipping each post exactly one movement (on-hand + then − on the shared ledger); a reservation lowers available without changing on-hand (no phantom) and a duplicate reservation is refused; ATP = available + incoming and mutates no stock; a POSTED movement can be neither edited nor DELETED (F-S97-1 ledger-immutability guard — on-hand unchanged after the refused delete); and after a REAL PROCESS RESTART the ledger, stock, and reservations survive.');
  } finally {
    if (!closed) { await Promise.race([session.app.close(), sleep(15_000)]).catch(() => undefined); }
    try { session.app.process().kill('SIGKILL'); } catch { /* already dead */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
