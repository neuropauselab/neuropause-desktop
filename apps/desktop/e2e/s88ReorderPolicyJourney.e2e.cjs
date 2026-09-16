#!/usr/bin/env node
/**
 * ERP S88 — REORDER GOVERNANCE POLICY CLOSURE journey in the REAL Electron runtime.
 *
 * S88 closes the five S87 operator-policy decisions by REUSING existing project decisions (see
 * DECISION-REGISTER-S88) and implements ONLY the pure decision layer (`reorderExecutionPolicy.ts`) —
 * it deliberately does NOT wire execution (no command, no PR creation, no PO, no supplier award, no
 * automatic/background reorder). Per §11, this journey proves, through the governed
 * `enterprise:module.*` bridge, the full read pipeline AND that the execution path REMAINS BLOCKED:
 *
 *   product → receive → ship (demand) → S85 recommendation → S86 decision readiness →
 *   attempt every execution verb on the intelligence modules → ALL REFUSED (Unknown action) →
 *   and the critical negative: NO PR, NO PO, no inventory/GL mutation. The decision report is the
 *   terminal; the policy layer decides what a FUTURE command would draft, but no execution is wired.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s88"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s88ReorderPolicyJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ALT_MAIN = path.join(path.resolve(__dirname, '..'), 'out-seam-s88/main/index.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S88 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S88 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) { const end = Date.now() + ms; for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await sleep(400); } }

async function main() {
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build out-seam-s88 first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s88-'));
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

    // 1. read pipeline: product → inventory → demand → S85 → S86
    assert((await create('inventory-products', { sku: 'SKU-1', name: 'Widget', purchaseCost: 4, reorderLevel: 200, safetyStock: 50, maximumStock: 500 })).ok, 'product SKU-1 created');
    assert((await create('inventory-movements', { movementNumber: 'MV-1', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 })).ok, 'received 100');
    const s = await create('warehouse-shipping', { shipmentNumber: 'SHIP-1', product: 'SKU-1', warehouse: 'WH-1', quantity: 30 });
    assert((await act('warehouse-shipping', s.record.id, 'ship')).ok, 'shipped 30 (availableStock 70 < 200)');
    const recRep = await create('inventory-reorder-recommendation', { asOfDate: new Date().toISOString().slice(0, 10) });
    assert(recRep.ok, 'S85 recommendation generated');
    const decRep = await create('inventory-reorder-decision', { asOfDate: new Date().toISOString().slice(0, 10) });
    assert(decRep.ok, 'S86 decision readiness generated');
    const row = JSON.parse(String(decRep.record.fields.rows)).find((r) => r.sku === 'SKU-1');
    assert(row && row.readinessStatus === 'READY_FOR_OPERATOR_REVIEW', 'decision row READY_FOR_OPERATOR_REVIEW (a reorder IS required)');
    assert(row.executionReadiness === 'BLOCKED_UNDEFINED_POLICY', 'S86 executionReadiness still fail-closed (S88 did not wire execution)');

    // 2. the policy decisions are CLOSED (register), but execution is deliberately NOT wired.
    const prBefore = (await listOf('procurement-requests')).length;
    const poBefore = (await listOf('procurement-orders')).length;
    const productBytesBefore = JSON.stringify(await listOf('inventory-products'));
    assert(prBefore === 0 && poBefore === 0, 'no PR/PO exists before any execution attempt');

    // 3. execution path REMAINS BLOCKED — every execution verb on the intelligence modules is refused
    for (const verb of ['execute', 'createPurchaseRequest', 'reorder', 'confirm', 'reorderCheck']) {
      const r = await act('inventory-reorder-decision', decRep.record.id, verb);
      assert(r && r.ok === false && /Unknown action/i.test(String(r.error ?? '')), `decision module refuses "${verb}" (execution not wired)`);
    }
    for (const verb of ['execute', 'createPurchaseRequest']) {
      const r = await act('inventory-reorder-recommendation', recRep.record.id, verb);
      assert(r && r.ok === false && /Unknown action/i.test(String(r.error ?? '')), `recommendation module refuses "${verb}"`);
    }

    // 4. CRITICAL NEGATIVE — no procurement/inventory effect from S88
    assert((await listOf('procurement-requests')).length === prBefore, 'NO purchase request created (execution not wired)');
    assert((await listOf('procurement-orders')).length === poBefore, 'NO purchase order created');
    assert(JSON.stringify(await listOf('inventory-products')) === productBytesBefore, 'products byte-identical (no inventory mutation)');

    // 5. governed read — the decision report remains the terminal
    assert((await listOf('inventory-reorder-decision')).length === 1, 'decision report is the terminal (governed read)');

    out('RESULT', 'S88 reorder governance POLICY CLOSURE VERIFIED in the real Electron runtime — the read pipeline (product→demand→S85→S86) works, the five policies are closed by reuse (DECISION-REGISTER-S88), and execution REMAINS BLOCKED: no execution is wired, every execution verb is refused, and NO PR/PO/inventory mutation occurs. Turning on execution is a separate later gate.');
  } finally {
    await Promise.race([app.close(), sleep(15_000)]).catch(() => undefined);
    try { app.process().kill('SIGKILL'); } catch { /* already dead */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
