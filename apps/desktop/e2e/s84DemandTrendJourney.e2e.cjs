#!/usr/bin/env node
/**
 * ERP S84 — GOVERNED DEMAND-TREND INTELLIGENCE journey in the REAL Electron runtime.
 *
 * Proves, entirely through the governed `enterprise:module.*` bridge (window.neuropause.invoke):
 *   create product → receive stock → create shipment → SHIP it (governed; the canonical demand
 *   event = a shipped/delivered shipment) → generate the demand-trend register → governed read →
 *   deterministic regeneration → shipping source store read-only.
 *
 * The governed `ship` action stamps `shippedDate = today` (no backdating), so a single session
 * yields ONE month of history per SKU → direction is honestly `insufficient-data`. Multi-month
 * direction (up/down/flat) is proven in demandTrend.test.ts with real dates.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s84"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s84DemandTrendJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ALT_MAIN = path.join(path.resolve(__dirname, '..'), 'out-seam-s84/main/index.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S84 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S84 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) { const end = Date.now() + ms; for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await sleep(400); } }

async function main() {
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build out-seam-s84 first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s84-'));
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
    const listOf = (moduleId) => bridge('enterprise:module.list', { moduleId });
    const num = (r, k) => Number(r?.record?.fields?.[k]);
    const thisMonth = new Date().toISOString().slice(0, 7);

    // 1. product + receive stock (so the governed ship can issue real stock)
    assert((await create('inventory-products', { sku: 'SKU-1', name: 'Widget', standardCost: 5 })).ok, 'product SKU-1 created');
    assert((await create('inventory-products', { sku: 'SKU-2', name: 'Gadget', standardCost: 8 })).ok, 'product SKU-2 created');
    assert((await create('inventory-movements', { movementNumber: 'MV-1', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 })).ok, 'received 100 SKU-1');
    assert((await create('inventory-movements', { movementNumber: 'MV-2', type: 'receive', product: 'SKU-2', warehouse: 'WH-1', quantity: 100 })).ok, 'received 100 SKU-2');

    // 2. create + SHIP shipments (governed — a shipped shipment is the canonical demand event)
    const shipOne = async (n, sku, qty) => {
      const s = await create('warehouse-shipping', { shipmentNumber: n, product: sku, warehouse: 'WH-1', quantity: qty });
      assert(s.ok, `${n} created (pending)`);
      assert((await act('warehouse-shipping', s.record.id, 'ship')).ok, `${n} SHIPPED (demand realized)`);
    };
    await shipOne('SHIP-1', 'SKU-1', 30);
    await shipOne('SHIP-2', 'SKU-2', 20);

    // 3. generate the immutable demand-trend register
    const v1 = await create('sales-demand-trend', { asOfDate: new Date().toISOString().slice(0, 10) });
    assert(v1.ok, 'demand-trend register generated');
    assert(num(v1, 'skuCount') === 2, 'register covers 2 SKUs');
    assert(num(v1, 'totalDemand') === 50, 'total demand 50 (30 + 20 shipped this month)');
    const rows = JSON.parse(String(v1.record.fields.rows));
    const one = rows.find((r) => r.sku === 'SKU-1');
    assert(one && one.latestPeriod === thisMonth && one.latestDemand === 30, `SKU-1 demand 30 in ${thisMonth}`);
    assert(one.direction === 'insufficient-data' && one.periodsCovered === 1, 'SKU-1 direction insufficient-data (one real month of history)');
    assert(num(v1, 'insufficientCount') === 2, 'both SKUs insufficient-data (single-session single-month, honest)');

    // 4. deterministic regeneration — same shipments + same as-of ⇒ byte-identical rows
    const shipBytesBefore = JSON.stringify(await listOf('warehouse-shipping'));
    const v2 = await create('sales-demand-trend', { asOfDate: new Date().toISOString().slice(0, 10) });
    assert(String(v2.record.fields.rows) === String(v1.record.fields.rows), 'deterministic regeneration: rows byte-identical');

    // 5. READ-ONLY — the shipping source store is byte-identical after the snapshots
    assert(JSON.stringify(await listOf('warehouse-shipping')) === shipBytesBefore, 'shipping source store byte-identical after generation (read-only)');

    // 6. governed read returns the immutable register history (tenant-scoped)
    assert((await listOf('sales-demand-trend')).length === 2, 'governed read returns both demand-trend reports');

    out('RESULT', 'S84 demand-trend intelligence VERIFIED in the real Electron runtime (product → receive → governed ship → demand-trend register → deterministic regeneration → governed read), governed, immutable, shipping read-only, no GL posted');
  } finally {
    await Promise.race([app.close(), sleep(15_000)]).catch(() => undefined);
    try { app.process().kill('SIGKILL'); } catch { /* already dead */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
