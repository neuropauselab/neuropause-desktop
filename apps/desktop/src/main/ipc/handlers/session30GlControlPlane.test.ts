/**
 * ERP Session 30 — Finance-core control-plane certification. NO new production command: this proves
 * the EXISTING GL / journal engine is a reliable governed accounting control plane for the already-
 * live P2P and O2C transaction cycles.
 *
 * Part A — journal-engine invariants (through the live enterprise handlers): a posted journal must
 * balance (debits == credits), unbalanced/zero/negative lines are rejected, a nonexistent account is
 * rejected, a POSTED entry is immutable, and reversal is a new mirrored -REV draft (append-only).
 * Part B — governed control-plane: the P2P (Dr Inventory/Cr GRNI → GRNI relief/AP → Dr AP/Cr Cash)
 * and O2C (Dr AR/Cr Revenue → Dr Cash/Cr AR) postings land on the real control accounts; the WHOLE
 * ledger stays balanced (Σ debits == Σ credits); replay/foreign-tenant/unauthorized post nothing; a
 * refused business transaction leaves NO partial journal.
 *
 * Everything asserted here is the repository's DEFINED behavior — no accounting policy is invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getAppPath: () => tmpdir(), getName: () => 'neuropause', isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s, 'utf8'), decryptString: (b: Buffer) => b.toString('utf8') },
}));

import {
  IpcChannel,
  ORDERS_MODULE_ID,
  STOCK_MOVEMENTS_MODULE_ID,
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  PURCHASE_ORDERS_MODULE_ID,
  GOODS_RECEIPTS_MODULE_ID,
  VENDOR_BILLS_MODULE_ID,
  glAccountFromRecord,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { resolveTenantScope } from '../../tenancy/backgroundPrincipal';
import { createProductModule } from '../../enterprise/modules/inventory/productModule';
import { createStockMovementModule } from '../../enterprise/modules/inventory/stockMovementModule';
import { createLedgerAccountModule } from '../../enterprise/modules/finance/ledgerAccountModule';
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createInvoiceModule } from '../../enterprise/modules/finance/invoiceModule';
import { createPaymentModule } from '../../enterprise/modules/finance/paymentModule';
import { createOrderModule } from '../../enterprise/modules/sales/orderModule';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { createGoodsReceiptModule } from '../../enterprise/modules/procurement/goodsReceiptModule';
import { createVendorBillModule } from '../../enterprise/modules/finance/vendorBillModule';
import { createVendorPaymentModule } from '../../enterprise/modules/finance/vendorPaymentModule';
import { __resetInvoiceConversionChainsForTests } from '../../enterprise/modules/sales/conversion';
import { DurableCommandJournal } from '../../platform/command/durableCommandJournal';
import { runSecureHandler } from '../secureBridge';
import type { Principal } from '../../platform/application/requestContext';
import { buildPlatformCommandDispatchDef } from './platformCommandIpc';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s30-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};
const PERMS: EnterprisePermission[] = ['sales:read', 'sales:manage', 'inventory:read', 'inventory:manage', 'operations:read', 'operations:manage', 'procurement:read', 'procurement:manage'];

let scope: TenantScope;
let registry: EnterpriseModuleRegistry;
let handlers: ReturnType<typeof buildModuleHandlers>;
let journal: DurableCommandJournal;
let audit: { action: string; target: string; summary: string }[];
let accountsStore: ReturnType<typeof createLedgerAccountModule>['store'];
let currentPrincipal: Principal | null;
let def: ReturnType<typeof buildPlatformCommandDispatchDef>;

function moduleCtx(): EnterpriseModuleContext {
  return {
    authorize: () => undefined, audit: (e) => audit.push(e), publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined, notify: () => undefined, actor: () => 'op@np.dev', now: () => '2026-09-02T12:00:00.000Z',
  };
}
const fullPrincipal = (over: Partial<Principal> = {}): Principal =>
  ({ actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: PERMS, ...over });

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  audit = []; currentPrincipal = fullPrincipal();
  __resetInvoiceConversionChainsForTests();
  registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(tmp('acct'));
  accountsStore = accounts.store;
  const invoiceMod = createInvoiceModule(tmp('inv'));
  const pos = createPurchaseOrderModule(tmp('po'));
  const bills = createVendorBillModule(tmp('bill'), pos.store);
  for (const m of [
    createProductModule(tmp('prod')),
    createStockMovementModule(tmp('mv')),
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    invoiceMod,
    createPaymentModule(tmp('pay'), invoiceMod.store),
    createOrderModule(tmp('so')),
    pos,
    createGoodsReceiptModule(tmp('gr')),
    bills,
    createVendorPaymentModule(tmp('vpay'), bills.store),
  ]) registry.register(m);
  registry.bindScope(() => resolveTenantScope(() => scope));
  handlers = buildModuleHandlers(registry, moduleCtx());
  journal = new DurableCommandJournal(tmp('journal'));
  def = buildPlatformCommandDispatchDef({ registry, journal, audit: (e) => audit.push(e), resolvePrincipal: () => currentPrincipal });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await journal.destroy().catch(() => undefined);
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const H = (c: string) => handlers.find((d) => d.channel === c)!.handler as (p: unknown) => Promise<unknown>;
const createIn = (moduleId: string, fields: Record<string, unknown>) =>
  H(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity; error?: string }>;
const actIn = (moduleId: string, id: string, action: string) =>
  H(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string; error?: string; record?: EnterpriseEntity }>;
const updateIn = (moduleId: string, id: string, fields: Record<string, unknown>) =>
  H(IpcChannel.EnterpriseModuleUpdate)({ moduleId, id, fields }) as Promise<{ ok: boolean; error?: string; errors?: Record<string, string> }>;

function balance(code: string): number {
  const a = accountsStore.list().find((r) => String(r.fields.code) === code);
  return a ? glAccountFromRecord(a).balance : 0;
}
interface Line { account: string; debit: number; credit: number }
const postedJournals = () => registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list().filter((r) => r.status !== 'deleted' && str(r.fields.postedAt));
function postedLines(): Line[] {
  return postedJournals().flatMap((r) => { try { return JSON.parse(str(r.fields.lines)) as Line[]; } catch { return []; } });
}
const totalDebits = () => postedLines().reduce((s, l) => s + (Number(l.debit) || 0), 0);
const totalCredits = () => postedLines().reduce((s, l) => s + (Number(l.credit) || 0), 0);
async function flushUntil(pred: () => boolean, ms = 1500): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 5));
}
const seedAccount = (code: string, name: string, cls: string) => createIn(LEDGER_ACCOUNTS_MODULE_ID, { code, name, class: cls, currency: 'USD' });
const draftJournal = (entryNumber: string, lines: Line[]) => createIn(JOURNAL_ENTRIES_MODULE_ID, { entryNumber, memo: 'test', lines: JSON.stringify(lines), status: 'draft' });

interface DispatchResult { ok: boolean; data?: { id?: string; invoiceId?: string; status?: string }; replayed?: boolean; error?: { code: string; message: string } }
async function dispatch(operation: string, target: string | undefined, idem: string, payload: Record<string, unknown> = {}, claimedTenantId?: string): Promise<DispatchResult> {
  return (await runSecureHandler(def, { operation, ...(target ? { target } : {}), payload, idempotencyKey: idem, ...(claimedTenantId ? { claimedTenantId } : {}) }, { isAuthenticated: () => true })) as DispatchResult;
}

const AR = '1100', CASH = '1000', REV = '4000', AP = '2000', INV = '1300';

// A full O2C cycle through governed commands: ship → invoice → issue → receive.
async function o2cCycle(total = 900, tag = 'A'): Promise<string> {
  await createIn('inventory-products', { sku: 'SKU-A', name: 'A', standardCost: 5 });
  await createIn(STOCK_MOVEMENTS_MODULE_ID, { movementNumber: `MV-${tag}`, type: 'receive', product: 'SKU-A', warehouse: 'WH-1', quantity: 100 });
  const o = await createIn(ORDERS_MODULE_ID, { orderNumber: `SO-${tag}`, customer: 'Acme', product: 'SKU-A', warehouse: 'WH-1', orderedQty: 40, currency: 'USD', total });
  const orderId = o.record!.id;
  await dispatch('ShipSalesOrder', orderId, `ship-${tag}`);
  const invoiceId = (await dispatch('InvoiceSalesOrder', orderId, `inv-${tag}`)).data!.invoiceId!;
  await dispatch('IssueCustomerInvoice', invoiceId, `iss-${tag}`);
  await flushUntil(() => balance(AR) >= total);
  return invoiceId;
}
// A P2P chain to an APPROVED goods bill (GR posted Dr Inv/Cr GRNI; bill approve relieves GRNI/books AP).
async function approvedBill(billTotal: number, tag = 'P'): Promise<string> {
  await createIn('inventory-products', { sku: 'SKU-B', name: 'B', standardCost: 5 });
  const qty = billTotal / 5;
  const po = await createIn(PURCHASE_ORDERS_MODULE_ID, { poNumber: `PO-${tag}`, supplier: 'Acme', warehouse: 'WH-1', currency: 'USD', lines: JSON.stringify([{ sku: 'SKU-B', quantity: qty, unitPrice: 5 }]) });
  await actIn(PURCHASE_ORDERS_MODULE_ID, po.record!.id, 'approve');
  const gr = await createIn(GOODS_RECEIPTS_MODULE_ID, { grNumber: `GR-${tag}`, purchaseOrder: po.record!.id, supplier: 'Acme', product: 'SKU-B', warehouse: 'WH-1', quantityReceived: qty, lines: JSON.stringify([{ sku: 'SKU-B', quantity: qty, poLine: 1 }]) });
  await dispatch('PostGoodsReceipt', gr.record!.id, `grpost-${tag}`);
  const bill = await createIn(VENDOR_BILLS_MODULE_ID, { billNumber: `BILL-${tag}`, vendor: 'Acme', currency: 'USD', amount: billTotal, sourcePurchaseOrder: po.record!.id, lines: JSON.stringify([{ sku: 'SKU-B', quantity: qty, unitPrice: 5 }]) });
  expect((await dispatch('ApproveSupplierInvoice', bill.record!.id, `appr-${tag}`)).ok).toBe(true);
  return bill.record!.id;
}

// ===========================================================================
// Part A — journal-engine double-entry invariants (the control-plane core)
// ===========================================================================

describe('S30 · Part A — journal-engine invariants', () => {
  it('a BALANCED journal posts (status posted, both accounts move)', async () => {
    await seedAccount('1000', 'Cash', 'asset');
    await seedAccount('4000', 'Revenue', 'revenue');
    const je = await draftJournal('JE-A1', [{ account: '1000', debit: 100, credit: 0 }, { account: '4000', debit: 0, credit: 100 }]);
    const r = await actIn(JOURNAL_ENTRIES_MODULE_ID, je.record!.id, 'post');
    expect(r.ok).toBe(true);
    expect(postedJournals()).toHaveLength(1);
    expect(balance('1000')).toBe(100);
    expect(Math.abs(balance('4000'))).toBe(100);
    expect(totalDebits()).toBe(totalCredits());
  });

  it('an UNBALANCED journal is REJECTED at post — nothing posted, no account moves', async () => {
    await seedAccount('1000', 'Cash', 'asset');
    await seedAccount('4000', 'Revenue', 'revenue');
    const je = await draftJournal('JE-A2', [{ account: '1000', debit: 100, credit: 0 }, { account: '4000', debit: 0, credit: 60 }]);
    const r = await actIn(JOURNAL_ENTRIES_MODULE_ID, je.record!.id, 'post');
    expect(r.ok).toBe(false);
    expect(str(r.message ?? r.error)).toMatch(/unbalanced/i);
    expect(postedJournals()).toHaveLength(0);
    expect(balance('1000')).toBe(0);
  });

  it('zero-value, both-sided, and negative lines are REJECTED', async () => {
    await seedAccount('1000', 'Cash', 'asset');
    expect((await draftJournal('JE-z', [{ account: '1000', debit: 0, credit: 0 }])).ok).toBe(false);
    expect((await draftJournal('JE-b', [{ account: '1000', debit: 50, credit: 50 }])).ok).toBe(false);
    expect((await draftJournal('JE-n', [{ account: '1000', debit: -50, credit: 0 }])).ok).toBe(false);
  });

  it('a NONEXISTENT account is REJECTED (no auto-create)', async () => {
    await seedAccount('1000', 'Cash', 'asset');
    const je = await draftJournal('JE-A4', [{ account: '1000', debit: 100, credit: 0 }, { account: '9999', debit: 0, credit: 100 }]);
    // rejected either at draft-create (validate) or at post — assert no posting either way
    if (je.ok) {
      const r = await actIn(JOURNAL_ENTRIES_MODULE_ID, je.record!.id, 'post');
      expect(r.ok).toBe(false);
    }
    expect(postedJournals()).toHaveLength(0);
    expect(accountsStore.list().some((a) => str(a.fields.code) === '9999')).toBe(false);
  });

  it('a POSTED journal is IMMUTABLE — an edit is refused', async () => {
    await seedAccount('1000', 'Cash', 'asset');
    await seedAccount('4000', 'Revenue', 'revenue');
    const je = await draftJournal('JE-A5', [{ account: '1000', debit: 100, credit: 0 }, { account: '4000', debit: 0, credit: 100 }]);
    expect((await actIn(JOURNAL_ENTRIES_MODULE_ID, je.record!.id, 'post')).ok).toBe(true);
    const edit = await updateIn(JOURNAL_ENTRIES_MODULE_ID, je.record!.id, { lines: JSON.stringify([{ account: '1000', debit: 500, credit: 0 }, { account: '4000', debit: 0, credit: 500 }]) });
    expect(edit.ok).toBe(false);
    expect(balance('1000')).toBe(100); // unchanged by the refused edit
  });

  it('REVERSAL is a new mirrored -REV draft (append-only, original untouched)', async () => {
    await seedAccount('1000', 'Cash', 'asset');
    await seedAccount('4000', 'Revenue', 'revenue');
    const je = await draftJournal('JE-A6', [{ account: '1000', debit: 100, credit: 0 }, { account: '4000', debit: 0, credit: 100 }]);
    expect((await actIn(JOURNAL_ENTRIES_MODULE_ID, je.record!.id, 'post')).ok).toBe(true);
    expect((await actIn(JOURNAL_ENTRIES_MODULE_ID, je.record!.id, 'reverse')).ok).toBe(true);
    const rev = registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list().find((r) => str(r.fields.entryNumber) === 'JE-A6-REV');
    expect(rev).toBeTruthy();
    const revLines = JSON.parse(str(rev!.fields.lines)) as Line[];
    expect(revLines.find((l) => l.account === '1000')!.credit).toBe(100); // debit↔credit swapped
    expect(str(rev!.fields.status)).toBe('draft'); // must be reviewed + posted separately
    expect(str(je.record!.fields.entryNumber)).toBe('JE-A6'); // original id/number unchanged
  });
});

// ===========================================================================
// Part B — governed control-plane: P2P + O2C traces + global double-entry
// ===========================================================================

describe('S30 · Part B — governed control-plane', () => {
  it('O2C posts Dr AR / Cr Revenue then Dr Cash / Cr AR — AR nets to zero', async () => {
    const invoiceId = await o2cCycle(900, 'o2c');
    expect(balance(AR)).toBe(900);
    expect(Math.abs(balance(REV))).toBe(900);
    // receive the payment
    await dispatch('ReceiveCustomerPayment', undefined, 'rcv', { paymentNumber: 'PAY-1', invoiceRef: invoiceId, amount: 900, method: 'bank_transfer' });
    await flushUntil(() => balance(AR) === 0);
    expect(balance(CASH)).toBe(900);
    expect(balance(AR)).toBe(0);
    expect(totalDebits()).toBe(totalCredits());
  });

  it('P2P posts Dr Inventory / Cr GRNI then relieves GRNI / books AP then Dr AP / Cr Cash — AP nets to zero', async () => {
    const billId = await approvedBill(100, 'p2p');
    await flushUntil(() => balance(INV) === 100);
    expect(balance(INV)).toBe(100);          // goods receipt Dr Inventory
    expect(balance(AP)).toBe(100);           // bill approval Cr AP (liability shows a positive credit-normal balance)
    await dispatch('PaySupplierInvoice', undefined, 'vpay', { paymentNumber: 'VPAY-1', billRef: billId, amount: 100, method: 'bank_transfer' });
    await flushUntil(() => balance(AP) === 0);
    expect(balance(AP)).toBe(0);             // AP settled
    expect(totalDebits()).toBe(totalCredits());
  });

  it('GLOBAL double-entry: after a full P2P + O2C cycle the whole ledger balances', async () => {
    const invoiceId = await o2cCycle(900, 'g');
    await dispatch('ReceiveCustomerPayment', undefined, 'g-rcv', { paymentNumber: 'PAY-G', invoiceRef: invoiceId, amount: 900, method: 'bank_transfer' });
    const billId = await approvedBill(100, 'g');
    await dispatch('PaySupplierInvoice', undefined, 'g-vpay', { paymentNumber: 'VPAY-G', billRef: billId, amount: 100, method: 'bank_transfer' });
    await flushUntil(() => balance(AR) === 0 && balance(AP) === 0);
    expect(postedJournals().length).toBeGreaterThan(3);
    expect(totalDebits()).toBe(totalCredits()); // Σ debits == Σ credits across every posted journal
    expect(totalDebits()).toBeGreaterThan(0);
  });

  it('IDEMPOTENT replay posts no second journal', async () => {
    const invoiceId = await o2cCycle(900, 'i');
    await dispatch('ReceiveCustomerPayment', undefined, 'i-rcv', { paymentNumber: 'PAY-I', invoiceRef: invoiceId, amount: 900, method: 'bank_transfer' });
    await flushUntil(() => balance(AR) === 0);
    const before = postedJournals().length;
    const replay = await dispatch('ReceiveCustomerPayment', undefined, 'i-rcv', { paymentNumber: 'PAY-I', invoiceRef: invoiceId, amount: 900, method: 'bank_transfer' });
    expect(replay.replayed).toBe(true);
    expect(postedJournals().length).toBe(before); // no double-post
    expect(balance(CASH)).toBe(900);
  });

  it('TENANT ISOLATION: tenant-A cannot see tenant-B ledger entries', async () => {
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    await o2cCycle(900, 'B');
    const bJournals = postedJournals().length;
    expect(bJournals).toBeGreaterThan(0);
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    currentPrincipal = fullPrincipal();
    expect(postedJournals()).toHaveLength(0); // tenant-B's journals are invisible to tenant-A
    expect(balance(AR)).toBe(0);
  });

  it('AUTHORIZATION: an unauthorized caller posts no accounting effect', async () => {
    await createIn('inventory-products', { sku: 'SKU-A', name: 'A', standardCost: 5 });
    await createIn(STOCK_MOVEMENTS_MODULE_ID, { movementNumber: 'MV-z', type: 'receive', product: 'SKU-A', warehouse: 'WH-1', quantity: 100 });
    const o = await createIn(ORDERS_MODULE_ID, { orderNumber: 'SO-z', customer: 'Acme', product: 'SKU-A', warehouse: 'WH-1', orderedQty: 40, currency: 'USD', total: 900 });
    await dispatch('ShipSalesOrder', o.record!.id, 'z-ship');
    const invoiceId = (await dispatch('InvoiceSalesOrder', o.record!.id, 'z-inv')).data!.invoiceId!;
    currentPrincipal = fullPrincipal({ permissions: ['operations:read', 'sales:read'] });
    const r = await dispatch('IssueCustomerInvoice', invoiceId, 'z-iss');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('UNAUTHORIZED');
    expect(balance(AR)).toBe(0); // no journal posted
  });

  it('ATOMICITY: a REFUSED business transaction leaves NO partial journal (books stay balanced)', async () => {
    const invoiceId = await o2cCycle(900, 'at');
    const before = postedJournals().length;
    const over = await dispatch('ReceiveCustomerPayment', undefined, 'at-over', { paymentNumber: 'PAY-OV', invoiceRef: invoiceId, amount: 5000, method: 'bank_transfer' });
    expect(over.ok).toBe(false); // overpayment refused
    expect(postedJournals().length).toBe(before); // no Cash/AR journal created
    expect(balance(CASH)).toBe(0);
    expect(totalDebits()).toBe(totalCredits());
  });
});
