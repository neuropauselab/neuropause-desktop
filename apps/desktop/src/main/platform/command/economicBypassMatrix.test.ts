/**
 * ERP Session 103 — CONSEQUENTIALLY GOVERNED FINANCE, INVENTORY & MANUFACTURING AUTHORITY.
 *
 * The economic-bypass matrix (PHASE 9/10): for the remaining consequential operations, prove that NO door
 * (edit / SetStatus / action / delete / cross-tenant / replay / terminal / onChange) lets an unauthorized or
 * forging actor cause an economic mutation — and that every implemented posting flows ONLY through its
 * RBAC-gated action. No approval policy is invented; no threshold or dual-control added.
 *
 * Reproduce-first established (DECISION-MEMO-S103): every economic posting (payroll accrual, disbursement,
 * stock adjustment, cycle-count reconcile, production output) lives INSIDE its RBAC-gated action — never in
 * an onChange-on-status — so a forged status via the edit door creates NO economic effect (contrast the
 * F-S98-1 class, which was an onChange-on-status forge and is fenced by a machine-owned status). Posted
 * records are immutable (markers + the S97/S55/S61/S64 delete guards).
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
  STOCK_ADJUSTMENTS_MODULE_ID,
  CYCLE_COUNTS_MODULE_ID,
  PAYROLL_RUNS_MODULE_ID,
  EMPLOYEES_MODULE_ID,
  VENDOR_PAYMENTS_MODULE_ID,
  PAYMENTS_MODULE_ID,
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
import { createStockAdjustmentModule } from '../../enterprise/modules/warehouse/stockAdjustmentModule';
import { createCycleCountModule } from '../../enterprise/modules/warehouse/cycleCountModule';
import { createPayrollRunModule } from '../../enterprise/modules/hr/payrollRunModule';
import { createEmployeeModule } from '../../enterprise/modules/hr/employeeModule';
import { createVendorPaymentModule } from '../../enterprise/modules/finance/vendorPaymentModule';
import { createPaymentModule } from '../../enterprise/modules/finance/paymentModule';
import { createInvoiceModule } from '../../enterprise/modules/finance/invoiceModule';
import { createVendorBillModule } from '../../enterprise/modules/finance/vendorBillModule';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { createProductionOrderModule } from '../../enterprise/modules/manufacturing/productionOrderModule';
import { createBomModule } from '../../enterprise/modules/manufacturing/bomModule';

const MV = 'inventory-movements';
const allPaths: string[] = [];
const tmpFile = (t: string): string => { const f = join(tmpdir(), `np-s103-${t}-${randomUUID()}.json`); allPaths.push(f); return f; };

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
  const employees = createEmployeeModule(paths.emp);
  const po = createPurchaseOrderModule(paths.po);
  const invoices = createInvoiceModule(paths.inv);
  const bills = createVendorBillModule(paths.bill, po.store);
  for (const m of [
    createProductModule(paths.prod), createStockMovementModule(paths.mv), accounts,
    createJournalEntryModule(paths.jrnl, accounts.store),
    createStockAdjustmentModule(paths.adj), createCycleCountModule(paths.cc),
    employees, createPayrollRunModule(paths.pay, employees.store),
    invoices, createPaymentModule(paths.cpay, invoices.store),
    po, bills, createVendorPaymentModule(paths.vpay, bills.store),
    createProductionOrderModule(paths.mo), createBomModule(paths.bom),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  return { registry, handlers: buildModuleHandlers(registry, ctx) };
}

let paths: Record<string, string>;
let ctx: EnterpriseModuleContext;
let inst: ReturnType<typeof buildInstallation>;
function freshPaths(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ['prod', 'mv', 'acct', 'jrnl', 'adj', 'cc', 'emp', 'pay', 'inv', 'cpay', 'po', 'bill', 'vpay', 'mo', 'bom']) out[id] = tmpFile(id);
  return out;
}
beforeEach(() => { scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' }; paths = freshPaths(); ctx = makeCtxAs(OP); inst = buildInstallation(paths, ctx); });
afterEach(async () => { vi.restoreAllMocks(); for (const p of allPaths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined); });

const handlerFor = (ch: string, c: EnterpriseModuleContext) => { const h = buildModuleHandlers(inst.registry, c); const d = h.find((x) => x.channel === ch); if (!d) throw new Error(`no handler ${ch}`); return d.handler as (p: unknown) => Promise<unknown>; };
const handler = (ch: string) => { const d = inst.handlers.find((x) => x.channel === ch); if (!d) throw new Error(`no handler ${ch}`); return d.handler as (p: unknown) => Promise<unknown>; };
const createIn = (m: string, f: Record<string, unknown>) => handler(IpcChannel.EnterpriseModuleCreate)({ moduleId: m, fields: f }) as Promise<{ ok: boolean; record?: EnterpriseEntity; errors?: Record<string, string> }>;
const actIn = (m: string, id: string, a: string) => handler(IpcChannel.EnterpriseModuleAction)({ moduleId: m, id, action: a }) as Promise<{ ok: boolean; message?: string; error?: string }>;
const updateIn = (m: string, id: string, f: Record<string, unknown>) => handler(IpcChannel.EnterpriseModuleUpdate)({ moduleId: m, id, fields: f }) as Promise<{ ok: boolean; error?: string; errors?: Record<string, string> }>;
const deleteIn = (m: string, id: string) => handler(IpcChannel.EnterpriseModuleDelete)({ moduleId: m, id }) as Promise<{ ok: boolean; errors?: Record<string, string> }>;
const listIn = (m: string) => inst.registry.get(m)!.store.list();
const rec = (m: string, id: string) => inst.registry.get(m)!.store.get(id);
const jcount = () => listIn(JOURNAL_ENTRIES_MODULE_ID).filter((r) => r.status !== 'deleted').length;
const movesOfType = (t: string) => listIn(MV).filter((m) => m.status !== 'deleted' && String(m.fields.type) === t);
async function seedStock() {
  await createIn(PRODUCTS_MODULE_ID, { sku: 'SKU-1', name: 'Widget', standardCost: 5 });
  await createIn(MV, { movementNumber: 'MV-SEED', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });
}
async function tryUnauthorized(ch: string, payload: Record<string, unknown>, deny: EnterprisePermission[]): Promise<boolean> {
  const h = handlerFor(ch, makeCtxAs('ai@np.dev', deny));
  try { const r = (await h(payload)) as { ok: boolean }; return r.ok === false; } catch { return true; }
}

// ─────────────────────── 1 · STOCK ADJUSTMENT — economic-bypass matrix ───────────────────────
describe('S103 stock adjustment — no door lets an unauthorized/forging actor mutate inventory', () => {
  it('a forged status=posted via the edit door creates NO movement and no GL; the post action then refuses', async () => {
    await seedStock();
    const adj = await createIn(STOCK_ADJUSTMENTS_MODULE_ID, { adjustmentNumber: 'ADJ-1', product: 'SKU-1', warehouse: 'WH-1', quantity: -10, reason: 'lost' });
    const id = adj.record!.id;
    const before = movesOfType('adjustment').length;
    // FORGE: set status=posted via the generic edit door. Posting is in the ACTION, not an onChange, so NO movement.
    await updateIn(STOCK_ADJUSTMENTS_MODULE_ID, id, { status: 'posted' });
    expect(movesOfType('adjustment').length).toBe(before); // zero inventory mutation from the forge
    expect(String(rec(STOCK_ADJUSTMENTS_MODULE_ID, id)!.fields.adjustmentMovement ?? '')).toBe(''); // no movement id — the forge is economically inert
    expect(jcount()).toBe(0);
    // and the post action now refuses (it requires status draft) — the forge is self-defeating
    if (String(rec(STOCK_ADJUSTMENTS_MODULE_ID, id)!.fields.status) === 'posted') {
      expect((await actIn(STOCK_ADJUSTMENTS_MODULE_ID, id, 'post')).ok).toBe(false);
      expect(movesOfType('adjustment').length).toBe(before);
    }
  });

  it('an unauthorized actor cannot post an adjustment via the action; the authorized action posts exactly one movement', async () => {
    await seedStock();
    const adj = await createIn(STOCK_ADJUSTMENTS_MODULE_ID, { adjustmentNumber: 'ADJ-2', product: 'SKU-1', warehouse: 'WH-1', quantity: -10, reason: 'lost' });
    const before = movesOfType('adjustment').length;
    expect(await tryUnauthorized(IpcChannel.EnterpriseModuleAction, { moduleId: STOCK_ADJUSTMENTS_MODULE_ID, id: adj.record!.id, action: 'post' }, ['warehouse:manage', 'inventory:manage'])).toBe(true);
    expect(movesOfType('adjustment').length).toBe(before); // zero movement, zero GL
    expect(jcount()).toBe(0);
    // authorized: exactly one adjustment movement (proves the refusal was authority, not a broken path)
    expect((await actIn(STOCK_ADJUSTMENTS_MODULE_ID, adj.record!.id, 'post')).ok).toBe(true);
    expect(movesOfType('adjustment').length).toBe(before + 1);
    // the posted adjustment movement is an immutable ledger row (S97) — cannot be deleted
    const mv = movesOfType('adjustment')[0];
    expect((await deleteIn(MV, mv.id)).ok).toBe(false);
  });
});

// ─────────────────────── 2 · CYCLE COUNT — unauthorized cannot post the variance ───────────────────────
describe('S103 cycle count — an unauthorized actor cannot reconcile a variance into an inventory movement', () => {
  it('unauthorized reconcile is refused with zero movement; the authorized reconcile posts the variance', async () => {
    await seedStock();
    const cc = await createIn(CYCLE_COUNTS_MODULE_ID, { countNumber: 'CC-1', product: 'SKU-1', warehouse: 'WH-1', systemQuantity: 100, countedQuantity: 90 });
    const before = movesOfType('adjustment').length;
    expect(await tryUnauthorized(IpcChannel.EnterpriseModuleAction, { moduleId: CYCLE_COUNTS_MODULE_ID, id: cc.record!.id, action: 'reconcile' }, ['warehouse:manage', 'inventory:manage'])).toBe(true);
    expect(movesOfType('adjustment').length).toBe(before);
    // authorized reconcile posts the −10 variance adjustment
    expect((await actIn(CYCLE_COUNTS_MODULE_ID, cc.record!.id, 'reconcile')).ok).toBe(true);
    expect(movesOfType('adjustment').length).toBe(before + 1);
  });
});

// ─────────────────────── 3 · PAYROLL — RBAC + action-gated posting; status forge inert ───────────────────────
describe('S103 payroll — an unauthorized actor cannot create/post a run; the status cannot be forged', () => {
  it('unauthorized create is refused; a run status is read-only (a forge via edit does not post an accrual)', async () => {
    await createIn(EMPLOYEES_MODULE_ID, { employeeNumber: 'EMP-1', name: 'Sam' });
    // unauthorized (no operations:manage) cannot create a payroll run
    expect(await tryUnauthorized(IpcChannel.EnterpriseModuleCreate, { moduleId: PAYROLL_RUNS_MODULE_ID, fields: { periodKey: '2026-09' } }, ['operations:manage'])).toBe(true);
    // an authorized run is created as a preview; posting the accrual is only via the `post` action (not an edit)
    const run = await createIn(PAYROLL_RUNS_MODULE_ID, { periodKey: '2026-09' });
    expect(run.ok).toBe(true);
    const jBefore = jcount();
    // FORGE: set postedAt/status via the edit door → refused/inert (readonly status + the postedAt-immutability validate)
    await updateIn(PAYROLL_RUNS_MODULE_ID, run.record!.id, { status: 'posted', postedAt: '2026-09-30T00:00:00.000Z' });
    expect(String(rec(PAYROLL_RUNS_MODULE_ID, run.record!.id)!.fields.status)).not.toBe('posted');
    expect(jcount()).toBe(jBefore); // no accrual booked by the forge attempt
  });
});

// ─────────────────────── 4 · PAYMENT REVERSAL — cleared payments (customer + vendor) undeletable ───────────────────────
describe('S103 payment reversal — a cleared payment (customer or vendor) cannot be deleted (S61/S64)', () => {
  it('a cleared vendor payment and a cleared customer payment both refuse deletion', async () => {
    // construct cleared payment records directly in their stores (the economic-delete guard reads status)
    const vpay = inst.registry.get(VENDOR_PAYMENTS_MODULE_ID)!.store.create({ title: 'VPAY-1', fields: { paymentNumber: 'VPAY-1', billRef: 'BILL-1', vendor: 'V-1', amount: 100, status: 'cleared' }, actor: OP, now: '2026-09-30T12:00:00.000Z' });
    const cpay = inst.registry.get(PAYMENTS_MODULE_ID)!.store.create({ title: 'RCPT-1', fields: { paymentNumber: 'RCPT-1', invoiceRef: 'INV-1', amount: 100, status: 'cleared' }, actor: OP, now: '2026-09-30T12:00:00.000Z' });
    const dv = await deleteIn(VENDOR_PAYMENTS_MODULE_ID, vpay.id);
    expect(dv.ok).toBe(false);
    expect(String(Object.values(dv.errors ?? {})[0] ?? '')).toMatch(/cleared vendor payment|reverse it|cannot be deleted/i);
    const dc = await deleteIn(PAYMENTS_MODULE_ID, cpay.id);
    expect(dc.ok).toBe(false);
    expect(String(Object.values(dc.errors ?? {})[0] ?? '')).toMatch(/cleared payment|reverse it|cannot be deleted/i);
  });
});

// ─────────────────────── 5 · F-S98-1 + CROSS-TENANT (carried fences) ───────────────────────
describe('S103 carried fences — F-S98-1 machine-owned production status; cross-tenant isolation', () => {
  it('forged production status refused with zero economic effect; another tenant sees no adjustment ledger', async () => {
    await createIn(PRODUCTS_MODULE_ID, { sku: 'FG-1', name: 'FG', standardCost: 12 });
    await createIn(BOM_MODULE_ID, { bomNumber: 'BOM-1', product: 'FG-1', outputQuantity: 1, yield: 100, waste: 0, status: 'active', components: JSON.stringify([{ sku: 'FG-1', quantity: 1 }]) });
    const mo = await createIn(PRODUCTION_ORDERS_MODULE_ID, { orderNumber: 'MO-1', bom: 'BOM-1', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 1 });
    expect((await updateIn(PRODUCTION_ORDERS_MODULE_ID, mo.record!.id, { status: 'completed' })).ok).toBe(false);
    expect(movesOfType('production_output').length).toBe(0);
    // cross-tenant: tenant-A's adjustment ledger is invisible to tenant-B
    await seedStock();
    const adj = await createIn(STOCK_ADJUSTMENTS_MODULE_ID, { adjustmentNumber: 'ADJ-X', product: 'SKU-1', warehouse: 'WH-1', quantity: -5, reason: 'lost' });
    await actIn(STOCK_ADJUSTMENTS_MODULE_ID, adj.record!.id, 'post');
    const movesA = movesOfType('adjustment').length;
    expect(movesA).toBe(1);
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    expect(listIn(MV).length).toBe(0); // tenant-B sees no ledger
    expect(listIn(STOCK_ADJUSTMENTS_MODULE_ID).length).toBe(0);
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    expect(movesOfType('adjustment').length).toBe(movesA); // untouched
  });
});
