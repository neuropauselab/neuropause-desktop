/**
 * ERP Session 13 — control-account boot-seed hardening.
 *
 * Reproduces and fixes the production initialization fragility: control-account
 * seeding used to run only on an EMPTY chart, so stock activity (which lazily
 * ensures stock accounts, making the chart non-empty) permanently suppressed the
 * finance control accounts — a later cash/expense posting then silently refused.
 * The fix aligns control-account seeding with the EXISTING FX/stock ensure-missing
 * policy and adds an explicit boot initializer. These tests do NOT rely on any
 * test-harness chart seeding — that is the point.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
}));

import {
  IpcChannel,
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, createLifecycleEmitter } from '../../framework/moduleRegistry';
import type { EnterpriseModuleActionContext } from '../../framework';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { createProductModule } from '../inventory/productModule';
import { createStockMovementModule } from '../inventory/stockMovementModule';
import { createJournalEntryModule } from './journalEntryModule';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createPurchaseOrderModule } from '../procurement/purchaseOrderModule';
import { createGoodsReceiptModule } from '../procurement/goodsReceiptModule';
import { createVendorBillModule } from './vendorBillModule';
import { createVendorPaymentModule } from './vendorPaymentModule';
import { STOCK_ACCOUNTS } from '../../../erp/postingRules';
import { seedControlAccountsIfEmpty } from './glPosting';
import { ensureCanonicalChart } from './controlChart';
import { DOCUMENT_SPECS } from '../../../erp/documentSpecs';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s13-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};

interface Rec { authorized: EnterprisePermission[] }
let rec: Rec;
let scope: { tenantId: string; workspaceId: string } | null;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];
let actionCtx: EnterpriseModuleActionContext;

function spyCtx() {
  return {
    authorize: (p: EnterprisePermission) => rec.authorized.push(p),
    audit: () => undefined,
    publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined,
    notify: () => undefined,
    actor: () => 'operator@np.dev',
    now: () => '2026-09-01T12:00:00.000Z',
  };
}

beforeEach(() => {
  rec = { authorized: [] };
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(tmp('acct'));
  const pos = createPurchaseOrderModule(tmp('po'));
  const billsM = createVendorBillModule(tmp('bill'), pos.store);
  for (const m of [
    createProductModule(tmp('prod')),
    createStockMovementModule(tmp('mv')),
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    pos,
    createGoodsReceiptModule(tmp('gr')),
    billsM,
    createVendorPaymentModule(tmp('vpay'), billsM.store),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  handlers = buildModuleHandlers(registry, spyCtx());
  actionCtx = createLifecycleEmitter(registry, spyCtx()).actionCtx;
  // NOTE: deliberately NO control-chart seeding here — Session 13 proves the
  // production paths seed themselves.
});
afterEach(async () => {
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

function handler(channel: string): (p: unknown) => Promise<unknown> {
  const def = handlers.find((d) => d.channel === channel);
  if (!def) throw new Error(`no handler for ${channel}`);
  return def.handler as (p: unknown) => Promise<unknown>;
}
const createIn = (moduleId: string, fields: Record<string, unknown>) =>
  handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity; errors?: Record<string, string> }>;
const act = (moduleId: string, id: string, action: string) =>
  handler(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string }>;
const accountCodes = (): string[] =>
  registry.get(LEDGER_ACCOUNTS_MODULE_ID)!.store.list().filter((r) => r.status !== 'deleted').map((r) => String(r.fields.code));
function journalLines(): { account: string; debit: number; credit: number }[] {
  return registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store
    .list()
    .flatMap((e) => JSON.parse(String(e.fields.lines ?? '[]')) as { account: string; debit: number; credit: number }[]);
}
const bal = (account: string, side: 'debit' | 'credit'): number =>
  journalLines().filter((l) => l.account === account).reduce((n, l) => n + l[side], 0);
async function flushUntil(pred: () => boolean, ms = 800): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 5));
}

// ---------------------------------------------------------------------------
// REPRODUCTION: stock activity first must not suppress finance control accounts
// ---------------------------------------------------------------------------

describe('Session 13 — boot init makes control accounts available before stock activity', () => {
  it('BOOT seed → stock receipt → a service bill still posts Operating Expense 5000', async () => {
    // The authoritative boot initializer runs on the empty chart FIRST (as at
    // production boot), before any stock activity makes the chart non-empty.
    // WITHOUT it (current production), the same sequence left 5000 unseeded and
    // the service bill silently refused — the reproduced fragility.
    await ensureCanonicalChart(actionCtx);
    // Stock activity: goods receipt lazily ensures stock accounts (chart already
    // non-empty from the boot seed — which is exactly why it can no longer
    // suppress the finance control accounts).
    await createIn('inventory-products', { sku: 'SP', name: 'SP', standardCost: 10 });
    const po = await createIn('procurement-orders', { poNumber: 'PO-SP', supplier: 'Acme', product: 'SP', warehouse: 'WH-1', quantity: 100, unitCost: 10, currency: 'USD' });
    const gr = await createIn('procurement-receipts', { grNumber: 'GR-SP', purchaseOrder: po.record!.id, supplier: 'Acme', product: 'SP', warehouse: 'WH-1', quantityOrdered: 40, quantityReceived: 40 });
    expect((await act('procurement-receipts', gr.record!.id, 'post')).ok).toBe(true);
    await flushUntil(() => bal(STOCK_ACCOUNTS.grni, 'credit') > 0);

    // Now a SERVICE bill (no PO) → Dr Operating Expense 5000 / Cr AP 2000.
    // 5000 is a finance CONTROL account (not a stock account), so it only posts
    // if control-account seeding survived the earlier stock activity.
    const bill = await createIn('finance-vendor-bills', { billNumber: 'VB-SVC13', vendor: 'Cloud Co', amount: 500, currency: 'USD' });
    expect((await act('finance-vendor-bills', bill.record!.id, 'approve')).ok).toBe(true);
    await flushUntil(() => bal('5000', 'debit') === 500);
    expect(bal('5000', 'debit')).toBe(500);
    expect(accountCodes()).toContain('5000'); // Operating Expenses present despite stock-first
  });
});

// ---------------------------------------------------------------------------
// Idempotent canonical initialization
// ---------------------------------------------------------------------------

describe('Session 13 — idempotent canonical chart', () => {
  const CANONICAL = ['1000', '1100', '1200', '1300', '1350', '1360', '2000', '2100', '2150', '4000', '5000', '5050', '5910', '5920'];

  it('ensureCanonicalChart is idempotent — 3× converges to one canonical set, no duplicates', async () => {
    await ensureCanonicalChart(actionCtx);
    const afterFirst = accountCodes().length;
    await ensureCanonicalChart(actionCtx);
    await ensureCanonicalChart(actionCtx);
    const codes = accountCodes();
    expect(codes.length).toBe(afterFirst); // no growth on re-runs
    expect(new Set(codes).size).toBe(codes.length); // no duplicate codes
    for (const c of CANONICAL) expect(codes).toContain(c);
  });

  it('ensureCanonicalChart on an EMPTY chart seeds the full canonical set (control + stock)', async () => {
    await ensureCanonicalChart(actionCtx);
    for (const c of ['1000', '2000', '5000', '2150', '1300', '5050']) expect(accountCodes()).toContain(c);
    expect(new Set(accountCodes()).size).toBe(accountCodes().length);
  });

  it('the empty-only seed respects a customized chart — never overwrites or force-adds (glAutoPosting policy)', async () => {
    // An operator customized the chart (one account; canonical control accounts
    // deliberately absent). The empty-only seed must NOT run — it neither
    // overwrites the custom account nor forces the canonical accounts in.
    await createIn(LEDGER_ACCOUNTS_MODULE_ID, { code: '2000', name: 'Custom Payables', class: 'liability', currency: 'USD' });
    await seedControlAccountsIfEmpty(actionCtx);
    expect(accountCodes()).toEqual(['2000']); // nothing force-added
    const ap = registry.get(LEDGER_ACCOUNTS_MODULE_ID)!.store.list().filter((r) => r.status !== 'deleted' && String(r.fields.code) === '2000');
    expect(ap).toHaveLength(1); // no duplicate
    expect(String(ap[0].fields.name)).toBe('Custom Payables'); // identity preserved, not overwritten
  });
});

// ---------------------------------------------------------------------------
// Fresh-database production-like E2E — boot init, NO harness seeding
// ---------------------------------------------------------------------------

describe('Session 13 — fresh-database E2E (boot init only)', () => {
  it('BOOT → PO → receipt → partial+final bill → payment leaves GRNI 0 and AP 0', async () => {
    await ensureCanonicalChart(actionCtx); // the boot initializer — the only seeding
    await createIn('inventory-products', { sku: 'E2E', name: 'E2E', standardCost: 10 });
    const po = await createIn('procurement-orders', { poNumber: 'PO-E2E', supplier: 'Acme', product: 'E2E', warehouse: 'WH-1', quantity: 100, unitCost: 10, currency: 'USD' });
    const gr = await createIn('procurement-receipts', { grNumber: 'GR-E2E', purchaseOrder: po.record!.id, supplier: 'Acme', product: 'E2E', warehouse: 'WH-1', quantityOrdered: 40, quantityReceived: 40 });
    expect((await act('procurement-receipts', gr.record!.id, 'post')).ok).toBe(true);
    await flushUntil(() => bal(STOCK_ACCOUNTS.grni, 'credit') === 400);

    const b1 = await createIn('finance-vendor-bills', { billNumber: 'VB-E1', vendor: 'Acme', amount: 200, currency: 'USD', sourcePurchaseOrder: po.record!.id, lines: JSON.stringify([{ sku: 'E2E', quantity: 20, unitPrice: 10 }]) });
    expect((await act('finance-vendor-bills', b1.record!.id, 'approve')).ok).toBe(true);
    await flushUntil(() => bal(STOCK_ACCOUNTS.grni, 'debit') === 200);
    const b2 = await createIn('finance-vendor-bills', { billNumber: 'VB-E2', vendor: 'Acme', amount: 200, currency: 'USD', sourcePurchaseOrder: po.record!.id, lines: JSON.stringify([{ sku: 'E2E', quantity: 20, unitPrice: 10 }]) });
    expect((await act('finance-vendor-bills', b2.record!.id, 'approve')).ok).toBe(true);
    await flushUntil(() => bal(STOCK_ACCOUNTS.grni, 'debit') === 400);
    expect(bal(STOCK_ACCOUNTS.grni, 'credit') - bal(STOCK_ACCOUNTS.grni, 'debit')).toBe(0); // GRNI reconciled

    // Pay both bills → AP settles to 0, Cash (a CONTROL account) credited.
    const p1 = await createIn('finance-vendor-payments', { paymentNumber: 'VP-E1', billRef: 'VB-E1', vendor: 'Acme', amount: 200, currency: 'USD' });
    expect(p1.ok).toBe(true);
    const p2 = await createIn('finance-vendor-payments', { paymentNumber: 'VP-E2', billRef: 'VB-E2', vendor: 'Acme', amount: 200, currency: 'USD' });
    expect(p2.ok).toBe(true);
    await flushUntil(() => bal('2000', 'credit') - bal('2000', 'debit') === 0 && bal('1000', 'credit') === 400);
    expect(bal('2000', 'credit') - bal('2000', 'debit')).toBe(0); // AP reconciled
    expect(bal('1000', 'credit')).toBe(400); // cash out — control account resolved
  });
});

// ---------------------------------------------------------------------------
// Tenancy — initialization cannot cross tenant boundaries
// ---------------------------------------------------------------------------

describe('Session 13 — tenant isolation of control-account initialization', () => {
  it('each tenant gets its own chart; no tenant resolves another tenant’s accounts', async () => {
    await ensureCanonicalChart(actionCtx); // tenant-A
    const aCount = accountCodes().length;
    expect(aCount).toBeGreaterThan(0);

    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    expect(accountCodes()).toHaveLength(0); // B cannot see A's chart
    await ensureCanonicalChart(actionCtx); // seeds B's own chart
    expect(accountCodes().length).toBe(aCount);

    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    expect(accountCodes().length).toBe(aCount); // A unchanged by B's initialization
  });
});

// ---------------------------------------------------------------------------
// Single vendor-bill posting owner (dormant leg retired)
// ---------------------------------------------------------------------------

describe('Session 13 — single vendor-bill posting owner', () => {
  it('the finance-vendor-bills adapter spec carries NO posting leg (retired)', () => {
    const spec = DOCUMENT_SPECS.find((s) => s.moduleId === 'finance-vendor-bills');
    expect(spec).toBeDefined();
    expect(spec?.postOn).toBeUndefined(); // no dormant duplicate posting owner remains
    expect(spec?.approval).toBeDefined(); // approval gating is retained
  });
});
