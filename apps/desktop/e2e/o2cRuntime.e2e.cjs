#!/usr/bin/env node
/**
 * ERP Session 45 — FULL GOVERNED O2C CHAIN in the REAL Electron runtime.
 *
 * Launches the ALTERNATE release build (out-seam-s45 — NEVER the armed out/, per the NP-008
 * armed-build law; the journalRuntime/B.10 precedent) on a FRESH throwaway --user-data-dir and
 * drives the complete Order-to-Cash lifecycle exactly as UI controls do
 * (`window.neuropause.invoke` — the S22 platformCommandLive precedent):
 *
 *   CreateSalesOrder → ShipSalesOrder (real stock issue) → InvoiceSalesOrder (draft)
 *     → IssueCustomerInvoice (Dr AR / Cr Revenue) → ReceiveCustomerPayment (Dr Cash / Cr AR,
 *       invoice settles to paid)
 *   + ConvertQuoteToSalesOrder (the S45 command, live)
 *   + negatives: pending order cannot invoice · cross-tenant claim rejected · same-key replay
 *   + the S45 EDIT-door guard live: hand-setting order status via enterprise:module.update REFUSED
 *   + durable proof: platform-command-journal.json on disk carries the O2C domain events
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s45"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/o2cRuntime.e2e.cjs
 * ZERO external effect: every mutation is a local ERP record inside the throwaway profile.
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_DIR = path.resolve(__dirname, '..');
const ALT_MAIN = path.join(APP_DIR, 'out-seam-s45/main/index.js');
// S48 — NP_APP_BIN points the SAME chain harness at the PACKAGED artifact.
const APP_BIN = process.env.NP_APP_BIN || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S45 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S45 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) {
  const end = Date.now() + ms;
  for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await new Promise((r) => setTimeout(r, 400)); }
}

async function main() {
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (build it first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s45-o2c-'));
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
    if (!APP_BIN) {
      for (const re of [/Enterprise OS ready/, /Runtime core ready/]) {
        assert(await waitForLog(logs, re, 30_000), `BOOT_LOG ${re}`);
      }
    } else {
      // Packaged mode routes logs to the file sink, not stdout; boot is proven by the
      // bridge answering below (every dispatch requires the runtime core to be up).
      await sleep(4000);
    }
    const bridge = (ch, payload) =>
      win.evaluate(([c, p]) => window.neuropause.invoke(c, p), [ch, payload]);
    const dispatch = (operation, o = {}) =>
      bridge('platform:command.dispatch', {
        operation,
        ...(o.target ? { target: o.target } : {}),
        payload: o.payload ?? {},
        idempotencyKey: o.idem,
        ...(o.claimedTenantId ? { claimedTenantId: o.claimedTenantId } : {}),
      });
    const create = (moduleId, fields) => bridge('enterprise:module.create', { moduleId, fields });
    const record = async (moduleId, id) => bridge('enterprise:module.get', { moduleId, id }); // returns the record itself

    // ── Master data (legitimately CRUD — products/stock are not O2C lifecycle writes) ──
    assert((await create('inventory-products', { sku: 'SKU-A', name: 'Widget', standardCost: 5 })).ok, 'seed product');
    assert((await create('inventory-movements', { movementNumber: 'MV-1', type: 'receive', product: 'SKU-A', warehouse: 'WH-1', quantity: 100 })).ok, 'seed on-hand stock (receive 100)');

    // ── CHAIN A · the economic O2C lifecycle, fully governed ──
    const so = await dispatch('CreateSalesOrder', { payload: { orderNumber: 'SO-LIVE-1', customer: 'Acme Inc.', product: 'SKU-A', warehouse: 'WH-1', orderedQty: 40, currency: 'USD', total: 900 }, idem: 'o2c-1' });
    if (!(so.ok === true && so.data && so.data.id)) out('DEBUG_so', so);
    assert(so.ok === true && so.data && so.data.id, 'CreateSalesOrder ok via live IPC');
    const soId = so.data.id;

    const ship = await dispatch('ShipSalesOrder', { target: soId, idem: 'o2c-1s' });
    assert(ship.ok === true, 'ShipSalesOrder ok (governed, real stock issue)');
    const soAfterShip = await record('sales-orders', soId);
    assert(String(soAfterShip.fields.status) === 'shipped', 'order is SHIPPED in the durable store');

    const inv = await dispatch('InvoiceSalesOrder', { target: soId, idem: 'o2c-1i' });
    assert(inv.ok === true && inv.data && inv.data.invoiceId, 'InvoiceSalesOrder ok → draft invoice');
    const invId = inv.data.invoiceId;

    const issue = await dispatch('IssueCustomerInvoice', { target: invId, idem: 'o2c-1x' });
    assert(issue.ok === true, 'IssueCustomerInvoice ok (Dr AR / Cr Revenue)');
    const invAfterIssue = await record('finance', invId);
    assert(String(invAfterIssue.fields.status) === 'issued', 'invoice is ISSUED in the durable store');

    const pay = await dispatch('ReceiveCustomerPayment', { payload: { paymentNumber: 'PAY-1', invoiceRef: invId, amount: 900, method: 'bank_transfer' }, idem: 'o2c-1p' });
    assert(pay.ok === true && pay.data && pay.data.id, 'ReceiveCustomerPayment ok (Dr Cash / Cr AR)');
    const invAfterPay = await record('finance', invId);
    assert(String(invAfterPay.fields.status) === 'paid', 'invoice SETTLED to paid from the real receipt ledger');
    assert(Number(invAfterPay.fields.outstandingBalance) === 0, 'outstanding balance is ZERO after settlement');

    // ── CHAIN B · quote → order through the NEW S45 governed conversion ──
    const q = await create('sales-quotes', { quoteNumber: 'Q-LIVE-1', customer: 'Beta LLC', status: 'accepted', currency: 'USD', subtotal: 500, total: 500 });
    assert(q.ok === true, 'seed accepted quote');
    const conv = await dispatch('ConvertQuoteToSalesOrder', { target: q.record.id, idem: 'o2c-q1' });
    assert(conv.ok === true && conv.data && conv.data.orderId, 'ConvertQuoteToSalesOrder ok (the S45 command, live)');
    const qAfter = await record('sales-quotes', q.record.id);
    assert(String(qAfter.fields.status) === 'converted', 'quote cross-linked to CONVERTED');
    const convReplay = await dispatch('ConvertQuoteToSalesOrder', { target: q.record.id, idem: 'o2c-q1' });
    assert(convReplay.ok === true && convReplay.replayed === true, 'same-key conversion REPLAYS (one order, ever)');

    // ── NEGATIVES, live in the real runtime ──
    const so2 = await dispatch('CreateSalesOrder', { payload: { orderNumber: 'SO-LIVE-2', customer: 'Acme', currency: 'USD', total: 100 }, idem: 'o2c-2' });
    const badInv = await dispatch('InvoiceSalesOrder', { target: so2.data.id, idem: 'o2c-2i' });
    assert(badInv.ok === false && badInv.error && badInv.error.code === 'CONFLICT', 'PENDING order cannot invoice (CONFLICT)');

    const evil = await dispatch('ShipSalesOrder', { target: so2.data.id, idem: 'o2c-2evil', claimedTenantId: 'tenant-EVIL' });
    assert(evil.ok === false && evil.error.code === 'TENANT_SCOPE_VIOLATION', 'cross-tenant claim rejected');

    // The S45 EDIT-door guard, live: hand-setting order status via the legacy update door REFUSED.
    const flip = await bridge('enterprise:module.update', { moduleId: 'sales-orders', id: so2.data.id, fields: { ...(await record('sales-orders', so2.data.id)).fields, status: 'shipped' } });
    assert(flip.ok === false && /lifecycle actions/i.test(String((flip.errors || {}).status || '')), 'EDIT door cannot hand-set order status (S45 guard live)');
    const so2After = await record('sales-orders', so2.data.id);
    assert(String(so2After.fields.status) === 'pending', 'order status UNCHANGED after the refused hand-flip');

    // ── DURABLE PROOF — the journal on disk carries the O2C domain events ──
    const journalPath = path.join(userData, 'platform-command-journal.json');
    assert(fs.existsSync(journalPath), 'durable platform-command-journal.json exists on disk');
    const text = fs.readFileSync(journalPath, 'utf8');
    for (const ev of ['SalesOrderCreated', 'SalesOrderShipped', 'SalesOrderInvoiced', 'CustomerInvoiceIssued', 'CustomerPaymentReceived', 'QuoteConvertedToSalesOrder']) {
      assert(text.includes(ev), `durable journal carries ${ev}`);
    }

    out('RESULT', 'FULL GOVERNED O2C CHAIN VERIFIED in the real Electron runtime (alternate build, fresh profile)');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
