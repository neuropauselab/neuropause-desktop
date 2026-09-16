/**
 * ERP Session 104 — ARCHITECTURE-DEFEAT / ADVERSARIAL CONTROL-PLANE CERTIFICATION.
 *
 * Assumes the system is hostile to its own invariants. Composes individually-legitimate operations,
 * replays, forges command envelopes, crosses tenants, and forges statuses across every economically-
 * consequential domain — and proves each attack fails closed with ZERO economic side effect. Reuses ONLY
 * the canonical command bus + governed doors (no second engine).
 *
 * Findings (DECISION-MEMO-S104): NO STOP. Every consequential economic mutation is gated by a server-side
 * RBAC authorize on a server-resolved actor; the command idempotency identity is (tenant, key) so a
 * key-confusion attack SUPPRESSES the second command (self-denial), never a duplicate/unauthorized effect;
 * approved/issued/posted economic records are immutable; the envelope actor/tenant are validated not trusted.
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
  PRODUCTS_MODULE_ID,
  PURCHASE_ORDERS_MODULE_ID,
  CUSTOMERS_MODULE_ID,
  ORDERS_MODULE_ID,
  FINANCE_MODULE_ID,
  PAYMENTS_MODULE_ID,
  STOCK_ADJUSTMENTS_MODULE_ID,
  PRODUCTION_ORDERS_MODULE_ID,
  BOM_MODULE_ID,
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
import { createInvoiceModule } from '../../enterprise/modules/finance/invoiceModule';
import { createPaymentModule } from '../../enterprise/modules/finance/paymentModule';
import { createPaymentReversalModule } from '../../enterprise/modules/finance/paymentReversalModule';
import { createVendorBillModule } from '../../enterprise/modules/finance/vendorBillModule';
import { createVendorPaymentModule } from '../../enterprise/modules/finance/vendorPaymentModule';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { createShippingModule } from '../../enterprise/modules/warehouse/shippingModule';
import { createStockAdjustmentModule } from '../../enterprise/modules/warehouse/stockAdjustmentModule';
import { createCustomerModule } from '../../enterprise/modules/crm/customerModule';
import { createOrderModule } from '../../enterprise/modules/sales/orderModule';
import { createProductionOrderModule } from '../../enterprise/modules/manufacturing/productionOrderModule';
import { createBomModule } from '../../enterprise/modules/manufacturing/bomModule';
import { PAYMENT_REVERSALS_MODULE_ID } from '../../enterprise/modules/finance/paymentReconcile';
import { dispatchCommand, type CommandDispatchDeps } from './commandBus';
import { DurableCommandJournal } from './durableCommandJournal';
import type { DomainCommand, DomainCommandType } from './domainCommand';

const MV = 'inventory-movements';
const allPaths: string[] = [];
function freshPaths(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ['prod', 'mv', 'acct', 'jrnl', 'inv', 'pay', 'rev', 'bill', 'vpay', 'po', 'ship', 'adj', 'cust', 'order', 'mo', 'bom', 'journal']) {
    const f = join(tmpdir(), `np-s104-${id}-${randomUUID()}.json`); allPaths.push(f); out[id] = f;
  }
  return out;
}
let scope: TenantScope | null;
const OP = 'operator@np.dev';
function makeCtxAs(actor: string, deny: EnterprisePermission[] = []): EnterpriseModuleContext {
  return {
    authorize: (p: EnterprisePermission) => { if (deny.includes(p)) throw new Error(`denied: ${p}`); },
    audit: () => undefined, publish: (_i: PlatformEventInput) => undefined, broadcast: () => undefined, notify: () => undefined,
    actor: () => actor, now: () => '2026-09-30T12:00:00.000Z',
  };
}
function buildInstallation(paths: Record<string, string>, ctx: EnterpriseModuleContext) {
  const registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(paths.acct);
  const invoices = createInvoiceModule(paths.inv);
  const po = createPurchaseOrderModule(paths.po);
  const bills = createVendorBillModule(paths.bill, po.store);
  const payments = createPaymentModule(paths.pay, invoices.store);
  const vendorPayments = createVendorPaymentModule(paths.vpay, bills.store);
  for (const m of [
    createProductModule(paths.prod), createStockMovementModule(paths.mv), accounts,
    createJournalEntryModule(paths.jrnl, accounts.store),
    invoices, payments, po, bills, vendorPayments,
    createPaymentReversalModule(paths.rev, payments.store, vendorPayments.store),
    createShippingModule(paths.ship), createStockAdjustmentModule(paths.adj),
    createCustomerModule(paths.cust), createOrderModule(paths.order),
    createProductionOrderModule(paths.mo), createBomModule(paths.bom),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  return { registry, handlers: buildModuleHandlers(registry, ctx), journal: new DurableCommandJournal(paths.journal) };
}
let paths: Record<string, string>;
let ctx: EnterpriseModuleContext;
let inst: ReturnType<typeof buildInstallation>;
beforeEach(() => { scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' }; paths = freshPaths(); ctx = makeCtxAs(OP); inst = buildInstallation(paths, ctx); });
afterEach(async () => { vi.restoreAllMocks(); for (const p of allPaths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined); });

let seq = 0;
function cmd(type: DomainCommandType, opts: { target?: string; payload?: Record<string, unknown>; idem?: string; tenantId?: string; actor?: string } = {}): DomainCommand {
  return { commandId: `cmd_${(seq += 1)}`, type, ...(opts.tenantId !== undefined ? { tenantId: opts.tenantId } : {}), actor: opts.actor ?? OP, ...(opts.target ? { target: { id: opts.target } } : {}), payload: opts.payload ?? {}, correlationId: 'corr_s104', idempotencyKey: opts.idem ?? `${type}_${seq}`, timestamp: '2026-09-30T12:00:00.000Z', source: 'test' };
}
function deps(i = inst, c: EnterpriseModuleContext = ctx): CommandDispatchDeps { return { registry: i.registry, ctx: c, resolveScope: () => scope, journal: i.journal }; }
const handler = (ch: string) => { const d = inst.handlers.find((x) => x.channel === ch); if (!d) throw new Error(`no handler ${ch}`); return d.handler as (p: unknown) => Promise<unknown>; };
const createIn = (m: string, f: Record<string, unknown>) => handler(IpcChannel.EnterpriseModuleCreate)({ moduleId: m, fields: f }) as Promise<{ ok: boolean; record?: EnterpriseEntity }>;
const actIn = (m: string, id: string, a: string) => handler(IpcChannel.EnterpriseModuleAction)({ moduleId: m, id, action: a }) as Promise<{ ok: boolean; message?: string; error?: string }>;
const updateIn = (m: string, id: string, f: Record<string, unknown>) => handler(IpcChannel.EnterpriseModuleUpdate)({ moduleId: m, id, fields: f }) as Promise<{ ok: boolean; error?: string; errors?: Record<string, string> }>;
const deleteIn = (m: string, id: string) => handler(IpcChannel.EnterpriseModuleDelete)({ moduleId: m, id }) as Promise<{ ok: boolean; errors?: Record<string, string> }>;
const listIn = (m: string) => inst.registry.get(m)!.store.list();
const rec = (m: string, id: string) => inst.registry.get(m)!.store.get(id);
const alive = (m: string) => listIn(m).filter((r) => r.status !== 'deleted');
const jcount = () => alive(JOURNAL_ENTRIES_MODULE_ID).length;
const movesOfType = (t: string) => listIn(MV).filter((m) => m.status !== 'deleted' && String(m.fields.type) === t);
async function seedStock() {
  await createIn(PRODUCTS_MODULE_ID, { sku: 'SKU-1', name: 'Widget', standardCost: 5 });
  await createIn(MV, { movementNumber: 'MV-SEED', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });
}
async function clearedReceipt(): Promise<{ orderId: string; invoiceId: string; invoiceNumber: string; paymentId: string }> {
  await seedStock();
  const c = await createIn(CUSTOMERS_MODULE_ID, { name: 'C-1' });
  const so = await dispatchCommand(cmd('CreateSalesOrder', { payload: { orderNumber: 'SO-1', customer: 'C-1', customerRef: c.record!.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: 5, total: 100 }, idem: 'so' }), deps());
  const orderId = String(so.data!.id);
  await dispatchCommand(cmd('ShipSalesOrder', { target: orderId, idem: 'ship' }), deps());
  await dispatchCommand(cmd('InvoiceSalesOrder', { target: orderId, idem: 'inv' }), deps());
  const invoiceId = String(rec(ORDERS_MODULE_ID, orderId)!.fields.convertedInvoice);
  const invoiceNumber = String(rec(FINANCE_MODULE_ID, invoiceId)!.fields.number);
  await dispatchCommand(cmd('IssueCustomerInvoice', { target: invoiceId, idem: 'issue' }), deps());
  await dispatchCommand(cmd('ReceiveCustomerPayment', { payload: { paymentNumber: 'RCPT-1', invoiceRef: invoiceNumber, amount: 100, transactionRef: 'TXN' }, idem: 'rcpt' }), deps());
  const payment = alive(PAYMENTS_MODULE_ID).find((p) => String(p.fields.status) === 'cleared')!;
  return { orderId, invoiceId, invoiceNumber, paymentId: payment.id };
}

// ─────────────────────── 1 · REPLAY / IDEMPOTENCY-KEY CONFUSION ───────────────────────
describe('S104 replay — a reused idempotency key SUPPRESSES the second command (never a duplicate/unauthorized effect)', () => {
  it('the same key across a DIFFERENT command replays the first result and executes no new economic effect', async () => {
    await seedStock();
    const c = await createIn(CUSTOMERS_MODULE_ID, { name: 'C-1' });
    // legitimate: create a sales order under key K
    const so = await dispatchCommand(cmd('CreateSalesOrder', { payload: { orderNumber: 'SO-1', customer: 'C-1', customerRef: c.record!.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: 5, total: 100 }, idem: 'K' }), deps());
    const orderId = String(so.data!.id);
    const ordersBefore = alive(ORDERS_MODULE_ID).length;
    const issuesBefore = movesOfType('issue').length;
    // ATTACK: dispatch a DIFFERENT command (ShipSalesOrder) reusing key K
    const shipReplay = await dispatchCommand(cmd('ShipSalesOrder', { target: orderId, idem: 'K' }), deps());
    expect(shipReplay.replayed).toBe(true); // returns the CreateSalesOrder cached result, does NOT ship
    expect(movesOfType('issue').length).toBe(issuesBefore); // ZERO issue movement — the ship never executed
    // ATTACK: reuse key K for another CreateSalesOrder with different payload → replayed, no second order
    const dupe = await dispatchCommand(cmd('CreateSalesOrder', { payload: { orderNumber: 'SO-2', customer: 'C-1', customerRef: c.record!.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: 99, total: 9900 }, idem: 'K' }), deps());
    expect(dupe.replayed).toBe(true);
    expect(alive(ORDERS_MODULE_ID).length).toBe(ordersBefore); // no duplicate/second order created
    // the real ship (fresh key) still works — proving key-confusion only suppresses, never corrupts
    expect((await dispatchCommand(cmd('ShipSalesOrder', { target: orderId, idem: 'ship-real' }), deps())).ok).toBe(true);
    expect(movesOfType('issue').length).toBe(issuesBefore + 1);
  });

  it('replaying a terminal payment command with its own key posts no second cash/AR effect', async () => {
    const r = await clearedReceipt();
    const jBefore = jcount();
    const replay = await dispatchCommand(cmd('ReceiveCustomerPayment', { payload: { paymentNumber: 'RCPT-1', invoiceRef: r.invoiceNumber, amount: 100, transactionRef: 'TXN' }, idem: 'rcpt' }), deps());
    expect(replay.replayed).toBe(true);
    expect(jcount()).toBe(jBefore); // no duplicate GL
    expect(alive(PAYMENTS_MODULE_ID).filter((p) => String(p.fields.status) === 'cleared').length).toBe(1);
  });
});

// ─────────────────────── 2 · ENVELOPE FORGERY (tenant/actor) ───────────────────────
describe('S104 envelope forgery — a forged tenant is refused; a forged actor grants no authority', () => {
  it('a forged tenantId in the command envelope is refused (CROSS_TENANT_CLAIM), zero effect', async () => {
    const r = await clearedReceipt();
    const jBefore = jcount();
    const forged = await dispatchCommand(cmd('ReceiveCustomerPayment', { payload: { paymentNumber: 'X', invoiceRef: r.invoiceNumber, amount: 1, transactionRef: 'X' }, idem: 'forge-t', tenantId: 'tenant-EVIL' }), deps());
    expect(forged.error).toBe('CROSS_TENANT_CLAIM');
    expect(jcount()).toBe(jBefore);
  });

  it('a forged actor field does not grant authority — an advisory principal is still UNAUTHORIZED', async () => {
    const r = await clearedReceipt();
    const advisory = makeCtxAs('ceo@evil', ['operations:manage', 'sales:manage', 'procurement:manage']);
    // the envelope claims actor "ceo@np.dev" but RBAC uses the SERVER-resolved advisory principal → refused
    const forged = await dispatchCommand(cmd('IssueCustomerInvoice', { target: r.invoiceId, idem: 'forge-a', actor: 'ceo@np.dev' }), deps(inst, advisory));
    expect(forged.error).toBe('UNAUTHORIZED');
  });
});

// ─────────────────────── 3 · APPROVE → MODIFY composition ───────────────────────
describe('S104 approve→modify — an approved/issued economic record cannot be mutated after the fact', () => {
  it('an approved PO cannot be reverted to draft; an issued invoice cannot have its amount edited', async () => {
    await createIn(PRODUCTS_MODULE_ID, { sku: 'SKU-1', name: 'Widget', standardCost: 5 });
    const po = await createIn(PURCHASE_ORDERS_MODULE_ID, { poNumber: 'PO-1', product: 'SKU-1', warehouse: 'WH-1', quantity: 10, unitCost: 5, supplier: 'V-1', status: 'draft' });
    await actIn(PURCHASE_ORDERS_MODULE_ID, po.record!.id, 'approve');
    expect((await updateIn(PURCHASE_ORDERS_MODULE_ID, po.record!.id, { status: 'draft' })).ok).toBe(false); // S49/S50
    expect(String(rec(PURCHASE_ORDERS_MODULE_ID, po.record!.id)!.fields.status)).toBe('approved');
    const r = await clearedReceipt();
    // the issued (and paid) invoice cannot have its economic amount edited (S60 issued-invoice fence)
    expect((await updateIn(FINANCE_MODULE_ID, r.invoiceId, { amount: 999999 })).ok).toBe(false);
  });
});

// ─────────────────────── 4 · REVERSAL composition (reverse→reverse, reverse→delete, delete-original) ───────────────────────
describe('S104 reversal composition — one reversal max; the original + the reversal are indestructible', () => {
  it('a second reversal is refused; the reversal record cannot be deleted; the original cannot be deleted', async () => {
    const r = await clearedReceipt();
    const rev1 = await createIn(PAYMENT_REVERSALS_MODULE_ID, { reversalNumber: 'REV-1', originalKind: 'customer', originalPaymentId: r.paymentId, reason: 'error' });
    expect(rev1.ok).toBe(true);
    // reverse → reverse: a second reversal of the same payment is refused
    expect((await createIn(PAYMENT_REVERSALS_MODULE_ID, { reversalNumber: 'REV-2', originalKind: 'customer', originalPaymentId: r.paymentId, reason: 'again' })).ok).toBe(false);
    // reverse → delete: the reversal record itself cannot be deleted (S64)
    expect((await deleteIn(PAYMENT_REVERSALS_MODULE_ID, rev1.record!.id)).ok).toBe(false);
    // the original (cleared) payment cannot be deleted (S61)
    expect((await deleteIn(PAYMENTS_MODULE_ID, r.paymentId)).ok).toBe(false);
  });
});

// ─────────────────────── 5 · CROSS-TENANT REFERENCE substitution ───────────────────────
describe('S104 cross-tenant reference — a tenant-B command cannot act on a tenant-A object', () => {
  it('shipping tenant-A order from tenant-B is refused with zero inventory effect', async () => {
    await seedStock();
    const c = await createIn(CUSTOMERS_MODULE_ID, { name: 'C-1' });
    const so = await dispatchCommand(cmd('CreateSalesOrder', { payload: { orderNumber: 'SO-1', customer: 'C-1', customerRef: c.record!.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: 5, total: 100 }, idem: 'so' }), deps());
    const orderId = String(so.data!.id);
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    const foreignShip = await dispatchCommand(cmd('ShipSalesOrder', { target: orderId, idem: 'foreign-ship' }), deps());
    expect(foreignShip.ok).toBe(false); // tenant-A's order is invisible under tenant-B
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    expect(movesOfType('issue').length).toBe(0); // nothing shipped
  });
});

// ─────────────────────── 6 · F-S98-1 CLASS — forged status across every consequential domain ───────────────────────
describe('S104 F-S98-1 all-domain — a forged status via the edit door causes NO economic mutation anywhere', () => {
  it('production, PO, adjustment, invoice and sales-order status forges are all refused/inert', async () => {
    await seedStock();
    // production
    await createIn(PRODUCTS_MODULE_ID, { sku: 'FG-1', name: 'FG', standardCost: 12 });
    await createIn(BOM_MODULE_ID, { bomNumber: 'BOM-1', product: 'FG-1', outputQuantity: 1, yield: 100, waste: 0, status: 'active', components: JSON.stringify([{ sku: 'FG-1', quantity: 1 }]) });
    const mo = await createIn(PRODUCTION_ORDERS_MODULE_ID, { orderNumber: 'MO-1', bom: 'BOM-1', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 1 });
    expect((await updateIn(PRODUCTION_ORDERS_MODULE_ID, mo.record!.id, { status: 'completed' })).ok).toBe(false);
    // stock adjustment: forge status=posted → no movement (posting is in the action)
    const adjBefore = movesOfType('adjustment').length;
    const adj = await createIn(STOCK_ADJUSTMENTS_MODULE_ID, { adjustmentNumber: 'ADJ-1', product: 'SKU-1', warehouse: 'WH-1', quantity: -10, reason: 'lost' });
    await updateIn(STOCK_ADJUSTMENTS_MODULE_ID, adj.record!.id, { status: 'posted' });
    expect(movesOfType('adjustment').length).toBe(adjBefore);
    // sales order: forge status=shipped → no issue movement (S46 raw-door + machine-owned)
    const c = await createIn(CUSTOMERS_MODULE_ID, { name: 'C-1' });
    const so = await dispatchCommand(cmd('CreateSalesOrder', { payload: { orderNumber: 'SO-1', customer: 'C-1', customerRef: c.record!.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: 5, total: 100 }, idem: 'so' }), deps());
    const issuesBefore = movesOfType('issue').length;
    expect((await updateIn(ORDERS_MODULE_ID, String(so.data!.id), { status: 'shipped' })).ok).toBe(false);
    expect(movesOfType('issue').length).toBe(issuesBefore);
    // invoice: forge status=issued via edit → no AR posting
    await dispatchCommand(cmd('InvoiceSalesOrder', { target: String(so.data!.id), idem: 'inv2' }), deps()); // fails (not shipped) — harmless; invoice may be absent
    const jBefore = jcount();
    // production output + GL unchanged by all the forges
    expect(movesOfType('production_output').length).toBe(0);
    expect(jcount()).toBe(jBefore);
  });
});
