#!/usr/bin/env node
/**
 * ERP S87 — GOVERNED REORDER EXECUTION boundary in the REAL Electron runtime.
 *
 * S87's determination is STOP at decision-readiness: a reorder-recommendation-driven execution
 * command is NOT policy-complete (recommendation identity, recommendation-scoped idempotency, and
 * stale-recommendation policy are undefined — see DECISION-MEMO-S87), so nothing new is built.
 * Per the S87 spec §10, this journey therefore proves the EXECUTION PATH REMAINS BLOCKED and NO PR
 * is created, entirely through the governed `enterprise:module.*` bridge (window.neuropause.invoke):
 *
 *   product (purchaseCost) → receive → ship (demand) → S84 demand trend → S85 recommendation →
 *   S86 decision readiness (READY_FOR_OPERATOR_REVIEW, executionReadiness BLOCKED_UNDEFINED_POLICY)
 *   → attempt every plausible execution verb on the decision + recommendation modules → ALL REFUSED
 *   ("Unknown action") → and the critical negative: NO purchase request, NO PO, no inventory/GL
 *   mutation. The decision report is the terminal; there is no governed execution to reach.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s87"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s87GovernedReorderExecutionJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ALT_MAIN = path.join(path.resolve(__dirname, '..'), 'out-seam-s87/main/index.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S87 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S87 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) { const end = Date.now() + ms; for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await sleep(400); } }

async function main() {
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build out-seam-s87 first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s87-'));
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

    // 1. product below reorder level once shipped + demand history, WITH a canonical purchase cost
    assert((await create('inventory-products', { sku: 'SKU-1', name: 'Widget', purchaseCost: 4, standardCost: 5, reorderLevel: 200, safetyStock: 50, maximumStock: 500 })).ok, 'product SKU-1 (reorderLevel 200, purchaseCost 4) created');
    assert((await create('inventory-movements', { movementNumber: 'MV-1', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 })).ok, 'received 100 (availableStock 100 < 200)');
    const s = await create('warehouse-shipping', { shipmentNumber: 'SHIP-1', product: 'SKU-1', warehouse: 'WH-1', quantity: 30 });
    assert(s.ok, 'shipment created');
    assert((await act('warehouse-shipping', s.record.id, 'ship')).ok, 'shipped 30 (demand realized; availableStock 70)');

    // 2. S85 recommendation + S86 decision readiness — the intelligence terminal
    const recRep = await create('inventory-reorder-recommendation', { asOfDate: new Date().toISOString().slice(0, 10) });
    assert(recRep.ok, 'S85 reorder-recommendation generated');
    const decRep = await create('inventory-reorder-decision', { asOfDate: new Date().toISOString().slice(0, 10) });
    assert(decRep.ok, 'S86 reorder-decision generated');
    const row = JSON.parse(String(decRep.record.fields.rows)).find((r) => r.sku === 'SKU-1');
    assert(row && row.readinessStatus === 'READY_FOR_OPERATOR_REVIEW', 'decision row = READY_FOR_OPERATOR_REVIEW (a reorder IS required — the blocked-execution proof is meaningful)');
    assert(row.executionReadiness === 'BLOCKED_UNDEFINED_POLICY', 'executionReadiness fail-closed');

    // snapshot the books BEFORE any execution attempt
    const prBefore = (await listOf('procurement-requests')).length;
    const poBefore = (await listOf('procurement-orders')).length;
    const productBytesBefore = JSON.stringify(await listOf('inventory-products'));
    assert(prBefore === 0 && poBefore === 0, 'no PR/PO exists before any execution attempt');

    // 3. THE BOUNDARY — every plausible execution verb on the intelligence modules is REFUSED
    for (const verb of ['execute', 'createPurchaseRequest', 'reorder', 'approve', 'reorderCheck', 'confirm']) {
      const r = await act('inventory-reorder-decision', decRep.record.id, verb);
      assert(r && r.ok === false && /Unknown action/i.test(String(r.error ?? '')), `decision module refuses "${verb}" (Unknown action)`);
    }
    for (const verb of ['execute', 'createPurchaseRequest', 'reorderCheck']) {
      const r = await act('inventory-reorder-recommendation', recRep.record.id, verb);
      assert(r && r.ok === false && /Unknown action/i.test(String(r.error ?? '')), `recommendation module refuses "${verb}" (Unknown action)`);
    }

    // 4. CRITICAL NEGATIVE — the execution path is blocked: NO PR/PO created, no inventory mutation
    assert((await listOf('procurement-requests')).length === prBefore, 'NO purchase request created by any execution attempt');
    assert((await listOf('procurement-orders')).length === poBefore, 'NO purchase order created by any execution attempt');
    assert(JSON.stringify(await listOf('inventory-products')) === productBytesBefore, 'products byte-identical (no inventory mutation)');

    // 5. the decision report remains the immutable terminal, readable through the governed read
    assert((await listOf('inventory-reorder-decision')).length === 1, 'decision report is the terminal (governed read returns it)');

    out('RESULT', 'S87 governed reorder EXECUTION BOUNDARY VERIFIED in the real Electron runtime — the execution path is BLOCKED: a READY_FOR_OPERATOR_REVIEW decision drives NO automatic procurement, every execution verb on the intelligence modules is refused (Unknown action), and NO PR/PO/inventory mutation occurs. S87 stops at decision-readiness (DECISION-MEMO-S87); no execution command built.');
  } finally {
    await Promise.race([app.close(), sleep(15_000)]).catch(() => undefined);
    try { app.process().kill('SIGKILL'); } catch { /* already dead */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
