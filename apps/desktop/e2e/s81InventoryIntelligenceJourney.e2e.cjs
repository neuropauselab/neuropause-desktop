#!/usr/bin/env node
/**
 * ERP S81 — INVENTORY AGING + ATP whole-capability journey in the REAL Electron runtime.
 *
 * Proves, entirely through the governed `enterprise:module.*` path (window.neuropause.invoke,
 * the same preload bridge the UI uses):
 *   create product → receive stock → reserve demand (governed reservation) →
 *   generate ATP (observe on-hand/reserved/available/incoming/ATP) →
 *   raise an open PO (incoming) → ATP changes (incoming added) →
 *   receive the PO through the canonical goods-receipt workflow (receiveGoods → post) →
 *   ATP changes correctly (composition shifts incoming→available, NO double count) →
 *   generate aging with a future as-of (aged 90+) and a today as-of (fresh) →
 *   verify the stock ledger was never mutated by the read-only snapshots.
 *
 * Tenant isolation is proven at unit level (inventoryIntelligence.test.ts, one bound store,
 * scope switched); a single local-mode Electron session has one principal, so this journey
 * asserts the governed tenant-scoped read path rather than a two-org switch.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s81"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s81InventoryIntelligenceJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ALT_MAIN = path.join(path.resolve(__dirname, '..'), 'out-seam-s81/main/index.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S81 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S81 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) { const end = Date.now() + ms; for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await sleep(400); } }

async function main() {
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build out-seam-s81 first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s81-'));
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
    const today = new Date().toISOString().slice(0, 10);
    const FUTURE = '2099-01-01';
    const num = (r, k) => Number(r?.record?.fields?.[k]);

    // 1. product + receive 100 (canonical inventory receipt = a receive movement)
    assert((await create('inventory-products', { sku: 'SKU-1', name: 'Widget', standardCost: 5 })).ok, 'product SKU-1 created');
    assert((await create('inventory-movements', { movementNumber: 'MV-1', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 })).ok, 'received 100 into WH-1');

    // 2. reserve 30 through the governed reservation workflow (posts a real reservation hold)
    assert((await create('inventory-reservations', { reservationNumber: 'RSV-1', product: 'SKU-1', warehouse: 'WH-1', quantity: 30 })).ok, 'reserved 30 (governed reservation)');

    // 3. ATP #1 — on-hand 100 / reserved 30 / available 70 / incoming 0 / ATP 70
    const atp1 = await create('inventory-atp', { asOfDate: today });
    assert(atp1.ok, 'ATP snapshot #1 generated');
    assert(num(atp1, 'totalOnHand') === 100 && num(atp1, 'totalReserved') === 30 && num(atp1, 'totalAvailable') === 70, 'ATP#1 on-hand 100 / reserved 30 / available 70');
    assert(num(atp1, 'totalIncoming') === 0 && num(atp1, 'totalAtp') === 70, 'ATP#1 incoming 0 → ATP 70');

    // 4. raise an OPEN purchase order (incoming) through the governed procurement workflow
    const po = await create('procurement-orders', { poNumber: 'PO-1', product: 'SKU-1', warehouse: 'WH-1', quantity: 50 });
    assert(po.ok, 'PO-1 created (draft)');
    assert((await act('procurement-orders', po.record.id, 'approve')).ok, 'PO-1 approved (now an open/incoming order)');

    // 5. ATP #2 — incoming 50 added → ATP 120 (ATP responds to incoming)
    const atp2 = await create('inventory-atp', { asOfDate: today });
    assert(num(atp2, 'totalAvailable') === 70 && num(atp2, 'totalIncoming') === 50 && num(atp2, 'totalAtp') === 120, 'ATP#2 available 70 + incoming 50 = ATP 120 (changed correctly)');

    // 6. receive the PO through the canonical goods-receipt workflow (receiveGoods → post)
    assert((await act('procurement-orders', po.record.id, 'receiveGoods')).ok, 'PO-1 receiveGoods (goods receipt created, PO → received)');
    const gr = (await listOf('procurement-receipts')).find((r) => String(r.fields.grNumber) === 'GR-PO-1');
    assert(gr, 'goods receipt GR-PO-1 exists');
    assert((await act('procurement-receipts', gr.id, 'post')).ok, 'goods receipt POSTED (receive movement into stock)');

    // READ-ONLY baseline: the ledger size right before the final snapshot-only block.
    const ledgerBefore = (await listOf('inventory-movements')).length;

    // 7. ATP #3 — on-hand 150, incoming 0 (PO received), available 120, ATP 120: NO double count
    const atp3 = await create('inventory-atp', { asOfDate: today });
    assert(num(atp3, 'totalOnHand') === 150, 'ATP#3 on-hand rose to 150 (received into stock)');
    assert(num(atp3, 'totalIncoming') === 0, 'ATP#3 incoming 0 (received PO no longer counted — no double count)');
    assert(num(atp3, 'totalAvailable') === 120 && num(atp3, 'totalAtp') === 120, 'ATP#3 available 120 = ATP 120 (composition shifted incoming→available; total unchanged)');

    // 8. AGING — future as-of buckets all on-hand as 90+; today as-of buckets it as fresh
    const agedFuture = await create('inventory-aging', { asOfDate: FUTURE });
    assert(num(agedFuture, 'totalOnHand') === 150 && num(agedFuture, 'days90plus') === 150, 'aging (future as-of): 150 on-hand all aged 90+');
    assert(num(agedFuture, 'over90Count') >= 1, 'aging flags 90+ lines');
    const agedToday = await create('inventory-aging', { asOfDate: today });
    assert(num(agedToday, 'days0to30') === 150 && num(agedToday, 'days90plus') === 0, 'aging (today as-of): 150 on-hand all fresh (0–30) — bucketing responds to as-of');

    // 9. READ-ONLY — the three snapshots above (ATP#3 + 2 aging) added ZERO stock movements
    const ledgerAfter = (await listOf('inventory-movements')).length;
    assert(ledgerAfter === ledgerBefore, 'stock ledger byte-count unchanged by the read-only snapshots');

    // 10. governed tenant-scoped reads return this session's reports (isolation unit-proven separately)
    assert((await listOf('inventory-atp')).length === 3 && (await listOf('inventory-aging')).length === 2, 'governed reads return the session tenant’s snapshots (3 ATP + 2 aging)');

    out('RESULT', 'S81 inventory aging + ATP VERIFIED in the real Electron runtime (receive → reserve → ATP → open PO → ATP+incoming → goods receipt → ATP no-double-count → aging future/today), governed, tenant-scoped, ledger read-only');
  } finally {
    await Promise.race([app.close(), sleep(15_000)]).catch(() => undefined);
    try { app.process().kill('SIGKILL'); } catch { /* already dead */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
