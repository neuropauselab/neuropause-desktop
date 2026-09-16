#!/usr/bin/env node
/**
 * ERP S75 — PROJECTS WHOLE-USER JOURNEY in the REAL Electron runtime.
 *
 * CRM Customer → Project (customerRef) → Tasks → Time entries (billable, rated) →
 * task→done → Billing Run → issueInvoice (REAL draft invoice via Finance + entries frozen +
 * run closed) → complete Project (freezes). Every step via `window.neuropause.invoke`;
 * alternate build (out-seam-s75), fresh profile; zero external effect.
 *
 * ACCOUNTING: the draft invoice's GL/AR posting is the certified S28 customer-invoice chain,
 * separate from Projects. Project-cost capitalization / revenue recognition / cost→GL are
 * UNDEFINED policy (DECISION-MEMO-S75-PROJECT-COST-REVENUE-ACCOUNTING.md) — NOT driven.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s75"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s75ProjectsJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const APP_DIR = path.resolve(__dirname, '..');
const ALT_MAIN = path.join(APP_DIR, 'out-seam-s75/main/index.js');
const APP_BIN = process.env.NP_APP_BIN || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S75 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S75 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) { const end = Date.now() + ms; for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await sleep(400); } }

async function main() {
  if (!APP_BIN && !fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN}`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s75-'));
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

    const cust = await create('crm-customers', { name: 'Analytical Engines' });
    assert(cust.ok, 'customer created');
    const prj = await create('projects-projects', { projectNumber: 'PRJ-1', name: 'Relaunch', customerRef: cust.record.id, billingType: 'time_material' });
    assert(prj.ok, 'project created (customerRef resolved)');
    assert((await create('projects-projects', { projectNumber: 'PRJ-X', name: 'Ghost', customerRef: 'ghost-id' })).ok === false, 'project with ghost customer refused');

    const t1 = await create('projects-tasks', { taskNumber: 'TSK-1', projectRef: prj.record.id, title: 'Design', status: 'todo' });
    assert(t1.ok, 'task created');
    assert((await upd('projects-tasks', t1.record.id, { status: 'done' })).ok, 'task moved to done');

    assert((await create('projects-time-entries', { entryNumber: 'TE-1', projectRef: prj.record.id, person: 'kinjal', date: '2026-08-03', hours: 4, hourlyRate: 50, billable: 'yes' })).ok, 'time entry 1');
    assert((await create('projects-time-entries', { entryNumber: 'TE-2', projectRef: prj.record.id, person: 'dishant', date: '2026-08-04', hours: 2, hourlyRate: 60, billable: 'yes' })).ok, 'time entry 2');

    const run = await create('projects-billing-runs', { projectRef: prj.record.id, periodFrom: '2026-08-01', periodTo: '2026-08-31', taxRate: 18 });
    assert(run.ok && Number((await get('projects-billing-runs', run.record.id)).fields.totalAmount) === 320, 'billing run previews 320');
    assert((await act('projects-billing-runs', run.record.id, 'issueInvoice')).ok, 'issueInvoice → real draft invoice');
    assert(String((await get('projects-billing-runs', run.record.id)).fields.status) === 'invoiced', 'run closed (invoiced)');
    const inv = (await list('finance')).find((i) => String(i.fields.number) === 'INV-BR-PRJ-1-1');
    assert(inv && Number(inv.fields.amount) === 320 && String(inv.fields.status) === 'draft', 'draft invoice 320 created');
    assert((await act('projects-billing-runs', run.record.id, 'issueInvoice')).ok === false, 'IDEMPOTENT re-issue refused');

    assert((await act('projects-projects', prj.record.id, 'complete')).ok, 'project completed');
    assert((await create('projects-tasks', { taskNumber: 'TSK-LATE', projectRef: prj.record.id, title: 'Late', status: 'todo' })).ok === false, 'ILLEGAL task on closed project refused');
    assert((await act('projects-projects', prj.record.id, 'cancel')).ok === false, 'ILLEGAL cancel-after-complete refused');

    out('RESULT', 'Projects whole-user journey VERIFIED in the real Electron runtime (customer→project→tasks→time→billing→draft invoice→close, idempotent, immutable); project-cost/revenue→GL = POLICY-BLOCKED, not driven');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
