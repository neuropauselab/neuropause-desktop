#!/usr/bin/env node
/**
 * ERP S90 — the S89 reorder-created draft PR continues through the EXISTING governed procurement
 * lifecycle in the REAL Electron runtime, entirely through the governed bridge (the SAME
 * `platform:command.dispatch` commands the Procurement UI's Submit / Approve / Create-Purchase-Order
 * buttons dispatch, and the `enterprise:module.*` channels for reads/creates):
 *
 *   product → receive → ship (demand) → S85 → S86 → S89 operator confirmation → DRAFT PR
 *     → SubmitPurchaseRequest  → pending
 *     → ApprovePurchaseRequest → approved
 *     → ConvertPurchaseRequestToPO → ONE draft PO (poNumber PO-PR-REORDER-…, sourceRequest = PR)
 *
 * Then: idempotency (same-key convert replays; distinct-key re-convert refused; PO count stays 1) and
 * status-machine negatives (convert-before-approve refused; hand-setting 'approved' via the edit door
 * refused). Throughout: reorder automation STOPS at the operator draft — every transition is an
 * explicit governed action — and NO inventory mutation / NO GL from the lifecycle.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s90"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s90ReorderProcurementLifecycleJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ALT_MAIN = path.join(path.resolve(__dirname, '..'), 'out-seam-s90/main/index.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S90 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S90 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) { const end = Date.now() + ms; for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await sleep(400); } }

async function main() {
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build out-seam-s90 first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s90-'));
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
    const prById = async (id) => (await listOf('procurement-requests')).find((r) => r.id === id);

    // 1. product → demand → S85 → S86 → S89 operator confirmation → DRAFT PR
    assert((await create('inventory-products', { sku: 'SKU-1', name: 'Widget', purchaseCost: 4, reorderLevel: 200, safetyStock: 50, maximumStock: 500 })).ok, 'product SKU-1 created');
    assert((await create('inventory-movements', { movementNumber: 'MV-1', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 })).ok, 'received 100 (availableStock 100 < 200)');
    const s = await create('warehouse-shipping', { shipmentNumber: 'SHIP-1', product: 'SKU-1', warehouse: 'WH-1', quantity: 30 });
    assert((await act('warehouse-shipping', s.record.id, 'ship')).ok, 'shipped 30 (availableStock 70)');
    const decRep = await create('inventory-reorder-decision', { asOfDate: new Date().toISOString().slice(0, 10) });
    assert(decRep.ok, 'S86 decision report generated');
    const reportNumber = String(decRep.record.fields.reportNumber);
    const confirm = await bridge('platform:command.dispatch', { operation: 'CreatePurchaseRequestFromReorderRecommendation', target: decRep.record.id, payload: { sku: 'SKU-1' }, idempotencyKey: `reorder-exec:${decRep.record.id}:SKU-1` });
    assert(confirm.ok === true, 'S89 operator confirmation → governed reorder execution succeeded');
    const prId = String(confirm.data.id);
    const requestNumber = String(confirm.data.requestNumber);
    assert(requestNumber === `PR-REORDER-${reportNumber}-SKU-1`, 'draft PR is reorder-originated + identifiable (PR-REORDER-…)');
    assert(String((await prById(prId)).fields.status) === 'draft', 'automation STOPS at the operator draft PR (status draft)');

    // 2. governed lifecycle — Submit → Approve → Convert (each an explicit governed action)
    const journalBefore = (await listOf('finance-journal-entries')).length;
    const productBytesBefore = JSON.stringify(await listOf('inventory-products'));
    assert((await listOf('procurement-orders')).length === 0, 'no PO before conversion');

    // status-machine: cannot convert an UNAPPROVED PR
    const earlyConv = await dispatch('ConvertPurchaseRequestToPO', prId, `conv:${prId}:early`);
    assert(earlyConv.ok === false, 'an unapproved PR cannot convert to a PO (approval gate)');
    assert((await listOf('procurement-orders')).length === 0, 'still no PO after the refused early conversion');

    // bypass: cannot hand-set 'approved' via the edit door
    const bypass = await update('procurement-requests', prId, { status: 'approved' });
    assert(bypass && bypass.ok === false, 'hand-setting approved via the edit door is refused (no bypass)');
    assert(String((await prById(prId)).fields.status) === 'draft', 'PR still draft after the refused edit');

    assert((await dispatch('SubmitPurchaseRequest', prId, `sub:${prId}`)).ok === true, 'Submit PR → governed');
    assert(String((await prById(prId)).fields.status) === 'pending', 'PR is pending after submit');
    assert((await dispatch('ApprovePurchaseRequest', prId, `app:${prId}`)).ok === true, 'Approve PR → governed (human approval before PO)');
    assert(String((await prById(prId)).fields.status) === 'approved', 'PR is approved after approval');
    const conv = await dispatch('ConvertPurchaseRequestToPO', prId, `conv:${prId}`);
    assert(conv.ok === true, 'Convert approved PR → PO (governed)');

    // 3. exactly one PO, with reorder lineage; PR ordered
    let pos = await listOf('procurement-orders');
    assert(pos.length === 1, 'exactly ONE purchase order created');
    const po = pos[0];
    assert(String(po.fields.poNumber) === `PO-${requestNumber}`, 'PO number embeds the reorder PR (PO-PR-REORDER-…)');
    assert(String(po.fields.sourceRequest) === prId, 'PO.sourceRequest → the reorder PR (lineage preserved)');
    assert(String(po.fields.status) === 'draft', 'PO created as DRAFT — not auto-approved, not auto-sent');
    assert(String((await prById(prId)).fields.status) === 'ordered' && String((await prById(prId)).fields.convertedOrder) === po.id, 'PR is ordered + cross-linked to the PO');

    // 4. idempotency — same-key convert replays; distinct-key re-convert refused; PO count stays 1
    const convReplay = await dispatch('ConvertPurchaseRequestToPO', prId, `conv:${prId}`);
    assert(convReplay.ok === true, 'same-key convert replays (no error)');
    const convAgain = await dispatch('ConvertPurchaseRequestToPO', prId, `conv:${prId}:again`);
    assert(convAgain.ok === false, 'a distinct-key re-conversion is refused (already converted)');
    assert((await listOf('procurement-orders')).length === 1, 'still exactly ONE PO (no duplicate)');

    // 5. side effects — the lifecycle posted NO GL and moved NO inventory
    assert((await listOf('finance-journal-entries')).length === journalBefore, 'journal count unchanged (no GL posted by the PR→PO lifecycle)');
    assert(JSON.stringify(await listOf('inventory-products')) === productBytesBefore, 'products byte-identical (no inventory mutation)');

    out('RESULT', 'S90 reorder → procurement lifecycle VERIFIED in the real Electron runtime — the S89 draft PR continues through the EXISTING governed commands (Submit → Approve → Convert) to exactly ONE draft PO carrying the reorder lineage (PO-PR-REORDER-…, sourceRequest); each transition is an explicit governed action (no automatic approval/PO); idempotent (one PO); unapproved-convert and edit-door-approval refused; NO GL, NO inventory mutation.');
  } finally {
    await Promise.race([app.close(), sleep(15_000)]).catch(() => undefined);
    try { app.process().kill('SIGKILL'); } catch { /* already dead */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
