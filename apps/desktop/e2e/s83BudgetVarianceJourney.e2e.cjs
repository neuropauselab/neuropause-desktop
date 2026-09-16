#!/usr/bin/env node
/**
 * ERP S83 — GOVERNED BUDGET-VARIANCE INTELLIGENCE journey in the REAL Electron runtime.
 *
 * Proves, entirely through the governed `enterprise:module.*` bridge (window.neuropause.invoke):
 *   create ledger accounts → create budgets → post journal entries (the canonical ACTUAL) →
 *   generate an immutable budget-variance register (budget/actual/variance/health per budget) →
 *   deterministic regeneration (byte-identical rows) → governed read →
 *   books read-only + no GL mutation after the snapshots.
 *
 * Only the GL-backed budget domain is exercised — the one domain with a canonical "actual"
 * (posted journals). Tenant isolation is proven at unit level (budgetVariance.test.ts, one
 * bound store, scope switched); a single local-mode session has one principal.
 *
 * Distinctive account codes (5990/4990/1990) avoid any collision with the boot-seeded control
 * chart, so the two budgets always resolve to exactly one account each.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s83"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s83BudgetVarianceJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ALT_MAIN = path.join(path.resolve(__dirname, '..'), 'out-seam-s83/main/index.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S83 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S83 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) { const end = Date.now() + ms; for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await sleep(400); } }

async function main() {
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build out-seam-s83 first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s83-'));
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

    // 1. ledger accounts (distinctive codes — no collision with the seeded control chart)
    for (const a of [
      { code: '5990', name: 'S83 Opex', class: 'expense' },
      { code: '4990', name: 'S83 Sales', class: 'revenue' },
      { code: '1990', name: 'S83 Cash', class: 'asset' },
    ]) assert((await create('finance-ledger-accounts', { ...a, currency: 'USD' })).ok, `account ${a.code} created`);

    // 2. budgets (the canonical budget/plan source)
    assert((await create('finance-budgets', { budgetName: 'S83 Opex Aug', periodKey: '2026-08', accountCode: '5990', budgetAmount: 500 })).ok, 'budget Opex 500 created');
    assert((await create('finance-budgets', { budgetName: 'S83 Sales Aug', periodKey: '2026-08', accountCode: '4990', budgetAmount: 600 })).ok, 'budget Sales 600 created');

    // 3. post journal entries — the canonical ACTUAL (posted books only)
    const postJe = async (n, lines) => {
      const je = await create('finance-journal-entries', { entryNumber: n, entryDate: '2026-08-05', lines: JSON.stringify(lines), status: 'draft' });
      assert(je.ok, `${n} drafted`);
      assert((await act('finance-journal-entries', je.record.id, 'post')).ok, `${n} posted`);
    };
    await postJe('S83-JE-1', [{ account: '5990', debit: 900, credit: 0 }, { account: '1990', debit: 0, credit: 900 }]); // opex 900 > 500 → over
    await postJe('S83-JE-2', [{ account: '1990', debit: 400, credit: 0 }, { account: '4990', debit: 0, credit: 400 }]); // revenue 400 < 600 → under

    // 4. generate the immutable budget-variance register
    const v1 = await create('finance-budget-variance', { asOfDate: '2026-08-31' });
    assert(v1.ok, 'variance register generated');
    assert(num(v1, 'budgetCount') === 2, 'register covers 2 budgets');
    const rows = JSON.parse(String(v1.record.fields.rows));
    const opex = rows.find((r) => r.accountCode === '5990');
    const sales = rows.find((r) => r.accountCode === '4990');
    assert(opex && opex.budgetAmount === 500 && opex.actualAmount === 900 && opex.variance === 400 && opex.health === 'over', 'Opex: budget 500 / actual 900 / variance +400 / OVER (unfavourable expense)');
    assert(sales && sales.budgetAmount === 600 && sales.actualAmount === 400 && sales.health === 'under', 'Sales: budget 600 / actual 400 / UNDER (unfavourable revenue short)');
    assert(num(v1, 'overCount') === 1 && num(v1, 'underCount') === 1, 'health counts: 1 over, 1 under');
    assert(num(v1, 'totalBudget') === 1100 && num(v1, 'totalActual') === 1300, 'portfolio totals: budget 1100 / actual 1300');

    // 5. deterministic regeneration — same books + same as-of ⇒ byte-identical rows
    const ledgerBefore = { acct: (await listOf('finance-ledger-accounts')).length, jrnl: (await listOf('finance-journal-entries')).length };
    const acctBytesBefore = JSON.stringify(await listOf('finance-ledger-accounts'));
    const jrnlBytesBefore = JSON.stringify(await listOf('finance-journal-entries'));
    const budBytesBefore = JSON.stringify(await listOf('finance-budgets'));
    const v2 = await create('finance-budget-variance', { asOfDate: '2026-08-31' });
    assert(String(v2.record.fields.rows) === String(v1.record.fields.rows), 'deterministic regeneration: rows byte-identical');

    // 6. READ-ONLY + NO GL MUTATION — books unchanged by the snapshots
    assert(JSON.stringify(await listOf('finance-ledger-accounts')) === acctBytesBefore, 'ledger accounts byte-identical after snapshots (no GL mutation)');
    assert(JSON.stringify(await listOf('finance-journal-entries')) === jrnlBytesBefore, 'journal byte-identical after snapshots (no journal mutation)');
    assert(JSON.stringify(await listOf('finance-budgets')) === budBytesBefore, 'budgets byte-identical after snapshots');
    assert((await listOf('finance-ledger-accounts')).length === ledgerBefore.acct && (await listOf('finance-journal-entries')).length === ledgerBefore.jrnl, 'no accounts/journals added by variance generation');

    // 7. governed read returns the immutable register history
    assert((await listOf('finance-budget-variance')).length === 2, 'governed read returns both variance reports (tenant-scoped)');

    out('RESULT', 'S83 budget-variance intelligence VERIFIED in the real Electron runtime (accounts → budgets → posted journals → variance register → deterministic regeneration → governed read), governed, immutable, books read-only, no GL posted');
  } finally {
    await Promise.race([app.close(), sleep(15_000)]).catch(() => undefined);
    try { app.process().kill('SIGKILL'); } catch { /* already dead */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
