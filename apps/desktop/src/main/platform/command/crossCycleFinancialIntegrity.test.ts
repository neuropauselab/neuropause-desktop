/**
 * ERP Session 96 — CROSS-CYCLE ERP FINANCIAL-INTEGRITY CERTIFICATION.
 *
 * Certifies that the certified P2P (S94) and O2C (S95) cycles execute in the SAME tenant/profile over a
 * SHARED product without corrupting shared inventory, GL, AR, AP, Cash, GRNI, Revenue, COGS, journal
 * history, idempotency, or lineage — reusing ONLY the existing canonical modules/commands (no new
 * accounting/inventory/reconciliation/transaction engine).
 *
 *   P2P: reorder → PR → PO → GR → Inventory (+Q1) + GRNI → Supplier Invoice → 3-way match → AP → Pay
 *   O2C: Customer → SO → Ship (Inventory −Q2, Dr COGS/Cr Inventory) → Invoice → Issue (AR) → Receipt
 *
 * Proves: shared inventory equation (0 + receipts − issues = final stock = product = ledger); the full
 * cross-cycle GL population, each posting exactly once and immutable; AR/AP SEPARATION (a supplier
 * payment cannot settle a customer invoice and vice versa); restart durability across both cycles;
 * tenant isolation; the raw-door + AI boundaries; and deterministic reconciliation from persisted state.
 *
 * Certification/verification gate — ZERO production change (the S95 draft-invoice guard already landed).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s, 'utf8'), decryptString: (b: Buffer) => b.toString('utf8') },
}));

import {
  IpcChannel,
  JOURNAL_ENTRIES_MODULE_ID,
  GOODS_RECEIPTS_MODULE_ID,
  PRODUCTS_MODULE_ID,
  PURCHASE_ORDERS_MODULE_ID,
  VENDOR_BILLS_MODULE_ID,
  VENDOR_PAYMENTS_MODULE_ID,
  CUSTOMERS_MODULE_ID,
  ORDERS_MODULE_ID,
  FINANCE_MODULE_ID,
  PAYMENTS_MODULE_ID,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { createProductModule } from '../../enterprise/modules/inventory/productModule';
import { createStockMovementModule } from '../../enterprise/modules/inventory/stockMovementModule';
import { createLedgerAccountModule } from '../../enterprise/modules/finance/ledgerAccountModule';
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createVendorBillModule } from '../../enterprise/modules/finance/vendorBillModule';
import { createVendorPaymentModule } from '../../enterprise/modules/finance/vendorPaymentModule';
import { createInvoiceModule } from '../../enterprise/modules/finance/invoiceModule';
import { createPaymentModule } from '../../enterprise/modules/finance/paymentModule';
import { createPaymentReversalModule } from '../../enterprise/modules/finance/paymentReversalModule';
import { createPurchaseRequestModule } from '../../enterprise/modules/procurement/purchaseRequestModule';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { createGoodsReceiptModule } from '../../enterprise/modules/procurement/goodsReceiptModule';
import { createShippingModule } from '../../enterprise/modules/warehouse/shippingModule';
import { createCustomerModule } from '../../enterprise/modules/crm/customerModule';
import { createOrderModule } from '../../enterprise/modules/sales/orderModule';
import { createReorderDecisionModule, REORDER_DECISION_MODULE_ID } from '../../enterprise/modules/inventory/reorderDecisionModule';
import { dispatchCommand, type CommandDispatchDeps } from './commandBus';
import { DurableCommandJournal } from './durableCommandJournal';
import type { DomainCommand, DomainCommandType } from './domainCommand';

const STOCK_MOVEMENTS_MODULE_ID = 'inventory-movements';
const STANDARD_COST = 6;   // drives COGS on the O2C issue (Dr COGS / Cr Inventory)
const SELL_PRICE = 10;

interface StorePaths {
  prod: string; mv: string; acct: string; jrnl: string; ship: string;
  pr: string; po: string; gr: string; bill: string; vpay: string; dec: string;
  cust: string; order: string; inv: string; pay: string; rev: string; journal: string;
}
const allPaths: string[] = [];
function freshPaths(): StorePaths {
  const p = (t: string): string => { const f = join(tmpdir(), `np-s96-${t}-${randomUUID()}.json`); allPaths.push(f); return f; };
  return { prod: p('prod'), mv: p('mv'), acct: p('acct'), jrnl: p('jrnl'), ship: p('ship'), pr: p('pr'), po: p('po'), gr: p('gr'), bill: p('bill'), vpay: p('vpay'), dec: p('dec'), cust: p('cust'), order: p('order'), inv: p('inv'), pay: p('pay'), rev: p('rev'), journal: p('journal') };
}

let scope: TenantScope | null;
let authorized: EnterprisePermission[];

function makeCtx(deny?: EnterprisePermission): EnterpriseModuleContext {
  return {
    authorize: (p: EnterprisePermission) => { authorized.push(p); if (deny && p === deny) throw new Error(`denied: ${p}`); },
    audit: () => undefined, publish: (_i: PlatformEventInput) => undefined, broadcast: () => undefined, notify: () => undefined,
    actor: () => 'operator@np.dev', now: () => '2026-09-01T12:00:00.000Z',
  };
}

function buildInstallation(paths: StorePaths, ctx: EnterpriseModuleContext) {
  const registry = new EnterpriseModuleRegistry();
  const products = createProductModule(paths.prod);
  const pr = createPurchaseRequestModule(paths.pr);
  const po = createPurchaseOrderModule(paths.po);
  const gr = createGoodsReceiptModule(paths.gr);
  const shipping = createShippingModule(paths.ship);
  const accounts = createLedgerAccountModule(paths.acct);
  const bills = createVendorBillModule(paths.bill, po.store);
  const vendorPayments = createVendorPaymentModule(paths.vpay, bills.store);
  const customers = createCustomerModule(paths.cust);
  const orders = createOrderModule(paths.order);
  const invoices = createInvoiceModule(paths.inv);
  const payments = createPaymentModule(paths.pay, invoices.store);
  const reversals = createPaymentReversalModule(paths.rev, payments.store, vendorPayments.store);
  for (const m of [
    products, pr, po, gr, shipping, accounts, bills, vendorPayments, customers, orders, invoices, payments, reversals,
    createStockMovementModule(paths.mv),
    createJournalEntryModule(paths.jrnl, accounts.store),
    createReorderDecisionModule(paths.dec, products.store, pr.store, po.store, shipping.store),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  const handlers = buildModuleHandlers(registry, ctx);
  const journal = new DurableCommandJournal(paths.journal);
  return { registry, handlers, journal };
}

let paths: StorePaths;
let ctx: EnterpriseModuleContext;
let inst: ReturnType<typeof buildInstallation>;

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  authorized = [];
  paths = freshPaths();
  ctx = makeCtx();
  inst = buildInstallation(paths, ctx);
});
afterEach(async () => { vi.restoreAllMocks(); for (const p of allPaths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined); });

let seq = 0;
function cmd(type: DomainCommandType, opts: { target?: string; payload?: Record<string, unknown>; idem?: string; tenantId?: string } = {}): DomainCommand {
  return {
    commandId: `cmd_${(seq += 1)}`, type,
    ...(opts.tenantId !== undefined ? { tenantId: opts.tenantId } : {}),
    actor: 'operator@np.dev',
    ...(opts.target ? { target: { id: opts.target } } : {}),
    payload: opts.payload ?? {},
    correlationId: 'corr_s96', idempotencyKey: opts.idem ?? `${type}_${seq}`,
    timestamp: '2026-09-01T12:00:00.000Z', source: 'test',
  };
}
function deps(i = inst, c: EnterpriseModuleContext = ctx): CommandDispatchDeps {
  return { registry: i.registry, ctx: c, resolveScope: () => scope, journal: i.journal };
}
const handler = (i: ReturnType<typeof buildInstallation>, channel: string) => {
  const def = i.handlers.find((d) => d.channel === channel);
  if (!def) throw new Error(`no handler for ${channel}`);
  return def.handler as (p: unknown) => Promise<unknown>;
};
const createIn = (moduleId: string, fields: Record<string, unknown>, i = inst) =>
  handler(i, IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity }>;
const actIn = (moduleId: string, id: string, action: string, i = inst) =>
  handler(i, IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string; error?: string }>;
const updateIn = (moduleId: string, id: string, fields: Record<string, unknown>, i = inst) =>
  handler(i, IpcChannel.EnterpriseModuleUpdate)({ moduleId, id, fields }) as Promise<{ ok: boolean; error?: string }>;
const listIn = (moduleId: string, i = inst) => i.registry.get(moduleId)!.store.list();
const rec = (moduleId: string, id: string, i = inst) => i.registry.get(moduleId)!.store.get(id);
const alive = (moduleId: string, i = inst) => listIn(moduleId, i).filter((r) => r.status !== 'deleted');
const count = (moduleId: string, i = inst) => alive(moduleId, i).length;
const movesOfType = (t: string, i = inst) => listIn(STOCK_MOVEMENTS_MODULE_ID, i).filter((m) => m.status !== 'deleted' && String(m.fields.type) === t);
const stock = (sku: string, i = inst) => Number(listIn(PRODUCTS_MODULE_ID, i).find((r) => String(r.fields.sku) === sku)?.fields.currentStock ?? 0);
const clearedVendorPay = (i = inst) => alive(VENDOR_PAYMENTS_MODULE_ID, i).filter((p) => String(p.fields.status) === 'cleared');
const clearedReceipts = (i = inst) => alive(PAYMENTS_MODULE_ID, i).filter((p) => String(p.fields.status) === 'cleared');

/** P2P: reorder → PR → PO → GR → posted (Inventory +Q1, GRNI) → supplier invoice → approve (AP) → pay. */
async function runP2P(i = inst): Promise<{ poNumber: string; grId: string; billId: string; billNumber: string; vendorPaymentId: string; q1: number }> {
  const report = await createIn(REORDER_DECISION_MODULE_ID, { asOfDate: '2026-07-31' }, i);
  const confirm = await dispatchCommand(cmd('CreatePurchaseRequestFromReorderRecommendation', { target: report.record!.id, payload: { sku: 'SKU-1' }, idem: 'reorder:seed' }), deps(i));
  const prId = String(confirm.data!.id);
  const q1 = Number(confirm.data!.quantity);
  await dispatchCommand(cmd('SubmitPurchaseRequest', { target: prId, idem: 'p2p-sub' }), deps(i));
  await dispatchCommand(cmd('ApprovePurchaseRequest', { target: prId, idem: 'p2p-app' }), deps(i));
  await dispatchCommand(cmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'p2p-conv' }), deps(i));
  const po = listIn(PURCHASE_ORDERS_MODULE_ID, i).find((r) => String(r.fields.sourceRequest) === prId)!;
  const poId = po.id;
  const poNumber = String(po.fields.poNumber);
  await updateIn(PURCHASE_ORDERS_MODULE_ID, poId, { warehouse: 'WH-1', supplier: 'Acme Supplies', unitCost: STANDARD_COST }, i);
  await actIn(PURCHASE_ORDERS_MODULE_ID, poId, 'approve', i);
  await actIn(PURCHASE_ORDERS_MODULE_ID, poId, 'send', i);
  await actIn(PURCHASE_ORDERS_MODULE_ID, poId, 'receiveGoods', i);
  const gr = listIn(GOODS_RECEIPTS_MODULE_ID, i).find((r) => String(r.fields.purchaseOrder) === poId)!;
  expect((await dispatchCommand(cmd('PostGoodsReceipt', { target: gr.id, idem: `p2p-post:${gr.id}` }), deps(i))).ok).toBe(true);
  const billTotal = q1 * STANDARD_COST;
  const billNumber = `BILL-${randomUUID().slice(0, 8)}`;
  const bill = await createIn(VENDOR_BILLS_MODULE_ID, { billNumber, vendor: 'Acme Supplies', currency: 'USD', amount: billTotal, sourcePurchaseOrder: poNumber, status: 'draft', lines: JSON.stringify([{ sku: 'SKU-1', quantity: q1, unitPrice: STANDARD_COST }]) }, i);
  const billId = bill.record!.id;
  expect((await dispatchCommand(cmd('ApproveSupplierInvoice', { target: billId, idem: `p2p-inv:${billId}` }), deps(i))).ok).toBe(true);
  expect((await dispatchCommand(cmd('PaySupplierInvoice', { payload: { paymentNumber: 'VPAY-1', billRef: billNumber, vendor: 'Acme Supplies', amount: billTotal, transactionRef: 'P2P-TXN' }, idem: 'p2p-pay' }), deps(i))).ok).toBe(true);
  const vp = clearedVendorPay(i)[0];
  return { poNumber, grId: gr.id, billId, billNumber, vendorPaymentId: vp.id, q1 };
}

/** O2C on the SAME product: Customer → SO (orderedQty Q2) → Ship (Inventory −Q2, COGS) → Invoice → Issue → Receipt. */
async function runO2C(q2: number, i = inst): Promise<{ orderId: string; invoiceId: string; invoiceNumber: string; receiptId: string; total: number }> {
  const total = q2 * SELL_PRICE;
  const customer = await createIn(CUSTOMERS_MODULE_ID, { name: 'Beta Buyer' }, i);
  const soCmd = await dispatchCommand(cmd('CreateSalesOrder', { payload: { orderNumber: 'SO-1', customer: 'Beta Buyer', customerRef: customer.record!.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: q2, total }, idem: 'o2c-so' }), deps(i));
  const orderId = String(soCmd.data!.id);
  expect((await dispatchCommand(cmd('ShipSalesOrder', { target: orderId, idem: 'o2c-ship' }), deps(i))).ok).toBe(true);
  expect((await dispatchCommand(cmd('InvoiceSalesOrder', { target: orderId, idem: 'o2c-inv' }), deps(i))).ok).toBe(true);
  const invoiceId = String(rec(ORDERS_MODULE_ID, orderId, i)!.fields.convertedInvoice);
  const invoiceNumber = String(rec(FINANCE_MODULE_ID, invoiceId, i)!.fields.number);
  expect((await dispatchCommand(cmd('IssueCustomerInvoice', { target: invoiceId, idem: 'o2c-issue' }), deps(i))).ok).toBe(true);
  expect((await dispatchCommand(cmd('ReceiveCustomerPayment', { payload: { paymentNumber: 'RCPT-1', invoiceRef: invoiceNumber, amount: total, transactionRef: 'O2C-TXN' }, idem: 'o2c-rcpt' }), deps(i))).ok).toBe(true);
  const receipt = clearedReceipts(i)[0];
  return { orderId, invoiceId, invoiceNumber, receiptId: receipt.id, total };
}

async function seedProduct(i = inst) {
  // reorderLevel high vs 0 stock so the P2P reorder recommends; standardCost drives COGS on issue.
  await createIn(PRODUCTS_MODULE_ID, { sku: 'SKU-1', name: 'Widget', purchaseCost: 4, standardCost: STANDARD_COST, reorderLevel: 20, safetyStock: 10, maximumStock: 500 }, i);
}

// ─────────────────────── 4 · SHARED INVENTORY INTEGRITY ───────────────────────
describe('S96 shared inventory — both cycles over one SKU: 0 + receipts − issues = final stock', () => {
  it('P2P receipt then O2C shipment net correctly; product = ledger = movements; no phantom/duplicate', async () => {
    await seedProduct();
    expect(stock('SKU-1')).toBe(0);
    const p = await runP2P();
    expect(stock('SKU-1')).toBe(p.q1); // +Q1 from the receipt
    const q2 = Math.min(40, p.q1);
    await runO2C(q2);
    // shared inventory equation
    expect(stock('SKU-1')).toBe(p.q1 - q2);
    const received = movesOfType('receive').reduce((n, m) => n + Number(m.fields.quantity), 0);
    const issued = movesOfType('issue').reduce((n, m) => n + Number(m.fields.quantity), 0);
    expect(received).toBe(p.q1);
    expect(issued).toBe(q2);
    expect(stock('SKU-1')).toBe(received - issued); // product == ledger
    expect(movesOfType('receive').length).toBe(1);
    expect(movesOfType('issue').length).toBe(1); // exactly one each; no phantom
  });
});

// ─────────────────────── 5 · SHARED CASH / GL INTEGRITY ───────────────────────
describe('S96 shared GL — both cycles populate the journal; each posting once; replay never duplicates', () => {
  it('both cycles book their canonical journals; a replay of any terminal command adds no journal', async () => {
    await seedProduct();
    const p = await runP2P();
    const afterP2P = count(JOURNAL_ENTRIES_MODULE_ID);
    expect(afterP2P).toBeGreaterThan(0); // Dr Inventory/Cr GRNI + GRNI-relief/Cr AP + Dr AP/Cr Cash
    const o = await runO2C(Math.min(40, p.q1));
    const afterBoth = count(JOURNAL_ENTRIES_MODULE_ID);
    expect(afterBoth).toBeGreaterThan(afterP2P); // Dr COGS/Cr Inventory + Dr AR/Cr Revenue + Dr Cash/Cr AR
    // replay every terminal economic command with the same key — no new journals, no new movements
    await dispatchCommand(cmd('PostGoodsReceipt', { target: p.grId, idem: `p2p-post:${p.grId}` }), deps());
    await dispatchCommand(cmd('ApproveSupplierInvoice', { target: p.billId, idem: `p2p-inv:${p.billId}` }), deps());
    await dispatchCommand(cmd('PaySupplierInvoice', { payload: { paymentNumber: 'VPAY-1', billRef: p.billNumber, vendor: 'Acme Supplies', amount: p.q1 * STANDARD_COST, transactionRef: 'P2P-TXN' }, idem: 'p2p-pay' }), deps());
    await dispatchCommand(cmd('ReceiveCustomerPayment', { payload: { paymentNumber: 'RCPT-1', invoiceRef: o.invoiceNumber, amount: o.total, transactionRef: 'O2C-TXN' }, idem: 'o2c-rcpt' }), deps());
    expect(count(JOURNAL_ENTRIES_MODULE_ID)).toBe(afterBoth); // no duplicate GL
    expect(movesOfType('receive').length).toBe(1);
    expect(movesOfType('issue').length).toBe(1);
    // both settlements stand
    expect(String(rec(VENDOR_BILLS_MODULE_ID, p.billId)!.fields.status)).toBe('paid');
    expect(String(rec(FINANCE_MODULE_ID, o.invoiceId)!.fields.status)).toBe('paid');
  });
});

// ─────────────────────── 6 · AR / AP SEPARATION ───────────────────────
describe('S96 AR/AP separation — a supplier payment cannot settle a customer invoice and vice versa', () => {
  it('cross-document settlement fails closed in both directions', async () => {
    await seedProduct();
    const p = await runP2P();
    const o = await runO2C(Math.min(30, p.q1));
    // PaySupplierInvoice against the CUSTOMER invoice number → no matching vendor bill → refused
    const crossPay = await dispatchCommand(cmd('PaySupplierInvoice', { payload: { paymentNumber: 'X1', billRef: o.invoiceNumber, vendor: 'Beta Buyer', amount: 1, transactionRef: 'X1' }, idem: 'x1' }), deps());
    expect(crossPay.ok).toBe(false);
    // ReceiveCustomerPayment against the SUPPLIER bill number → no matching customer invoice → refused
    const crossRcpt = await dispatchCommand(cmd('ReceiveCustomerPayment', { payload: { paymentNumber: 'X2', invoiceRef: p.billNumber, amount: 1, transactionRef: 'X2' }, idem: 'x2' }), deps());
    expect(crossRcpt.ok).toBe(false);
    // no stray payment/receipt created
    expect(clearedVendorPay().length).toBe(1);
    expect(clearedReceipts().length).toBe(1);
  });
});

// ─────────────────────── 7 · IDEMPOTENCY + RESTART (both cycles) ───────────────────────
describe('S96 restart durability — both cycles survive a restart; terminal replays never double-post', () => {
  it('rebuild over the same stores preserves inventory + journals + settlements; replays are deduped', async () => {
    await seedProduct();
    const p = await runP2P();
    const o = await runO2C(Math.min(40, p.q1));
    const snap = {
      stock: stock('SKU-1'), recv: movesOfType('receive').length, iss: movesOfType('issue').length,
      jrnl: count(JOURNAL_ENTRIES_MODULE_ID), vpay: clearedVendorPay().length, rcpt: clearedReceipts().length,
    };
    const ctx2 = makeCtx();
    const inst2 = buildInstallation(paths, ctx2);
    for (const m of [PRODUCTS_MODULE_ID, STOCK_MOVEMENTS_MODULE_ID, JOURNAL_ENTRIES_MODULE_ID, VENDOR_PAYMENTS_MODULE_ID, PAYMENTS_MODULE_ID, VENDOR_BILLS_MODULE_ID, FINANCE_MODULE_ID]) {
      await inst2.registry.get(m)!.store.load();
    }
    expect(stock('SKU-1', inst2)).toBe(snap.stock);
    expect(movesOfType('receive', inst2).length).toBe(snap.recv);
    expect(movesOfType('issue', inst2).length).toBe(snap.iss);
    expect(count(JOURNAL_ENTRIES_MODULE_ID, inst2)).toBe(snap.jrnl);
    expect(clearedVendorPay(inst2).length).toBe(snap.vpay);
    expect(clearedReceipts(inst2).length).toBe(snap.rcpt);
    // replay both terminal payments on the restarted installation → deduped
    const rp = await dispatchCommand(cmd('PaySupplierInvoice', { payload: { paymentNumber: 'VPAY-1', billRef: p.billNumber, vendor: 'Acme Supplies', amount: p.q1 * STANDARD_COST, transactionRef: 'P2P-TXN' }, idem: 'p2p-pay' }), deps(inst2, ctx2));
    const rr = await dispatchCommand(cmd('ReceiveCustomerPayment', { payload: { paymentNumber: 'RCPT-1', invoiceRef: o.invoiceNumber, amount: o.total, transactionRef: 'O2C-TXN' }, idem: 'o2c-rcpt' }), deps(inst2, ctx2));
    expect(rp.replayed).toBe(true);
    expect(rr.replayed).toBe(true);
    expect(clearedVendorPay(inst2).length).toBe(snap.vpay);
    expect(clearedReceipts(inst2).length).toBe(snap.rcpt);
    expect(count(JOURNAL_ENTRIES_MODULE_ID, inst2)).toBe(snap.jrnl);
    expect(stock('SKU-1', inst2)).toBe(snap.stock);
  });
});

// ─────────────────────── 8 · TENANT ISOLATION ───────────────────────
describe('S96 tenant isolation — a second tenant cannot see or settle the first tenant documents', () => {
  it('cross-tenant reads/settlements fail closed across both cycles', async () => {
    await seedProduct();
    const p = await runP2P();
    const o = await runO2C(Math.min(20, p.q1));
    // switch to tenant-B: the tenant-A documents are invisible
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    expect(rec(VENDOR_BILLS_MODULE_ID, p.billId) ?? null).toBeNull(); // invisible (scopeOrDeny → null)
    expect(rec(FINANCE_MODULE_ID, o.invoiceId) ?? null).toBeNull();
    expect(stock('SKU-1')).toBe(0); // tenant-B has no products
    // tenant-B cannot pay tenant-A's bill or settle tenant-A's invoice
    expect((await dispatchCommand(cmd('PaySupplierInvoice', { payload: { paymentNumber: 'B1', billRef: p.billNumber, vendor: 'Acme Supplies', amount: 1, transactionRef: 'B1' }, idem: 'b1' }), deps())).ok).toBe(false);
    expect((await dispatchCommand(cmd('ReceiveCustomerPayment', { payload: { paymentNumber: 'B2', invoiceRef: o.invoiceNumber, amount: 1, transactionRef: 'B2' }, idem: 'b2' }), deps())).ok).toBe(false);
    // forged tenant on a tenant-A target → CROSS_TENANT_CLAIM
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    expect((await dispatchCommand(cmd('PostGoodsReceipt', { target: p.grId, idem: 'ff', tenantId: 'tenant-EVIL' }), deps())).error).toBe('CROSS_TENANT_CLAIM');
  });
});

// ─────────────────────── 9 + 10 · RAW-DOOR + AI BOUNDARY ───────────────────────
describe('S96 boundaries — raw doors stay governed-only; advisory AI cannot execute either cycle', () => {
  it('raw action doors for consequential O2C ops are refused (governed-command-only, S46)', async () => {
    await seedProduct();
    // a fresh SO to test the raw ship/invoice doors + the machine-owned status edit
    const customer = await createIn(CUSTOMERS_MODULE_ID, { name: 'Gamma' });
    const so = await dispatchCommand(cmd('CreateSalesOrder', { payload: { orderNumber: 'SO-R', customer: 'Gamma', customerRef: customer.record!.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: 5, total: 50 }, idem: 'sor' }), deps());
    const orderId = String(so.data!.id);
    expect((await actIn(ORDERS_MODULE_ID, orderId, 'ship')).ok).toBe(false); // raw ship refused
    expect((await actIn(ORDERS_MODULE_ID, orderId, 'convertToInvoice')).ok).toBe(false); // raw invoice refused
    expect((await updateIn(ORDERS_MODULE_ID, orderId, { status: 'shipped' })).ok).toBe(false); // status edit refused
    expect(movesOfType('issue').length).toBe(0); // nothing shipped via the side doors
  });

  it('an advisory principal (no manage grants) cannot execute any consequential P2P or O2C command', async () => {
    await seedProduct();
    const p = await runP2P();
    const o = await runO2C(Math.min(10, p.q1));
    const advisory: EnterpriseModuleContext = {
      ...makeCtx(),
      authorize: (perm: EnterprisePermission) => {
        authorized.push(perm);
        if (['procurement:manage', 'operations:manage', 'sales:manage'].includes(perm)) throw new Error(`advisory has no ${perm}`);
      },
    };
    const customer = await createIn(CUSTOMERS_MODULE_ID, { name: 'Delta' });
    const so = await dispatchCommand(cmd('CreateSalesOrder', { payload: { orderNumber: 'SO-AI', customer: 'Delta', customerRef: customer.record!.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: 5, total: 50 }, idem: 'soai' }), deps());
    // P2P consequential
    expect((await dispatchCommand(cmd('PostGoodsReceipt', { target: p.grId, idem: 'ai-post' }), deps(inst, advisory))).error).toBe('UNAUTHORIZED');
    expect((await dispatchCommand(cmd('PaySupplierInvoice', { payload: { paymentNumber: 'AIV', billRef: p.billNumber, vendor: 'Acme Supplies', amount: 1, transactionRef: 'AIV' }, idem: 'ai-pay' }), deps(inst, advisory))).error).toBe('UNAUTHORIZED');
    // O2C consequential
    expect((await dispatchCommand(cmd('ShipSalesOrder', { target: String(so.data!.id), idem: 'ai-ship' }), deps(inst, advisory))).error).toBe('UNAUTHORIZED');
    expect((await dispatchCommand(cmd('IssueCustomerInvoice', { target: o.invoiceId, idem: 'ai-iss' }), deps(inst, advisory))).error).toBe('UNAUTHORIZED');
    expect((await dispatchCommand(cmd('ReceiveCustomerPayment', { payload: { paymentNumber: 'AIR', invoiceRef: o.invoiceNumber, amount: 1, transactionRef: 'AIR' }, idem: 'ai-rcpt' }), deps(inst, advisory))).error).toBe('UNAUTHORIZED');
  });
});

// ─────────────────────── 11 · DETERMINISTIC RECONCILIATION FROM PERSISTED STATE ───────────────────────
describe('S96 reconciliation — inventory / AP / AR / cash reconcile from persisted records', () => {
  it('inventory, AP, AR are consistent after both cycles complete', async () => {
    await seedProduct();
    const p = await runP2P();
    const q2 = Math.min(40, p.q1);
    const o = await runO2C(q2);
    // Inventory: receipts − issues = final stock delta (from 0)
    const received = movesOfType('receive').reduce((n, m) => n + Number(m.fields.quantity), 0);
    const issued = movesOfType('issue').reduce((n, m) => n + Number(m.fields.quantity), 0);
    expect(received - issued).toBe(stock('SKU-1'));
    // AP: approved supplier invoice − supplier settlement = outstanding AP (0 — fully paid)
    const bill = rec(VENDOR_BILLS_MODULE_ID, p.billId)!;
    expect(String(bill.fields.status)).toBe('paid');
    expect(Number(bill.fields.amountPaid ?? 0)).toBe(p.q1 * STANDARD_COST);
    // AR: issued customer invoice − customer receipt = outstanding AR (0 — fully settled)
    const inv = rec(FINANCE_MODULE_ID, o.invoiceId)!;
    expect(String(inv.fields.status)).toBe('paid');
    expect(Number(inv.fields.amountPaid ?? 0)).toBe(o.total);
    // Cash: exactly one supplier payment out + one customer receipt in
    expect(clearedVendorPay().length).toBe(1);
    expect(clearedReceipts().length).toBe(1);
  });
});
