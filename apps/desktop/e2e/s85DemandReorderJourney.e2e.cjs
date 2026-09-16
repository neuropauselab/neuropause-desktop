#!/usr/bin/env node
/**
 * ERP S85 — GOVERNED DEMAND→REORDER RECOMMENDATION journey in the REAL Electron runtime.
 *
 * Proves, entirely through the governed `enterprise:module.*` bridge (window.neuropause.invoke):
 *   product → receive stock → ship (demand history) → generate the reorder-recommendation register
 *   (canonical reorder engine + demand trend) → governed read → deterministic regeneration →
 *   product/shipping stores read-only.
 *
 * Then the CRITICAL NEGATIVE — generating a recommendation is ADVISORY ONLY:
 *   → drafts NO purchase request
 *   → creates NO purchase order
 *   → mutates NO product/inventory
 *   → posts NO GL (journal count unchanged by generation)
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s85"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s85DemandReorderJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ALT_MAIN = path.join(path.resolve(__dirname, '..'), 'out-seam-s85/main/index.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S85 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S85 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) { const end = Date.now() + ms; for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await sleep(400); } }

async function main() {
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build out-seam-s85 first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s85-'));
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

    // 1. product below reorder level once shipped + demand history
    assert((await create('inventory-products', { sku: 'SKU-1', name: 'Widget', standardCost: 5, reorderLevel: 200, safetyStock: 50, maximumStock: 500 })).ok, 'product SKU-1 (reorderLevel 200) created');
    assert((await create('inventory-movements', { movementNumber: 'MV-1', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 })).ok, 'received 100 (availableStock 100 < 200)');
    const s = await create('warehouse-shipping', { shipmentNumber: 'SHIP-1', product: 'SKU-1', warehouse: 'WH-1', quantity: 30 });
    assert(s.ok, 'shipment created');
    assert((await act('warehouse-shipping', s.record.id, 'ship')).ok, 'shipped 30 (demand realized; availableStock 70)');

    // snapshot the books BEFORE generation — for the no-mutation proofs
    const prBefore = (await listOf('procurement-requests')).length;
    const poBefore = (await listOf('procurement-orders')).length;
    const productBytesBefore = JSON.stringify(await listOf('inventory-products'));
    const shipBytesBefore = JSON.stringify(await listOf('warehouse-shipping'));
    const journalBefore = (await listOf('finance-journal-entries')).length;

    // 2. generate the reorder-recommendation register
    const v1 = await create('inventory-reorder-recommendation', { asOfDate: new Date().toISOString().slice(0, 10) });
    assert(v1.ok, 'reorder-recommendation register generated');
    const row = JSON.parse(String(v1.record.fields.rows)).find((r) => r.sku === 'SKU-1');
    assert(row && row.attention === 'reorder' && row.reorderLevel === 200, 'SKU-1 attention = reorder (availableStock 70 ≤ reorderLevel 200)');
    // targetLevel = max(500, 200+50, 201) = 500; position = 70 → suggested = 430 (from assessReorder, not invented)
    assert(row.recommendedQuantity === 430, 'recommendedQuantity 430 (target 500 − position 70), from the canonical reorder engine');
    assert(num(v1, 'reorderCount') === 1, 'reorderCount 1');

    // 3. deterministic regeneration
    const v2 = await create('inventory-reorder-recommendation', { asOfDate: new Date().toISOString().slice(0, 10) });
    assert(String(v2.record.fields.rows) === String(v1.record.fields.rows), 'deterministic regeneration: rows byte-identical');

    // 4. CRITICAL NEGATIVE — generation is advisory only
    assert((await listOf('procurement-requests')).length === prBefore, 'NO purchase request drafted by generation');
    assert((await listOf('procurement-orders')).length === poBefore, 'NO purchase order created by generation');
    assert(JSON.stringify(await listOf('inventory-products')) === productBytesBefore, 'products byte-identical (no inventory mutation)');
    assert(JSON.stringify(await listOf('warehouse-shipping')) === shipBytesBefore, 'shipping byte-identical (read-only source)');
    assert((await listOf('finance-journal-entries')).length === journalBefore, 'journal count unchanged (no GL posted by generation)');

    // 5. governed read returns the immutable register history (tenant-scoped)
    assert((await listOf('inventory-reorder-recommendation')).length === 2, 'governed read returns both recommendation reports');

    out('RESULT', 'S85 reorder-recommendation intelligence VERIFIED in the real Electron runtime (product → receive → ship → reorder recommendation → deterministic regeneration → governed read), advisory only — NO PR, NO PO, NO inventory mutation, NO GL');
  } finally {
    await Promise.race([app.close(), sleep(15_000)]).catch(() => undefined);
    try { app.process().kill('SIGKILL'); } catch { /* already dead */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
