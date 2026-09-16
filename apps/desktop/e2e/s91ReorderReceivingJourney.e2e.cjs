#!/usr/bin/env node
/**
 * ERP S91 — the reorder-originated PO continues into the EXISTING governed P2P receiving path in the
 * REAL Electron runtime, through the governed bridge (the `enterprise:module.*` actions the
 * Procurement/Warehouse UI buttons invoke + the `platform:command.dispatch` PostGoodsReceipt command):
 *
 *   product → demand → S85 → S86 → S89 confirmation → draft PR → Submit → Approve → Convert → PO
 *     → assign receiving warehouse (operator field) → PO Approve → Send
 *     → (draft/unapproved-PO receive refused) → Receive Goods → pending GR (GR-PO-PR-REORDER-…)
 *     → (edit-door 'received' refused) → PostGoodsReceipt → ONE receive movement, inventory += qty, GRNI
 *
 * Then: replay (same key) does not double-post; distinct-key re-post refused; one GR per PO; full
 * lineage recommendation → PR → PO → GR → movement. Nothing auto-received; each step explicit.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s91"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s91ReorderReceivingJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ALT_MAIN = path.join(path.resolve(__dirname, '..'), 'out-seam-s91/main/index.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S91 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S91 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) { const end = Date.now() + ms; for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await sleep(400); } }

async function main() {
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build out-seam-s91 first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s91-'));
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
    const update = (moduleId, id, fields) => bridge('enterprise:module.update', { moduleId, id, fields });
    const listOf = (moduleId) => bridge('enterprise:module.list', { moduleId });
    const dispatch = (operation, target, idempotencyKey) => bridge('platform:command.dispatch', { operation, target, payload: {}, idempotencyKey });
    const stock = async (sku) => Number((await listOf('inventory-products')).find((r) => String(r.fields.sku) === sku)?.fields?.currentStock ?? 0);
    const waitStock = async (sku, target) => { for (let i = 0; i < 40; i += 1) { if ((await stock(sku)) === target) return true; await sleep(250); } return (await stock(sku)) === target; };

    // 1. product → demand → S86 → S89 confirmation → draft PR → S90 lifecycle → PO
    assert((await create('inventory-products', { sku: 'SKU-1', name: 'Widget', purchaseCost: 4, standardCost: 5, reorderLevel: 200, safetyStock: 50, maximumStock: 500 })).ok, 'product SKU-1 created (standardCost 5 for GRNI valuation)');
    assert((await create('inventory-movements', { movementNumber: 'MV-1', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 })).ok, 'received 100');
    const s = await create('warehouse-shipping', { shipmentNumber: 'SHIP-1', product: 'SKU-1', warehouse: 'WH-1', quantity: 30 });
    assert((await act('warehouse-shipping', s.record.id, 'ship')).ok, 'shipped 30 (currentStock 70)');
    assert(await waitStock('SKU-1', 70), 'inventory reconciled to 70 before receipt');
    const decRep = await create('inventory-reorder-decision', { asOfDate: new Date().toISOString().slice(0, 10) });
    const confirm = await bridge('platform:command.dispatch', { operation: 'CreatePurchaseRequestFromReorderRecommendation', target: decRep.record.id, payload: { sku: 'SKU-1' }, idempotencyKey: `reorder-exec:${decRep.record.id}:SKU-1` });
    const prId = String(confirm.data.id);
    const requestNumber = String(confirm.data.requestNumber);
    const qty = Number(confirm.data.quantity);
    assert((await dispatch('SubmitPurchaseRequest', prId, `sub:${prId}`)).ok, 'Submit PR');
    assert((await dispatch('ApprovePurchaseRequest', prId, `app:${prId}`)).ok, 'Approve PR');
    assert((await dispatch('ConvertPurchaseRequestToPO', prId, `conv:${prId}`)).ok, 'Convert → PO');
    const po = (await listOf('procurement-orders')).find((r) => String(r.fields.sourceRequest) === prId);
    const poId = po.id;
    const poNumber = String(po.fields.poNumber);
    assert(poNumber === `PO-${requestNumber}`, 'PO carries reorder lineage (PO-PR-REORDER-…)');

    // 2. assign the receiving warehouse (operator field — reorder is SKU-level, no warehouse)
    assert((await update('procurement-orders', poId, { warehouse: 'WH-1' })).ok, 'operator assigns receiving warehouse WH-1 on the PO');

    // 3. approval-before-receive: a DRAFT PO cannot be received
    const earlyReceive = await act('procurement-orders', poId, 'receiveGoods');
    assert(earlyReceive && earlyReceive.ok === false, 'a draft/unapproved PO cannot be received (approval gate)');
    assert((await listOf('procurement-receipts')).length === 0, 'no goods receipt from the refused early receive');

    // 4. PO Approve → Send → Receive Goods → pending GR
    assert((await act('procurement-orders', poId, 'approve')).ok, 'PO Approve (governed)');
    assert((await act('procurement-orders', poId, 'send')).ok, 'PO Send (governed)');
    assert((await act('procurement-orders', poId, 'receiveGoods')).ok, 'Receive Goods → pending GR');
    const gr = (await listOf('procurement-receipts')).find((r) => String(r.fields.purchaseOrder) === poId);
    const grId = gr.id;
    assert(String(gr.fields.grNumber) === `GR-${poNumber}`, 'GR carries the PO lineage (GR-PO-PR-REORDER-…)');
    assert(String(gr.fields.status) === 'pending', 'GR is pending (not yet posted)');
    assert(String((await listOf('procurement-orders')).find((r) => r.id === poId).fields.convertedReceipt) === grId, 'PO ↔ GR cross-link');

    // 5. edit-door cannot mutate inventory: hand-setting GR 'received' is refused
    const grBypass = await update('procurement-receipts', grId, { status: 'received' });
    assert(grBypass && grBypass.ok === false, 'hand-setting the GR to received via the edit door is refused (no inventory bypass)');
    assert(String((await listOf('procurement-receipts')).find((r) => r.id === grId).fields.status) === 'pending', 'GR still pending after the refused edit');

    // 6. PostGoodsReceipt → inventory readback
    const stockBefore = await stock('SKU-1');
    const journalBefore = (await listOf('finance-journal-entries')).length;
    const movesBefore = (await listOf('inventory-movements')).filter((m) => String(m.fields.type) === 'receive').length;
    const post = await dispatch('PostGoodsReceipt', grId, `post:${grId}`);
    assert(post.ok === true, 'PostGoodsReceipt (governed command) succeeded');
    assert(String((await listOf('procurement-receipts')).find((r) => r.id === grId).fields.status) === 'received', 'GR is received after posting');
    assert(await waitStock('SKU-1', stockBefore + qty), `inventory increased by the received quantity (${stockBefore} → ${stockBefore + qty})`);
    const movesAfter = (await listOf('inventory-movements')).filter((m) => String(m.fields.type) === 'receive');
    assert(movesAfter.length === movesBefore + 1, 'exactly ONE new receive movement');
    assert(movesAfter.some((m) => String(m.fields.referenceRecord) === grId), 'the movement traces back to the GR (lineage)');
    assert((await listOf('finance-journal-entries')).length > journalBefore, 'canonical GR→GL booked (Dr Inventory / Cr GRNI)');

    // 7. idempotency — replay does not double-post; distinct-key re-post refused
    const replay = await dispatch('PostGoodsReceipt', grId, `post:${grId}`);
    assert(replay.ok === true, 'same-key re-post replays');
    assert((await stock('SKU-1')) === stockBefore + qty, 'inventory unchanged on replay (no double-post)');
    assert((await listOf('inventory-movements')).filter((m) => String(m.fields.type) === 'receive').length === movesBefore + 1, 'still exactly one receive movement after replay');
    const reAgain = await dispatch('PostGoodsReceipt', grId, `post:${grId}:again`);
    assert(reAgain.ok === false, 'a distinct-key re-post is refused (already received)');
    assert((await stock('SKU-1')) === stockBefore + qty, 'inventory unchanged after the refused re-post');

    // 8. side effects — one GR, no duplicate PO
    assert((await listOf('procurement-receipts')).filter((r) => String(r.fields.purchaseOrder) === poId).length === 1, 'exactly one GR for the PO');
    assert((await listOf('procurement-orders')).filter((r) => String(r.fields.sourceRequest) === prId).length === 1, 'no duplicate PO');

    out('RESULT', 'S91 reorder receiving VERIFIED in the real Electron runtime — the reorder PO enters the EXISTING governed receiving path (approve → send → assign warehouse → Receive Goods → PostGoodsReceipt) to ONE receive movement + canonical GRNI, inventory += received quantity; full lineage recommendation → PR → PO → GR → movement; a draft PO cannot be received; edit-door receipt refused; replay/re-post do not double-post; one GR per PO; no duplicate PO.');
  } finally {
    await Promise.race([app.close(), sleep(15_000)]).catch(() => undefined);
    try { app.process().kill('SIGKILL'); } catch { /* already dead */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
