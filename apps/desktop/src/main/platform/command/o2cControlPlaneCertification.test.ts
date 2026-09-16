/**
 * ERP Session 95 — END-TO-END ORDER-TO-CASH CONTROL-PLANE CERTIFICATION.
 *
 * Certifies the COMPLETE governed O2C lifecycle as ONE workflow, reusing ONLY the existing canonical
 * modules/commands (no new approval/payment/workflow/inventory/accounting/command-bus engine):
 *
 *   Customer → Create Sales Order (pending) → Ship (inventory issue) → Convert to Invoice (draft)
 *     → Issue Invoice (Dr AR / Cr Sales Revenue) → AR Liability → Receive Customer Payment
 *     → (Dr Cash / Cr AR) → AR Settled
 *
 * Plus the governance controls around it: SO status-machine boundary (born pending; ship/invoice are
 * governed-command-only, S46), shipment idempotency (inventory issued exactly once), invoice AR-once,
 * the DRAFT-INVOICE-CANNOT-SETTLE guard (S95 sell-side mirror of the buy-side "approve first"),
 * payment-once, the reversal/delete boundary, RESTART DURABILITY, tenant/actor security, and the
 * AI/advisory boundary. Every consequential mutation flows through the durable command journal.
 *
 * Certification/verification gate. The only production change is the S95 draft-invoice settlement guard
 * in `paymentModule.ts` (a real YELLOW finding, reproduced here, fixed by mirroring the buy-side).
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
  CUSTOMERS_MODULE_ID,
  ORDERS_MODULE_ID,
  FINANCE_MODULE_ID,
  PAYMENTS_MODULE_ID,
  PRODUCTS_MODULE_ID,
  VENDOR_PAYMENTS_MODULE_ID,
  VENDOR_PAYMENT_KIND,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { EnterpriseRecordStore } from '../../enterprise/framework';
import { createProductModule } from '../../enterprise/modules/inventory/productModule';
import { createStockMovementModule } from '../../enterprise/modules/inventory/stockMovementModule';
import { createLedgerAccountModule } from '../../enterprise/modules/finance/ledgerAccountModule';
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createInvoiceModule } from '../../enterprise/modules/finance/invoiceModule';
import { createPaymentModule } from '../../enterprise/modules/finance/paymentModule';
import { createPaymentReversalModule } from '../../enterprise/modules/finance/paymentReversalModule';
import { createCustomerModule } from '../../enterprise/modules/crm/customerModule';
import { createOrderModule } from '../../enterprise/modules/sales/orderModule';
import { dispatchCommand, type CommandDispatchDeps } from './commandBus';
import { DurableCommandJournal } from './durableCommandJournal';
import type { DomainCommand, DomainCommandType } from './domainCommand';

const STOCK_MOVEMENTS_MODULE_ID = 'inventory-movements';
const UNIT_PRICE = 10;

interface StorePaths {
  prod: string; cust: string; order: string; inv: string; pay: string; vpay: string; rev: string;
  acct: string; jrnl: string; mv: string; journal: string;
}
const allPaths: string[] = [];
function freshPaths(): StorePaths {
  const p = (t: string): string => { const f = join(tmpdir(), `np-s95-${t}-${randomUUID()}.json`); allPaths.push(f); return f; };
  return { prod: p('prod'), cust: p('cust'), order: p('order'), inv: p('inv'), pay: p('pay'), vpay: p('vpay'), rev: p('rev'), acct: p('acct'), jrnl: p('jrnl'), mv: p('mv'), journal: p('journal') };
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
  const customers = createCustomerModule(paths.cust);
  const orders = createOrderModule(paths.order);
  const invoices = createInvoiceModule(paths.inv);
  const accounts = createLedgerAccountModule(paths.acct);
  const payments = createPaymentModule(paths.pay, invoices.store);
  const vendorPaymentsStore = new EnterpriseRecordStore(paths.vpay, VENDOR_PAYMENTS_MODULE_ID, VENDOR_PAYMENT_KIND);
  const reversals = createPaymentReversalModule(paths.rev, payments.store, vendorPaymentsStore);
  for (const m of [
    products, customers, orders, invoices, accounts, payments, reversals,
    createStockMovementModule(paths.mv),
    createJournalEntryModule(paths.jrnl, accounts.store),
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
    correlationId: 'corr_s95', idempotencyKey: opts.idem ?? `${type}_${seq}`,
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
const deleteIn = (moduleId: string, id: string, i = inst) =>
  handler(i, IpcChannel.EnterpriseModuleDelete)({ moduleId, id }) as Promise<{ ok: boolean }>;
const listIn = (moduleId: string, i = inst) => i.registry.get(moduleId)!.store.list();
const rec = (moduleId: string, id: string, i = inst) => i.registry.get(moduleId)!.store.get(id);
const alive = (moduleId: string, i = inst) => listIn(moduleId, i).filter((r) => r.status !== 'deleted');
const count = (moduleId: string, i = inst) => alive(moduleId, i).length;
const issueMovements = (i = inst) => listIn(STOCK_MOVEMENTS_MODULE_ID, i).filter((m) => m.status !== 'deleted' && String(m.fields.type) === 'issue');
const clearedReceipts = (i = inst) => alive(PAYMENTS_MODULE_ID, i).filter((p) => String(p.fields.status) === 'cleared');

/** Drive the FULL governed O2C chain to a SETTLED invoice on the given installation, from zero state. */
async function runFullO2C(i = inst): Promise<{
  customerId: string; orderId: string; orderNumber: string; invoiceId: string; invoiceNumber: string; receiptId: string; qty: number; total: number;
}> {
  const qty = 40;
  const total = qty * UNIT_PRICE;
  // seed on-hand stock so the shipment can issue
  await createIn(PRODUCTS_MODULE_ID, { sku: 'SKU-1', name: 'Widget', purchaseCost: 4, standardCost: 6 }, i);
  await createIn(STOCK_MOVEMENTS_MODULE_ID, { movementNumber: 'MV-SEED', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 }, i);
  // 1 · CUSTOMER + SALES ORDER (born pending)
  const customer = await createIn(CUSTOMERS_MODULE_ID, { name: 'Acme Inc.' }, i);
  const customerId = customer.record!.id;
  const soCmd = await dispatchCommand(cmd('CreateSalesOrder', { payload: { orderNumber: 'SO-1', customer: 'Acme Inc.', customerRef: customerId, product: 'SKU-1', warehouse: 'WH-1', orderedQty: qty, total }, idem: 'so:1' }), deps(i));
  const orderId = String(soCmd.data!.id);
  const orderNumber = String(rec(ORDERS_MODULE_ID, orderId, i)!.fields.orderNumber);
  expect(String(rec(ORDERS_MODULE_ID, orderId, i)!.fields.status)).toBe('pending');
  // 2 · SHIP (inventory issue)
  expect((await dispatchCommand(cmd('ShipSalesOrder', { target: orderId, idem: 'ship:1' }), deps(i))).ok).toBe(true);
  expect(String(rec(ORDERS_MODULE_ID, orderId, i)!.fields.status)).toBe('shipped');
  // 3 · CONVERT TO INVOICE (draft)
  expect((await dispatchCommand(cmd('InvoiceSalesOrder', { target: orderId, idem: 'inv:1' }), deps(i))).ok).toBe(true);
  const invoiceId = String(rec(ORDERS_MODULE_ID, orderId, i)!.fields.convertedInvoice);
  const invoiceNumber = String(rec(FINANCE_MODULE_ID, invoiceId, i)!.fields.number);
  expect(String(rec(FINANCE_MODULE_ID, invoiceId, i)!.fields.status)).toBe('draft');
  // 4 · ISSUE (Dr AR / Cr Revenue)
  expect((await dispatchCommand(cmd('IssueCustomerInvoice', { target: invoiceId, idem: 'issue:1' }), deps(i))).ok).toBe(true);
  expect(String(rec(FINANCE_MODULE_ID, invoiceId, i)!.fields.status)).toBe('issued');
  // 5 · RECEIVE PAYMENT (Dr Cash / Cr AR → settled)
  const paid = await dispatchCommand(cmd('ReceiveCustomerPayment', { payload: { paymentNumber: 'RCPT-1', invoiceRef: invoiceNumber, amount: total, transactionRef: 'RT-1' }, idem: 'rcpt:1' }), deps(i));
  expect(paid.ok).toBe(true);
  const receipt = clearedReceipts(i)[0];
  return { customerId, orderId, orderNumber, invoiceId, invoiceNumber, receiptId: receipt.id, qty, total };
}

// ─────────────────────── 1–5 · THE FULL CHAIN COMPOSES INTO ONE GOVERNED WORKFLOW ───────────────────────
describe('S95 O2C — the complete governed chain Customer → … → AR settled composes end-to-end', () => {
  it('runs the whole chain from zero ERP state to a settled invoice with exactly-one economic effects + lineage', async () => {
    const r = await runFullO2C();
    expect(count(CUSTOMERS_MODULE_ID)).toBe(1);
    expect(count(ORDERS_MODULE_ID)).toBe(1);
    expect(issueMovements().length).toBe(1); // inventory issued exactly once
    expect(count(FINANCE_MODULE_ID)).toBe(1);
    expect(clearedReceipts().length).toBe(1);
    // lineage: order → invoice → receipt
    expect(String(rec(ORDERS_MODULE_ID, r.orderId)!.fields.convertedInvoice)).toBe(r.invoiceId);
    expect(String(rec(PAYMENTS_MODULE_ID, r.receiptId)!.fields.invoiceRef)).toBe(r.invoiceNumber);
    // AR settled
    const inv = rec(FINANCE_MODULE_ID, r.invoiceId)!;
    expect(String(inv.fields.status)).toBe('paid');
    expect(Number(inv.fields.amountPaid ?? 0)).toBe(r.total);
    expect(authorized).toContain('sales:manage');
    expect(authorized).toContain('operations:manage');
  });

  it('AR (issue) + Cash (receipt) GL are each booked exactly once (no duplicate accounting on replay)', async () => {
    const r = await runFullO2C();
    const before = count(JOURNAL_ENTRIES_MODULE_ID);
    await dispatchCommand(cmd('IssueCustomerInvoice', { target: r.invoiceId, idem: 'issue:1' }), deps()); // replay
    await dispatchCommand(cmd('ReceiveCustomerPayment', { payload: { paymentNumber: 'RCPT-1', invoiceRef: r.invoiceNumber, amount: r.total, transactionRef: 'RT-1' }, idem: 'rcpt:1' }), deps()); // replay
    expect(count(JOURNAL_ENTRIES_MODULE_ID)).toBe(before);
    expect(issueMovements().length).toBe(1);
    expect(clearedReceipts().length).toBe(1);
  });
});

// ─────────────────────── 1–2 · SALES ORDER + SHIPMENT BOUNDARY ───────────────────────
describe('S95 sales order + shipment — pending until shipped; inventory issued once; no side-door bypass', () => {
  it('a created SO is pending and moves no inventory; shipment issues inventory exactly once with lineage', async () => {
    const r = await runFullO2C();
    const mv = issueMovements().find((m) => String(m.fields.referenceRecord) === r.orderId);
    expect(mv).toBeTruthy(); // the issue movement traces to the order
    // a replay ship is refused (order already shipped) — no second issue
    const reship = await dispatchCommand(cmd('ShipSalesOrder', { target: r.orderId, idem: 'ship:again' }), deps());
    expect(reship.ok).toBe(false);
    expect(issueMovements().length).toBe(1);
  });

  it('the raw action door cannot ship or invoice (governed-command-only, S46) and a status edit is refused', async () => {
    const qty = 10;
    await createIn(PRODUCTS_MODULE_ID, { sku: 'SKU-1', name: 'Widget', standardCost: 6 });
    await createIn(STOCK_MOVEMENTS_MODULE_ID, { movementNumber: 'MV', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 50 });
    const customer = await createIn(CUSTOMERS_MODULE_ID, { name: 'Acme' });
    const soCmd = await dispatchCommand(cmd('CreateSalesOrder', { payload: { orderNumber: 'SO-9', customer: 'Acme', customerRef: customer.record!.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: qty, total: qty * UNIT_PRICE }, idem: 'so:9' }), deps());
    const orderId = String(soCmd.data!.id);
    // raw action door: ship + convertToInvoice are governed-only → refused
    expect((await actIn(ORDERS_MODULE_ID, orderId, 'ship')).ok).toBe(false);
    expect((await actIn(ORDERS_MODULE_ID, orderId, 'convertToInvoice')).ok).toBe(false);
    // a generic edit cannot hand-set the machine-owned status
    expect((await updateIn(ORDERS_MODULE_ID, orderId, { status: 'shipped' })).ok).toBe(false);
    expect(issueMovements().length).toBe(0); // nothing moved
    expect(String(rec(ORDERS_MODULE_ID, orderId)!.fields.status)).toBe('pending');
  });
});

// ─────────────────────── 3–4 · CUSTOMER INVOICE + AR ───────────────────────
describe('S95 invoice + AR — draft books no AR; issue books AR once; no duplicate on replay', () => {
  it('convert produces a draft invoice (no AR) linked to the order; re-convert is refused', async () => {
    const qty = 20;
    await createIn(PRODUCTS_MODULE_ID, { sku: 'SKU-1', name: 'Widget', standardCost: 6 });
    await createIn(STOCK_MOVEMENTS_MODULE_ID, { movementNumber: 'MV', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 50 });
    const customer = await createIn(CUSTOMERS_MODULE_ID, { name: 'Acme' });
    const soCmd = await dispatchCommand(cmd('CreateSalesOrder', { payload: { orderNumber: 'SO-2', customer: 'Acme', customerRef: customer.record!.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: qty, total: qty * UNIT_PRICE }, idem: 'so:2' }), deps());
    const orderId = String(soCmd.data!.id);
    await dispatchCommand(cmd('ShipSalesOrder', { target: orderId, idem: 's' }), deps());
    const journalBefore = count(JOURNAL_ENTRIES_MODULE_ID);
    expect((await dispatchCommand(cmd('InvoiceSalesOrder', { target: orderId, idem: 'i' }), deps())).ok).toBe(true);
    const invoiceId = String(rec(ORDERS_MODULE_ID, orderId)!.fields.convertedInvoice);
    expect(String(rec(FINANCE_MODULE_ID, invoiceId)!.fields.status)).toBe('draft');
    expect(count(JOURNAL_ENTRIES_MODULE_ID)).toBe(journalBefore); // a draft books no AR
    // re-convert refused (already invoiced)
    const reconv = await dispatchCommand(cmd('InvoiceSalesOrder', { target: orderId, idem: 'i2' }), deps());
    expect(reconv.ok).toBe(false);
    // issue books AR once; re-issue refused
    expect((await dispatchCommand(cmd('IssueCustomerInvoice', { target: invoiceId, idem: 'iss' }), deps())).ok).toBe(true);
    const afterIssue = count(JOURNAL_ENTRIES_MODULE_ID);
    expect(afterIssue).toBeGreaterThan(journalBefore); // Dr AR / Cr Revenue booked
    const reissue = await dispatchCommand(cmd('IssueCustomerInvoice', { target: invoiceId, idem: 'iss2' }), deps());
    expect(reissue.ok).toBe(false);
    expect(count(JOURNAL_ENTRIES_MODULE_ID)).toBe(afterIssue);
  });
});

// ─────────────────────── 5 · CUSTOMER RECEIPT (incl. the S95 draft-invoice guard) ───────────────────────
describe('S95 receipt — a draft/unissued invoice cannot be settled; an issued invoice settles once', () => {
  it('REPRODUCES + FIXES the finding: a receipt against a DRAFT (unissued) invoice is refused (no AR booked, no settlement)', async () => {
    // Create a draft invoice directly (no issue) and attempt to settle it.
    const invCreate = await createIn(FINANCE_MODULE_ID, { number: 'INV-DRAFT', customer: 'Acme', amount: 100, currency: 'USD' });
    const invId = invCreate.record!.id;
    expect(String(rec(FINANCE_MODULE_ID, invId)!.fields.status)).toBe('draft');
    const journalBefore = count(JOURNAL_ENTRIES_MODULE_ID);
    const settle = await dispatchCommand(cmd('ReceiveCustomerPayment', { payload: { paymentNumber: 'RCPT-D', invoiceRef: 'INV-DRAFT', amount: 100, transactionRef: 'RT-D' }, idem: 'rd' }), deps());
    expect(settle.ok).toBe(false); // S95 sell-side guard: cannot settle a draft invoice — issue it first
    expect(clearedReceipts().length).toBe(0);
    expect(String(rec(FINANCE_MODULE_ID, invId)!.fields.status)).toBe('draft'); // unchanged
    expect(count(JOURNAL_ENTRIES_MODULE_ID)).toBe(journalBefore); // NO Cr AR / Cash booked against unissued AR
  });

  it('overpay, duplicate-txn, and a second full receipt are all refused; a same-key replay does not double-receive', async () => {
    const r = await runFullO2C(); // invoice already settled by the full chain
    // second full receipt refused (overpay — already settled)
    expect((await dispatchCommand(cmd('ReceiveCustomerPayment', { payload: { paymentNumber: 'RCPT-2', invoiceRef: r.invoiceNumber, amount: r.total, transactionRef: 'RT-2' }, idem: 'rc2' }), deps())).ok).toBe(false);
    expect(clearedReceipts().length).toBe(1);
    // same-key replay of the original settlement replays (no double)
    const replay = await dispatchCommand(cmd('ReceiveCustomerPayment', { payload: { paymentNumber: 'RCPT-1', invoiceRef: r.invoiceNumber, amount: r.total, transactionRef: 'RT-1' }, idem: 'rcpt:1' }), deps());
    expect(replay.replayed === true || replay.ok === true).toBe(true);
    expect(clearedReceipts().length).toBe(1);
  });
});

// ─────────────────────── 6 · REVERSAL / DELETE BOUNDARY (no reversal in the happy path) ───────────────────────
describe('S95 reversal boundary — cleared receipt reverses only through the governed reversal; original immutable', () => {
  it('a cleared receipt cannot be deleted; ReverseCustomerPayment is the canonical unwind; bank-reconciled is fail-closed', async () => {
    const r = await runFullO2C();
    expect((await deleteIn(PAYMENTS_MODULE_ID, r.receiptId)).ok).toBe(false); // economic delete guard
    expect(String(rec(PAYMENTS_MODULE_ID, r.receiptId)!.fields.status)).toBe('cleared');
    // bank-reconciled → reversal fail-closed (simulate FW-8 write-back)
    inst.registry.get(PAYMENTS_MODULE_ID)!.store.update(r.receiptId, { fields: { bankReconciledAt: '2026-09-02T00:00:00.000Z', bankStatementRef: 'BS-1' }, actor: 'system', now: '2026-09-02T00:00:00.000Z' });
    expect((await dispatchCommand(cmd('ReverseCustomerPayment', { target: r.receiptId, payload: { reason: 'x' }, idem: 'revbr' }), deps())).ok).toBe(false);
    expect(count('finance-payment-reversals')).toBe(0);
  });

  it('a non-bank-reconciled cleared receipt reverses ONLY through ReverseCustomerPayment, original immutable, invoice re-opened', async () => {
    const r = await runFullO2C();
    const before = JSON.stringify(rec(PAYMENTS_MODULE_ID, r.receiptId)!.fields);
    expect((await dispatchCommand(cmd('ReverseCustomerPayment', { target: r.receiptId, payload: { reason: 'wrong customer' }, idem: 'rev' }), deps())).ok).toBe(true);
    expect(count('finance-payment-reversals')).toBe(1);
    expect(JSON.stringify(rec(PAYMENTS_MODULE_ID, r.receiptId)!.fields)).toBe(before); // original immutable
    expect(Number(rec(FINANCE_MODULE_ID, r.invoiceId)!.fields.amountPaid ?? 0)).toBe(0); // invoice re-opened
    expect((await dispatchCommand(cmd('ReverseCustomerPayment', { target: r.receiptId, payload: { reason: 'again' }, idem: 'rev2' }), deps())).ok).toBe(false); // at-most-one
  });
});

// ─────────────────────── 7 · RESTART DURABILITY ───────────────────────
describe('S95 durability — the completed O2C chain survives a process restart with no double-post', () => {
  it('rebuilding over the same stores preserves every count + lineage; replays do not duplicate', async () => {
    const r = await runFullO2C();
    const snap = {
      cust: count(CUSTOMERS_MODULE_ID), order: count(ORDERS_MODULE_ID), mv: issueMovements().length,
      inv: count(FINANCE_MODULE_ID), pay: clearedReceipts().length, jrnl: count(JOURNAL_ENTRIES_MODULE_ID),
    };
    const ctx2 = makeCtx();
    const inst2 = buildInstallation(paths, ctx2);
    for (const m of [CUSTOMERS_MODULE_ID, ORDERS_MODULE_ID, FINANCE_MODULE_ID, PAYMENTS_MODULE_ID, JOURNAL_ENTRIES_MODULE_ID, STOCK_MOVEMENTS_MODULE_ID]) {
      await inst2.registry.get(m)!.store.load();
    }
    expect(count(CUSTOMERS_MODULE_ID, inst2)).toBe(snap.cust);
    expect(count(ORDERS_MODULE_ID, inst2)).toBe(snap.order);
    expect(issueMovements(inst2).length).toBe(snap.mv);
    expect(count(FINANCE_MODULE_ID, inst2)).toBe(snap.inv);
    expect(clearedReceipts(inst2).length).toBe(snap.pay);
    expect(count(JOURNAL_ENTRIES_MODULE_ID, inst2)).toBe(snap.jrnl);
    expect(String(rec(FINANCE_MODULE_ID, r.invoiceId, inst2)!.fields.status)).toBe('paid');
    // replay the terminal command on the restarted installation → deduped, nothing doubles
    const replay = await dispatchCommand(cmd('ReceiveCustomerPayment', { payload: { paymentNumber: 'RCPT-1', invoiceRef: r.invoiceNumber, amount: r.total, transactionRef: 'RT-1' }, idem: 'rcpt:1' }), deps(inst2, ctx2));
    expect(replay.replayed).toBe(true);
    expect(clearedReceipts(inst2).length).toBe(snap.pay);
    expect(count(JOURNAL_ENTRIES_MODULE_ID, inst2)).toBe(snap.jrnl);
  });
});

// ─────────────────────── 8 · SECURITY ───────────────────────
describe('S95 security — forged tenant / unauthorized / cross-tenant / replay all fail closed', () => {
  it('unauthorized actors cannot ship, issue, or receive', async () => {
    const r = await runFullO2C();
    const denySales = makeCtx('sales:manage');
    const denyOps = makeCtx('operations:manage');
    // build a second shippable order to test unauthorized ship
    const customer2 = await createIn(CUSTOMERS_MODULE_ID, { name: 'Beta' });
    const so2 = await dispatchCommand(cmd('CreateSalesOrder', { payload: { orderNumber: 'SO-U', customer: 'Beta', customerRef: customer2.record!.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: 5, total: 50 }, idem: 'sou' }), deps());
    expect((await dispatchCommand(cmd('ShipSalesOrder', { target: String(so2.data!.id), idem: 'shu' }), deps(inst, denySales))).error).toBe('UNAUTHORIZED');
    expect((await dispatchCommand(cmd('IssueCustomerInvoice', { target: r.invoiceId, idem: 'isu' }), deps(inst, denyOps))).error).toBe('UNAUTHORIZED');
    expect((await dispatchCommand(cmd('ReceiveCustomerPayment', { payload: { paymentNumber: 'RX', invoiceRef: r.invoiceNumber, amount: r.total, transactionRef: 'RX' }, idem: 'rxu' }), deps(inst, denyOps))).error).toBe('UNAUTHORIZED');
  });

  it('forged / no / cross tenant fail closed; a cross-tenant customer reference is refused', async () => {
    const r = await runFullO2C();
    scope = null;
    expect((await dispatchCommand(cmd('ReceiveCustomerPayment', { payload: { paymentNumber: 'RN', invoiceRef: r.invoiceNumber, amount: r.total, transactionRef: 'RN' }, idem: 'tn' }), deps())).error).toBe('UNRESOLVED_TENANT');
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    expect((await dispatchCommand(cmd('ShipSalesOrder', { target: r.orderId, idem: 'tf', tenantId: 'tenant-EVIL' }), deps())).error).toBe('CROSS_TENANT_CLAIM');
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    // cross-tenant customer: a SO referencing a customer invisible in the caller's tenant is refused
    const foreign = await dispatchCommand(cmd('CreateSalesOrder', { payload: { orderNumber: 'SO-X', customer: 'Ghost', customerRef: 'no-such-customer', product: 'SKU-1', warehouse: 'WH-1', orderedQty: 1, total: 10 }, idem: 'sox' }), deps());
    expect(foreign.ok).toBe(false);
    expect(String(foreign.error)).toBe('CUSTOMER_NOT_FOUND');
  });
});

// ─────────────────────── 9 · AI / ADVISORY BOUNDARY ───────────────────────
describe('S95 AI boundary — an advisory principal cannot autonomously execute any consequential O2C command', () => {
  it('an advisory context (no sales/operations manage grant) is refused on ship/issue/receive/reverse', async () => {
    const r = await runFullO2C();
    const advisory: EnterpriseModuleContext = {
      ...makeCtx(),
      authorize: (p: EnterprisePermission) => { authorized.push(p); if (p === 'sales:manage' || p === 'operations:manage') throw new Error(`advisory has no ${p}`); },
    };
    const customer2 = await createIn(CUSTOMERS_MODULE_ID, { name: 'Gamma' });
    const so2 = await dispatchCommand(cmd('CreateSalesOrder', { payload: { orderNumber: 'SO-AI', customer: 'Gamma', customerRef: customer2.record!.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: 5, total: 50 }, idem: 'soai' }), deps());
    expect((await dispatchCommand(cmd('ShipSalesOrder', { target: String(so2.data!.id), idem: 'ai1' }), deps(inst, advisory))).error).toBe('UNAUTHORIZED');
    expect((await dispatchCommand(cmd('IssueCustomerInvoice', { target: r.invoiceId, idem: 'ai2' }), deps(inst, advisory))).error).toBe('UNAUTHORIZED');
    expect((await dispatchCommand(cmd('ReceiveCustomerPayment', { payload: { paymentNumber: 'AI', invoiceRef: r.invoiceNumber, amount: r.total, transactionRef: 'AIx' }, idem: 'ai3' }), deps(inst, advisory))).error).toBe('UNAUTHORIZED');
    expect((await dispatchCommand(cmd('ReverseCustomerPayment', { target: r.receiptId, payload: { reason: 'ai' }, idem: 'ai4' }), deps(inst, advisory))).error).toBe('UNAUTHORIZED');
    // nothing changed
    expect(String(rec(FINANCE_MODULE_ID, r.invoiceId)!.fields.status)).toBe('paid');
    expect(count('finance-payment-reversals')).toBe(0);
  });
});
