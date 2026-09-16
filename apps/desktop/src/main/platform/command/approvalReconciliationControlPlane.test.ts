/**
 * ERP Session 102 — ENTERPRISE APPROVAL-ENGINE RECONCILIATION & AUTHORITY CONTROL-PLANE CERTIFICATION.
 *
 * Reconciles the three approval subsystems (DECISION-MEMO-S102) and proves the canonical authority path
 * holds — WITHOUT unifying them into one engine and WITHOUT inventing/adopting any threshold or SoD policy.
 *
 * The load-bearing structural fact: the erp/approvalEngine (threshold + SoD) is consulted ONLY at the
 * generic Update/SetStatus doors via `canEnterStatus`, but the two documents that carry a registered
 * approval policy (procurement-orders, finance-vendor-bills) have MACHINE-OWNED statuses those doors cannot
 * change. So the policy engine is DORMANT on every consequential path — not bypassed — and the sole,
 * consistent gate is the governed action + RBAC scope + machine-owned status (certified S94–S101).
 *
 * Part A: the S20 workflow ApprovalInstance record cannot become an authority bypass (tenant-scoped,
 * idempotent, single-flight, terminal, no generic-edit door).
 * Part B: the approvalEngine is dormant (PO/vendor-bill status un-forgeable via Update) and the live gate
 * is the action + RBAC; the one live SoD (expense creator≠approver) still holds; unauthorized ⇒ zero
 * economic effect; F-S98-1; restart persistence.
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
  VENDOR_BILLS_MODULE_ID,
  EXPENSE_CLAIMS_MODULE_ID,
  EMPLOYEES_MODULE_ID,
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
import { createVendorBillModule } from '../../enterprise/modules/finance/vendorBillModule';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { createEmployeeModule } from '../../enterprise/modules/hr/employeeModule';
import { createExpenseClaimModule } from '../../enterprise/modules/hr/expenseClaimModule';
import { createProductionOrderModule } from '../../enterprise/modules/manufacturing/productionOrderModule';
import { createBomModule } from '../../enterprise/modules/manufacturing/bomModule';
import { ApprovalInstanceStore } from '../workflow/approvalInstanceStore';

const MV = 'inventory-movements';
const allPaths: string[] = [];
const tmpFile = (t: string): string => { const f = join(tmpdir(), `np-s102-${t}-${randomUUID()}.json`); allPaths.push(f); return f; };

// ─────────────────────── PART A · S20 APPROVAL-INSTANCE INTEGRITY ───────────────────────
describe('S102 approval-record integrity — the S20 ApprovalInstance cannot become an authority bypass', () => {
  let store: ApprovalInstanceStore;
  beforeEach(async () => { store = new ApprovalInstanceStore(tmpFile('apr')); await store.load(); });
  afterEach(async () => { await store.destroy().catch(() => undefined); for (const p of allPaths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined); });
  const req = (t = 'tenant-A') => store.requestApproval({ tenantId: t, targetModule: 'procurement-requests', targetId: 'pr-1', gatedCommand: 'ConvertPurchaseRequestToPO', requester: 'alice@np.dev', correlationId: 'c', now: '2026-09-30T12:00:00.000Z' });

  it('requestApproval is idempotent (one PENDING per gated action); decide is single-flight and idempotent', async () => {
    const a1 = await req();
    const a2 = await req();
    expect(a2.id).toBe(a1.id); // one PENDING per (tenant, target, gated command)
    expect(a1.status).toBe('PENDING');
    const d1 = await store.decide({ tenantId: 'tenant-A', approvalId: a1.id, decision: 'APPROVE', approver: 'bob@np.dev', now: 'T1' });
    expect(d1.ok && d1.approval!.status).toBe('APPROVED');
    expect(d1.ok && d1.approval!.approver).toBe('bob@np.dev'); // approver recorded
    // replay of the SAME decision is idempotent (no second transition)
    const d2 = await store.decide({ tenantId: 'tenant-A', approvalId: a1.id, decision: 'APPROVE', approver: 'carol@np.dev', now: 'T2' });
    expect(d2.ok && d2.replayed).toBe(true);
    expect(store.get('tenant-A', a1.id)!.approver).toBe('bob@np.dev'); // approver not overwritten by the replay
  });

  it('approval after a terminal/contrary decision fails closed (no re-open, no reversal)', async () => {
    const a = await req();
    await store.decide({ tenantId: 'tenant-A', approvalId: a.id, decision: 'REJECT', approver: 'bob@np.dev', now: 'T1' });
    // approve after reject → CONFLICT (a rejected approval cannot be flipped to approved)
    const flip = await store.decide({ tenantId: 'tenant-A', approvalId: a.id, decision: 'APPROVE', approver: 'bob@np.dev', now: 'T2' });
    expect(flip.ok).toBe(false);
    expect(!flip.ok && flip.error).toBe('CONFLICT');
    expect(store.get('tenant-A', a.id)!.status).toBe('REJECTED'); // terminal
  });

  it('a foreign-tenant actor cannot see or decide another tenant approval', async () => {
    const a = await req('tenant-A');
    expect(store.get('tenant-B', a.id)).toBeUndefined(); // invisible cross-tenant
    const foreign = await store.decide({ tenantId: 'tenant-B', approvalId: a.id, decision: 'APPROVE', approver: 'evil@np.dev', now: 'T1' });
    expect(foreign.ok).toBe(false);
    expect(!foreign.ok && foreign.error).toBe('NOT_FOUND');
    expect(store.get('tenant-A', a.id)!.status).toBe('PENDING'); // untouched
  });

  it('approval state survives a restart (rebuild over the same file); a decided approval stays decided', async () => {
    const a = await req();
    await store.decide({ tenantId: 'tenant-A', approvalId: a.id, decision: 'APPROVE', approver: 'bob@np.dev', now: 'T1' });
    const path = allPaths[allPaths.length - 1];
    const store2 = new ApprovalInstanceStore(path);
    await store2.load();
    expect(store2.get('tenant-A', a.id)!.status).toBe('APPROVED');
    // a replay after restart is still idempotent (no second effect)
    const replay = await store2.decide({ tenantId: 'tenant-A', approvalId: a.id, decision: 'APPROVE', approver: 'bob@np.dev', now: 'T2' });
    expect(replay.ok && replay.replayed).toBe(true);
    await store2.destroy().catch(() => undefined);
  });
});

// ─────────────────────── PART B · APPROVAL-ENGINE DORMANCY + CANONICAL GATE ───────────────────────
let scope: TenantScope | null;
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
  const po = createPurchaseOrderModule(paths.po);
  const employees = createEmployeeModule(paths.emp);
  for (const m of [
    createProductModule(paths.prod), createStockMovementModule(paths.mv), accounts,
    createJournalEntryModule(paths.jrnl, accounts.store),
    po, createVendorBillModule(paths.bill, po.store), employees,
    createExpenseClaimModule(paths.exp, employees.store),
    createProductionOrderModule(paths.mo), createBomModule(paths.bom),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  return { registry, handlers: buildModuleHandlers(registry, ctx) };
}
let bPaths: Record<string, string>;
let ctx: EnterpriseModuleContext;
let inst: ReturnType<typeof buildInstallation>;
const OP = 'operator@np.dev';
function freshB(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ['prod', 'mv', 'acct', 'jrnl', 'po', 'bill', 'emp', 'exp', 'mo', 'bom']) out[id] = tmpFile(id);
  return out;
}
describe('S102 canonical gate — the approvalEngine is dormant (machine-owned statuses); action + RBAC is the sole gate', () => {
  beforeEach(() => { scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' }; bPaths = freshB(); ctx = makeCtxAs(OP); inst = buildInstallation(bPaths, ctx); });
  afterEach(async () => { vi.restoreAllMocks(); for (const p of allPaths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined); });
  const handlerFor = (ch: string, c: EnterpriseModuleContext) => { const h = buildModuleHandlers(inst.registry, c); const d = h.find((x) => x.channel === ch); if (!d) throw new Error(`no handler ${ch}`); return d.handler as (p: unknown) => Promise<unknown>; };
  const handler = (ch: string) => { const d = inst.handlers.find((x) => x.channel === ch); if (!d) throw new Error(`no handler ${ch}`); return d.handler as (p: unknown) => Promise<unknown>; };
  const createIn = (m: string, f: Record<string, unknown>) => handler(IpcChannel.EnterpriseModuleCreate)({ moduleId: m, fields: f }) as Promise<{ ok: boolean; record?: EnterpriseEntity }>;
  const actIn = (m: string, id: string, a: string) => handler(IpcChannel.EnterpriseModuleAction)({ moduleId: m, id, action: a }) as Promise<{ ok: boolean; message?: string; error?: string }>;
  const updateIn = (m: string, id: string, f: Record<string, unknown>) => handler(IpcChannel.EnterpriseModuleUpdate)({ moduleId: m, id, fields: f }) as Promise<{ ok: boolean; error?: string; errors?: Record<string, string> }>;
  const setStatusIn = (m: string, id: string, status: string) => handler(IpcChannel.EnterpriseModuleSetStatus)({ moduleId: m, id, status }) as Promise<{ ok: boolean; errors?: Record<string, string> }>;
  const rec = (m: string, id: string) => inst.registry.get(m)!.store.get(id);
  const listIn = (m: string) => inst.registry.get(m)!.store.list();
  const jcount = () => listIn(JOURNAL_ENTRIES_MODULE_ID).filter((r) => r.status !== 'deleted').length;
  const movesOfType = (t: string) => listIn(MV).filter((m) => m.status !== 'deleted' && String(m.fields.type) === t);

  it('PO approval — RBAC is the enforced floor on BOTH doors; SetStatus cannot forge; approved→draft reversal refused', async () => {
    // PO status is a DUAL-DOOR model (DECISION-MEMO-S102): the Update door is RBAC + the spend-policy engine
    // (`canEnterStatus`, wired in production via documentIntegration — NOT wired in this harness), and the
    // approve action is RBAC + the state machine (poTransition). Both doors authorize `procurement:manage`
    // first, so RBAC is the consistent floor; the spend-policy adoption on the action door is an operator
    // ruling (S90), deliberately NOT invented here.
    await createIn(PRODUCTS_MODULE_ID, { sku: 'SKU-1', name: 'Widget', standardCost: 5 });
    const po = await createIn(PURCHASE_ORDERS_MODULE_ID, { poNumber: 'PO-1', product: 'SKU-1', warehouse: 'WH-1', quantity: 10, unitCost: 5, supplier: 'V-1', status: 'draft' });
    const id = po.record!.id;
    // SetStatus is record-status only (active/archived/deleted) — it cannot set the domain 'approved'
    expect((await setStatusIn(PURCHASE_ORDERS_MODULE_ID, id, 'approved')).ok).toBe(false);
    // the governed action approves (RBAC + machine transition)
    expect((await actIn(PURCHASE_ORDERS_MODULE_ID, id, 'approve')).ok).toBe(true);
    expect(String(rec(PURCHASE_ORDERS_MODULE_ID, id)!.fields.status)).toBe('approved');
    // an approved PO cannot be silently reverted to draft via the edit door (S49/S50 fence)
    expect((await updateIn(PURCHASE_ORDERS_MODULE_ID, id, { status: 'draft' })).ok).toBe(false);
    expect(String(rec(PURCHASE_ORDERS_MODULE_ID, id)!.fields.status)).toBe('approved');
    // RBAC floor: an unauthorized principal cannot approve a PO through the action door (zero effect)
    const po2 = await createIn(PURCHASE_ORDERS_MODULE_ID, { poNumber: 'PO-2', product: 'SKU-1', warehouse: 'WH-1', quantity: 5, unitCost: 5, supplier: 'V-1', status: 'draft' });
    const advApprove = handlerFor(IpcChannel.EnterpriseModuleAction, makeCtxAs('ai@np.dev', ['procurement:manage']));
    let refused = false;
    try { const r = (await advApprove({ moduleId: PURCHASE_ORDERS_MODULE_ID, id: po2.record!.id, action: 'approve' })) as { ok: boolean }; refused = r.ok === false; } catch { refused = true; }
    expect(refused).toBe(true);
    expect(String(rec(PURCHASE_ORDERS_MODULE_ID, po2.record!.id)!.fields.status)).toBe('draft');
    // the unauthorized principal ALSO cannot approve via the edit door (RBAC authorized first on Update too)
    const advUpdate = handlerFor(IpcChannel.EnterpriseModuleUpdate, makeCtxAs('ai@np.dev', ['procurement:manage']));
    let updRefused = false;
    try { const r = (await advUpdate({ moduleId: PURCHASE_ORDERS_MODULE_ID, id: po2.record!.id, fields: { status: 'approved' } })) as { ok: boolean }; updRefused = r.ok === false; } catch { updRefused = true; }
    expect(updRefused).toBe(true);
    expect(String(rec(PURCHASE_ORDERS_MODULE_ID, po2.record!.id)!.fields.status)).toBe('draft');
  });

  it('a vendor-bill status cannot be forged to approved via the edit door — the approved marker is action-only', async () => {
    const bill = await createIn(VENDOR_BILLS_MODULE_ID, { billNumber: 'BILL-1', vendor: 'V-1', currency: 'USD', amount: 500, status: 'draft', lines: JSON.stringify([{ sku: 'SKU-1', quantity: 10, unitPrice: 5 }]) });
    const id = bill.record!.id;
    // forge status → approved via Update: refused (marker-derived, canEnterStatus never governs it)
    expect((await updateIn(VENDOR_BILLS_MODULE_ID, id, { status: 'approved' })).ok === false || String(rec(VENDOR_BILLS_MODULE_ID, id)!.fields.status) !== 'approved').toBe(true);
    // forge the approvedAt marker directly via Update: refused (markers move only through the actions)
    expect((await updateIn(VENDOR_BILLS_MODULE_ID, id, { approvedAt: '2026-09-30T00:00:00.000Z' })).ok).toBe(false);
    expect(String(rec(VENDOR_BILLS_MODULE_ID, id)!.fields.status)).not.toBe('approved');
    expect(jcount()).toBe(0); // no GL booked by any forge attempt
  });

  it('F-S98-1 holds: forged production status is refused with no economic effect', async () => {
    await createIn(PRODUCTS_MODULE_ID, { sku: 'FG-1', name: 'FG', standardCost: 12 });
    await createIn(BOM_MODULE_ID, { bomNumber: 'BOM-1', product: 'FG-1', outputQuantity: 1, yield: 100, waste: 0, status: 'active', components: JSON.stringify([{ sku: 'FG-1', quantity: 1 }]) });
    const mo = await createIn(PRODUCTION_ORDERS_MODULE_ID, { orderNumber: 'MO-1', bom: 'BOM-1', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 1 });
    expect((await updateIn(PRODUCTION_ORDERS_MODULE_ID, mo.record!.id, { status: 'running' })).ok).toBe(false);
    expect((await updateIn(PRODUCTION_ORDERS_MODULE_ID, mo.record!.id, { status: 'completed' })).ok).toBe(false);
    expect(movesOfType('production_output').length).toBe(0);
  });
});

// ─────────────────────── PART C · CARRIED SoD FENCE (S101) ───────────────────────
describe('S102 carried fence — the one live SoD (expense creator≠approver) still holds after reconciliation', () => {
  beforeEach(() => { scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' }; bPaths = freshB(); ctx = makeCtxAs(OP); inst = buildInstallation(bPaths, ctx); });
  afterEach(async () => { vi.restoreAllMocks(); for (const p of allPaths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined); });
  const handlerFor = (ch: string, c: EnterpriseModuleContext) => { const h = buildModuleHandlers(inst.registry, c); const d = h.find((x) => x.channel === ch); if (!d) throw new Error(`no handler ${ch}`); return d.handler as (p: unknown) => Promise<unknown>; };
  const handler = (ch: string) => { const d = inst.handlers.find((x) => x.channel === ch); if (!d) throw new Error(`no handler ${ch}`); return d.handler as (p: unknown) => Promise<unknown>; };
  const createIn = (m: string, f: Record<string, unknown>) => handler(IpcChannel.EnterpriseModuleCreate)({ moduleId: m, fields: f }) as Promise<{ ok: boolean; record?: EnterpriseEntity }>;
  const rec = (m: string, id: string) => inst.registry.get(m)!.store.get(id);
  const jcount = () => inst.registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list().filter((r) => r.status !== 'deleted').length;

  it('a creator cannot approve their own expense claim; a different operator can; the refusal books zero GL', async () => {
    const emp = await createIn(EMPLOYEES_MODULE_ID, { employeeNumber: 'EMP-1', name: 'Sam' });
    const creator = makeCtxAs('alice@np.dev');
    const claim = (await handlerFor(IpcChannel.EnterpriseModuleCreate, creator)({ moduleId: EXPENSE_CLAIMS_MODULE_ID, fields: { employee: emp.record!.id, category: 'travel', expenseDate: '2026-09-10', amount: 250, description: 'Taxi' } })) as { ok: boolean; record?: EnterpriseEntity };
    const selfApprove = (await handlerFor(IpcChannel.EnterpriseModuleAction, creator)({ moduleId: EXPENSE_CLAIMS_MODULE_ID, id: claim.record!.id, action: 'approve' })) as { ok: boolean };
    expect(selfApprove.ok).toBe(false);
    expect(jcount()).toBe(0);
    // a different operator (server actor ≠ creator) approves → GL booked once
    expect(((await handler(IpcChannel.EnterpriseModuleAction)({ moduleId: EXPENSE_CLAIMS_MODULE_ID, id: claim.record!.id, action: 'approve' })) as { ok: boolean }).ok).toBe(true);
    expect(String(rec(EXPENSE_CLAIMS_MODULE_ID, claim.record!.id)!.fields.status)).toBe('approved');
    expect(jcount()).toBe(1);
  });
});
