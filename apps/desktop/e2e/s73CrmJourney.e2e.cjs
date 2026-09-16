#!/usr/bin/env node
/**
 * ERP S73 Gate 2 — CRM WHOLE-USER JOURNEY in the REAL Electron runtime.
 *
 * Lead → CONVERT (Contact + Customer) → Opportunity → advanceStage → markWon →
 * Quote (accepted) → ConvertQuoteToSalesOrder (GOVERNED command) → Sales Order.
 * Every step through `window.neuropause.invoke` (the same bridge the UI uses);
 * alternate release build (out-seam-s73), fresh throwaway profile; zero external effect.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s73"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s73CrmJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_DIR = path.resolve(__dirname, '..');
const ALT_MAIN = path.join(APP_DIR, 'out-seam-s73/main/index.js');
const APP_BIN = process.env.NP_APP_BIN || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S73CRM ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S73CRM FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) { const end = Date.now() + ms; for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await sleep(400); } }

async function main() {
  if (!APP_BIN && !fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build it first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s73crm-'));
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
    const dispatch = (operation, o = {}) => bridge('platform:command.dispatch', { operation, ...(o.target ? { target: o.target } : {}), payload: o.payload ?? {}, idempotencyKey: o.idem });

    // ── Lead → convert → (contact + customer); second convert refused ──
    const lead = await create('crm-leads', { name: 'Ada Lovelace', company: 'Analytical Engines', email: 'ada@ae.example', dealValue: 5000, stage: 'new' });
    assert(lead.ok && lead.record && lead.record.id, 'create lead ok');
    const conv = await act('crm-leads', lead.record.id, 'convert');
    assert(conv.ok, 'lead CONVERT ok (contact + customer created)');
    const conv2 = await act('crm-leads', lead.record.id, 'convert');
    assert(conv2.ok === false, 'second convert REFUSED (no duplicate customer/contact)');

    // ── Opportunity → advanceStage → markWon; closed is immutable ──
    const opp = await create('crm-opportunities', { name: 'AE expansion', account: 'Analytical Engines', amount: 12000, stage: 'prospecting' });
    assert(opp.ok && opp.record, 'create opportunity ok');
    assert((await act('crm-opportunities', opp.record.id, 'advanceStage')).ok, 'opportunity advanceStage ok');
    assert((await act('crm-opportunities', opp.record.id, 'markWon')).ok, 'opportunity markWon ok');
    assert(String((await get('crm-opportunities', opp.record.id)).fields.stage) === 'closed-won', 'opportunity is closed-won');
    assert((await act('crm-opportunities', opp.record.id, 'advanceStage')).ok === false, 'closed opportunity is immutable');

    // ── Quote (accepted) → ConvertQuoteToSalesOrder (governed) → order; replay idempotent ──
    const q = await create('sales-quotes', { quoteNumber: 'Q-CRM-1', customer: 'Analytical Engines', status: 'accepted', currency: 'USD', subtotal: 12000, total: 12000 });
    assert(q.ok && q.record, 'create accepted quote ok');
    const so = await dispatch('ConvertQuoteToSalesOrder', { target: q.record.id, idem: 'crm-q1' });
    assert(so.ok && so.data && so.data.orderId, 'ConvertQuoteToSalesOrder ok (governed) → order');
    assert(String((await get('sales-quotes', q.record.id)).fields.status) === 'converted', 'quote cross-linked to converted');
    const soReplay = await dispatch('ConvertQuoteToSalesOrder', { target: q.record.id, idem: 'crm-q1' });
    assert(soReplay.ok && soReplay.replayed === true, 'same-key conversion REPLAYS (one order, ever)');

    out('RESULT', 'CRM whole-user journey VERIFIED in the real Electron runtime (lead→convert→opportunity→won→quote→governed order, idempotent)');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
