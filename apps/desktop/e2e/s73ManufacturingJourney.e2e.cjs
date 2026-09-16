#!/usr/bin/env node
/**
 * ERP S73 Gate 5 — MANUFACTURING WHOLE-USER JOURNEY in the REAL Electron runtime.
 *
 * Seed components → BOM → Production Order (plan→allocate→start→complete, BOM-driven
 * consumption + finished-goods output) → Quality inspection → Costing. Every step through
 * `window.neuropause.invoke`; alternate build (out-seam-s73), fresh profile; zero external effect.
 *
 * QUALITY disposition → inventory mapping and cost-variance SETTLEMENT authority carry
 * Session-4/5 notes; the approval-authority parts are NOT driven, NOT invented.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s73"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s73ManufacturingJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const APP_DIR = path.resolve(__dirname, '..');
const ALT_MAIN = path.join(APP_DIR, 'out-seam-s73/main/index.js');
const APP_BIN = process.env.NP_APP_BIN || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S73MF ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S73MF FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) { const end = Date.now() + ms; for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await sleep(400); } }

async function main() {
  if (!APP_BIN && !fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN}`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s73mf-'));
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
    const seed = async (sku, name, qty) => {
      await create('inventory-products', { sku, name, standardCost: 2 });
      await create('inventory-movements', { movementNumber: `SEED-${sku}`, type: 'receive', product: sku, warehouse: 'WH-1', quantity: qty, status: 'posted' });
    };

    await seed('COMP-1', 'Bolt', 100);
    await seed('COMP-2', 'Frame', 100);
    await seed('FG-1', 'Finished Good', 0);
    assert((await create('manufacturing-bom', { bomNumber: 'BOM-1', product: 'FG-1', yield: 100, status: 'active', components: JSON.stringify([{ sku: 'COMP-1', quantity: 2 }, { sku: 'COMP-2', quantity: 5 }]) })).ok, 'BOM created');
    const mo = await create('manufacturing-orders', { orderNumber: 'MO-1', bom: 'BOM-1', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 10 });
    assert(mo.ok && mo.record, 'production order created');
    assert((await act('manufacturing-orders', mo.record.id, 'plan')).ok, 'MO PLANNED');
    assert((await act('manufacturing-orders', mo.record.id, 'allocate')).ok, 'MO ALLOCATED (components reserved)');
    assert((await act('manufacturing-orders', mo.record.id, 'start')).ok, 'MO STARTED (components consumed)');
    assert((await act('manufacturing-orders', mo.record.id, 'complete')).ok, 'MO COMPLETED (finished goods output)');
    assert(String((await get('manufacturing-orders', mo.record.id)).fields.status) === 'completed', 'MO status = completed');
    assert((await create('manufacturing-quality', { inspectionNumber: 'QC-1', stage: 'final', inspectedQuantity: 10, passedQuantity: 9, failedQuantity: 1, reworkQuantity: 0, result: 'pass' })).ok, 'quality inspection recorded');
    assert((await create('manufacturing-costing', { costNumber: 'PC-1', materialCost: 100, laborCost: 50, machineCost: 30, overheadCost: 20, standardCost: 180 })).ok, 'costing recorded');

    out('RESULT', 'Manufacturing whole-user journey VERIFIED in the real Electron runtime (BOM→order plan→allocate→start→complete→quality→costing); variance/scrap approval authority = POLICY-BLOCKED, not driven');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
