/**
 * ERP Session 16 — multi-SKU procurement foundation: PO lines → multi-line goods
 * receipt → per-line inventory/GRNI → three-way match → GRNI reconciliation.
 *
 * The single-product limitation (reproduced below): a Purchase Order carried ONE
 * `product`/`quantity`, so the three-way match had one order line and a
 * multi-SKU bill could never fully match. Session 16 adds additive `lines` to the
 * PO and the goods receipt (the vendor-bill lines convention), posts one valued
 * movement per receipt line through the shared Session-7 seam, and reads the
 * order side of the match from the PO lines. No parallel PO model; no frozen
 * surface; standard cost + canonical accounts unchanged.
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
  STOCK_MOVEMENTS_MODULE_ID,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, createLifecycleEmitter } from '../../framework/moduleRegistry';
import type { EnterpriseModuleActionContext } from '../../framework';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { createProductModule } from '../inventory/productModule';
import { createStockMovementModule } from '../inventory/stockMovementModule';
import { createJournalEntryModule } from '../finance/journalEntryModule';
import { createLedgerAccountModule } from '../finance/ledgerAccountModule';
import { createPurchaseOrderModule } from './purchaseOrderModule';
import { createGoodsReceiptModule } from './goodsReceiptModule';
import { createVendorBillModule } from '../finance/vendorBillModule';
import { createVendorPaymentModule } from '../finance/vendorPaymentModule';
import { voidPostedMovement } from '../inventory/multiLineMovements';
import { STOCK_ACCOUNTS } from '../../../erp/postingRules';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s16-${tag}-${randomUUID()}.json`);
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
});
afterEach(async () => {
  vi.restoreAllMocks();
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

const movements = (): EnterpriseEntity[] =>
  registry.get(STOCK_MOVEMENTS_MODULE_ID)!.store.list().filter((m) => m.status !== 'deleted');
function journalLines(): { account: string; debit: number; credit: number }[] {
  return registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store
    .list()
    .flatMap((e) => JSON.parse(String(e.fields.lines ?? '[]')) as { account: string; debit: number; credit: number }[]);
}
const bal = (account: string, side: 'debit' | 'credit'): number =>
  journalLines().filter((l) => l.account === account).reduce((n, l) => n + l[side], 0);
const net = (account: string): number => bal(account, 'credit') - bal(account, 'debit');
const sumAll = (side: 'debit' | 'credit'): number => journalLines().reduce((n, l) => n + l[side], 0);
async function flushUntil(pred: () => boolean, ms = 1200): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 5));
}

// Products A=$5, B=$3, C=$8 (standard cost). A multi-line PO A=10/B=20/C=5.
async function seedProducts(): Promise<void> {
  await createIn('inventory-products', { sku: 'SKU-A', name: 'A', standardCost: 5 });
  await createIn('inventory-products', { sku: 'SKU-B', name: 'B', standardCost: 3 });
  await createIn('inventory-products', { sku: 'SKU-C', name: 'C', standardCost: 8 });
}
async function multiLinePO(poNumber = 'PO-16'): Promise<EnterpriseEntity> {
  const po = await createIn('procurement-orders', {
    poNumber, supplier: 'Acme', warehouse: 'WH-1', currency: 'USD',
    lines: JSON.stringify([
      { sku: 'SKU-A', quantity: 10, unitPrice: 5 },
      { sku: 'SKU-B', quantity: 20, unitPrice: 3 },
      { sku: 'SKU-C', quantity: 5, unitPrice: 8 },
    ]),
  });
  expect(po.ok).toBe(true);
  await act('procurement-orders', po.record!.id, 'approve');
  return po.record!;
}
const receiptLines = (ls: { sku: string; quantity: number; poLine?: number }[]) => JSON.stringify(ls);
async function receive(poId: string, grNumber: string, lines: { sku: string; quantity: number; poLine?: number }[]) {
  const total = lines.reduce((n, l) => n + l.quantity, 0);
  const gr = await createIn('procurement-receipts', {
    grNumber, purchaseOrder: poId, supplier: 'Acme', warehouse: 'WH-1', product: 'MULTI', quantityReceived: total,
    lines: receiptLines(lines),
  });
  return gr;
}

// ---------------------------------------------------------------------------
// REPRODUCTION — the single-product limitation
// ---------------------------------------------------------------------------

describe('S16 · reproduction — single-product PO cannot serve a multi-SKU bill', () => {
  it('a legacy single-product PO gives the match ONE order line, so a 3-SKU bill mismatches', async () => {
    await seedProducts();
    const po = await createIn('procurement-orders', { poNumber: 'PO-OLD', supplier: 'Acme', warehouse: 'WH-1', product: 'SKU-A', quantity: 10, unitCost: 5, currency: 'USD' });
    const gr = await createIn('procurement-receipts', { grNumber: 'GR-OLD', purchaseOrder: po.record!.id, supplier: 'Acme', product: 'SKU-A', warehouse: 'WH-1', quantityOrdered: 10, quantityReceived: 6 });
    expect((await act('procurement-receipts', gr.record!.id, 'post')).ok).toBe(true);
    await flushUntil(() => bal(STOCK_ACCOUNTS.grni, 'credit') > 0);
    const bill = await createIn('finance-vendor-bills', {
      billNumber: 'VB-OLD', vendor: 'Acme', amount: 88, currency: 'USD', sourcePurchaseOrder: po.record!.id,
      lines: JSON.stringify([{ sku: 'SKU-A', quantity: 6, unitPrice: 5 }, { sku: 'SKU-B', quantity: 10, unitPrice: 3 }, { sku: 'SKU-C', quantity: 5, unitPrice: 8 }]),
    });
    // B and C have no order line and no receipt → the bill cannot post (held).
    expect((await act('finance-vendor-bills', bill.record!.id, 'approve')).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A/B — multi-line PO + per-line inventory/GRNI
// ---------------------------------------------------------------------------

describe('S16 · multi-line PO + per-line inventory/GRNI', () => {
  it('a PO carries 3 independent lines; subtotal is derived from them', async () => {
    await seedProducts();
    const po = await multiLinePO();
    const rec2 = registry.get('procurement-orders')!.store.get(po.id)!;
    expect(Number(rec2.fields.subtotal)).toBe(10 * 5 + 20 * 3 + 5 * 8); // 150
    expect(Number(rec2.fields.total)).toBe(150);
  });

  it('a multi-line receipt posts one valued movement per line; Σ Inventory debits = Σ GRNI credits', async () => {
    await seedProducts();
    const po = await multiLinePO();
    const gr = await receive(po.id, 'GR-1', [
      { sku: 'SKU-A', quantity: 6, poLine: 1 },
      { sku: 'SKU-B', quantity: 10, poLine: 2 },
      { sku: 'SKU-C', quantity: 5, poLine: 3 },
    ]);
    expect((await act('procurement-receipts', gr.record!.id, 'post')).ok).toBe(true);
    await flushUntil(() => bal(STOCK_ACCOUNTS.grni, 'credit') === 100);
    // one receive movement per line, each SKU-specific
    const recv = movements().filter((m) => String(m.fields.type) === 'receive');
    expect(recv).toHaveLength(3);
    expect(new Set(recv.map((m) => String(m.fields.product)))).toEqual(new Set(['SKU-A', 'SKU-B', 'SKU-C']));
    // A 6×5=30, B 10×3=30, C 5×8=40 → 100
    expect(bal(STOCK_ACCOUNTS.inventory, 'debit')).toBe(100);
    expect(bal(STOCK_ACCOUNTS.grni, 'credit')).toBe(100);
    expect(sumAll('debit')).toBe(sumAll('credit')); // Σ Debits = Σ Credits
  });

  it('receipt lines carry PO-line identity — a SKU not on the PO is refused', async () => {
    await seedProducts();
    const po = await multiLinePO();
    const gr = await receive(po.id, 'GR-BAD', [{ sku: 'SKU-Z', quantity: 1 }]);
    const r = await act('procurement-receipts', gr.record!.id, 'post');
    expect(r.ok).toBe(false);
    expect(String(r.message)).toContain('does not match');
  });

  it('over-receipt is refused: received > ordered per line', async () => {
    await seedProducts();
    const po = await multiLinePO();
    const gr = await receive(po.id, 'GR-OVER', [{ sku: 'SKU-A', quantity: 11, poLine: 1 }]);
    const r = await act('procurement-receipts', gr.record!.id, 'post');
    expect(r.ok).toBe(false);
    expect(String(r.message)).toContain('Over-receipt');
  });

  it('a receipt line whose SKU disagrees with its referenced PO line is refused (no cross-SKU satisfaction)', async () => {
    await seedProducts();
    const po = await multiLinePO(); // line 1 = A, line 2 = B, line 3 = C
    const gr = await receive(po.id, 'GR-XLINE', [{ sku: 'SKU-A', quantity: 6, poLine: 2 }]); // A claiming B's line
    const r = await act('procurement-receipts', gr.record!.id, 'post');
    expect(r.ok).toBe(false);
    expect(String(r.message)).toContain('does not match');
  });
});

// ---------------------------------------------------------------------------
// D — partial receipts per SKU
// ---------------------------------------------------------------------------

describe('S16 · partial receipts reconcile per SKU', () => {
  it('two receipts fill the PO; cumulative received ≤ ordered; no line received twice', async () => {
    await seedProducts();
    const po = await multiLinePO();
    // Receipt 1: A=6, B=10, C=5
    const g1 = await receive(po.id, 'GR-P1', [{ sku: 'SKU-A', quantity: 6 }, { sku: 'SKU-B', quantity: 10 }, { sku: 'SKU-C', quantity: 5 }]);
    expect((await act('procurement-receipts', g1.record!.id, 'post')).ok).toBe(true);
    await flushUntil(() => movements().filter((m) => String(m.fields.type) === 'receive').length === 3);
    // Receipt 2: A=4, B=10 (C already complete)
    const g2 = await receive(po.id, 'GR-P2', [{ sku: 'SKU-A', quantity: 4 }, { sku: 'SKU-B', quantity: 10 }]);
    expect((await act('procurement-receipts', g2.record!.id, 'post')).ok).toBe(true);
    await flushUntil(() => movements().filter((m) => String(m.fields.type) === 'receive').length === 5);
    // Over-receipt on a 3rd (A already 10) is refused.
    const g3 = await receive(po.id, 'GR-P3', [{ sku: 'SKU-A', quantity: 1 }]);
    expect((await act('procurement-receipts', g3.record!.id, 'post')).ok).toBe(false);
    // Final received: A=10, B=20, C=5 (Σ value 10×5+20×3+5×8 = 150)
    await flushUntil(() => bal(STOCK_ACCOUNTS.grni, 'credit') === 150);
    expect(bal(STOCK_ACCOUNTS.grni, 'credit')).toBe(150);
    expect(bal(STOCK_ACCOUNTS.inventory, 'debit')).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// E — three-way match + GRNI reconciliation E2E
// ---------------------------------------------------------------------------

describe('S16 · three-way match + GRNI reconciliation', () => {
  it('multi-line PO → receipt → multi-line bill → payment → GRNI=0, AP=0', async () => {
    await seedProducts();
    const po = await multiLinePO();
    const gr = await receive(po.id, 'GR-E2E', [{ sku: 'SKU-A', quantity: 6 }, { sku: 'SKU-B', quantity: 10 }, { sku: 'SKU-C', quantity: 5 }]);
    expect((await act('procurement-receipts', gr.record!.id, 'post')).ok).toBe(true);
    await flushUntil(() => bal(STOCK_ACCOUNTS.grni, 'credit') === 100);
    const bill = await createIn('finance-vendor-bills', {
      billNumber: 'VB-E2E', vendor: 'Acme', amount: 100, currency: 'USD', sourcePurchaseOrder: po.id,
      lines: JSON.stringify([{ sku: 'SKU-A', quantity: 6, unitPrice: 5 }, { sku: 'SKU-B', quantity: 10, unitPrice: 3 }, { sku: 'SKU-C', quantity: 5, unitPrice: 8 }]),
    });
    expect((await act('finance-vendor-bills', bill.record!.id, 'approve')).ok).toBe(true);
    await flushUntil(() => net(STOCK_ACCOUNTS.grni) === 0);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(0); // fully relieved
    expect(net(STOCK_ACCOUNTS.accountsPayable)).toBe(100); // AP owed
    const pay = await createIn('finance-vendor-payments', { paymentNumber: 'VP-E2E', billRef: 'VB-E2E', vendor: 'Acme', amount: 100, currency: 'USD' });
    expect(pay.ok).toBe(true);
    await flushUntil(() => net(STOCK_ACCOUNTS.accountsPayable) === 0);
    expect(net(STOCK_ACCOUNTS.accountsPayable)).toBe(0);
    expect(bal('1000', 'credit')).toBe(100); // cash paid
  });

  it('billed > received per SKU is refused (cumulative)', async () => {
    await seedProducts();
    const po = await multiLinePO();
    const gr = await receive(po.id, 'GR-BILL', [{ sku: 'SKU-A', quantity: 6 }]);
    expect((await act('procurement-receipts', gr.record!.id, 'post')).ok).toBe(true);
    await flushUntil(() => bal(STOCK_ACCOUNTS.grni, 'credit') > 0);
    const bill = await createIn('finance-vendor-bills', {
      billNumber: 'VB-OVER', vendor: 'Acme', amount: 40, currency: 'USD', sourcePurchaseOrder: po.id,
      lines: JSON.stringify([{ sku: 'SKU-A', quantity: 8, unitPrice: 5 }]), // billing 8 but only 6 received
    });
    expect((await act('finance-vendor-bills', bill.record!.id, 'approve')).ok).toBe(false);
  });

  it("one SKU's receipt cannot satisfy another SKU's bill", async () => {
    await seedProducts();
    const po = await multiLinePO();
    const gr = await receive(po.id, 'GR-XSKU', [{ sku: 'SKU-A', quantity: 6 }]); // only A received
    expect((await act('procurement-receipts', gr.record!.id, 'post')).ok).toBe(true);
    await flushUntil(() => bal(STOCK_ACCOUNTS.grni, 'credit') > 0);
    const bill = await createIn('finance-vendor-bills', {
      billNumber: 'VB-B', vendor: 'Acme', amount: 30, currency: 'USD', sourcePurchaseOrder: po.id,
      lines: JSON.stringify([{ sku: 'SKU-B', quantity: 10, unitPrice: 3 }]), // billing B, none received
    });
    expect((await act('finance-vendor-bills', bill.record!.id, 'approve')).ok).toBe(false);
  });

  it('a partial bill leaves remaining GRNI = the unbilled received value', async () => {
    await seedProducts();
    const po = await multiLinePO();
    const gr = await receive(po.id, 'GR-PB', [{ sku: 'SKU-A', quantity: 6 }, { sku: 'SKU-B', quantity: 10 }, { sku: 'SKU-C', quantity: 5 }]);
    expect((await act('procurement-receipts', gr.record!.id, 'post')).ok).toBe(true);
    await flushUntil(() => bal(STOCK_ACCOUNTS.grni, 'credit') === 100);
    // Bill only SKU-A (6×5=30). Remaining GRNI = 100 − 30 = 70 (B 30 + C 40).
    const bill = await createIn('finance-vendor-bills', {
      billNumber: 'VB-PB', vendor: 'Acme', amount: 30, currency: 'USD', sourcePurchaseOrder: po.id,
      lines: JSON.stringify([{ sku: 'SKU-A', quantity: 6, unitPrice: 5 }]),
    });
    expect((await act('finance-vendor-bills', bill.record!.id, 'approve')).ok).toBe(true);
    await flushUntil(() => net(STOCK_ACCOUNTS.grni) === 70);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(70);
  });
});

// ---------------------------------------------------------------------------
// F/G — idempotency + reversal
// ---------------------------------------------------------------------------

describe('S16 · idempotency + reversal', () => {
  it('re-posting a received multi-line receipt does not double-post', async () => {
    await seedProducts();
    const po = await multiLinePO();
    const gr = await receive(po.id, 'GR-IDEM', [{ sku: 'SKU-A', quantity: 6 }, { sku: 'SKU-B', quantity: 10 }]);
    expect((await act('procurement-receipts', gr.record!.id, 'post')).ok).toBe(true);
    await flushUntil(() => movements().filter((m) => String(m.fields.type) === 'receive').length === 2);
    expect((await act('procurement-receipts', gr.record!.id, 'post')).ok).toBe(false); // already received
    expect(movements().filter((m) => String(m.fields.type) === 'receive')).toHaveLength(2);
  });

  it('reversal voids the correct individual lines (full and partial)', async () => {
    await seedProducts();
    const po = await multiLinePO();
    const gr = await receive(po.id, 'GR-REV', [{ sku: 'SKU-A', quantity: 6 }, { sku: 'SKU-B', quantity: 10 }, { sku: 'SKU-C', quantity: 5 }]);
    expect((await act('procurement-receipts', gr.record!.id, 'post')).ok).toBe(true);
    await flushUntil(() => bal(STOCK_ACCOUNTS.grni, 'credit') === 100);
    const ids = String(registry.get('procurement-receipts')!.store.get(gr.record!.id)!.fields.receiptMovements).split(',');
    expect(ids).toHaveLength(3);
    // Partial reversal: void the SKU-C line only (5×8=40) → GRNI 100 − 40 = 60 remaining.
    const cMovement = movements().find((m) => String(m.fields.product) === 'SKU-C')!;
    expect(await voidPostedMovement(actionCtx, cMovement.id)).toBe(true);
    await flushUntil(() => net(STOCK_ACCOUNTS.grni) === 60);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(60);
    // Full reversal: void the remaining two → GRNI 0.
    for (const id of ids) await voidPostedMovement(actionCtx, id);
    await flushUntil(() => net(STOCK_ACCOUNTS.grni) === 0);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// H — tenant isolation
// ---------------------------------------------------------------------------

describe('S16 · tenant isolation', () => {
  it('a receipt in tenant B cannot receive against tenant A’s purchase order', async () => {
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    await seedProducts();
    const po = await multiLinePO('PO-XT');
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    const gr = await receive(po.id, 'GR-XT', [{ sku: 'SKU-A', quantity: 6 }]);
    const r = await act('procurement-receipts', gr.record!.id, 'post');
    expect(r.ok).toBe(false); // A's PO is invisible in B
    expect(String(r.message)).toContain('was not found');
  });
});
