/**
 * ERP Session 14 — dynamic-tenant chart initialization + multi-tenant integrity.
 *
 * Closes the Session 13 residual: a tenant NOT covered by the boot seed (created
 * or activated after boot) whose first activity is stock used to hit the
 * empty-only control-account pause (stock seeding made the chart non-empty before
 * control was seeded). The deterministic fix seeds the canonical chart
 * CONTROL-FIRST at the stock-posting seam, in the acting tenant's own scope — so
 * any tenant self-heals on first use, without a race and without changing the
 * customized-chart empty-only policy. No test-harness chart seeding is used.
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
import { ensureCanonicalChart } from './controlChart';
import { seedControlAccountsIfEmpty } from './glPosting';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s14-${tag}-${randomUUID()}.json`);
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
  // NOTE: deliberately NO chart seeding here — a fresh/dynamic tenant is exactly
  // one with no prior initialization.
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
const net = (account: string): number => bal(account, 'credit') - bal(account, 'debit');
async function flushUntil(pred: () => boolean, ms = 800): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 5));
}

async function receive(sku: string, qty: number, cost: number, poNum: string, grNum: string): Promise<string> {
  await createIn('inventory-products', { sku, name: sku, standardCost: cost });
  const po = await createIn('procurement-orders', { poNumber: poNum, supplier: 'Acme', product: sku, warehouse: 'WH-1', quantity: qty, unitCost: cost, currency: 'USD' });
  const gr = await createIn('procurement-receipts', { grNumber: grNum, purchaseOrder: po.record!.id, supplier: 'Acme', product: sku, warehouse: 'WH-1', quantityOrdered: qty, quantityReceived: qty });
  expect((await act('procurement-receipts', gr.record!.id, 'post')).ok).toBe(true);
  return po.record!.id;
}

// ---------------------------------------------------------------------------
// REPRODUCTION: a dynamic tenant's first activity is stock
// ---------------------------------------------------------------------------

describe('Session 14 — a dynamic tenant whose first activity is stock still gets control accounts', () => {
  it('stock-first (no prior init) → the stock-posting seam seeds control first → a service bill posts OpEx 5000', async () => {
    scope = { tenantId: 'tenant-DYNAMIC', workspaceId: 'ws-DYNAMIC' }; // activated after boot, never seeded
    await receive('DYN', 40, 10, 'PO-DYN', 'GR-DYN'); // first activity is stock
    await flushUntil(() => bal(STOCK_ACCOUNTS.grni, 'credit') > 0);
    // Control accounts must have been seeded control-FIRST by the posting seam.
    expect(accountCodes()).toContain('5000'); // Operating Expenses (a control account)
    expect(accountCodes()).toContain('1000'); // Cash (a control account)
    const bill = await createIn('finance-vendor-bills', { billNumber: 'VB-DYN', vendor: 'Cloud Co', amount: 500, currency: 'USD' });
    expect((await act('finance-vendor-bills', bill.record!.id, 'approve')).ok).toBe(true);
    await flushUntil(() => bal('5000', 'debit') === 500);
    expect(bal('5000', 'debit')).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Idempotency + concurrency
// ---------------------------------------------------------------------------

describe('Session 14 — idempotent + concurrency-safe initialization', () => {
  it('ensureCanonicalChart is idempotent (3× sequential → one canonical set)', async () => {
    await ensureCanonicalChart(actionCtx);
    const n = accountCodes().length;
    await ensureCanonicalChart(actionCtx);
    await ensureCanonicalChart(actionCtx);
    expect(accountCodes().length).toBe(n);
    expect(new Set(accountCodes()).size).toBe(accountCodes().length);
  });

  it('concurrent initialization cannot duplicate accounts (3 simultaneous calls → one set)', async () => {
    await Promise.all([ensureCanonicalChart(actionCtx), ensureCanonicalChart(actionCtx), ensureCanonicalChart(actionCtx)]);
    const codes = accountCodes();
    expect(new Set(codes).size).toBe(codes.length); // no duplicates
    for (const c of ['1000', '2000', '5000', '2150', '1300', '5050']) {
      expect(codes.filter((x) => x === c)).toHaveLength(1); // exactly one of each canonical code
    }
  });

  it('activation-while-first-transaction-starts cannot duplicate (init races a stock posting)', async () => {
    scope = { tenantId: 'tenant-RACE', workspaceId: 'ws-RACE' };
    await createIn('inventory-products', { sku: 'RC', name: 'RC', standardCost: 10 });
    const po = await createIn('procurement-orders', { poNumber: 'PO-RC', supplier: 'Acme', product: 'RC', warehouse: 'WH-1', quantity: 10, unitCost: 10, currency: 'USD' });
    const gr = await createIn('procurement-receipts', { grNumber: 'GR-RC', purchaseOrder: po.record!.id, supplier: 'Acme', product: 'RC', warehouse: 'WH-1', quantityOrdered: 10, quantityReceived: 10 });
    // Fire an activation init and the first stock posting concurrently.
    await Promise.all([ensureCanonicalChart(actionCtx), act('procurement-receipts', gr.record!.id, 'post')]);
    await flushUntil(() => bal(STOCK_ACCOUNTS.grni, 'credit') > 0);
    const codes = accountCodes();
    expect(new Set(codes).size).toBe(codes.length); // no duplicate control/stock accounts
    for (const c of ['1000', '2000', '5000', '2150', '1300']) expect(codes.filter((x) => x === c)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Multi-tenant isolation
// ---------------------------------------------------------------------------

describe('Session 14 — multi-tenant chart isolation', () => {
  it('Tenant A and Tenant B get independent charts; neither sees the other’s', async () => {
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    await ensureCanonicalChart(actionCtx);
    const aCount = accountCodes().length;
    expect(aCount).toBeGreaterThan(0);

    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    expect(accountCodes()).toHaveLength(0); // B cannot see A's accounts
    await ensureCanonicalChart(actionCtx);
    expect(accountCodes().length).toBe(aCount); // B has its own equivalent set

    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    expect(accountCodes().length).toBe(aCount); // A unchanged by B's init
  });

  it('a bill in tenant B cannot reference tenant A’s purchase order (cross-tenant)', async () => {
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    const poA = await receive('XT', 40, 10, 'PO-XT', 'GR-XT');
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    const bill = await createIn('finance-vendor-bills', {
      billNumber: 'VB-XT', vendor: 'Acme', amount: 200, currency: 'USD', sourcePurchaseOrder: poA,
      lines: JSON.stringify([{ sku: 'XT', quantity: 20, unitPrice: 10 }]),
    });
    expect(bill.ok).toBe(false); // A's PO is invisible in B
    expect(JSON.stringify(bill.errors ?? {})).toContain('purchase order');
  });
});

// ---------------------------------------------------------------------------
// Fresh-tenant E2E (no harness seeding) + customized-chart preservation
// ---------------------------------------------------------------------------

describe('Session 14 — fresh-tenant E2E and customized-chart preservation', () => {
  it('a newly activated tenant completes PO → receipt → partial bill → payment with GRNI=0 and AP=0', async () => {
    scope = { tenantId: 'tenant-FRESH', workspaceId: 'ws-FRESH' }; // never seeded
    const po = await receive('FR', 40, 10, 'PO-FR', 'GR-FR'); // stock-first self-heals the chart (control-first)
    await flushUntil(() => bal(STOCK_ACCOUNTS.grni, 'credit') === 400);
    const b1 = await createIn('finance-vendor-bills', { billNumber: 'VB-FR1', vendor: 'Acme', amount: 200, currency: 'USD', sourcePurchaseOrder: po, lines: JSON.stringify([{ sku: 'FR', quantity: 20, unitPrice: 10 }]) });
    expect((await act('finance-vendor-bills', b1.record!.id, 'approve')).ok).toBe(true);
    await flushUntil(() => bal(STOCK_ACCOUNTS.grni, 'debit') === 200);
    const b2 = await createIn('finance-vendor-bills', { billNumber: 'VB-FR2', vendor: 'Acme', amount: 200, currency: 'USD', sourcePurchaseOrder: po, lines: JSON.stringify([{ sku: 'FR', quantity: 20, unitPrice: 10 }]) });
    expect((await act('finance-vendor-bills', b2.record!.id, 'approve')).ok).toBe(true);
    await flushUntil(() => net(STOCK_ACCOUNTS.grni) === 0);
    const p1 = await createIn('finance-vendor-payments', { paymentNumber: 'VP-FR1', billRef: 'VB-FR1', vendor: 'Acme', amount: 200, currency: 'USD' });
    const p2 = await createIn('finance-vendor-payments', { paymentNumber: 'VP-FR2', billRef: 'VB-FR2', vendor: 'Acme', amount: 200, currency: 'USD' });
    expect(p1.ok && p2.ok).toBe(true);
    await flushUntil(() => net(STOCK_ACCOUNTS.accountsPayable) === 0 && bal('1000', 'credit') === 400);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(0);
    expect(net(STOCK_ACCOUNTS.accountsPayable)).toBe(0);
    expect(bal('1000', 'credit')).toBe(400); // cash — a control account — resolved
  });

  it('a customized non-empty chart is preserved — the empty-only control seed still pauses', async () => {
    scope = { tenantId: 'tenant-CUSTOM', workspaceId: 'ws-CUSTOM' };
    await createIn(LEDGER_ACCOUNTS_MODULE_ID, { code: '2000', name: 'Custom Payables', class: 'liability', currency: 'USD' });
    await seedControlAccountsIfEmpty(actionCtx);
    expect(accountCodes()).toEqual(['2000']); // never force-added onto a customized chart
    const ap = registry.get(LEDGER_ACCOUNTS_MODULE_ID)!.store.list().filter((r) => r.status !== 'deleted' && String(r.fields.code) === '2000');
    expect(String(ap[0].fields.name)).toBe('Custom Payables'); // identity preserved
  });
});
