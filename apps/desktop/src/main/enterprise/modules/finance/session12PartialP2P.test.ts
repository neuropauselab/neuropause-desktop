/**
 * ERP Session 12 — partial receipts + partial vendor billing.
 *
 * Extends Session 11's line-level three-way match to CUMULATIVE matching: a PO
 * may be received and billed in parts, each bill relieving GRNI for its own
 * received-and-not-yet-billed portion, cumulative billed never exceeding
 * cumulative received. Reuses the existing threeWayMatch engine (fed the
 * REMAINING receivable) — no second matcher, no new costing method (GRNI relief
 * allocates the already-accrued pool proportionally, = standard cost when
 * constant). Fail-closed and idempotency controls from Session 11 are preserved.
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
  GL_CONTROL_ACCOUNTS,
  GL_PAYABLE_CONTROL_ACCOUNTS,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, createLifecycleEmitter } from '../../framework/moduleRegistry';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { createProductModule } from '../inventory/productModule';
import { createStockMovementModule } from '../inventory/stockMovementModule';
import { createJournalEntryModule } from './journalEntryModule';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createPurchaseOrderModule } from '../procurement/purchaseOrderModule';
import { createGoodsReceiptModule } from '../procurement/goodsReceiptModule';
import { createVendorBillModule } from './vendorBillModule';
import { STOCK_ACCOUNTS } from '../../../erp/postingRules';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s12-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};

interface Rec { publish: PlatformEventInput[]; audit: { action: string }[]; broadcast: { channel: string }[]; authorized: EnterprisePermission[] }
let rec: Rec;
let scope: { tenantId: string; workspaceId: string } | null;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];
let bills: ReturnType<typeof createVendorBillModule>;

function spyCtx() {
  return {
    authorize: (p: EnterprisePermission) => rec.authorized.push(p),
    audit: (e: { action: string; target: string; summary: string }) => rec.audit.push(e),
    publish: (i: PlatformEventInput) => rec.publish.push(i),
    broadcast: (channel: string) => rec.broadcast.push({ channel }),
    notify: () => undefined,
    actor: () => 'operator@np.dev',
    now: () => '2026-09-01T12:00:00.000Z',
  };
}

beforeEach(async () => {
  rec = { publish: [], audit: [], broadcast: [], authorized: [] };
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(tmp('acct'));
  const pos = createPurchaseOrderModule(tmp('po'));
  bills = createVendorBillModule(tmp('bill'), pos.store);
  for (const m of [
    createProductModule(tmp('prod')),
    createStockMovementModule(tmp('mv')),
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    pos,
    createGoodsReceiptModule(tmp('gr')),
    bills,
  ]) registry.register(m);
  registry.bindScope(() => scope);
  handlers = buildModuleHandlers(registry, spyCtx());
  createLifecycleEmitter(registry, spyCtx());
  await seedControlChart();
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
  handler(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string; error?: string }>;

async function seedControlChart(): Promise<void> {
  for (const a of [...Object.values(GL_CONTROL_ACCOUNTS), ...Object.values(GL_PAYABLE_CONTROL_ACCOUNTS)]) {
    await createIn(LEDGER_ACCOUNTS_MODULE_ID, { code: a.code, name: a.name, class: a.accountClass, currency: 'USD' });
  }
}

function journalLines(): { account: string; debit: number; credit: number }[] {
  return registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store
    .list()
    .flatMap((e) => JSON.parse(String(e.fields.lines ?? '[]')) as { account: string; debit: number; credit: number }[]);
}
const bal = (account: string, side: 'debit' | 'credit'): number =>
  journalLines().filter((l) => l.account === account).reduce((n, l) => n + l[side], 0);
const net = (account: string): number => bal(account, 'credit') - bal(account, 'debit');
const jeCount = (prefix: string): number =>
  registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list().filter((e) => String(e.fields.entryNumber ?? e.title ?? '').startsWith(prefix)).length;
async function flushUntil(pred: () => boolean, ms = 800): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 5));
}
const settle = () => new Promise((r) => setTimeout(r, 60));

let poSeq = 0;
async function createPO(sku: string, qty: number, unitCost: number, supplier = 'Acme'): Promise<string> {
  const po = await createIn('procurement-orders', {
    poNumber: `PO-${sku}-${(poSeq += 1)}`, supplier, product: sku, warehouse: 'WH-1', quantity: qty, unitCost, currency: 'USD',
  });
  if (!po.ok || !po.record) throw new Error(`PO create failed: ${JSON.stringify(po.errors)}`);
  return po.record.id;
}
let grSeq = 0;
async function receive(poId: string, sku: string, qty: number, supplier = 'Acme'): Promise<void> {
  const gr = await createIn('procurement-receipts', {
    grNumber: `GR-${sku}-${(grSeq += 1)}`, purchaseOrder: poId, supplier, product: sku, warehouse: 'WH-1', quantityOrdered: qty, quantityReceived: qty,
  });
  if (!gr.ok || !gr.record) throw new Error(`GR create failed: ${JSON.stringify(gr.errors)}`);
  const posted = await act('procurement-receipts', gr.record.id, 'post');
  expect(posted.ok).toBe(true);
  await flushUntil(() => net(STOCK_ACCOUNTS.grni) !== 0 || bal(STOCK_ACCOUNTS.grni, 'credit') > 0);
}
async function makeBill(poId: string, billNumber: string, sku: string, qty: number, unitPrice: number): Promise<string> {
  const b = await createIn('finance-vendor-bills', {
    billNumber, vendor: 'Acme', amount: Math.round(qty * unitPrice * 100) / 100, currency: 'USD', sourcePurchaseOrder: poId,
    lines: JSON.stringify([{ sku, quantity: qty, unitPrice }]),
  });
  if (!b.ok || !b.record) throw new Error(`bill create failed: ${JSON.stringify(b.errors)}`);
  return b.record.id;
}

// ---------------------------------------------------------------------------
// The four reproduction cases (PO 100, receive 40)
// ---------------------------------------------------------------------------

describe('Session 12 — the four partial cases (PO 100, receive 40, std cost 10)', () => {
  it('A: bill 40 (== received) → MATCHED, posts, GRNI nets 0', async () => {
    await createIn('inventory-products', { sku: 'A', name: 'A', standardCost: 10 });
    const po = await createPO('A', 100, 10);
    await receive(po, 'A', 40);
    const bill = await makeBill(po, 'VB-A', 'A', 40, 10);
    expect((await act('finance-vendor-bills', bill, 'approve')).ok).toBe(true);
    await flushUntil(() => jeCount('JE-BILL-VB-A') > 0);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(0); // accrued 400 − relieved 400
    expect(bal(STOCK_ACCOUNTS.accountsPayable, 'credit')).toBe(400);
  });

  it('B: bill 20 (< received) → PARTIAL now POSTS its portion; GRNI 200 outstanding', async () => {
    await createIn('inventory-products', { sku: 'B', name: 'B', standardCost: 10 });
    const po = await createPO('B', 100, 10);
    await receive(po, 'B', 40); // accrued 400
    const bill = await makeBill(po, 'VB-B', 'B', 20, 10);
    expect((await act('finance-vendor-bills', bill, 'approve')).ok).toBe(true);
    await flushUntil(() => jeCount('JE-BILL-VB-B') > 0);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(200); // 400 accrued − 200 relieved
    expect(bal(STOCK_ACCOUNTS.accountsPayable, 'credit')).toBe(200);
  });

  it('C: bill 60 (> received 40) → MISMATCH, fail closed, no posting', async () => {
    await createIn('inventory-products', { sku: 'C', name: 'C', standardCost: 10 });
    const po = await createPO('C', 100, 10);
    await receive(po, 'C', 40);
    const bill = await makeBill(po, 'VB-C', 'C', 60, 10);
    expect((await act('finance-vendor-bills', bill, 'approve')).ok).toBe(false);
    await settle();
    expect(bal(STOCK_ACCOUNTS.grni, 'debit')).toBe(0);
    expect(bal(STOCK_ACCOUNTS.accountsPayable, 'credit')).toBe(0);
  });

  it('D: bill 100 (>> received 40) → MISMATCH, fail closed, no posting', async () => {
    await createIn('inventory-products', { sku: 'D', name: 'D', standardCost: 10 });
    const po = await createPO('D', 100, 10);
    await receive(po, 'D', 40);
    const bill = await makeBill(po, 'VB-D', 'D', 100, 10);
    expect((await act('finance-vendor-bills', bill, 'approve')).ok).toBe(false);
    await settle();
    expect(bal(STOCK_ACCOUNTS.accountsPayable, 'credit')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Cumulative billing + multiple receipts
// ---------------------------------------------------------------------------

describe('Session 12 — cumulative partial billing', () => {
  it('bill 20 then bill 20 (received 40) → both post, GRNI nets 0 cumulatively', async () => {
    await createIn('inventory-products', { sku: 'CUM', name: 'CUM', standardCost: 10 });
    const po = await createPO('CUM', 100, 10);
    await receive(po, 'CUM', 40); // accrued 400
    const b1 = await makeBill(po, 'VB-C1', 'CUM', 20, 10);
    expect((await act('finance-vendor-bills', b1, 'approve')).ok).toBe(true);
    await flushUntil(() => jeCount('JE-BILL-VB-C1') > 0);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(200);
    const b2 = await makeBill(po, 'VB-C2', 'CUM', 20, 10);
    expect((await act('finance-vendor-bills', b2, 'approve')).ok).toBe(true);
    await flushUntil(() => jeCount('JE-BILL-VB-C2') > 0);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(0); // fully billed
    expect(bal(STOCK_ACCOUNTS.accountsPayable, 'credit')).toBe(400);
  });

  it('cumulative over-billing fails closed (bill 30 then bill 20 on received 40)', async () => {
    await createIn('inventory-products', { sku: 'OVER', name: 'OVER', standardCost: 10 });
    const po = await createPO('OVER', 100, 10);
    await receive(po, 'OVER', 40);
    const b1 = await makeBill(po, 'VB-O1', 'OVER', 30, 10);
    expect((await act('finance-vendor-bills', b1, 'approve')).ok).toBe(true);
    await flushUntil(() => jeCount('JE-BILL-VB-O1') > 0);
    const b2 = await makeBill(po, 'VB-O2', 'OVER', 20, 10); // 30+20 = 50 > 40
    expect((await act('finance-vendor-bills', b2, 'approve')).ok).toBe(false); // fail closed
    await settle();
    expect(net(STOCK_ACCOUNTS.grni)).toBe(100); // only 30 relieved of 40 accrued
  });

  it('multiple receipts, cumulative bills → GRNI nets 0', async () => {
    await createIn('inventory-products', { sku: 'MR', name: 'MR', standardCost: 10 });
    const po = await createPO('MR', 100, 10);
    await receive(po, 'MR', 40); // accrued 400
    await receive(po, 'MR', 30); // accrued +300 = 700 total
    expect(net(STOCK_ACCOUNTS.grni)).toBe(700);
    const b1 = await makeBill(po, 'VB-M1', 'MR', 50, 10);
    expect((await act('finance-vendor-bills', b1, 'approve')).ok).toBe(true);
    await flushUntil(() => jeCount('JE-BILL-VB-M1') > 0);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(200); // 700 − 500
    const b2 = await makeBill(po, 'VB-M2', 'MR', 20, 10);
    expect((await act('finance-vendor-bills', b2, 'approve')).ok).toBe(true);
    await flushUntil(() => jeCount('JE-BILL-VB-M2') > 0);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(0); // fully billed (70)
  });

  it('partial bill with within-tolerance overprice books PPV on the billed portion', async () => {
    await createIn('inventory-products', { sku: 'PPV', name: 'PPV', standardCost: 10 });
    const po = await createPO('PPV', 100, 10);
    await receive(po, 'PPV', 40); // accrued 400
    const bill = await makeBill(po, 'VB-PPV', 'PPV', 20, 10.05); // subtotal 201
    expect((await act('finance-vendor-bills', bill, 'approve')).ok).toBe(true);
    await flushUntil(() => jeCount('JE-BILL-VB-PPV') > 0);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(200); // relieved 20 × 10 (standard) = 200
    expect(bal(STOCK_ACCOUNTS.purchasePriceVariance, 'debit')).toBe(1); // 201 − 200
    expect(bal(STOCK_ACCOUNTS.accountsPayable, 'credit')).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Idempotency, reversal, tenancy
// ---------------------------------------------------------------------------

describe('Session 12 — idempotency, reversal, tenancy', () => {
  it('repeated approval of a partial bill posts once', async () => {
    await createIn('inventory-products', { sku: 'ID', name: 'ID', standardCost: 10 });
    const po = await createPO('ID', 100, 10);
    await receive(po, 'ID', 40);
    const bill = await makeBill(po, 'VB-ID', 'ID', 20, 10);
    expect((await act('finance-vendor-bills', bill, 'approve')).ok).toBe(true);
    await flushUntil(() => jeCount('JE-BILL-VB-ID') > 0);
    expect((await act('finance-vendor-bills', bill, 'approve')).ok).toBe(false); // not draft
    await settle();
    expect(jeCount('JE-BILL-VB-ID')).toBe(1);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(200);
  });

  it('cancelling a partial bill restores its GRNI and frees the quantity to re-bill', async () => {
    await createIn('inventory-products', { sku: 'REV', name: 'REV', standardCost: 10 });
    const po = await createPO('REV', 100, 10);
    await receive(po, 'REV', 40); // accrued 400
    const b1 = await makeBill(po, 'VB-R1', 'REV', 20, 10);
    expect((await act('finance-vendor-bills', b1, 'approve')).ok).toBe(true);
    await flushUntil(() => net(STOCK_ACCOUNTS.grni) === 200);
    expect((await act('finance-vendor-bills', b1, 'cancel')).ok).toBe(true);
    await flushUntil(() => net(STOCK_ACCOUNTS.grni) === 400); // relief reversed
    // The 20 units are billable again: a fresh bill for the full 40 now matches.
    const b2 = await makeBill(po, 'VB-R2', 'REV', 40, 10);
    expect((await act('finance-vendor-bills', b2, 'approve')).ok).toBe(true);
    await flushUntil(() => jeCount('JE-BILL-VB-R2') > 0);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(0);
  });

  it('cross-tenant: a partial goods bill cannot reference another tenant’s PO', async () => {
    await createIn('inventory-products', { sku: 'XT', name: 'XT', standardCost: 10 });
    const po = await createPO('XT', 100, 10);
    await receive(po, 'XT', 40);
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    const b = await createIn('finance-vendor-bills', {
      billNumber: 'VB-XT', vendor: 'Acme', amount: 200, currency: 'USD', sourcePurchaseOrder: po,
      lines: JSON.stringify([{ sku: 'XT', quantity: 20, unitPrice: 10 }]),
    });
    expect(b.ok).toBe(false);
    expect(JSON.stringify(b.errors ?? {})).toContain('purchase order');
  });
});
