#!/usr/bin/env node
/**
 * ERP S82 — PROCUREMENT SPEND ANALYTICS + SUPPLIER RISK whole-capability journey in the REAL
 * Electron runtime.
 *
 * REQUIRES: the FG-S82 registration to have LANDED (spendAnalyticsModule + supplierRiskModule
 * registered in the frozen enterprise/index.ts per FG-S82-PROCUREMENT-INTELLIGENCE-REGISTRATION.md).
 * Until that gate's token arrives and the 4 additive lines exist, the modules are unreachable and
 * this harness FAILS CLOSED at the first register create — that failure is the correct answer.
 *
 * Proves, entirely through the governed `enterprise:module.*` path (window.neuropause.invoke,
 * the same preload bridge the UI uses):
 *   create supplier (rating 1 / 40d lead) → PO through the existing doors (approve → send) →
 *   spend register #1 reflects ORDERED + OPEN (never blended) →
 *   receive the PO through the canonical goods-receipt workflow (receiveGoods → post) →
 *   spend register #2 shifts the lifecycle (open → received; ordered unchanged) →
 *   vendor bill approved (INVOICED appears; PAID still 0) →
 *   risk register shows indicators (existing >=60 cutoff, open-bill exposure, printed reasons) →
 *   repeat generation is deterministic (same rows) → source stores never mutated.
 *
 * Tenant isolation is proven at unit level (procurementIntelligence.test.ts, one bound store,
 * scope switched); a single local-mode Electron session has one principal, so this journey
 * asserts the governed tenant-scoped read path rather than a two-org switch.
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s82"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s82SpendRiskJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ALT_MAIN = path.join(path.resolve(__dirname, '..'), 'out-seam-s82/main/index.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S82 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S82 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) { const end = Date.now() + ms; for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await sleep(400); } }

async function main() {
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build out-seam-s82 first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s82-'));
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
    const today = new Date().toISOString().slice(0, 10);
    const num = (r, k) => Number(r?.record?.fields?.[k]);
    const rowsOf = (r) => JSON.parse(String(r?.record?.fields?.rows ?? '[]'));

    // 1. master data: product + a supplier whose OWN fields put it at the existing >=60 cutoff
    assert((await create('inventory-products', { sku: 'SKU-1', name: 'Widget', standardCost: 5 })).ok, 'product SKU-1 created');
    assert((await create('procurement-suppliers', { name: 'Acme Supplies', vendorRating: 1, leadTime: 40, status: 'active' })).ok,
      'supplier Acme created (rating 1/5, 40d lead — (5−1)×12 + 20 = 68 ≥ 60 by the EXISTING formula)');

    // 2. PO through the existing doors: create (draft) → approve → send
    const po = await create('procurement-orders', { poNumber: 'PO-1', supplier: 'Acme Supplies', product: 'SKU-1', warehouse: 'WH-1', quantity: 10, unitCost: 20, subtotal: 200, discount: 0, tax: 0, expectedDelivery: '2099-01-01' });
    assert(po.ok, 'PO-1 created (draft)');
    assert((await act('procurement-orders', po.record.id, 'approve')).ok, 'PO-1 approved (existing door)');
    assert((await act('procurement-orders', po.record.id, 'send')).ok, 'PO-1 sent (existing door)');

    // 3. spend register #1 — ORDERED 200 and OPEN 200 are separate numbers; nothing invoiced/paid
    const spend1 = await create('procurement-spend-analytics', { asOfDate: today });
    assert(spend1.ok, 'spend register #1 generated (governed create = generate)');
    assert(num(spend1, 'orderedTotal') === 200 && num(spend1, 'openTotal') === 200, 'spend#1 ordered 200 / open 200 (sent PO is both)');
    assert(num(spend1, 'invoicedTotal') === 0 && num(spend1, 'paidTotal') === 0, 'spend#1 invoiced 0 / paid 0 (no bill yet — not fabricated)');
    assert(rowsOf(spend1)[0].supplier === 'Acme Supplies', 'spend#1 row attributed to Acme by trimmed name');

    // 4. receive through the canonical goods-receipt workflow (receiveGoods → post)
    assert((await act('procurement-orders', po.record.id, 'receiveGoods')).ok, 'PO-1 receiveGoods (goods receipt created, PO → received)');
    const gr = (await listOf('procurement-receipts')).find((r) => String(r.fields.grNumber) === 'GR-PO-1');
    assert(gr, 'goods receipt GR-PO-1 exists');
    assert((await act('procurement-receipts', gr.id, 'post')).ok, 'goods receipt POSTED (receive movement into stock)');

    // 5. spend register #2 — lifecycle SHIFTS: open → 0, ordered unchanged, receipt counted
    const spend2 = await create('procurement-spend-analytics', { asOfDate: today });
    assert(num(spend2, 'orderedTotal') === 200, 'spend#2 ordered still 200 (received stays ordered spend)');
    assert(num(spend2, 'openTotal') === 0, 'spend#2 open 0 (a received PO is no longer open — states never blended)');
    assert(num(spend2, 'receiptCount') === 1, 'spend#2 counts the posted receipt (RECEIVED evidence)');

    // 6. vendor bill through the existing Finance door: create (draft) → approve (books the payable)
    const bill = await create('finance-vendor-bills', { billNumber: 'BILL-1', vendor: 'Acme Supplies', amount: 100, taxRate: 0 });
    assert(bill.ok, 'vendor bill BILL-1 created (draft)');
    assert((await act('finance-vendor-bills', bill.record.id, 'approve')).ok, 'BILL-1 approved (booked payable — existing door)');
    const spend3 = await create('procurement-spend-analytics', { asOfDate: today });
    assert(num(spend3, 'invoicedTotal') === 100 && num(spend3, 'paidTotal') === 0, 'spend#3 invoiced 100 / paid 0 (INVOICED ≠ PAID)');

    // READ-ONLY baseline before the register-only block below — FULL-CONTENT identity, not
    // just counts: every source record serialized (id-sorted), so any field/rev/timestamp drift
    // in any source store fails the proof.
    const sourceSnapshot = async () => JSON.stringify(await Promise.all(
      ['procurement-orders', 'procurement-receipts', 'finance-vendor-bills', 'procurement-suppliers']
        .map(async (m) => (await listOf(m)).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))),
    ));
    const beforeRegisters = await sourceSnapshot();

    // 7. risk register — indicators from EXISTING formulas, reasons printed
    const risk1 = await create('procurement-supplier-risk', { asOfDate: today });
    assert(risk1.ok, 'risk register generated (governed create = generate)');
    assert(num(risk1, 'supplierCount') === 1 && num(risk1, 'highRiskCount') === 1, 'risk: Acme is HIGH RISK by the existing >=60 cutoff');
    assert(num(risk1, 'openBillExposure') === 100, 'risk: open payable exposure 100 (approved unpaid bill — deriveApAging rule)');
    const riskRow = rowsOf(risk1)[0];
    assert(riskRow.riskScore === 68 && riskRow.highRisk === true, 'risk row: score 68 (rating 1 → 48, lead 40d → +20) via calculateVendorRisk');
    assert(riskRow.deliveryPerformancePct === 100, 'risk row: on-time 100% from the real dated receipt evidence');
    assert(Array.isArray(riskRow.reasons) && riskRow.reasons.join(' ').includes('calculateVendorRisk'), 'risk row PRINTS its reasons + formula');

    // 8. repeat generation is deterministic (same sources → same rows; a NEW immutable snapshot)
    const risk2 = await create('procurement-supplier-risk', { asOfDate: today });
    assert(String(risk2.record.fields.rows) === String(risk1.record.fields.rows), 'risk register regeneration deterministic (same rows)');
    const spend4 = await create('procurement-spend-analytics', { asOfDate: today });
    assert(String(spend4.record.fields.rows) === String(spend3.record.fields.rows), 'spend register regeneration deterministic (same rows)');

    // 9. READ-ONLY — every source record content-identical after all register generations
    assert((await sourceSnapshot()) === beforeRegisters, 'source stores content-identical after the read-only registers (full-record proof)');

    // 10. governed tenant-scoped reads return this session's registers (isolation unit-proven separately)
    assert((await listOf('procurement-spend-analytics')).length === 4 && (await listOf('procurement-supplier-risk')).length === 2,
      'governed reads return the session tenant’s registers (4 spend + 2 risk)');

    out('RESULT', 'S82 spend analytics + supplier risk VERIFIED in the real Electron runtime (supplier → PO approve/send → spend ORDERED/OPEN → receiveGoods/post → lifecycle shift → bill approve → INVOICED → risk indicators at the existing cutoff → deterministic regeneration), governed, tenant-scoped, sources read-only');
  } finally {
    await Promise.race([app.close(), sleep(15_000)]).catch(() => undefined);
    try { app.process().kill('SIGKILL'); } catch { /* already dead */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
