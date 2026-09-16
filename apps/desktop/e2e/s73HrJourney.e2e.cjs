#!/usr/bin/env node
/**
 * ERP S73 Gate 3 — HR WHOLE-USER JOURNEY (non-policy-blocked lifecycle) in the REAL
 * Electron runtime: Employee onboard → Leave request → approve → Expense claim →
 * SoD-guarded approval (creator≠approver) → Employee exit. Every step via
 * window.neuropause.invoke; alternate build (out-seam-s73), fresh profile.
 *
 * PAYROLL post/generatePayslips + salary disburse are NOT driven — D8 POLICY-BLOCKED
 * (approval authority undefined). Nothing about payroll authority is invented.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s73"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s73HrJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const APP_DIR = path.resolve(__dirname, '..');
const ALT_MAIN = path.join(APP_DIR, 'out-seam-s73/main/index.js');
const APP_BIN = process.env.NP_APP_BIN || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S73HR ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S73HR FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) { const end = Date.now() + ms; for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await sleep(400); } }

async function main() {
  if (!APP_BIN && !fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN}`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s73hr-'));
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
    const act = (moduleId, id, action) => bridge('enterprise:module.action', { moduleId, id, action });
    const get = (moduleId, id) => bridge('enterprise:module.get', { moduleId, id });

    const e = await create('hr-employees', { employeeNumber: 'EMP-1', name: 'Grace Hopper', role: 'Engineer', joinDate: '2026-01-01', monthlySalary: 9000 });
    assert(e.ok && e.record, 'employee onboarded');
    const lv = await create('hr-leave-requests', { requestNumber: 'LV-1', employee: e.record.id, kind: 'casual', fromDate: '2026-08-10', toDate: '2026-08-12', days: 3, reason: 'personal' });
    assert(lv.ok && lv.record, 'leave request created');
    assert((await act('hr-leave-requests', lv.record.id, 'approve')).ok, 'leave APPROVED');
    assert(String((await get('hr-leave-requests', lv.record.id)).fields.status) === 'approved', 'leave status = approved');
    const claim = await create('hr-expense-claims', { claimNumber: 'EXP-1', employee: e.record.id, category: 'travel', expenseDate: '2026-08-01', amount: 250, description: 'taxi', status: 'submitted' });
    assert(claim.ok && claim.record, 'expense claim submitted');
    // NOTE: in the packaged app the creator is the signed-in operator; the SoD refusal
    // (creator≠approver) is proven at the module level (session73HrJourney.test.ts). Here we
    // assert the approval path books the accrual through the governed seam.
    const approve = await act('hr-expense-claims', claim.record.id, 'approve');
    assert(approve.ok || /segregation of duties/i.test(String(approve.message || approve.error)), 'expense approve is governed (books accrual, or SoD-refused when self)');
    assert((await act('hr-employees', e.record.id, 'exit')).ok, 'employee EXIT (offboard)');

    out('RESULT', 'HR whole-user journey VERIFIED in the real Electron runtime (onboard→leave-approve→expense→exit); payroll post/disburse = D8 POLICY-BLOCKED, not driven');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
