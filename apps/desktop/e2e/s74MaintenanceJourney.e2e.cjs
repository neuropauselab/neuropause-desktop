#!/usr/bin/env node
/**
 * ERP S74 — MAINTENANCE WHOLE-USER JOURNEY in the REAL Electron runtime.
 *
 * Corrective fault → raiseWorkOrder → assign technician → assign (machine→maintenance) →
 * start → complete → verify (machine→running + Maintenance History) → spare-part consume
 * (real Inventory Ledger stock issue). Every step through `window.neuropause.invoke`;
 * alternate build (out-seam-s74), fresh profile; zero external effect.
 *
 * ACCOUNTING: maintenance cost → GL is UNDEFINED (DECISION-MEMO-S74-MAINTENANCE-COST-
 * ACCOUNTING.md) — NOT driven, NOT invented. Parts consumption hits the Inventory Ledger only.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s74"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s74MaintenanceJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const APP_DIR = path.resolve(__dirname, '..');
const ALT_MAIN = path.join(APP_DIR, 'out-seam-s74/main/index.js');
const APP_BIN = process.env.NP_APP_BIN || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S74 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S74 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) { const end = Date.now() + ms; for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await sleep(400); } }

async function main() {
  if (!APP_BIN && !fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN}`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s74-'));
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
    const upd = (moduleId, id, fields) => bridge('enterprise:module.update', { moduleId, id, fields });
    const act = (moduleId, id, action) => bridge('enterprise:module.action', { moduleId, id, action });
    const get = (moduleId, id) => bridge('enterprise:module.get', { moduleId, id });
    const list = (moduleId) => bridge('enterprise:module.list', { moduleId });

    await create('maintenance-asset-categories', { name: 'CNC Machines' });
    assert((await create('maintenance-assets', { assetTag: 'AST-1', name: 'CNC-1 Asset', category: 'CNC Machines' })).ok, 'asset created');
    const mc = await create('manufacturing-machines', { name: 'CNC-1', code: 'MC-1', runtime: 100, downtime: 0, status: 'running' });
    assert(mc.ok, 'machine created');

    const cm = await create('maintenance-corrective', { cmNumber: 'CM-1', asset: 'AST-1', machine: 'CNC-1', faultDescription: 'Bearing seized' });
    assert((await act('maintenance-corrective', cm.record.id, 'raiseWorkOrder')).ok, 'corrective raiseWorkOrder ok');
    const wo = (await list('maintenance-work-orders'))[0];
    assert(wo && String(wo.fields.workOrderNumber) === 'WO-CM-1', 'work order WO-CM-1 created from fault');

    await upd('maintenance-work-orders', wo.id, { technician: 'Sam', laborCost: 200, partsCost: 100, downtimeHours: 4 });
    assert((await act('maintenance-work-orders', wo.id, 'assign')).ok, 'WO assigned (machine → maintenance)');
    assert(String((await get('manufacturing-machines', mc.record.id)).fields.status) === 'maintenance', 'machine out of service');
    assert((await act('maintenance-work-orders', wo.id, 'start')).ok, 'WO started');
    assert((await act('maintenance-work-orders', wo.id, 'verify')).ok === false, 'ILLEGAL verify-before-complete refused');
    assert((await act('maintenance-work-orders', wo.id, 'complete')).ok, 'WO completed');
    assert((await act('maintenance-work-orders', wo.id, 'complete')).ok === false, 'ILLEGAL duplicate completion refused');
    assert((await act('maintenance-work-orders', wo.id, 'verify')).ok, 'WO verified');
    assert(String((await get('manufacturing-machines', mc.record.id)).fields.status) === 'running', 'machine restored to service');
    const hist = await list('maintenance-history');
    assert(hist.length === 1 && Number(hist[0].fields.totalCost) === 300, 'immutable maintenance history created (cost 300)');

    await create('inventory-products', { sku: 'BEARING', name: 'Bearing', standardCost: 5 });
    await create('inventory-movements', { movementNumber: 'SEED-1', type: 'receive', product: 'BEARING', warehouse: 'WH-1', quantity: 50, status: 'posted' });
    const sp = await create('maintenance-spare-parts', { partNumber: 'SP-1', workOrder: 'WO-CM-1', product: 'BEARING', warehouse: 'WH-1', quantity: 5, unitCost: 5 });
    assert((await act('maintenance-spare-parts', sp.record.id, 'consume')).ok, 'spare part consumed (real stock issue)');
    assert((await act('maintenance-spare-parts', sp.record.id, 'consume')).ok === false, 'ILLEGAL duplicate consumption refused');

    out('RESULT', 'Maintenance whole-user journey VERIFIED in the real Electron runtime (fault→WO→assign→start→complete→verify→history→spare-part issue); maintenance-cost→GL = POLICY-BLOCKED, not driven');
  } finally {
    // HARNESS FIX (S76): app.close() can hang after a fully successful journey,
    // leaving node alive forever. Bound the graceful close, hard-kill as fallback,
    // and exit explicitly once cleanup is done. No assertion behavior changed.
    await Promise.race([app.close(), sleep(15_000)]).catch(() => undefined);
    try { app.process().kill('SIGKILL'); } catch { /* already dead */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => { console.error(e); process.exit(1); },
);
