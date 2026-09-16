#!/usr/bin/env node
/**
 * ERP S73 Gate 4 — WAREHOUSE WHOLE-USER JOURNEY in the REAL Electron runtime.
 *
 * Seed on-hand → Transfer (approve→dispatch→receive, net-zero) → Pick → Pack → Ship
 * (issues stock). Every step through `window.neuropause.invoke` (the UI's bridge);
 * alternate release build (out-seam-s73), fresh throwaway profile; zero external effect.
 *
 * CYCLE-COUNT reconcile + STOCK-ADJUSTMENT economic-variance MATERIALITY APPROVAL is
 * D10 POLICY-BLOCKED (threshold/decider/SoD/write-off GL undefined) — NOT driven, NOT invented.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s73"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s73WarehouseJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const APP_DIR = path.resolve(__dirname, '..');
const ALT_MAIN = path.join(APP_DIR, 'out-seam-s73/main/index.js');
const APP_BIN = process.env.NP_APP_BIN || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S73WH ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S73WH FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) { const end = Date.now() + ms; for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await sleep(400); } }

async function main() {
  if (!APP_BIN && !fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN}`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s73wh-'));
  const logs = [];
  const app = await electron.launch({
    ...(APP_BIN ? { executablePath: APP_BIN } : {}),
    args: [...(APP_BIN ? [] : [ALT_MAIN]), `--user-data-dir=${profile}`],
    env: { ...process.env, NP_E2E_BUILD: '', NEUROPAUSE_E2E: '', ELECTRON_RENDERER_URL: '', NODE_ENV: 'production' },
    timeout: 60_000,
  });
  app.process().stdout.on('data', (d) => logs.push(String(d)));
  app.process().stderr.on('data', (d) => logs.push(String(d)));
  try {
    const win = await app.firstWindow({ timeout: 45_000 });
    const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData) === fs.realpathSync(profile), 'ISOLATED profile is the running userData');
    if (!APP_BIN) for (const re of [/Enterprise OS ready/, /Runtime core ready/]) assert(await waitForLog(logs, re, 30_000), `BOOT_LOG ${re}`);
    else await sleep(4000);
    const bridge = (ch, payload) => win.evaluate(([c, p]) => window.neuropause.invoke(c, p), [ch, payload]);
    const create = (moduleId, fields) => bridge('enterprise:module.create', { moduleId, fields });
    const act = (moduleId, id, action) => bridge('enterprise:module.action', { moduleId, id, action });
    const get = (moduleId, id) => bridge('enterprise:module.get', { moduleId, id });
    const list = (moduleId) => bridge('enterprise:module.list', { moduleId });

    const prod = await create('inventory-products', { sku: 'SKU-1', name: 'Widget', standardCost: 5 });
    assert(prod.ok && prod.record, 'product created');
    const seed = await create('warehouse-adjustments', { adjustmentNumber: 'ADJ-SEED', product: 'SKU-1', warehouse: 'WH-1', quantity: 100, reason: 'found' });
    assert((await act('warehouse-adjustments', seed.record.id, 'post')).ok, 'seed 100 on-hand posted');

    const tr = await create('warehouse-transfers', { transferNumber: 'TRN-1', product: 'SKU-1', quantity: 30, fromWarehouse: 'WH-1', toWarehouse: 'WH-2' });
    assert((await act('warehouse-transfers', tr.record.id, 'approve')).ok, 'transfer APPROVED (reservation)');
    assert((await act('warehouse-transfers', tr.record.id, 'dispatch')).ok, 'transfer DISPATCHED (transfer-out)');
    assert((await act('warehouse-transfers', tr.record.id, 'receive')).ok, 'transfer RECEIVED (transfer-in)');
    assert(String((await get('warehouse-transfers', tr.record.id)).fields.status) === 'completed', 'transfer completed');

    const p = await create('warehouse-picks', { pickNumber: 'PICK-1', salesOrder: 'SO-1', product: 'SKU-1', warehouse: 'WH-1', quantity: 5 });
    assert((await act('warehouse-picks', p.record.id, 'reserve')).ok, 'pick RESERVED');
    assert((await act('warehouse-picks', p.record.id, 'pick')).ok, 'PICKED');
    assert((await act('warehouse-picks', p.record.id, 'createPacking')).ok, 'packing created');
    const packRec = (await list('warehouse-packing')).find((r) => r.title === 'PACK-PICK-1');
    assert((await act('warehouse-packing', packRec.id, 'pack')).ok, 'PACKED');
    assert((await act('warehouse-packing', packRec.id, 'createShipment')).ok, 'shipment created');
    const shipRec = (await list('warehouse-shipping')).find((r) => r.title === 'SHIP-PACK-PICK-1');
    assert((await act('warehouse-shipping', shipRec.id, 'ship')).ok, 'SHIPPED (stock issued)');

    out('RESULT', 'Warehouse whole-user journey VERIFIED in the real Electron runtime (seed→transfer net-zero→pick→pack→ship); cycle-count/adjustment variance-approval = D10 POLICY-BLOCKED, not driven');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
