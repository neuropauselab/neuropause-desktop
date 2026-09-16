#!/usr/bin/env node
/**
 * ERP S80 (FG-S80b) — GOVERNED KPI SNAPSHOT + EXCEPTION INTELLIGENCE, real Electron journey.
 *
 * Drives the governed ON-DEMAND path:
 *   product below safety stock (governed create)
 *   → `kpi:capture` (governed IPC, tenant resolved in main from the current principal)
 *   → KPI snapshot + exception evaluation, written under the SAME principal the read uses
 *   → exception visible on the existing `executiveCenter:snapshot` channel (kpiIntelligence)
 *   → restock (governed update) → `kpi:capture` → exception RECOVERED / cleared
 *   → repeated `kpi:capture` does not duplicate the historical observation.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s80"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s80KpiExceptionJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ALT_MAIN = path.join(path.resolve(__dirname, '..'), 'out-seam-s80/main/index.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S80 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S80 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) { const end = Date.now() + ms; for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await sleep(400); } }

async function main() {
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build out-seam-s80 first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s80-'));
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
    const update = (moduleId, id, fields) => bridge('enterprise:module.update', { moduleId, id, fields });
    const capture = () => bridge('kpi:capture', {});
    const activeExc = async () => {
      const snap = await bridge('executiveCenter:snapshot', {});
      return (snap && snap.kpiIntelligence && snap.kpiIntelligence.activeExceptions) || [];
    };
    const snapshots = async () => {
      const snap = await bridge('executiveCenter:snapshot', {});
      return (snap && snap.kpiIntelligence && snap.kpiIntelligence.snapshots) || [];
    };
    const KPI = 'inventory.belowSafetyStock';

    // 1. product below its own safety stock (existing master fields; governed create)
    const p = await create('inventory-products', { sku: 'WIDGET', name: 'Widget', safetyStock: 10, currentStock: 2 });
    assert(p.ok && p.record, 'product created below safety stock');
    // 2. governed on-demand capture (tenant resolved in main; renderer supplies nothing)
    const cap = await capture();
    assert(cap && cap.ok && cap.captured, 'kpi:capture governed + captured (tenant from main principal)');
    // 3/4. exception visible on the existing Executive Center channel
    let exc = await activeExc();
    assert(exc.some((e) => e.kpiKey === KPI && e.status === 'EXCEPTION'), 'safety-stock EXCEPTION visible in Executive Center');
    // 5. repeated capture does NOT duplicate the historical observation (idempotent per period)
    const before = (await snapshots()).filter((s) => s.kpiKey === KPI).length;
    await capture();
    const after = (await snapshots()).filter((s) => s.kpiKey === KPI).length;
    assert(before === after, 'repeated capture creates no duplicate historical snapshot (idempotent)');
    // 6/7. restock above safety → capture → exception RECOVERED / cleared
    assert((await update('inventory-products', p.record.id, { currentStock: 50 })).ok, 'restocked above safety stock');
    const cap2 = await capture();
    assert(cap2 && cap2.ok, 'kpi:capture after restock');
    exc = await activeExc();
    assert(!exc.some((e) => e.kpiKey === KPI && e.status === 'EXCEPTION'), 'exception RECOVERED / cleared after restock');

    out('RESULT', 'S80 KPI/exception intelligence VERIFIED in the real Electron runtime (below-safety → kpi:capture → Executive Center exception → idempotent recapture → restock → recover), governed on-demand, tenant from main');
  } finally {
    await Promise.race([app.close(), sleep(15_000)]).catch(() => undefined);
    try { app.process().kill('SIGKILL'); } catch { /* already dead */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
