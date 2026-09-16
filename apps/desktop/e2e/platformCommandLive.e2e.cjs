#!/usr/bin/env node
/**
 * ERP Session 22 / FG-ERP-LIVE-IPC — PACKAGED-APP live-chain harness.
 *
 * Proves the COMPLETE governed chain in the REAL packaged application, driven from the
 * renderer exactly as a UI control does (`window.neuropause.invoke` — the brainPropose /
 * journalRuntime precedent; a button's onClick calls the same bridge):
 *
 *   renderer (window.neuropause.invoke)
 *     → preload/secure bridge
 *     → IPC channel  platform:command.dispatch
 *     → platformCommandIpc handler → ElectronClientAdapter → Application Boundary
 *     → command bus → authorization → workflow/approved-gate → domain command
 *     → durable transaction + domain event + outbox (platform-command-journal.json on disk)
 *     → audit → IPC response → (renderer state)
 *
 * ⚠ MUST RUN ON macOS. It launches the packaged Electron app via playwright `_electron`; it
 * was NOT executed in the Linux authoring sandbox (no macOS Electron binary, no display).
 * ZERO external effect: all mutations are local ERP records inside a throwaway --user-data-dir.
 *
 * Build the packaged app first (see the runbook in the Session-22 evidence), then:
 *   NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" \
 *   NP_APP_BIN="$PWD/dist/mac-arm64/NeuroPause.app/Contents/MacOS/NeuroPause" \
 *   node e2e/platformCommandLive.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_DIR = path.resolve(__dirname, '..');
const APP_BIN =
  process.env.NP_APP_BIN ||
  path.join(APP_DIR, 'dist/mac-arm64/NeuroPause.app/Contents/MacOS/NeuroPause');

function out(k, v) { console.log(`S22 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S22 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) {
  const end = Date.now() + ms;
  for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await new Promise((r) => setTimeout(r, 400)); }
}

async function main() {
  if (!fs.existsSync(APP_BIN)) fail(`packaged app missing: ${APP_BIN} (build it first; set NP_APP_BIN)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s22-live-'));
  const logs = [];
  const app = await electron.launch({
    executablePath: APP_BIN,
    args: [`--user-data-dir=${profile}`],
    env: { ...process.env, NP_E2E_BUILD: '', NEUROPAUSE_E2E: '' },
    timeout: 60_000,
  });
  app.process().stdout.on('data', (d) => logs.push(String(d)));
  app.process().stderr.on('data', (d) => logs.push(String(d)));
  try {
    const win = await app.firstWindow({ timeout: 45_000 });
    out('packaged', await app.evaluate(({ app: a }) => a.isPackaged));
    const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(path.resolve(userData) === path.resolve(profile), 'ISOLATED profile is the running userData');
    // Boot composition — the runtime core + governed platform are up.
    for (const re of [/Enterprise OS ready/, /Runtime core ready/]) {
      assert(await waitForLog(logs, re, 30_000), `BOOT_LOG ${re}`);
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
    const LINES = JSON.stringify([{ sku: 'SKU-A', quantity: 10, unitPrice: 5 }]);

    // 1 · CreatePurchaseRequest through the LIVE channel.
    const created = await dispatch('CreatePurchaseRequest', { payload: { requestNumber: 'PR-LIVE-1', lines: LINES }, idem: 'live-1' });
    assert(created && created.ok === true && created.data && created.data.id, 'CreatePurchaseRequest ok via live IPC');
    const prId = created.data.id;

    // 2 · Submit → Approve → Convert (the approved-gate is enforced at the command path).
    assert((await dispatch('SubmitPurchaseRequest', { target: prId, idem: 'live-1s' })).ok, 'SubmitPurchaseRequest ok');
    assert((await dispatch('ApprovePurchaseRequest', { target: prId, idem: 'live-1a' })).ok, 'ApprovePurchaseRequest ok');
    const conv = await dispatch('ConvertPurchaseRequestToPO', { target: prId, idem: 'live-1c' });
    assert(conv.ok === true && conv.data && conv.data.purchaseOrderId, 'ConvertPurchaseRequestToPO created a PO');

    // 3 · Invariant — a fresh PENDING PR cannot convert (no approval skip) → CONFLICT.
    const pend = await dispatch('CreatePurchaseRequest', { payload: { requestNumber: 'PR-LIVE-2', lines: LINES }, idem: 'live-2' });
    await dispatch('SubmitPurchaseRequest', { target: pend.data.id, idem: 'live-2s' });
    const badConv = await dispatch('ConvertPurchaseRequestToPO', { target: pend.data.id, idem: 'live-2c' });
    assert(badConv.ok === false && badConv.error && badConv.error.code === 'CONFLICT', 'PENDING PR cannot convert (CONFLICT)');

    // 4 · Tenant-claim rejected (renderer cannot inject tenant identity).
    const evil = await dispatch('CreatePurchaseRequest', { payload: { requestNumber: 'PR-LIVE-3', lines: LINES }, idem: 'live-3', claimedTenantId: 'tenant-EVIL' });
    assert(evil.ok === false && evil.error.code === 'TENANT_SCOPE_VIOLATION', 'cross-tenant claim rejected');

    // 5 · Idempotency — same key replays, one economic effect.
    const replay = await dispatch('CreatePurchaseRequest', { payload: { requestNumber: 'PR-LIVE-1', lines: LINES }, idem: 'live-1' });
    assert(replay.ok === true && replay.data.id === prId, 'same idempotency key replays to the same PR');

    // 6 · DURABLE EFFECT ON DISK — the Session-18 journal committed the transaction + event + outbox.
    const journalPath = path.join(userData, 'platform-command-journal.json');
    assert(fs.existsSync(journalPath), 'durable platform-command-journal.json exists on disk');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    const recs = Array.isArray(journal) ? journal : journal.records || journal.entries || [];
    assert(recs.length >= 1, `durable journal holds committed command records (${recs.length})`);

    out('RESULT', 'LIVE CHAIN VERIFIED (packaged): UI invoke → IPC → command bus → durable journal → response');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
