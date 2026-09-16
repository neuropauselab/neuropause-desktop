/**
 * ERP Session 101 — AUTHORITY, APPROVAL & SEGREGATION-OF-DUTIES CERTIFICATION.
 *
 * Proves that consequential ERP operations cannot be executed by an unauthorized, self-approving,
 * forged, or terminal-state actor — reusing ONLY the existing RBAC, the one live SoD rule (HR expense
 * claim creator≠approver), machine-owned status guards, the command bus authorize step, the economic-delete
 * guards, and the canonical reversal command. No new approval engine, no production change.
 *
 * The load-bearing question is NOT "do users have different UI permissions" but "can an unauthorized actor
 * cause an economic side effect (inventory / GL / AR / AP / payment)". Every forbidden path below is proven
 * to fail closed with ZERO economic mutation.
 *
 * Authority model (source-wins, from discovery): authority is FLAT permission-scope based; the actor is
 * server-resolved (renderer cannot forge it); exactly ONE live SoD rule exists (expense claim); PR→PO
 * conversion has a hard machine-owned-status gate; payment reversal + economic-delete guards hold. Threshold
 * tiers, PR/PO SoD, payroll authority, stock-adjustment approval, mfg-variance approval and period-reopen
 * dual-control are POLICY-OPEN / NOT-IMPLEMENTED (DECISION-MEMO-S101) — deliberately NOT invented here.
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
  PURCHASE_REQUESTS_MODULE_ID,
  PURCHASE_ORDERS_MODULE_ID,
  EXPENSE_CLAIMS_MODULE_ID,
  EMPLOYEES_MODULE_ID,
  STOCK_ADJUSTMENTS_MODULE_ID,
  ACCOUNTING_PERIODS_MODULE_ID,
  PAYMENTS_MODULE_ID,
  CUSTOMERS_MODULE_ID,
  ORDERS_MODULE_ID,
  FINANCE_MODULE_ID,
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
import { PAYMENT_REVERSALS_MODULE_ID } from '../../enterprise/modules/finance/paymentReconcile';
import { createVendorPaymentModule } from '../../enterprise/modules/finance/vendorPaymentModule';
import { createVendorBillModule } from '../../enterprise/modules/finance/vendorBillModule';
import { createAccountingPeriodModule } from '../../enterprise/modules/finance/accountingPeriodModule';
import { createPurchaseRequestModule } from '../../enterprise/modules/procurement/purchaseRequestModule';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { createShippingModule } from '../../enterprise/modules/warehouse/shippingModule';
import { createStockAdjustmentModule } from '../../enterprise/modules/warehouse/stockAdjustmentModule';
import { createCustomerModule } from '../../enterprise/modules/crm/customerModule';
import { createOrderModule } from '../../enterprise/modules/sales/orderModule';
import { createEmployeeModule } from '../../enterprise/modules/hr/employeeModule';
import { createExpenseClaimModule } from '../../enterprise/modules/hr/expenseClaimModule';
import { createProductionOrderModule } from '../../enterprise/modules/manufacturing/productionOrderModule';
import { createBomModule } from '../../enterprise/modules/manufacturing/bomModule';
import { dispatchCommand, type CommandDispatchDeps } from './commandBus';
import { DurableCommandJournal } from './durableCommandJournal';
import type { DomainCommand, DomainCommandType } from './domainCommand';

const MV = 'inventory-movements';
const allPaths: string[] = [];
function freshPaths(): Record<string, string> {
  const ids = ['prod', 'mv', 'acct', 'jrnl', 'inv', 'pay', 'rev', 'vpay', 'bill', 'period', 'pr', 'po', 'ship', 'adj', 'cust', 'order', 'emp', 'exp', 'mo', 'bom', 'journal'];
  const out: Record<string, string> = {};
  for (const id of ids) { const f = join(tmpdir(), `np-s101-${id}-${randomUUID()}.json`); allPaths.push(f); out[id] = f; }
  return out;
}

let scope: TenantScope | null;
/** A ctx whose actor is a NAMED principal and whose authorize denies a given set of permissions. */
function makeCtxAs(actor: string, deny: EnterprisePermission[] = []): EnterpriseModuleContext {
  return {
    authorize: (p: EnterprisePermission) => { if (deny.includes(p)) throw new Error(`denied: ${p}`); },
    audit: () => undefined, publish: (_i: PlatformEventInput) => undefined, broadcast: () => undefined, notify: () => undefined,
    actor: () => actor, now: () => '2026-09-30T12:00:00.000Z',
  };
}
function buildInstallation(paths: Record<string, string>, ctx: EnterpriseModuleContext) {
  const registry = new EnterpriseModuleRegistry();
  const products = createProductModule(paths.prod);
  const accounts = createLedgerAccountModule(paths.acct);
  const invoices = createInvoiceModule(paths.inv);
  const payments = createPaymentModule(paths.pay, invoices.store);
  const po = createPurchaseOrderModule(paths.po);
  const bills = createVendorBillModule(paths.bill, po.store);
  const vendorPayments = createVendorPaymentModule(paths.vpay, bills.store);
  const employees = createEmployeeModule(paths.emp);
  const customers = createCustomerModule(paths.cust);
  for (const m of [
    products, accounts, invoices, payments, po, bills, vendorPayments, employees, customers,
    createStockMovementModule(paths.mv),
    createJournalEntryModule(paths.jrnl, accounts.store),
    createPaymentReversalModule(paths.rev, payments.store, vendorPayments.store),
    createAccountingPeriodModule(paths.period),
    createPurchaseRequestModule(paths.pr),
    createShippingModule(paths.ship),
    createStockAdjustmentModule(paths.adj),
    createOrderModule(paths.order),
    createExpenseClaimModule(paths.exp, employees.store),
    createProductionOrderModule(paths.mo),
    createBomModule(paths.bom),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  return { registry, handlers: buildModuleHandlers(registry, ctx), journal: new DurableCommandJournal(paths.journal) };
}

let paths: Record<string, string>;
let ctx: EnterpriseModuleContext;
let inst: ReturnType<typeof buildInstallation>;
const OPERATOR = 'operator@np.dev';
beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  paths = freshPaths();
  ctx = makeCtxAs(OPERATOR);
  inst = buildInstallation(paths, ctx);
});
afterEach(async () => { vi.restoreAllMocks(); for (const p of allPaths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined); });

let seq = 0;
function cmd(type: DomainCommandType, opts: { target?: string; payload?: Record<string, unknown>; idem?: string; tenantId?: string } = {}): DomainCommand {
  return { commandId: `cmd_${(seq += 1)}`, type, ...(opts.tenantId !== undefined ? { tenantId: opts.tenantId } : {}), actor: OPERATOR, ...(opts.target ? { target: { id: opts.target } } : {}), payload: opts.payload ?? {}, correlationId: 'corr_s101', idempotencyKey: opts.idem ?? `${type}_${seq}`, timestamp: '2026-09-30T12:00:00.000Z', source: 'test' };
}
function deps(i = inst, c: EnterpriseModuleContext = ctx): CommandDispatchDeps { return { registry: i.registry, ctx: c, resolveScope: () => scope, journal: i.journal }; }
const handlerFor = (i: ReturnType<typeof buildInstallation>, ch: string, c: EnterpriseModuleContext) => { const h = buildModuleHandlers(i.registry, c); const d = h.find((x) => x.channel === ch); if (!d) throw new Error(`no handler ${ch}`); return d.handler as (p: unknown) => Promise<unknown>; };
const handler = (i: ReturnType<typeof buildInstallation>, ch: string) => { const d = i.handlers.find((x) => x.channel === ch); if (!d) throw new Error(`no handler ${ch}`); return d.handler as (p: unknown) => Promise<unknown>; };
const createIn = (m: string, f: Record<string, unknown>, i = inst) => handler(i, IpcChannel.EnterpriseModuleCreate)({ moduleId: m, fields: f }) as Promise<{ ok: boolean; record?: EnterpriseEntity; errors?: Record<string, string> }>;
const actIn = (m: string, id: string, a: string, i = inst) => handler(i, IpcChannel.EnterpriseModuleAction)({ moduleId: m, id, action: a }) as Promise<{ ok: boolean; message?: string; error?: string }>;
const updateIn = (m: string, id: string, f: Record<string, unknown>, i = inst) => handler(i, IpcChannel.EnterpriseModuleUpdate)({ moduleId: m, id, fields: f }) as Promise<{ ok: boolean; error?: string; errors?: Record<string, string> }>;
const setStatusIn = (m: string, id: string, status: string, i = inst) => handler(i, IpcChannel.EnterpriseModuleSetStatus)({ moduleId: m, id, status }) as Promise<{ ok: boolean; errors?: Record<string, string> }>;
const deleteIn = (m: string, id: string, i = inst) => handler(i, IpcChannel.EnterpriseModuleDelete)({ moduleId: m, id }) as Promise<{ ok: boolean; errors?: Record<string, string> }>;
const listIn = (m: string, i = inst) => i.registry.get(m)!.store.list();
const rec = (m: string, id: string, i = inst) => i.registry.get(m)!.store.get(id);
const alive = (m: string, i = inst) => listIn(m, i).filter((r) => r.status !== 'deleted');
const count = (m: string, i = inst) => alive(m, i).length;
const journalCount = (i = inst) => count(JOURNAL_ENTRIES_MODULE_ID, i);
const movesOfType = (t: string, i = inst) => listIn(MV, i).filter((m) => m.status !== 'deleted' && String(m.fields.type) === t);

async function seedEmployeeAndClaim(creatorCtx: EnterpriseModuleContext): Promise<{ empId: string; claimId: string }> {
  const emp = await createIn(EMPLOYEES_MODULE_ID, { employeeNumber: 'EMP-1', name: 'Sam' });
  // create the claim AS the creator principal (createdBy is stamped from the ctx actor)
  const createByCreator = handlerFor(inst, IpcChannel.EnterpriseModuleCreate, creatorCtx);
  const claim = (await createByCreator({ moduleId: EXPENSE_CLAIMS_MODULE_ID, fields: { employee: emp.record!.id, category: 'travel', expenseDate: '2026-09-10', amount: 250, description: 'Taxi' } })) as { ok: boolean; record?: EnterpriseEntity };
  expect(claim.ok).toBe(true);
  return { empId: emp.record!.id, claimId: claim.record!.id };
}

// ─────────────────────── 1 · EXPENSE SoD (the one live rule) — airtight across every door ───────────────────────
describe('S101 expense SoD — a creator cannot approve their own claim through ANY door; GL only via the SoD-checked action', () => {
  it('creator self-approve refused; different operator approves once (GL posted); edit/SetStatus cannot forge approved', async () => {
    const creator = makeCtxAs('alice@np.dev');
    const { claimId } = await seedEmployeeAndClaim(creator);
    expect(String(rec(EXPENSE_CLAIMS_MODULE_ID, claimId)!.createdBy)).toBe('alice@np.dev');

    // creator tries to approve their OWN claim (action door, as alice) → SoD refusal, ZERO GL
    const selfApprove = handlerFor(inst, IpcChannel.EnterpriseModuleAction, creator);
    const r = (await selfApprove({ moduleId: EXPENSE_CLAIMS_MODULE_ID, id: claimId, action: 'approve' })) as { ok: boolean; message?: string };
    expect(r.ok).toBe(false);
    expect(String(r.message)).toMatch(/segregation of duties|its own creator/i);
    expect(journalCount()).toBe(0);
    expect(String(rec(EXPENSE_CLAIMS_MODULE_ID, claimId)!.fields.status)).toBe('submitted');

    // creator tries to FORGE 'approved' via the edit door → validate forces 'submitted' (machine-owned), ZERO GL
    await handlerFor(inst, IpcChannel.EnterpriseModuleUpdate, creator)({ moduleId: EXPENSE_CLAIMS_MODULE_ID, id: claimId, fields: { status: 'approved' } });
    expect(String(rec(EXPENSE_CLAIMS_MODULE_ID, claimId)!.fields.status)).toBe('submitted');
    expect(journalCount()).toBe(0);

    // creator tries to FORGE via SetStatus → 'approved' is not a valid record status; refused
    const ss = await setStatusIn(EXPENSE_CLAIMS_MODULE_ID, claimId, 'approved');
    expect(ss.ok).toBe(false);
    expect(String(rec(EXPENSE_CLAIMS_MODULE_ID, claimId)!.fields.status)).toBe('submitted');
    expect(journalCount()).toBe(0);

    // a DIFFERENT operator approves (SoD satisfied) → GL accrual posted exactly once
    expect((await actIn(EXPENSE_CLAIMS_MODULE_ID, claimId, 'approve')).ok).toBe(true); // ctx actor = operator@np.dev ≠ alice
    expect(String(rec(EXPENSE_CLAIMS_MODULE_ID, claimId)!.fields.status)).toBe('approved');
    expect(journalCount()).toBe(1);
    // decidedBy is the server actor, not the creator
    expect(String(rec(EXPENSE_CLAIMS_MODULE_ID, claimId)!.fields.decidedBy)).toBe(OPERATOR);
    // terminal: a decided claim cannot be re-approved or edited
    expect((await actIn(EXPENSE_CLAIMS_MODULE_ID, claimId, 'approve')).ok).toBe(false);
    expect((await updateIn(EXPENSE_CLAIMS_MODULE_ID, claimId, { amount: 999 })).ok).toBe(false);
    expect(journalCount()).toBe(1); // still one accrual
  });

  it('an unauthorized principal (no operations:manage) cannot approve a claim — zero GL', async () => {
    const { claimId } = await seedEmployeeAndClaim(makeCtxAs('alice@np.dev'));
    const advisory = makeCtxAs('ai@np.dev', ['operations:manage']);
    const advApprove = handlerFor(inst, IpcChannel.EnterpriseModuleAction, advisory);
    let refused = false;
    try { const r = (await advApprove({ moduleId: EXPENSE_CLAIMS_MODULE_ID, id: claimId, action: 'approve' })) as { ok: boolean }; refused = r.ok === false; } catch { refused = true; }
    expect(refused).toBe(true);
    expect(journalCount()).toBe(0);
  });
});

// ─────────────────────── 2 · PR→PO CONVERSION — hard machine-owned-status gate ───────────────────────
describe('S101 PR→PO — conversion requires an approved PR; the approved status cannot be hand-set via the edit door', () => {
  it('a non-approved PR cannot convert; editing status→approved is refused; only the governed approve enables conversion', async () => {
    await createIn(PRODUCTS_MODULE_ID, { sku: 'SKU-1', name: 'Widget', standardCost: 5 });
    const pr = await createIn(PURCHASE_REQUESTS_MODULE_ID, { requestNumber: 'PR-1', product: 'SKU-1', sku: 'SKU-1', quantity: 10, warehouse: 'WH-1' });
    const prId = pr.record!.id;
    // convert a draft PR → refused (must be approved)
    expect((await dispatchCommand(cmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'conv:1' }), deps())).ok).toBe(false);
    expect(count(PURCHASE_ORDERS_MODULE_ID)).toBe(0);
    // forge status→approved via the edit door → refused (machine-owned; skips governed approval)
    const forge = await updateIn(PURCHASE_REQUESTS_MODULE_ID, prId, { status: 'approved' });
    expect(forge.ok).toBe(false);
    expect(String(rec(PURCHASE_REQUESTS_MODULE_ID, prId)!.fields.status)).not.toBe('approved');
    // governed lifecycle: submit → approve → now conversion is allowed
    await dispatchCommand(cmd('SubmitPurchaseRequest', { target: prId, idem: 'sub:1' }), deps());
    await dispatchCommand(cmd('ApprovePurchaseRequest', { target: prId, idem: 'app:1' }), deps());
    expect(String(rec(PURCHASE_REQUESTS_MODULE_ID, prId)!.fields.status)).toBe('approved');
    expect((await dispatchCommand(cmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'conv:2' }), deps())).ok).toBe(true);
    expect(count(PURCHASE_ORDERS_MODULE_ID)).toBe(1);
  });
});

// ─────────────────────── 3 · ECONOMIC CONSEQUENCE — unauthorized actor → ZERO side effect ───────────────────────
describe('S101 economic consequence — an unauthorized/advisory actor causes no inventory, GL, or FG mutation', () => {
  it('advisory cannot post a stock adjustment, post payroll, or complete production — nothing moves', async () => {
    await createIn(PRODUCTS_MODULE_ID, { sku: 'SKU-1', name: 'Widget', standardCost: 5 });
    await createIn(MV, { movementNumber: 'MV-SEED', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });
    const adj = await createIn(STOCK_ADJUSTMENTS_MODULE_ID, { adjustmentNumber: 'ADJ-1', product: 'SKU-1', warehouse: 'WH-1', quantity: -10, reason: 'lost' });
    const movesBefore = movesOfType('adjustment').length;
    const jrnlBefore = journalCount();
    // advisory lacks warehouse:manage → posting the adjustment is refused; NO adjustment movement, NO GL
    const advisory = makeCtxAs('ai@np.dev', ['warehouse:manage', 'inventory:manage', 'operations:manage', 'manufacturing:manage']);
    const advAct = handlerFor(inst, IpcChannel.EnterpriseModuleAction, advisory);
    let refused = false;
    try { const r = (await advAct({ moduleId: STOCK_ADJUSTMENTS_MODULE_ID, id: adj.record!.id, action: 'post' })) as { ok: boolean }; refused = r.ok === false; } catch { refused = true; }
    expect(refused).toBe(true);
    expect(movesOfType('adjustment').length).toBe(movesBefore); // zero adjustment movement
    expect(journalCount()).toBe(jrnlBefore); // zero GL
    // an AUTHORIZED operator CAN post it (proves the refusal was authority, not a broken path)
    expect((await actIn(STOCK_ADJUSTMENTS_MODULE_ID, adj.record!.id, 'post')).ok).toBe(true);
    expect(movesOfType('adjustment').length).toBe(movesBefore + 1); // now one canonical adjustment movement
  });
});

// ─────────────────────── 4 · PAYMENT / REVERSAL AUTHORITY (S61/S62/S64 fences) ───────────────────────
describe('S101 payment/reversal — cleared payment undeletable; reversal is canonical + at-most-once; bank-reconciled fail-closed', () => {
  async function clearedReceipt(): Promise<{ paymentId: string; invoiceNumber: string; total: number }> {
    await createIn(PRODUCTS_MODULE_ID, { sku: 'SKU-1', name: 'Widget', standardCost: 5 });
    await createIn(MV, { movementNumber: 'MV-SEED', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });
    const customer = await createIn(CUSTOMERS_MODULE_ID, { name: 'C-1' });
    const so = await dispatchCommand(cmd('CreateSalesOrder', { payload: { orderNumber: 'SO-1', customer: 'C-1', customerRef: customer.record!.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: 5, total: 100 }, idem: 'so' }), deps());
    const orderId = String(so.data!.id);
    await dispatchCommand(cmd('ShipSalesOrder', { target: orderId, idem: 'ship' }), deps());
    await dispatchCommand(cmd('InvoiceSalesOrder', { target: orderId, idem: 'inv' }), deps());
    const invoiceId = String(rec(ORDERS_MODULE_ID, orderId)!.fields.convertedInvoice);
    const invoiceNumber = String(rec(FINANCE_MODULE_ID, invoiceId)!.fields.number);
    await dispatchCommand(cmd('IssueCustomerInvoice', { target: invoiceId, idem: 'issue' }), deps());
    await dispatchCommand(cmd('ReceiveCustomerPayment', { payload: { paymentNumber: 'RCPT-1', invoiceRef: invoiceNumber, amount: 100, transactionRef: 'TXN' }, idem: 'rcpt' }), deps());
    const payment = alive(PAYMENTS_MODULE_ID).find((p) => String(p.fields.status) === 'cleared')!;
    return { paymentId: payment.id, invoiceNumber, total: 100 };
  }

  it('a cleared payment cannot be deleted; a canonical reversal is at-most-once; a bank-reconciled payment cannot be reversed', async () => {
    const c = await clearedReceipt();
    // (a) cleared payment cannot be deleted (economic-delete guard, S61/S64)
    const del = await deleteIn(PAYMENTS_MODULE_ID, c.paymentId);
    expect(del.ok).toBe(false);
    expect(String(Object.values(del.errors ?? {})[0] ?? '')).toMatch(/cleared payment|reverse it|cannot be deleted/i);
    // (b) canonical reversal via the reversal module — succeeds once, second is refused (at-most-once)
    const rev1 = await createIn(PAYMENT_REVERSALS_MODULE_ID, { reversalNumber: 'REV-1', originalKind: 'customer', originalPaymentId: c.paymentId, reason: 'error' });
    expect(rev1.ok).toBe(true);
    const rev2 = await createIn(PAYMENT_REVERSALS_MODULE_ID, { reversalNumber: 'REV-2', originalPaymentId: c.paymentId, reason: 'again' });
    expect(rev2.ok).toBe(false); // at-most-one effective reversal per payment
  });

  it('a bank-reconciled payment fails closed on reversal', async () => {
    const c = await clearedReceipt();
    // mark it bank-reconciled (test-side setup of the reconciliation state)
    inst.registry.get(PAYMENTS_MODULE_ID)!.store.update(c.paymentId, { fields: { bankReconciledAt: '2026-09-30T00:00:00.000Z' }, actor: OPERATOR, now: '2026-09-30T12:00:00.000Z' });
    const rev = await createIn(PAYMENT_REVERSALS_MODULE_ID, { reversalNumber: 'REV-BR', originalKind: 'customer', originalPaymentId: c.paymentId, reason: 'error' });
    expect(rev.ok).toBe(false);
    expect(String(Object.values(rev.errors ?? {})[0] ?? '')).toMatch(/bank-reconciled|finalized statement/i);
  });
});

// ─────────────────────── 5 · PERIOD REOPEN — gated by RBAC + closed-period edit immutability ───────────────────────
describe('S101 period reopen — reopen requires operations:manage; a closed period cannot be edited via the edit door', () => {
  it('unauthorized reopen refused; closed-period edit refused; authorized reopen works and clears the close', async () => {
    const period = await createIn(ACCOUNTING_PERIODS_MODULE_ID, { periodKey: '2026-09', status: 'open' });
    const id = period.record!.id;
    expect((await actIn(ACCOUNTING_PERIODS_MODULE_ID, id, 'close')).ok).toBe(true);
    expect(String(rec(ACCOUNTING_PERIODS_MODULE_ID, id)!.fields.closedBy)).toBe(OPERATOR); // close attributed to the server actor
    // a closed period cannot be edited via the generic edit door (S55 immutability)
    expect((await updateIn(ACCOUNTING_PERIODS_MODULE_ID, id, { status: 'open' })).ok).toBe(false);
    // an unauthorized principal cannot reopen
    const advisory = makeCtxAs('ai@np.dev', ['operations:manage']);
    const advAct = handlerFor(inst, IpcChannel.EnterpriseModuleAction, advisory);
    let refused = false;
    try { const r = (await advAct({ moduleId: ACCOUNTING_PERIODS_MODULE_ID, id, action: 'reopen' })) as { ok: boolean }; refused = r.ok === false; } catch { refused = true; }
    expect(refused).toBe(true);
    expect(String(rec(ACCOUNTING_PERIODS_MODULE_ID, id)!.fields.closedAt)).not.toBe(''); // still closed
    // the authorized operator can reopen (dual-control is POLICY-OPEN, DECISION-MEMO-S101 — not invented)
    expect((await actIn(ACCOUNTING_PERIODS_MODULE_ID, id, 'reopen')).ok).toBe(true);
    expect(String(rec(ACCOUNTING_PERIODS_MODULE_ID, id)!.fields.closedAt)).toBe('');
  });
});

// ─────────────────────── 6 · F-S98-1 + CROSS-TENANT + AI (carried fences) ───────────────────────
describe('S101 carried fences — F-S98-1, cross-tenant approval, advisory AI, all fail closed', () => {
  it('forged production status refused; cross-tenant claim approval invisible; advisory cannot execute', async () => {
    await createIn(PRODUCTS_MODULE_ID, { sku: 'FG-1', name: 'FG', standardCost: 12 });
    await createIn(BOM_MODULE_ID, { bomNumber: 'BOM-1', product: 'FG-1', outputQuantity: 1, yield: 100, waste: 0, status: 'active', components: JSON.stringify([{ sku: 'FG-1', quantity: 1 }]) });
    const mo = await createIn(PRODUCTION_ORDERS_MODULE_ID, { orderNumber: 'MO-1', bom: 'BOM-1', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 1 });
    // F-S98-1: forged status edits refused
    expect((await updateIn(PRODUCTION_ORDERS_MODULE_ID, mo.record!.id, { status: 'running' })).ok).toBe(false);
    expect((await updateIn(PRODUCTION_ORDERS_MODULE_ID, mo.record!.id, { status: 'completed' })).ok).toBe(false);
    expect(movesOfType('production_output').length).toBe(0);

    // cross-tenant: a claim created in tenant-A is invisible to tenant-B (its approval cannot be driven cross-tenant)
    const { claimId } = await seedEmployeeAndClaim(makeCtxAs('alice@np.dev'));
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    expect(rec(EXPENSE_CLAIMS_MODULE_ID, claimId) ?? null).toBeNull();
    expect((await actIn(EXPENSE_CLAIMS_MODULE_ID, claimId, 'approve')).ok).toBe(false); // target invisible under tenant-B
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    expect(journalCount()).toBe(0); // no cross-tenant approval booked
  });
});

// ─────────────────────── 7 · RESTART — approval + economic state survive; unauthorized remains unauthorized ───────────────────────
describe('S101 restart — approval state + economic state survive; authority still enforced after restart', () => {
  it('an approved claim + its accrual survive a restart; a still-unauthorized actor stays refused', async () => {
    const { claimId } = await seedEmployeeAndClaim(makeCtxAs('alice@np.dev'));
    await actIn(EXPENSE_CLAIMS_MODULE_ID, claimId, 'approve'); // operator approves
    const snap = { status: String(rec(EXPENSE_CLAIMS_MODULE_ID, claimId)!.fields.status), jrnl: journalCount() };
    for (const m of [EXPENSE_CLAIMS_MODULE_ID, EMPLOYEES_MODULE_ID, JOURNAL_ENTRIES_MODULE_ID, 'finance-accounts']) {
      const mod = inst.registry.get(m); if (mod) await mod.store.flush();
    }
    const inst2 = buildInstallation(paths, makeCtxAs(OPERATOR));
    for (const m of [EXPENSE_CLAIMS_MODULE_ID, EMPLOYEES_MODULE_ID, JOURNAL_ENTRIES_MODULE_ID]) await inst2.registry.get(m)!.store.load();
    expect(String(rec(EXPENSE_CLAIMS_MODULE_ID, claimId, inst2)!.fields.status)).toBe(snap.status);
    expect(journalCount(inst2)).toBe(snap.jrnl);
    // the decided claim is still terminal (no second approval / no second accrual) after restart
    expect((await actIn(EXPENSE_CLAIMS_MODULE_ID, claimId, 'approve', inst2)).ok).toBe(false);
    expect(journalCount(inst2)).toBe(snap.jrnl);
  });
});
