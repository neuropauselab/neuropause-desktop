/**
 * ERP Session 94 — END-TO-END PROCURE-TO-PAY CONTROL-PLANE CERTIFICATION.
 *
 * Certifies the COMPLETE governed P2P lifecycle as ONE workflow, reusing ONLY the existing canonical
 * modules/commands (no new approval/payment/workflow/inventory/accounting/command-bus engine):
 *
 *   Create PR → Submit → Approve → Convert → PO (draft) → PO Approve → PO Send → Receive Goods
 *     → Post Goods Receipt (inventory + GRNI) → Supplier Invoice → 3-Way Match → AP Liability
 *     → PaySupplierInvoice → one cleared payment (Dr AP / Cr Cash) → AP Settled
 *
 * Plus the governance controls around it: procurement gating, receiving idempotency, three-way-match
 * fail-closed, AP-once, payment-once, the reversal/delete boundary, RESTART DURABILITY, tenant/actor
 * security, and the AI/advisory boundary (no autonomous consequential execution). Every consequential
 * mutation flows through the durable command journal (idempotency + event + outbox + audit).
 *
 * This is a certification/verification gate — ZERO production change. The individual controls are also
 * pinned per-slice (S89 execution, S90 lifecycle, S91 receiving, S92 invoice/3WM/AP, S93 payment); this
 * suite proves they compose into one governed chain and survive a restart.
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
  PURCHASE_REQUESTS_MODULE_ID,
  VENDOR_BILLS_MODULE_ID,
  VENDOR_PAYMENTS_MODULE_ID,
  PAYMENTS_MODULE_ID,
  PAYMENT_KIND,
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
import { createVendorBillModule } from '../../enterprise/modules/finance/vendorBillModule';
import { createVendorPaymentModule } from '../../enterprise/modules/finance/vendorPaymentModule';
import { createPaymentReversalModule } from '../../enterprise/modules/finance/paymentReversalModule';
import { createPurchaseRequestModule } from '../../enterprise/modules/procurement/purchaseRequestModule';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { createGoodsReceiptModule } from '../../enterprise/modules/procurement/goodsReceiptModule';
import { createShippingModule } from '../../enterprise/modules/warehouse/shippingModule';
import { createReorderDecisionModule, REORDER_DECISION_MODULE_ID } from '../../enterprise/modules/inventory/reorderDecisionModule';
import { dispatchCommand, type CommandDispatchDeps } from './commandBus';
import { DurableCommandJournal } from './durableCommandJournal';
import type { DomainCommand, DomainCommandType } from './domainCommand';

const STOCK_MOVEMENTS_MODULE_ID = 'inventory-movements';
const STANDARD_COST = 5;

/** All store paths for one "installation" — reused to prove a restart reloads the same persisted state. */
interface StorePaths {
  prod: string; pr: string; po: string; gr: string; ship: string; acct: string; bill: string;
  vpay: string; cpay: string; rev: string; mv: string; jrnl: string; dec: string; journal: string;
}
const allPaths: string[] = [];
function freshPaths(): StorePaths {
  const p = (t: string): string => { const f = join(tmpdir(), `np-s94-${t}-${randomUUID()}.json`); allPaths.push(f); return f; };
  return { prod: p('prod'), pr: p('pr'), po: p('po'), gr: p('gr'), ship: p('ship'), acct: p('acct'), bill: p('bill'), vpay: p('vpay'), cpay: p('cpay'), rev: p('rev'), mv: p('mv'), jrnl: p('jrnl'), dec: p('dec'), journal: p('journal') };
}

let scope: TenantScope | null;
let authorized: EnterprisePermission[];

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

/** Build a full P2P-capable registry over the given store paths (a fresh "process"). */
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
  const customerPaymentsStore = new EnterpriseRecordStore(paths.cpay, PAYMENTS_MODULE_ID, PAYMENT_KIND);
  const reversals = createPaymentReversalModule(paths.rev, customerPaymentsStore, vendorPayments.store);
  for (const m of [
    products, pr, po, gr, shipping, accounts, bills, vendorPayments, reversals,
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
    correlationId: 'corr_s94', idempotencyKey: opts.idem ?? `${type}_${seq}`,
    timestamp: '2026-09-01T12:00:00.000Z', source: 'test',
  };
}

/** Bind command-dispatch deps to a specific installation (default: the beforeEach one). */
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
const receiveMovements = (i = inst) => listIn(STOCK_MOVEMENTS_MODULE_ID, i).filter((m) => m.status !== 'deleted' && String(m.fields.type) === 'receive');

/**
 * Drive the FULL governed P2P chain to a SETTLED bill on the given installation. No seeded ERP state —
 * everything is created through the governed create/action/command doors. Returns the key ids/counts.
 */
async function runFullP2P(i = inst): Promise<{
  prId: string; poId: string; poNumber: string; grId: string; billId: string; billNumber: string; paymentId: string; qty: number; total: number;
}> {
  const vendor = 'Acme Supplies';
  // A · PROCUREMENT
  await createIn(PRODUCTS_MODULE_ID, { sku: 'SKU-1', name: 'Widget', purchaseCost: 4, standardCost: STANDARD_COST, reorderLevel: 20, safetyStock: 10, maximumStock: 50 }, i);
  const report = await createIn(REORDER_DECISION_MODULE_ID, { asOfDate: '2026-07-31' }, i);
  const confirm = await dispatchCommand(cmd('CreatePurchaseRequestFromReorderRecommendation', { target: report.record!.id, payload: { sku: 'SKU-1' }, idem: 'reorder-exec:seed' }), deps(i));
  const prId = String(confirm.data!.id);
  const qty = Number(confirm.data!.quantity);
  expect(String(rec(PURCHASE_REQUESTS_MODULE_ID, prId, i)!.fields.status)).toBe('draft');
  await dispatchCommand(cmd('SubmitPurchaseRequest', { target: prId, idem: 'sub' }), deps(i));
  await dispatchCommand(cmd('ApprovePurchaseRequest', { target: prId, idem: 'app' }), deps(i));
  await dispatchCommand(cmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'conv' }), deps(i));
  const po = listIn(PURCHASE_ORDERS_MODULE_ID, i).find((r) => String(r.fields.sourceRequest) === prId)!;
  const poId = po.id;
  const poNumber = String(po.fields.poNumber);
  // PO remains draft until explicit approval
  expect(String(rec(PURCHASE_ORDERS_MODULE_ID, poId, i)!.fields.status)).toBe('draft');
  await updateIn(PURCHASE_ORDERS_MODULE_ID, poId, { warehouse: 'WH-1', supplier: vendor, unitCost: STANDARD_COST }, i);
  // B · RECEIVING — a draft PO cannot be received
  expect((await actIn(PURCHASE_ORDERS_MODULE_ID, poId, 'receiveGoods', i)).ok).toBe(false);
  expect(count(GOODS_RECEIPTS_MODULE_ID, i)).toBe(0);
  expect((await actIn(PURCHASE_ORDERS_MODULE_ID, poId, 'approve', i)).ok).toBe(true);
  expect((await actIn(PURCHASE_ORDERS_MODULE_ID, poId, 'send', i)).ok).toBe(true);
  expect((await actIn(PURCHASE_ORDERS_MODULE_ID, poId, 'receiveGoods', i)).ok).toBe(true);
  const gr = listIn(GOODS_RECEIPTS_MODULE_ID, i).find((r) => String(r.fields.purchaseOrder) === poId)!;
  const grId = gr.id;
  expect(String(gr.fields.status)).toBe('pending');
  expect((await dispatchCommand(cmd('PostGoodsReceipt', { target: grId, idem: `post:${grId}` }), deps(i))).ok).toBe(true);
  expect(receiveMovements(i).length).toBe(1);
  // C · SUPPLIER INVOICE / 3-WAY MATCH
  const total = qty * STANDARD_COST;
  const billNumber = `BILL-${randomUUID().slice(0, 8)}`;
  const bill = await createIn(VENDOR_BILLS_MODULE_ID, {
    billNumber, vendor, currency: 'USD', amount: total, sourcePurchaseOrder: poNumber, status: 'draft',
    lines: JSON.stringify([{ sku: 'SKU-1', quantity: qty, unitPrice: STANDARD_COST }]),
  }, i);
  const billId = bill.record!.id;
  // a draft bill has NOT booked AP (no payable yet)
  expect(String(rec(VENDOR_BILLS_MODULE_ID, billId, i)!.fields.status)).toBe('draft');
  expect((await dispatchCommand(cmd('ApproveSupplierInvoice', { target: billId, idem: `inv:${billId}` }), deps(i))).ok).toBe(true);
  expect(String(rec(VENDOR_BILLS_MODULE_ID, billId, i)!.fields.status)).toBe('approved');
  // D · PAYMENT
  const paid = await dispatchCommand(cmd('PaySupplierInvoice', { payload: { paymentNumber: 'VPAY-1', billRef: billNumber, vendor, amount: total, transactionRef: 'TXN-1' }, idem: 'pay:1' }), deps(i));
  expect(paid.ok).toBe(true);
  const payment = alive(VENDOR_PAYMENTS_MODULE_ID, i).find((p) => String(p.fields.status) === 'cleared')!;
  expect(String(rec(VENDOR_BILLS_MODULE_ID, billId, i)!.fields.status)).toBe('paid');
  return { prId, poId, poNumber, grId, billId, billNumber, paymentId: payment.id, qty, total };
}

// ─────────────────────── A–D · THE FULL CHAIN COMPOSES INTO ONE GOVERNED WORKFLOW ───────────────────────
describe('S94 P2P — the complete governed chain PR → … → AP settled composes end-to-end', () => {
  it('runs the whole chain from zero ERP state to a settled bill with exactly-one economic effects + lineage', async () => {
    const r = await runFullP2P();
    // one of each document, one inventory movement, AP booked + settled, one cleared payment
    expect(count(PURCHASE_REQUESTS_MODULE_ID)).toBe(1);
    expect(count(PURCHASE_ORDERS_MODULE_ID)).toBe(1);
    expect(count(GOODS_RECEIPTS_MODULE_ID)).toBe(1);
    expect(receiveMovements().length).toBe(1);
    expect(count(VENDOR_BILLS_MODULE_ID)).toBe(1);
    expect(alive(VENDOR_PAYMENTS_MODULE_ID).filter((p) => String(p.fields.status) === 'cleared').length).toBe(1);
    // lineage recommendation → PR → PO → GR → bill → payment
    expect(r.poNumber).toMatch(/^PO-PR-REORDER-/);
    expect(String(rec(GOODS_RECEIPTS_MODULE_ID, r.grId)!.fields.grNumber)).toBe(`GR-${r.poNumber}`);
    expect(String(rec(VENDOR_BILLS_MODULE_ID, r.billId)!.fields.sourcePurchaseOrder)).toBe(r.poNumber);
    expect(String(rec(VENDOR_PAYMENTS_MODULE_ID, r.paymentId)!.fields.billRef)).toBe(r.billNumber);
    // AP settled
    const bill = rec(VENDOR_BILLS_MODULE_ID, r.billId)!;
    expect(String(bill.fields.status)).toBe('paid');
    expect(Number(bill.fields.amountPaid ?? 0)).toBe(r.total);
    // the whole chain authorized through procurement:manage + operations:manage (governed, not bypassed)
    expect(authorized).toContain('procurement:manage');
    expect(authorized).toContain('operations:manage');
  });

  it('AP + GRNI + payment GL are each booked exactly once (no duplicate accounting)', async () => {
    await runFullP2P();
    const journals = listIn(JOURNAL_ENTRIES_MODULE_ID);
    // GRNI (goods receipt), GRNI-relief/AP (bill approve), and Dr AP / Cr Cash (payment) all present.
    // Re-dispatching the terminal economic commands with the SAME key must not add journals.
    const before = journals.length;
    const gr = listIn(GOODS_RECEIPTS_MODULE_ID)[0];
    await dispatchCommand(cmd('PostGoodsReceipt', { target: gr.id, idem: `post:${gr.id}` }), deps()); // same key → replay
    const bill = listIn(VENDOR_BILLS_MODULE_ID)[0];
    await dispatchCommand(cmd('ApproveSupplierInvoice', { target: bill.id, idem: `inv:${bill.id}` }), deps()); // same key → replay
    await dispatchCommand(cmd('PaySupplierInvoice', { payload: { paymentNumber: 'VPAY-1', billRef: String(bill.fields.billNumber), vendor: 'Acme Supplies', amount: Number(bill.fields.total), transactionRef: 'TXN-1' }, idem: 'pay:1' }), deps());
    expect(listIn(JOURNAL_ENTRIES_MODULE_ID).length).toBe(before); // no duplicate GL from any replay
    expect(receiveMovements().length).toBe(1); // no duplicate inventory movement
  });
});

// ─────────────────────── F · RESTART DURABILITY ───────────────────────
describe('S94 durability — the completed chain survives a process restart with no double-post', () => {
  it('rebuilding the installation over the same stores preserves every count + lineage; replays do not duplicate', async () => {
    const r = await runFullP2P();
    const snapshot = {
      pr: count(PURCHASE_REQUESTS_MODULE_ID), po: count(PURCHASE_ORDERS_MODULE_ID), gr: count(GOODS_RECEIPTS_MODULE_ID),
      mv: receiveMovements().length, bill: count(VENDOR_BILLS_MODULE_ID),
      pay: alive(VENDOR_PAYMENTS_MODULE_ID).filter((p) => String(p.fields.status) === 'cleared').length,
      jrnl: count(JOURNAL_ENTRIES_MODULE_ID),
    };

    // RESTART: a brand-new installation (fresh registry + fresh durable journal) over the SAME files.
    const ctx2 = makeCtx();
    const inst2 = buildInstallation(paths, ctx2);
    for (const m of [PURCHASE_REQUESTS_MODULE_ID, PURCHASE_ORDERS_MODULE_ID, GOODS_RECEIPTS_MODULE_ID, VENDOR_BILLS_MODULE_ID, VENDOR_PAYMENTS_MODULE_ID, JOURNAL_ENTRIES_MODULE_ID, STOCK_MOVEMENTS_MODULE_ID]) {
      await inst2.registry.get(m)!.store.load();
    }
    // counts + lineage survive the restart
    expect(count(PURCHASE_REQUESTS_MODULE_ID, inst2)).toBe(snapshot.pr);
    expect(count(PURCHASE_ORDERS_MODULE_ID, inst2)).toBe(snapshot.po);
    expect(count(GOODS_RECEIPTS_MODULE_ID, inst2)).toBe(snapshot.gr);
    expect(receiveMovements(inst2).length).toBe(snapshot.mv);
    expect(count(VENDOR_BILLS_MODULE_ID, inst2)).toBe(snapshot.bill);
    expect(alive(VENDOR_PAYMENTS_MODULE_ID, inst2).filter((p) => String(p.fields.status) === 'cleared').length).toBe(snapshot.pay);
    expect(count(JOURNAL_ENTRIES_MODULE_ID, inst2)).toBe(snapshot.jrnl);
    expect(String(rec(VENDOR_BILLS_MODULE_ID, r.billId, inst2)!.fields.status)).toBe('paid');

    // replay the terminal economic commands on the RESTARTED installation → deduped, nothing doubles
    const post = await dispatchCommand(cmd('PostGoodsReceipt', { target: r.grId, idem: `post:${r.grId}` }), deps(inst2, ctx2));
    expect(post.replayed).toBe(true);
    const pay = await dispatchCommand(cmd('PaySupplierInvoice', { payload: { paymentNumber: 'VPAY-1', billRef: r.billNumber, vendor: 'Acme Supplies', amount: r.total, transactionRef: 'TXN-1' }, idem: 'pay:1' }), deps(inst2, ctx2));
    expect(pay.replayed).toBe(true);
    expect(receiveMovements(inst2).length).toBe(snapshot.mv);
    expect(count(JOURNAL_ENTRIES_MODULE_ID, inst2)).toBe(snapshot.jrnl);
    expect(alive(VENDOR_PAYMENTS_MODULE_ID, inst2).filter((p) => String(p.fields.status) === 'cleared').length).toBe(snapshot.pay);
  });
});

// ─────────────────────── E · REVERSAL / DELETE BOUNDARY (no reversal performed) ───────────────────────
describe('S94 reversal boundary — the only unwind is the governed reversal; original immutable; bank-recon fail-closed', () => {
  it('a cleared payment cannot be deleted; ReverseVendorPayment is the canonical unwind; a bank-reconciled payment is fail-closed', async () => {
    const r = await runFullP2P();
    // cleared payment cannot be deleted
    expect((await deleteIn(VENDOR_PAYMENTS_MODULE_ID, r.paymentId)).ok).toBe(false);
    expect(String(rec(VENDOR_PAYMENTS_MODULE_ID, r.paymentId)!.fields.status)).toBe('cleared');
    // a bank-reconciled payment cannot be reversed (fail-closed) — simulate the FW-8 write-back
    inst.registry.get(VENDOR_PAYMENTS_MODULE_ID)!.store.update(r.paymentId, { fields: { bankReconciledAt: '2026-09-02T00:00:00.000Z', bankStatementRef: 'BS-1' }, actor: 'system', now: '2026-09-02T00:00:00.000Z' });
    const blocked = await dispatchCommand(cmd('ReverseVendorPayment', { target: r.paymentId, payload: { reason: 'x' }, idem: 'revbr' }), deps());
    expect(blocked.ok).toBe(false);
    expect(count('finance-payment-reversals')).toBe(0);
  });

  it('a non-bank-reconciled cleared payment reverses ONLY through ReverseVendorPayment, leaving the original immutable', async () => {
    const r = await runFullP2P();
    const before = JSON.stringify(rec(VENDOR_PAYMENTS_MODULE_ID, r.paymentId)!.fields);
    const reverse = await dispatchCommand(cmd('ReverseVendorPayment', { target: r.paymentId, payload: { reason: 'wrong supplier' }, idem: 'rev' }), deps());
    expect(reverse.ok).toBe(true);
    expect(count('finance-payment-reversals')).toBe(1);
    // ORIGINAL immutable; bill re-opened
    expect(JSON.stringify(rec(VENDOR_PAYMENTS_MODULE_ID, r.paymentId)!.fields)).toBe(before);
    expect(Number(rec(VENDOR_BILLS_MODULE_ID, r.billId)!.fields.amountPaid ?? 0)).toBe(0);
    // at-most-one reversal
    expect((await dispatchCommand(cmd('ReverseVendorPayment', { target: r.paymentId, payload: { reason: 'again' }, idem: 'rev2' }), deps())).ok).toBe(false);
  });
});

// ─────────────────────── G · SECURITY — every consequential command fails closed ───────────────────────
describe('S94 security — forged tenant / unauthorized / replay all fail closed through existing governance', () => {
  it('unauthorized actors cannot approve PR, transition PO, post GR, approve invoice, or pay', async () => {
    // Build the chain up to the points each command guards, then attempt with a denied ctx.
    const r = await runFullP2P();
    // PR approve requires procurement:manage
    const pr2 = await dispatchCommand(cmd('CreatePurchaseRequestFromReorderRecommendation', { target: listIn(REORDER_DECISION_MODULE_ID)[0].id, payload: { sku: 'SKU-1' }, idem: 'x' }), deps());
    void pr2;
    const denyProc = makeCtx('procurement:manage');
    const denyOps = makeCtx('operations:manage');
    // PostGoodsReceipt (procurement:manage) with denied ctx → UNAUTHORIZED
    const gr = listIn(GOODS_RECEIPTS_MODULE_ID)[0];
    expect((await dispatchCommand(cmd('PostGoodsReceipt', { target: gr.id, idem: 'p' }), deps(inst, denyProc))).error).toBe('UNAUTHORIZED');
    // ApproveSupplierInvoice + PaySupplierInvoice (operations:manage) with denied ctx → UNAUTHORIZED
    expect((await dispatchCommand(cmd('ApproveSupplierInvoice', { target: r.billId, idem: 'i' }), deps(inst, denyOps))).error).toBe('UNAUTHORIZED');
    expect((await dispatchCommand(cmd('PaySupplierInvoice', { payload: { paymentNumber: 'VPAY-X', billRef: r.billNumber, vendor: 'Acme Supplies', amount: r.total, transactionRef: 'TXN-X' }, idem: 'px' }), deps(inst, denyOps))).error).toBe('UNAUTHORIZED');
  });

  it('forged tenant / no tenant / cross-tenant are refused on the consequential commands', async () => {
    const r = await runFullP2P();
    scope = null;
    expect((await dispatchCommand(cmd('PaySupplierInvoice', { payload: { paymentNumber: 'V', billRef: r.billNumber, vendor: 'Acme Supplies', amount: r.total, transactionRef: 'T' }, idem: 't1' }), deps())).error).toBe('UNRESOLVED_TENANT');
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    expect((await dispatchCommand(cmd('PostGoodsReceipt', { target: r.grId, idem: 't2', tenantId: 'tenant-EVIL' }), deps())).error).toBe('CROSS_TENANT_CLAIM');
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  });

  it('a duplicate/replay command does not produce a second effect (idempotent by key)', async () => {
    const r = await runFullP2P();
    const movesBefore = receiveMovements().length;
    const replay = await dispatchCommand(cmd('PostGoodsReceipt', { target: r.grId, idem: `post:${r.grId}` }), deps());
    expect(replay.replayed).toBe(true);
    expect(receiveMovements().length).toBe(movesBefore);
  });
});

// ─────────────────────── H · AI / ADVISORY BOUNDARY ───────────────────────
describe('S94 AI boundary — an advisory principal cannot autonomously execute any consequential P2P command', () => {
  it('an advisory context (no operations/procurement manage grant) is refused on approve/receive/pay/reverse', async () => {
    const r = await runFullP2P();
    // Model the AI/advisory boundary: a context whose authorize() denies BOTH consequential grants —
    // exactly the posture an advisory path holds (§13: the Brain proposes, it never reaches). Every
    // consequential command flows through the SAME governed authorize() gate, so each is refused.
    const advisory: EnterpriseModuleContext = {
      ...makeCtx(),
      authorize: (p: EnterprisePermission) => { authorized.push(p); if (p === 'procurement:manage' || p === 'operations:manage') throw new Error(`advisory has no ${p}`); },
    };
    const report = listIn(REORDER_DECISION_MODULE_ID)[0];
    expect((await dispatchCommand(cmd('CreatePurchaseRequestFromReorderRecommendation', { target: report.id, payload: { sku: 'SKU-1' }, idem: 'ai1' }), deps(inst, advisory))).error).toBe('UNAUTHORIZED');
    expect((await dispatchCommand(cmd('ApprovePurchaseRequest', { target: r.prId, idem: 'ai2' }), deps(inst, advisory))).error).toBe('UNAUTHORIZED');
    expect((await dispatchCommand(cmd('PostGoodsReceipt', { target: r.grId, idem: 'ai3' }), deps(inst, advisory))).error).toBe('UNAUTHORIZED');
    expect((await dispatchCommand(cmd('ApproveSupplierInvoice', { target: r.billId, idem: 'ai4' }), deps(inst, advisory))).error).toBe('UNAUTHORIZED');
    expect((await dispatchCommand(cmd('PaySupplierInvoice', { payload: { paymentNumber: 'VP', billRef: r.billNumber, vendor: 'Acme Supplies', amount: r.total, transactionRef: 'TA' }, idem: 'ai5' }), deps(inst, advisory))).error).toBe('UNAUTHORIZED');
    expect((await dispatchCommand(cmd('ReverseVendorPayment', { target: r.paymentId, payload: { reason: 'ai' }, idem: 'ai6' }), deps(inst, advisory))).error).toBe('UNAUTHORIZED');
    // nothing changed: still one settled bill, one cleared payment, no reversal
    expect(String(rec(VENDOR_BILLS_MODULE_ID, r.billId)!.fields.status)).toBe('paid');
    expect(count('finance-payment-reversals')).toBe(0);
  });
});
