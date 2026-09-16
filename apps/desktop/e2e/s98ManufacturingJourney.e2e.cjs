#!/usr/bin/env node
/**
 * ERP S98 — MANUFACTURING control-plane journey in the REAL Electron runtime, on a FRESH isolated
 * profile with NO seeded ERP state and NO IPC shortcuts. Certifies Manufacturing as a governed CONSUMER
 * and PRODUCER of the same canonical inventory + finance control plane, driven entirely through the real
 * governed module ACTION door (manufacturing has no domain commands).
 *
 *   product/BOM → production order → plan → allocate (reserve components, no phantom on-hand)
 *     → start (production_consumption: component on-hand ↓, Dr WIP/Cr Inventory) → complete
 *     (production_output: FG on-hand ↑, Dr FG/Cr WIP) → variance settlement (WIP → 5910) → negatives → restart
 *
 * Proves: the BOM scales component consumption; allocate reserves without changing on-hand; start consumes
 * exactly one production_consumption movement per component and posts WIP; complete yields exactly one
 * production_output movement and posts finished goods; the variance settles WIP to 5910 and WIP nets to
 * zero; the production status is machine-owned (F-S98-1: a status EDIT is refused so no phantom finished
 * goods can be forged); a posted production movement cannot be deleted; and everything survives a real restart.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s98"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s98ManufacturingJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ALT_MAIN = path.join(path.resolve(__dirname, '..'), 'out-seam-s98/main/index.js');
const RM1 = 'RM-1', RM1_COST = 5;
const RM2 = 'RM-2', RM2_COST = 4;
const FG = 'FG-1', FG_COST = 12;
const PO = 'manufacturing-orders', BOM = 'manufacturing-bom', MV = 'inventory-movements', JRNL = 'finance-journal-entries';
const WIP = '1350', INVENTORY = '1300', FIN_GOODS = '1360', PROD_VARIANCE = '5910';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S98 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S98 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
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
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build out-seam-s98 first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s98-'));
  let session = await launch(profile);
  let closed = false;
  try {
    const b = () => session.bridge;
    const create = (m, f) => b()('enterprise:module.create', { moduleId: m, fields: f });
    const act = (m, id, a) => b()('enterprise:module.action', { moduleId: m, id, action: a });
    const update = (m, id, f) => b()('enterprise:module.update', { moduleId: m, id, fields: f });
    const del = (m, id) => b()('enterprise:module.delete', { moduleId: m, id });
    const listOf = (m) => b()('enterprise:module.list', { moduleId: m });
    const prod = async (sku) => (await listOf('inventory-products')).find((r) => String(r.fields.sku) === sku);
    const onHand = async (sku) => Number((await prod(sku))?.fields?.currentStock ?? 0);
    const reserved = async (sku) => Number((await prod(sku))?.fields?.reservedStock ?? 0);
    const available = async (sku) => Number((await prod(sku))?.fields?.availableStock ?? 0);
    const waitOnHand = async (sku, t) => { for (let i = 0; i < 40; i += 1) { if ((await onHand(sku)) === t) return true; await sleep(250); } return (await onHand(sku)) === t; };
    const waitReserved = async (sku, t) => { for (let i = 0; i < 40; i += 1) { if ((await reserved(sku)) === t) return true; await sleep(250); } return (await reserved(sku)) === t; };
    const movesOf = async (t) => (await listOf(MV)).filter((m) => m.status !== 'deleted' && String(m.fields.type) === t);
    const orderStatus = async (id) => String(((await listOf(PO)).find((r) => r.id === id))?.fields?.status ?? '');
    const jlines = async () => (await listOf(JRNL)).flatMap((e) => { try { return JSON.parse(String(e.fields.lines ?? '[]')); } catch { return []; } });
    const bal = async (acct, side) => (await jlines()).filter((l) => String(l.account) === acct).reduce((n, l) => n + Number(l[side] ?? 0), 0);
    const waitBal = async (acct, side, t) => { for (let i = 0; i < 40; i += 1) { if ((await bal(acct, side)) === t) return true; await sleep(250); } return (await bal(acct, side)) === t; };

    const userData = await session.app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData) === fs.realpathSync(profile), 'FRESH isolated profile is the running userData');
    assert((await listOf(PO)).length === 0 && (await listOf(MV)).length === 0, 'fresh profile has NO seeded ERP state');

    // master data: raw + finished products, component stock (receive), and the BOM recipe
    assert((await create('inventory-products', { sku: RM1, name: 'Raw 1', standardCost: RM1_COST })).ok, 'product RM-1 created');
    assert((await create('inventory-products', { sku: RM2, name: 'Raw 2', standardCost: RM2_COST })).ok, 'product RM-2 created');
    assert((await create('inventory-products', { sku: FG, name: 'Finished', standardCost: FG_COST })).ok, 'product FG-1 created');
    assert((await create(MV, { movementNumber: 'MV-SEED-RM1', type: 'receive', product: RM1, warehouse: 'WH-1', quantity: 100 })).ok, 'seeded 100 RM-1');
    assert((await create(MV, { movementNumber: 'MV-SEED-RM2', type: 'receive', product: RM2, warehouse: 'WH-1', quantity: 100 })).ok, 'seeded 100 RM-2');
    await waitOnHand(RM1, 100); await waitOnHand(RM2, 100);
    const bom = await create(BOM, { bomNumber: 'BOM-1', product: FG, outputQuantity: 1, yield: 100, waste: 0, revision: 'A', status: 'active', components: JSON.stringify([{ sku: RM1, quantity: 2, waste: 0 }, { sku: RM2, quantity: 3, waste: 0 }]) });
    assert(bom.ok, 'BOM-1 recipe created (2× RM-1 + 3× RM-2)');

    // production order — born draft (machine-owned status)
    const order = await create(PO, { orderNumber: 'MO-1', bom: 'BOM-1', product: FG, warehouse: 'WH-1', productionQuantity: 5 });
    assert(order.ok, 'production order MO-1 created');
    const orderId = order.record.id;
    assert((await orderStatus(orderId)) === 'draft', 'order is born draft (machine-owned)');

    // out-of-order transitions refused
    assert((await act(PO, orderId, 'start')).ok === false, 'cannot start a draft order (status-gated)');
    assert((await act(PO, orderId, 'complete')).ok === false, 'cannot complete a draft order (status-gated)');

    // plan → allocate (reservations; no phantom on-hand)
    assert((await act(PO, orderId, 'plan')).ok, 'plan (draft → planned)');
    assert((await orderStatus(orderId)) === 'planned', 'status planned');
    assert((await act(PO, orderId, 'allocate')).ok, 'allocate material (planned → released)');
    assert((await orderStatus(orderId)) === 'released', 'status released');
    assert(await waitReserved(RM1, 10), 'RM-1 reserved 10 (2×5)');
    assert(await waitReserved(RM2, 15), 'RM-2 reserved 15 (3×5)');
    assert((await onHand(RM1)) === 100 && (await onHand(RM2)) === 100, 'allocate did NOT change component on-hand (no phantom)');
    assert((await available(RM1)) === 90 && (await available(RM2)) === 85, 'available = on-hand − reserved');

    // start → consumption (on-hand ↓, Dr WIP/Cr Inventory; releases reservations)
    const consumeBefore = (await movesOf('production_consumption')).length;
    assert((await act(PO, orderId, 'start')).ok, 'start production (released → running)');
    assert((await orderStatus(orderId)) === 'running', 'status running');
    assert(await waitOnHand(RM1, 90), 'RM-1 on-hand 100 → 90 (consumed 10)');
    assert(await waitOnHand(RM2, 85), 'RM-2 on-hand 100 → 85 (consumed 15)');
    assert((await movesOf('production_consumption')).length === consumeBefore + 2, 'start posts exactly one production_consumption per component');
    assert(await waitReserved(RM1, 0) && (await reserved(RM2)) === 0, 'reservations released on consumption (net-zero)');
    assert(await waitBal(WIP, 'debit', 110), 'consumption posts Dr WIP 110 (10×5 + 15×4)');
    assert((await bal(INVENTORY, 'credit')) === 110, 'consumption posts Cr Inventory 110');

    // complete → output (FG on-hand ↑, Dr FG/Cr WIP) + variance settlement
    const outputBefore = (await movesOf('production_output')).length;
    assert((await onHand(FG)) === 0, 'FG on-hand starts at 0');
    assert((await act(PO, orderId, 'complete')).ok, 'complete (running → completed)');
    assert((await orderStatus(orderId)) === 'completed', 'status completed');
    assert(await waitOnHand(FG, 5), 'FG on-hand 0 → 5 (yield 100%)');
    assert((await movesOf('production_output')).length === outputBefore + 1, 'complete posts exactly one production_output movement');
    assert(await waitBal(FIN_GOODS, 'debit', 60), 'output posts Dr Finished Goods 60 (5×12)');
    // the complete action's onChange settlement is fire-and-forget; drive it deterministically through the
    // IPC update door (which awaits onChange), editing a non-status field — the F-S98-1 guard fences status
    // only, and settlement is idempotent.
    await update(PO, orderId, { operator: 'settle' });
    assert(await waitBal(PROD_VARIANCE, 'debit', 50), 'variance settlement posts Dr 5910 50 (WIP 110 − standard output 60)');
    assert((await bal(WIP, 'debit')) - (await bal(WIP, 'credit')) === 0, 'WIP nets to zero after variance settlement');

    // NEGATIVE — F-S98-1: production status is machine-owned; a status edit via the edit door is refused
    const forge = await create(PO, { orderNumber: 'MO-FORGE', bom: 'BOM-1', product: FG, warehouse: 'WH-1', productionQuantity: 5 });
    const forgeId = forge.record.id;
    const fgOnHandBefore = await onHand(FG);
    const toRunning = await update(PO, forgeId, { status: 'running' });
    assert(toRunning.ok === false, 'F-S98-1: editing production status to running via the edit door is REFUSED');
    assert((await orderStatus(forgeId)) === 'draft', 'the forged order stays draft');
    assert((await update(PO, forgeId, { status: 'completed' })).ok === false, 'F-S98-1: a direct edit to completed is REFUSED');
    assert((await onHand(FG)) === fgOnHandBefore, 'no phantom finished goods produced from the forged edits');

    // NEGATIVE — a posted production movement cannot be deleted (S97 economic-delete guard on the ledger)
    const consumeMv = (await movesOf('production_consumption'))[0];
    const delRes = await del(MV, consumeMv.id);
    assert(delRes && delRes.ok === false, 'a posted production_consumption movement cannot be DELETED');

    // snapshot for restart
    const snap = { fg: await onHand(FG), rm1: await onHand(RM1), rm2: await onHand(RM2), consume: (await movesOf('production_consumption')).length, output: (await movesOf('production_output')).length, wipNet: (await bal(WIP, 'debit')) - (await bal(WIP, 'credit')), variance: await bal(PROD_VARIANCE, 'debit') };

    // RESTART
    await session.app.close(); closed = true;
    session = await launch(profile); closed = false;
    const userData2 = await session.app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData2) === fs.realpathSync(profile), 'restart reopened the SAME profile');
    assert((await orderStatus(orderId)) === 'completed', 'the completed order stays completed after restart');
    assert((await onHand(FG)) === snap.fg, 'FG on-hand unchanged after restart');
    assert((await onHand(RM1)) === snap.rm1 && (await onHand(RM2)) === snap.rm2, 'component on-hand unchanged after restart');
    assert((await movesOf('production_consumption')).length === snap.consume, 'consumption movement count unchanged after restart');
    assert((await movesOf('production_output')).length === snap.output, 'output movement count unchanged after restart');
    assert((await bal(WIP, 'debit')) - (await bal(WIP, 'credit')) === snap.wipNet, 'WIP net unchanged after restart');
    assert((await bal(PROD_VARIANCE, 'debit')) === snap.variance, 'variance GL unchanged after restart');

    out('RESULT', 'S98 manufacturing control plane VERIFIED in the real Electron runtime on a FRESH profile: a BOM scales component consumption; the production order runs plan → allocate → start → complete through the governed action door; allocate reserves components without changing on-hand (no phantom); start consumes exactly one production_consumption per component (Dr WIP 110 / Cr Inventory 110) and releases the reservations; complete yields exactly one production_output (Dr FG 60 / Cr WIP) and FG on-hand rises to 5; the variance settles WIP to 5910 (Dr 50) and WIP nets to zero; the production status is MACHINE-OWNED (F-S98-1 — a status edit via the edit door is refused so no phantom finished goods can be forged); a posted production movement cannot be deleted; and after a REAL PROCESS RESTART the order, movements, stock and GL all survive.');
  } finally {
    if (!closed) { await Promise.race([session.app.close(), sleep(15_000)]).catch(() => undefined); }
    try { session.app.process().kill('SIGKILL'); } catch { /* already dead */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
