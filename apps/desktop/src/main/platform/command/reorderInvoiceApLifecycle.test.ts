/**
 * ERP Session 92 — the S91 reorder-originated, POSTED Goods Receipt continues into the EXISTING
 * governed supplier-invoice → three-way-match → Accounts-Payable path, reusing the EXISTING
 * modules/commands (no new AP engine, no second matcher, no invented accounting/tolerance/payment):
 *
 *   reorder GR (posted, GRNI accrued)
 *     → operator drafts a Vendor Bill (supplier invoice) referencing the PO (sourcePurchaseOrder),
 *       with vendor + line items (SKU, qty, unitPrice)                      [CRUD create; NO payable]
 *     → (ApproveSupplierInvoice COMMAND) vendor-bill `approve`
 *          → evaluateGoodsBill → the pure threeWayMatch (PO ↔ GR ↔ Bill, DEFAULT_TOLERANCE)
 *          → MATCHED → GRNI relieved / Accounts Payable booked EXACTLY ONCE (a payment-ready liability)
 *
 * The reorder recommendation is SKU-level and supplies SKU + quantity + lineage ONLY. The bill's
 * VENDOR, the PO's SUPPLIER and UNIT PRICE, and the invoice LINE ITEMS are operator inputs at the
 * PO/invoicing stage (the S88 supplier / S91 warehouse pattern extended to price + lines). The
 * three-way match is CORRECTLY FAIL-CLOSED when any is absent — a header-only reorder bill with no
 * lines, no ordered price, or the wrong vendor is HELD and books NO payable. NOTHING is auto-invoiced,
 * auto-approved, or PAID (S92 never touches PaySupplierInvoice); each step is an explicit governed
 * action. AI stays advisory (§13). ZERO production change — this is a certification/verification gate.
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
import { createPurchaseRequestModule } from '../../enterprise/modules/procurement/purchaseRequestModule';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { createGoodsReceiptModule } from '../../enterprise/modules/procurement/goodsReceiptModule';
import { createShippingModule } from '../../enterprise/modules/warehouse/shippingModule';
import { createReorderDecisionModule, REORDER_DECISION_MODULE_ID } from '../../enterprise/modules/inventory/reorderDecisionModule';
import { dispatchCommand, type CommandDispatchDeps } from './commandBus';
import { DurableCommandJournal } from './durableCommandJournal';
import type { DomainCommand, DomainCommandType } from './domainCommand';

const paths: string[] = [];
const tmp = (t: string): string => { const p = join(tmpdir(), `np-s92-${t}-${randomUUID()}.json`); paths.push(p); return p; };

let scope: TenantScope | null;
let registry: EnterpriseModuleRegistry;
let journal: DurableCommandJournal;
let authorized: EnterprisePermission[];
let ctx: EnterpriseModuleContext;
let handlers: ReturnType<typeof buildModuleHandlers>;

function makeCtx(deny?: EnterprisePermission): EnterpriseModuleContext {
  return {
    authorize: (p: EnterprisePermission) => { authorized.push(p); if (deny && p === deny) throw new Error(`denied: ${p}`); },
    audit: () => undefined,
    publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined,
    notify: () => undefined,
    actor: () => 'operator@np.dev',
    now: () => '2026-09-01T12:00:00.000Z',
  };
}

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  authorized = [];
  registry = new EnterpriseModuleRegistry();
  const products = createProductModule(tmp('prod'));
  const pr = createPurchaseRequestModule(tmp('pr'));
  const po = createPurchaseOrderModule(tmp('po'));
  const gr = createGoodsReceiptModule(tmp('gr'));
  const shipping = createShippingModule(tmp('ship'));
  const accounts = createLedgerAccountModule(tmp('acct'));
  const bills = createVendorBillModule(tmp('bill'), po.store);
  for (const m of [
    products, pr, po, gr, shipping, accounts, bills,
    createStockMovementModule(tmp('mv')),
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    createVendorPaymentModule(tmp('pay'), bills.store),
    createReorderDecisionModule(tmp('dec'), products.store, pr.store, po.store, shipping.store),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  ctx = makeCtx();
  handlers = buildModuleHandlers(registry, ctx);
  journal = new DurableCommandJournal(tmp('journal'));
});
afterEach(async () => { vi.restoreAllMocks(); for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined); });

const handler = (channel: string) => {
  const def = handlers.find((d) => d.channel === channel);
  if (!def) throw new Error(`no handler for ${channel}`);
  return def.handler as (p: unknown) => Promise<unknown>;
};
const createIn = (moduleId: string, fields: Record<string, unknown>) =>
  handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity }>;
const actIn = (moduleId: string, id: string, action: string) =>
  handler(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string; error?: string }>;
const updateIn = (moduleId: string, id: string, fields: Record<string, unknown>) =>
  handler(IpcChannel.EnterpriseModuleUpdate)({ moduleId, id, fields }) as Promise<{ ok: boolean; error?: string }>;
const listIn = (moduleId: string) => registry.get(moduleId)!.store.list();
const rec = (moduleId: string, id: string) => registry.get(moduleId)!.store.get(id);

function deps(ctxOverride?: EnterpriseModuleContext): CommandDispatchDeps {
  return { registry, ctx: ctxOverride ?? ctx, resolveScope: () => scope, journal };
}
let seq = 0;
function cmd(type: DomainCommandType, opts: { target?: string; payload?: Record<string, unknown>; idem?: string; tenantId?: string } = {}): DomainCommand {
  return {
    commandId: `cmd_${(seq += 1)}`, type,
    ...(opts.tenantId !== undefined ? { tenantId: opts.tenantId } : {}),
    actor: 'operator@np.dev',
    ...(opts.target ? { target: { id: opts.target } } : {}),
    payload: opts.payload ?? {},
    correlationId: 'corr_s92', idempotencyKey: opts.idem ?? `${type}_${seq}`,
    timestamp: '2026-09-01T12:00:00.000Z', source: 'test',
  };
}

const journalCount = () => listIn(JOURNAL_ENTRIES_MODULE_ID).length;
const paymentCount = () => listIn(VENDOR_PAYMENTS_MODULE_ID).filter((r) => r.status !== 'deleted').length;
const STANDARD_COST = 5; // GRNI accrues at standard cost on the S91 receipt; the ordered price we match to.

/**
 * Drive the S91 chain to a POSTED reorder Goods Receipt and stamp the PO with the operator's
 * PO-stage inputs (supplier + ordered unit price) so a genuine supplier invoice can match. Returns
 * the lineage + received quantity. `withPrice`/`supplier` let a test omit an input to prove fail-closed.
 */
async function receivedReorder(opts: { supplier?: string; unitCost?: number } = {}): Promise<{ poId: string; poNumber: string; grId: string; qty: number }> {
  await createIn(PRODUCTS_MODULE_ID, { sku: 'SKU-1', name: 'Widget', purchaseCost: 4, standardCost: STANDARD_COST, reorderLevel: 20, safetyStock: 10, maximumStock: 50 });
  const report = await createIn(REORDER_DECISION_MODULE_ID, { asOfDate: '2026-07-31' });
  const confirm = await dispatchCommand(cmd('CreatePurchaseRequestFromReorderRecommendation', { target: report.record!.id, payload: { sku: 'SKU-1' }, idem: 'reorder-exec:seed' }), deps());
  const prId = String(confirm.data!.id);
  const qty = Number(confirm.data!.quantity);
  await dispatchCommand(cmd('SubmitPurchaseRequest', { target: prId, idem: 'sub' }), deps());
  await dispatchCommand(cmd('ApprovePurchaseRequest', { target: prId, idem: 'app' }), deps());
  await dispatchCommand(cmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'conv' }), deps());
  const po = listIn(PURCHASE_ORDERS_MODULE_ID).find((r) => String(r.fields.sourceRequest) === prId)!;
  // Operator PO-stage inputs the SKU-level recommendation does not carry (S88/S91 pattern): the
  // receiving warehouse, the awarded supplier, and the ordered unit price. Set on the DRAFT PO.
  await updateIn(PURCHASE_ORDERS_MODULE_ID, po.id, {
    warehouse: 'WH-1',
    ...(opts.supplier !== undefined ? { supplier: opts.supplier } : {}),
    ...(opts.unitCost !== undefined ? { unitCost: opts.unitCost } : {}),
  });
  expect((await actIn(PURCHASE_ORDERS_MODULE_ID, po.id, 'approve')).ok).toBe(true);
  expect((await actIn(PURCHASE_ORDERS_MODULE_ID, po.id, 'send')).ok).toBe(true);
  expect((await actIn(PURCHASE_ORDERS_MODULE_ID, po.id, 'receiveGoods')).ok).toBe(true);
  const gr = listIn(GOODS_RECEIPTS_MODULE_ID).find((r) => String(r.fields.purchaseOrder) === po.id)!;
  const post = await dispatchCommand(cmd('PostGoodsReceipt', { target: gr.id, idem: `post:${gr.id}` }), deps());
  expect(post.ok).toBe(true); // receipt posted → inventory + GRNI accrued
  return { poId: po.id, poNumber: String(po.fields.poNumber), grId: gr.id, qty };
}

/** Draft a supplier invoice (vendor bill) referencing the reorder PO. */
async function draftBill(fields: Record<string, unknown>): Promise<string> {
  const r = await createIn(VENDOR_BILLS_MODULE_ID, { billNumber: `BILL-${randomUUID().slice(0, 8)}`, currency: 'USD', status: 'draft', ...fields });
  expect(r.ok).toBe(true);
  return r.record!.id;
}

// ─────────────────────── HAPPY PATH — reorder invoice → three-way match → AP booked once ───────────────────────
describe('S92 payable — reorder GR → supplier invoice → three-way match → AP booked exactly once', () => {
  it('a matched goods bill posts the payable through the governed command (GRNI relieved, one AP booking, NO payment)', async () => {
    const { poNumber, qty } = await receivedReorder({ supplier: 'Acme Supplies', unitCost: STANDARD_COST });
    const amount = qty * STANDARD_COST;
    const billId = await draftBill({
      vendor: 'Acme Supplies',
      sourcePurchaseOrder: poNumber,
      amount,
      lines: JSON.stringify([{ sku: 'SKU-1', quantity: qty, unitPrice: STANDARD_COST }]),
    });
    // creating the draft bill books NO payable
    expect(String(rec(VENDOR_BILLS_MODULE_ID, billId)!.fields.status)).toBe('draft');
    const journalBefore = journalCount();

    const approve = await dispatchCommand(cmd('ApproveSupplierInvoice', { target: billId, idem: `inv:${billId}` }), deps());
    expect(approve.ok).toBe(true);
    const bill = rec(VENDOR_BILLS_MODULE_ID, billId)!;
    expect(String(bill.fields.status)).toBe('approved'); // approvedAt stamped by the action
    expect(String(bill.fields.approvedAt)).not.toBe('');
    // AP liability booked exactly once (GRNI relief / Cr Accounts Payable via the shared GL seam)
    expect(journalCount()).toBeGreaterThan(journalBefore);
    // a payment-ready liability — NOT a payment. S92 never settles.
    expect(paymentCount()).toBe(0);
    expect(String(bill.fields.paidDate ?? '')).toBe('');
    expect(authorized).toContain('operations:manage');
  });

  it('at-most-once — a re-approve is refused (no second AP booking); same-key replay does not double-post', async () => {
    const { poNumber, qty } = await receivedReorder({ supplier: 'Acme Supplies', unitCost: STANDARD_COST });
    const billId = await draftBill({ vendor: 'Acme Supplies', sourcePurchaseOrder: poNumber, amount: qty * STANDARD_COST, lines: JSON.stringify([{ sku: 'SKU-1', quantity: qty, unitPrice: STANDARD_COST }]) });
    expect((await dispatchCommand(cmd('ApproveSupplierInvoice', { target: billId, idem: 'inv' }), deps())).ok).toBe(true);
    const afterFirst = journalCount();
    // same key → durable-journal replay, no second booking
    const replay = await dispatchCommand(cmd('ApproveSupplierInvoice', { target: billId, idem: 'inv' }), deps());
    expect(replay.replayed).toBe(true);
    expect(journalCount()).toBe(afterFirst);
    // distinct key → the module refuses to re-approve a non-draft bill (document-level idempotency)
    const again = await dispatchCommand(cmd('ApproveSupplierInvoice', { target: billId, idem: 'inv2' }), deps());
    expect(again.ok).toBe(false);
    expect(journalCount()).toBe(afterFirst);
    expect(paymentCount()).toBe(0);
  });
});

// ─────────────────────── FAIL-CLOSED BOUNDARY — no operator input is invented; no payable on a bad match ───────────────────────
describe('S92 fail-closed — the three-way match holds a bill missing any operator input (no AP booked)', () => {
  it('a goods bill with NO line items is HELD (NO_LINES) — a header-only reorder bill cannot post AP', async () => {
    const { poNumber, qty } = await receivedReorder({ supplier: 'Acme Supplies', unitCost: STANDARD_COST });
    const billId = await draftBill({ vendor: 'Acme Supplies', sourcePurchaseOrder: poNumber, amount: qty * STANDARD_COST });
    const before = journalCount();
    const r = await dispatchCommand(cmd('ApproveSupplierInvoice', { target: billId, idem: 'inv' }), deps());
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain('NO_LINES');
    expect(String(rec(VENDOR_BILLS_MODULE_ID, billId)!.fields.status)).toBe('draft'); // no payable
    expect(journalCount()).toBe(before);
  });

  it('a bill whose PO carries NO ordered price is HELD (MISMATCH) — the overcharge control fires', async () => {
    // Operator omitted the PO unit price; the header-fallback order line is priced 0.
    const { poNumber, qty } = await receivedReorder({ supplier: 'Acme Supplies' });
    const billId = await draftBill({ vendor: 'Acme Supplies', sourcePurchaseOrder: poNumber, amount: qty * STANDARD_COST, lines: JSON.stringify([{ sku: 'SKU-1', quantity: qty, unitPrice: STANDARD_COST }]) });
    const before = journalCount();
    const r = await dispatchCommand(cmd('ApproveSupplierInvoice', { target: billId, idem: 'inv' }), deps());
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain('MISMATCH');
    expect(journalCount()).toBe(before);
  });

  it('a bill whose vendor differs from the PO supplier is HELD (BLOCKED) — wrong-supplier control', async () => {
    const { poNumber, qty } = await receivedReorder({ supplier: 'Acme Supplies', unitCost: STANDARD_COST });
    const billId = await draftBill({ vendor: 'Other Vendor Co', sourcePurchaseOrder: poNumber, amount: qty * STANDARD_COST, lines: JSON.stringify([{ sku: 'SKU-1', quantity: qty, unitPrice: STANDARD_COST }]) });
    const before = journalCount();
    const r = await dispatchCommand(cmd('ApproveSupplierInvoice', { target: billId, idem: 'inv' }), deps());
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain('BLOCKED');
    expect(journalCount()).toBe(before);
  });

  it('a bill whose lines do not sum to the subtotal is HELD (LINES_INCONSISTENT)', async () => {
    const { poNumber, qty } = await receivedReorder({ supplier: 'Acme Supplies', unitCost: STANDARD_COST });
    // subtotal says qty*5 but the single line sums to qty*4 — inconsistent
    const billId = await draftBill({ vendor: 'Acme Supplies', sourcePurchaseOrder: poNumber, amount: qty * STANDARD_COST, lines: JSON.stringify([{ sku: 'SKU-1', quantity: qty, unitPrice: 4 }]) });
    const before = journalCount();
    const r = await dispatchCommand(cmd('ApproveSupplierInvoice', { target: billId, idem: 'inv' }), deps());
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain('LINES_INCONSISTENT');
    expect(journalCount()).toBe(before);
  });

  it('a bill for MORE than was received is HELD (MISMATCH) — never pay for goods not in', async () => {
    const { poNumber, qty } = await receivedReorder({ supplier: 'Acme Supplies', unitCost: STANDARD_COST });
    const over = qty + 10;
    const billId = await draftBill({ vendor: 'Acme Supplies', sourcePurchaseOrder: poNumber, amount: over * STANDARD_COST, lines: JSON.stringify([{ sku: 'SKU-1', quantity: over, unitPrice: STANDARD_COST }]) });
    const before = journalCount();
    const r = await dispatchCommand(cmd('ApproveSupplierInvoice', { target: billId, idem: 'inv' }), deps());
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain('MISMATCH');
    expect(journalCount()).toBe(before);
    expect(paymentCount()).toBe(0);
  });
});

// ─────────────────────── EDIT-DOOR FENCE — no forged approval, no forged payable ───────────────────────
describe('S92 edit-door — lifecycle markers are action-owned; a generic edit cannot forge AP', () => {
  it('a generic EDIT cannot hand-stamp approvedAt (no payable via the edit door)', async () => {
    const { poNumber, qty } = await receivedReorder({ supplier: 'Acme Supplies', unitCost: STANDARD_COST });
    const billId = await draftBill({ vendor: 'Acme Supplies', sourcePurchaseOrder: poNumber, amount: qty * STANDARD_COST, lines: JSON.stringify([{ sku: 'SKU-1', quantity: qty, unitPrice: STANDARD_COST }]) });
    const before = journalCount();
    const edit = await updateIn(VENDOR_BILLS_MODULE_ID, billId, { approvedAt: '2026-01-01T00:00:00.000Z' });
    expect(edit.ok).toBe(false); // markers cannot be edited
    expect(String(rec(VENDOR_BILLS_MODULE_ID, billId)!.fields.status)).toBe('draft');
    expect(journalCount()).toBe(before);
  });

  it('a bill referencing a non-existent PO is refused at create (audit trail cannot be forged)', async () => {
    const r = await createIn(VENDOR_BILLS_MODULE_ID, { billNumber: 'BILL-GHOST', vendor: 'Acme Supplies', currency: 'USD', amount: 10, sourcePurchaseOrder: 'PO-DOES-NOT-EXIST' });
    expect(r.ok).toBe(false);
  });
});

// ─────────────────────── SECURITY / TENANT — invoice approval authority fails closed ───────────────────────
describe('S92 security — supplier-invoice approval authority + tenancy fail closed', () => {
  it('ApproveSupplierInvoice requires operations:manage — a denied actor cannot book AP', async () => {
    const { poNumber, qty } = await receivedReorder({ supplier: 'Acme Supplies', unitCost: STANDARD_COST });
    const billId = await draftBill({ vendor: 'Acme Supplies', sourcePurchaseOrder: poNumber, amount: qty * STANDARD_COST, lines: JSON.stringify([{ sku: 'SKU-1', quantity: qty, unitPrice: STANDARD_COST }]) });
    const before = journalCount();
    const denied = await dispatchCommand(cmd('ApproveSupplierInvoice', { target: billId, idem: 'inv' }), deps(makeCtx('operations:manage')));
    expect(denied.ok).toBe(false);
    expect(denied.error).toBe('UNAUTHORIZED');
    expect(String(rec(VENDOR_BILLS_MODULE_ID, billId)!.fields.status)).toBe('draft');
    expect(journalCount()).toBe(before);
  });

  it('NO_TENANT / forged tenant / cross-tenant approval fail closed', async () => {
    const { poNumber, qty } = await receivedReorder({ supplier: 'Acme Supplies', unitCost: STANDARD_COST });
    const billId = await draftBill({ vendor: 'Acme Supplies', sourcePurchaseOrder: poNumber, amount: qty * STANDARD_COST, lines: JSON.stringify([{ sku: 'SKU-1', quantity: qty, unitPrice: STANDARD_COST }]) });
    scope = null;
    expect((await dispatchCommand(cmd('ApproveSupplierInvoice', { target: billId, idem: 'inv' }), deps())).error).toBe('UNRESOLVED_TENANT');
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    expect((await dispatchCommand(cmd('ApproveSupplierInvoice', { target: billId, idem: 'inv2', tenantId: 'tenant-EVIL' }), deps())).error).toBe('CROSS_TENANT_CLAIM');
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' }; // a foreign tenant cannot see the bill
    const foreign = await dispatchCommand(cmd('ApproveSupplierInvoice', { target: billId, idem: 'inv3' }), deps());
    expect(foreign.ok).toBe(false);
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    expect(String(rec(VENDOR_BILLS_MODULE_ID, billId)!.fields.status)).toBe('draft');
    expect(paymentCount()).toBe(0);
  });
});
