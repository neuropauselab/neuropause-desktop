#!/usr/bin/env node
/**
 * ERP S99 — MAINTENANCE + PROJECTS economic control-plane journey in the REAL Electron runtime, on a FRESH
 * isolated profile with NO seeded ERP state and NO IPC shortcuts. Certifies both domains as SAFE, governed
 * participants in the canonical Inventory + Finance control plane.
 *
 * MAINTENANCE: spare-part consume → one production_consumption movement in the canonical ledger (on-hand −q
 *   once; replay refused; posted movement cannot be deleted); labor cost is non-posting; the spare material
 *   posts INCIDENTALLY to Dr WIP / Cr Inventory (POLICY-OPEN, documented in DECISION-MEMO-S99 — asserted, not
 *   "fixed"); work-order lifecycle assign → start → complete → verify records history.
 * PROJECTS: billing run → DRAFT invoice in the canonical finance module (entries + run frozen; idempotent);
 *   the legacy issue door is fenced (S46); issuing via the governed IssueCustomerInvoice command posts
 *   Dr Accounts Receivable / Cr Sales Revenue exactly once (the inherited O2C S28/S95 chain).
 * Everything survives a REAL process restart with no duplicate movement / GL / billing.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s99"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s99MaintenanceProjectsJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ALT_MAIN = path.join(path.resolve(__dirname, '..'), 'out-seam-s99/main/index.js');
const SKU = 'SP-SKU-1', STD = 8;
const MV = 'inventory-movements', PROD = 'inventory-products', JRNL = 'finance-journal-entries';
const SPARE = 'maintenance-spare-parts', WO = 'maintenance-work-orders';
const CUST = 'crm-customers', PROJ = 'projects-projects', TIME = 'projects-time-entries', RUN = 'projects-billing-runs', FIN = 'finance';
const WIP = '1350', INV = '1300', AR = '1100', REV = '4000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S99 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S99 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) { const end = Date.now() + ms; for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await sleep(400); } }

async function launch(profile) {
  const logs = [];
  const app = await electron.launch({ args: [ALT_MAIN, `--user-data-dir=${profile}`], env: { ...process.env, NP_E2E_BUILD: '', NEUROPAUSE_E2E: '', ELECTRON_RENDERER_URL: '', NODE_ENV: 'production' }, timeout: 60_000 });
  app.process().stdout.on('data', (d) => logs.push(String(d)));
  app.process().stderr.on('data', (d) => logs.push(String(d)));
  const win = await app.firstWindow({ timeout: 45_000 });
  for (const re of [/Enterprise OS ready/, /Runtime core ready/]) { if (!(await waitForLog(logs, re, 30_000))) fail(`BOOT_LOG ${re}`); }
  const bridge = (ch, payload) => win.evaluate(([c, p]) => window.neuropause.invoke(c, p), [ch, payload]);
  return { app, win, bridge };
}

async function main() {
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build out-seam-s99 first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s99-'));
  let session = await launch(profile);
  let closed = false;
  try {
    const b = () => session.bridge;
    const create = (m, f) => b()('enterprise:module.create', { moduleId: m, fields: f });
    const act = (m, id, a) => b()('enterprise:module.action', { moduleId: m, id, action: a });
    const del = (m, id) => b()('enterprise:module.delete', { moduleId: m, id });
    const listOf = (m) => b()('enterprise:module.list', { moduleId: m });
    const dispatch = (op, target, key) => b()('platform:command.dispatch', { operation: op, target, payload: {}, idempotencyKey: key });
    const onHand = async () => { const p = (await listOf(PROD)).find((r) => String(r.fields.sku) === SKU); return Number(p?.fields?.currentStock ?? 0); };
    const waitOnHand = async (t) => { for (let i = 0; i < 40; i += 1) { if ((await onHand()) === t) return true; await sleep(250); } return (await onHand()) === t; };
    const consumeMoves = async () => (await listOf(MV)).filter((m) => m.status !== 'deleted' && String(m.fields.type) === 'production_consumption');
    const jlines = async () => (await listOf(JRNL)).flatMap((e) => { try { return JSON.parse(String(e.fields.lines ?? '[]')); } catch { return []; } });
    const bal = async (acct, side) => (await jlines()).filter((l) => String(l.account) === acct).reduce((n, l) => n + Number(l[side] ?? 0), 0);
    const waitBal = async (acct, side, t) => { for (let i = 0; i < 40; i += 1) { if ((await bal(acct, side)) === t) return true; await sleep(250); } return (await bal(acct, side)) === t; };
    const draftInvoice = async () => (await listOf(FIN)).find((r) => r.status !== 'deleted');

    const userData = await session.app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData) === fs.realpathSync(profile), 'FRESH isolated profile is the running userData');
    assert((await listOf(MV)).length === 0 && (await listOf(SPARE)).length === 0 && (await listOf(PROJ)).length === 0, 'fresh profile has NO seeded ERP state');

    // ───────── MAINTENANCE ─────────
    assert((await create(PROD, { sku: SKU, name: 'Bearing', standardCost: STD })).ok, 'product created');
    assert((await create(MV, { movementNumber: 'MV-SEED', type: 'receive', product: SKU, warehouse: 'WH-1', quantity: 100 })).ok, 'seeded 100 on-hand');
    assert(await waitOnHand(100), 'on-hand reconciled to 100');
    // a work order carrying labor/parts cost posts NO journal (labor non-posting)
    const wo = await create(WO, { workOrderNumber: 'WO-1', type: 'corrective', technician: 'Sam', laborCost: 500, partsCost: 200, status: 'scheduled' });
    assert(wo.ok, 'work order created with labor/parts cost fields');
    assert((await jlines()).length === 0, 'maintenance labor cost posts NO journal (non-posting field)');
    // spare-part consume → one production_consumption, on-hand −5 once
    const part = await create(SPARE, { partNumber: 'SP-1', product: SKU, warehouse: 'WH-1', quantity: 5, unitCost: STD, workOrder: 'WO-1' });
    assert((await act(SPARE, part.record.id, 'consume')).ok, 'spare part consumed');
    assert(await waitOnHand(95), 'on-hand 100 → 95 (spare consumed exactly once)');
    assert((await consumeMoves()).length === 1, 'exactly one production_consumption movement');
    // replay refused → no duplicate movement
    assert((await act(SPARE, part.record.id, 'consume')).ok === false, 'a replay consume is refused (idempotent)');
    assert((await consumeMoves()).length === 1, 'still exactly one movement after replay');
    // incidental WIP GL (POLICY-OPEN): Cr Inventory correct; Dr WIP is the documented mis-attribution
    assert(await waitBal(INV, 'credit', 40), 'spare material Cr Inventory 40 (5 × std 8) — correct');
    assert((await bal(WIP, 'debit')) === 40, 'spare material Dr WIP 40 — INCIDENTAL/POLICY-OPEN (documented, not fixed)');
    // posted spare movement is immutable — cannot be deleted (S97 guard)
    const mv = (await consumeMoves())[0];
    assert((await del(MV, mv.id)).ok === false, 'a posted spare-part movement cannot be DELETED');
    assert(await waitOnHand(95), 'on-hand unchanged after the refused delete');
    // work-order lifecycle
    for (const a of ['assign', 'start', 'complete', 'verify']) assert((await act(WO, wo.record.id, a)).ok, `work order ${a}`);
    assert(String(((await listOf(WO)).find((r) => r.id === wo.record.id)).fields.status) === 'verified', 'work order verified');

    // ───────── PROJECTS ─────────
    const cust = await create(CUST, { name: 'Beta Corp' });
    const project = await create(PROJ, { projectNumber: 'PRJ-1', name: 'Relaunch', customerRef: cust.record.id, billingType: 'time_material' });
    assert(project.ok, 'project created');
    assert((await create(TIME, { entryNumber: 'TE-1', projectRef: project.record.id, person: 'Sam', date: '2026-09-10', hours: 10, hourlyRate: 50, billable: 'yes' })).ok, 'billable time entry 1 (10h)');
    assert((await create(TIME, { entryNumber: 'TE-2', projectRef: project.record.id, person: 'Sam', date: '2026-09-11', hours: 6, hourlyRate: 50, billable: 'yes' })).ok, 'billable time entry 2 (6h)');
    assert((await jlines()).filter((l) => String(l.account) === AR).length === 0, 'no AR posted yet (delivery records are non-posting)');
    const run = await create(RUN, { projectRef: project.record.id, periodFrom: '2026-09-01', periodTo: '2026-09-30', taxRate: 0 });
    assert(run.ok, 'billing run created');
    assert((await act(RUN, run.record.id, 'issueInvoice')).ok, 'billing run issued a DRAFT invoice');
    const inv = await draftInvoice();
    assert(inv && String(inv.fields.status) === 'draft', 'a DRAFT invoice exists in the canonical finance module');
    assert(Number(inv.fields.amount) === 800, 'invoice amount = (10 + 6)h × 50 = 800');
    assert((await bal(AR, 'debit')) === 0, 'a draft invoice posts NO AR yet');
    // one invoice per run (idempotent)
    assert((await act(RUN, run.record.id, 'issueInvoice')).ok === false, 'a re-issue of the run is refused (one invoice per run)');
    // legacy raw issue door fenced (S46); governed command posts AR/revenue once
    assert((await act(FIN, inv.id, 'issue')).ok === false, 'the legacy raw issue action is refused (governed-command-only, S46)');
    assert((await dispatch('IssueCustomerInvoice', inv.id, 'issue:1')).ok === true, 'IssueCustomerInvoice command issues the invoice');
    assert(await waitBal(AR, 'debit', 800), 'issue posts Dr Accounts Receivable 800');
    assert((await bal(REV, 'credit')) === 800, 'issue posts Cr Sales Revenue 800');
    // AR booked once — replay posts no second entry
    await dispatch('IssueCustomerInvoice', inv.id, 'issue:1');
    assert((await bal(AR, 'debit')) === 800, 'AR still 800 after replay (booked exactly once)');
    // no project-specific cost/revenue journal beyond the canonical AR/revenue
    assert((await jlines()).filter((l) => ![WIP, INV, AR, REV].includes(String(l.account))).length === 0, 'no separate project cost→GL or revenue-recognition posting');

    // snapshot for restart
    const snap = { on: await onHand(), consume: (await consumeMoves()).length, wip: await bal(WIP, 'debit'), ar: await bal(AR, 'debit'), rev: await bal(REV, 'credit'), invoices: (await listOf(FIN)).filter((r) => r.status !== 'deleted').length, runStatus: String(((await listOf(RUN)).find((r) => r.id === run.record.id)).fields.status), woStatus: String(((await listOf(WO)).find((r) => r.id === wo.record.id)).fields.status) };

    // ───────── RESTART ─────────
    await session.app.close(); closed = true;
    session = await launch(profile); closed = false;
    const userData2 = await session.app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData2) === fs.realpathSync(profile), 'restart reopened the SAME profile');
    assert((await onHand()) === snap.on, 'on-hand survives restart');
    assert((await consumeMoves()).length === snap.consume, 'spare movement count survives restart');
    assert((await bal(WIP, 'debit')) === snap.wip, 'WIP GL survives restart');
    assert((await bal(AR, 'debit')) === snap.ar && (await bal(REV, 'credit')) === snap.rev, 'AR/revenue GL survives restart');
    assert((await listOf(FIN)).filter((r) => r.status !== 'deleted').length === snap.invoices, 'invoice count survives restart');
    assert(String(((await listOf(RUN)).find((r) => r.id === run.record.id)).fields.status) === snap.runStatus, 'billing run status (invoiced) survives restart');
    assert(String(((await listOf(WO)).find((r) => r.id === wo.record.id)).fields.status) === snap.woStatus, 'work order status (verified) survives restart');
    // no duplicate after restart
    assert((await act(SPARE, part.record.id, 'consume')).ok === false, 'spare replay after restart refused (no duplicate movement)');
    assert((await act(RUN, run.record.id, 'issueInvoice')).ok === false, 'billing-run re-issue after restart refused (no duplicate billing)');
    assert((await consumeMoves()).length === snap.consume && (await listOf(FIN)).filter((r) => r.status !== 'deleted').length === snap.invoices, 'no duplicate movement or invoice after restart');

    out('RESULT', 'S99 maintenance + projects economic boundaries VERIFIED in the real Electron runtime on a FRESH profile: MAINTENANCE spare-part consume posts exactly one production_consumption movement into the canonical inventory ledger (on-hand −5 once; replay refused; posted movement immutable to delete), maintenance labor cost is non-posting, and the spare material posts incidentally to Dr WIP / Cr Inventory (Cr Inventory correct; the WIP debit is the POLICY-OPEN mis-attribution documented in DECISION-MEMO-S99, asserted not fixed); the work-order lifecycle assign → start → complete → verify holds. PROJECTS billing run creates a DRAFT invoice in the canonical finance module (entries + run frozen, one invoice per run), the legacy raw issue door is fenced (S46), and the governed IssueCustomerInvoice command posts Dr Accounts Receivable / Cr Sales Revenue exactly once (the inherited O2C chain) with NO separate project cost→GL. After a REAL PROCESS RESTART every movement, GL posting, invoice, and lifecycle state survives with no duplicate movement, GL, or billing. No accounting policy was invented.');
  } finally {
    if (!closed) { await Promise.race([session.app.close(), sleep(15_000)]).catch(() => undefined); }
    try { session.app.process().kill('SIGKILL'); } catch { /* already dead */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
