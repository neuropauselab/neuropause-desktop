/**
 * ERP Session 25 — ApproveSupplierInvoice (three-way match) through the LIVE platform:command.dispatch
 * path. Reuses the existing vendor-bill `approve` → fail-closed three-way match (PO↔GR↔Bill, billed ≤
 * received cumulative, existing DEFAULT_TOLERANCE) → GRNI relief / AP. No new invoice store, no invented
 * tolerance. Per-(tenant, PO) serialization (S25) closes the concurrent over-billing race.
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
  VENDOR_BILLS_MODULE_ID,
  GOODS_RECEIPTS_MODULE_ID,
  PURCHASE_ORDERS_MODULE_ID,
  JOURNAL_ENTRIES_MODULE_ID,
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
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { createGoodsReceiptModule } from '../../enterprise/modules/procurement/goodsReceiptModule';
import { createVendorBillModule } from '../../enterprise/modules/finance/vendorBillModule';
import { DurableCommandJournal } from '../../platform/command/durableCommandJournal';
import { runSecureHandler } from '../secureBridge';
import type { Principal } from '../../platform/application/requestContext';
import { buildPlatformCommandDispatchDef } from './platformCommandIpc';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s25-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};
const PERMS: EnterprisePermission[] = ['procurement:read', 'procurement:manage', 'inventory:read', 'inventory:manage', 'operations:read', 'operations:manage'];

let scope: TenantScope;
let registry: EnterpriseModuleRegistry;
let handlers: ReturnType<typeof buildModuleHandlers>;
let journal: DurableCommandJournal;
let audit: { action: string; target: string; summary: string }[];
let currentPrincipal: Principal | null;
let def: ReturnType<typeof buildPlatformCommandDispatchDef>;

function moduleCtx(): EnterpriseModuleContext {
  return {
    authorize: () => undefined, audit: (e) => audit.push(e), publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined, notify: () => undefined, actor: () => 'op@np.dev', now: () => '2026-09-01T12:00:00.000Z',
  };
}
const fullPrincipal = (over: Partial<Principal> = {}): Principal =>
  ({ actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: PERMS, ...over });

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  audit = []; currentPrincipal = fullPrincipal();
  registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(tmp('acct'));
  const pos = createPurchaseOrderModule(tmp('po'));
  for (const m of [
    createProductModule(tmp('prod')),
    createStockMovementModule(tmp('mv')),
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    pos,
    createGoodsReceiptModule(tmp('gr')),
    createVendorBillModule(tmp('bill'), pos.store),
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

const H = (c: string) => handlers.find((d) => d.channel === c)!.handler as (p: unknown) => Promise<unknown>;
const createIn = (moduleId: string, fields: Record<string, unknown>) =>
  H(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity }>;
const actIn = (moduleId: string, id: string, action: string) =>
  H(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean }>;
const bill = (id: string) => registry.get(VENDOR_BILLS_MODULE_ID)!.store.get(id)!;
const approvedBills = () => registry.get(VENDOR_BILLS_MODULE_ID)!.store.list().filter((b) => String(b.fields.approvedAt || '') !== '');
const journalLines = () => registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list()
  .flatMap((e) => JSON.parse(String(e.fields.lines ?? '[]')) as { account: string; debit: number; credit: number }[]);
async function flushUntil(pred: () => boolean, ms = 1500): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 5));
}

interface DispatchResult { ok: boolean; data?: { id?: string; status?: string }; replayed?: boolean; error?: { code: string; message: string } }
async function approveInvoice(billId: string, idem: string, claimedTenantId?: string): Promise<DispatchResult> {
  return (await runSecureHandler(
    def,
    { operation: 'ApproveSupplierInvoice', target: billId, payload: {}, idempotencyKey: idem, ...(claimedTenantId ? { claimedTenantId } : {}) },
    { isAuthenticated: () => true },
  )) as DispatchResult;
}

// Seed a product + approved PO(qty) + a POSTED goods receipt(receiveQty), so there is received stock to match.
async function poReceived(qty: number, receiveQty: number, poNumber = 'PO-25'): Promise<string> {
  await createIn('inventory-products', { sku: 'SKU-A', name: 'A', standardCost: 5 });
  const po = await createIn(PURCHASE_ORDERS_MODULE_ID, {
    poNumber, supplier: 'Acme', warehouse: 'WH-1', currency: 'USD',
    lines: JSON.stringify([{ sku: 'SKU-A', quantity: qty, unitPrice: 5 }]),
  });
  await actIn(PURCHASE_ORDERS_MODULE_ID, po.record!.id, 'approve');
  const gr = await createIn(GOODS_RECEIPTS_MODULE_ID, {
    grNumber: `GR-${poNumber}`, purchaseOrder: po.record!.id, supplier: 'Acme', product: 'SKU-A', warehouse: 'WH-1',
    quantityReceived: receiveQty, lines: JSON.stringify([{ sku: 'SKU-A', quantity: receiveQty, poLine: 1 }]),
  });
  expect((await actIn(GOODS_RECEIPTS_MODULE_ID, gr.record!.id, 'post')).ok).toBe(true);
  return po.record!.id;
}
async function draftBill(poId: string, billNumber: string, qty: number): Promise<string> {
  const b = await createIn(VENDOR_BILLS_MODULE_ID, {
    billNumber, vendor: 'Acme', currency: 'USD', amount: qty * 5, sourcePurchaseOrder: poId,
    lines: JSON.stringify([{ sku: 'SKU-A', quantity: qty, unitPrice: 5 }]),
  });
  expect(b.ok).toBe(true);
  return b.record!.id;
}

// ===========================================================================
// Exact three-way match through the live governed path
// ===========================================================================

describe('S25 · ApproveSupplierInvoice — exact three-way match on the live path', () => {
  it('billed = received → approves, emits event + durable journal + audit + relieves GRNI', async () => {
    const po = await poReceived(100, 100);
    const b = await draftBill(po, 'BILL-1', 100);
    const r = await approveInvoice(b, 'a1');
    expect(r.ok).toBe(true);
    expect(journal.records(scope.tenantId)).toHaveLength(1);
    expect(journal.records(scope.tenantId)[0].event.type).toBe('SupplierInvoiceApproved');
    expect(journal.pendingOutbox(scope.tenantId)).toHaveLength(1);
    expect(audit.length).toBeGreaterThan(0);
    expect(String(bill(b).fields.approvedAt)).not.toBe(''); // really approved
    await flushUntil(() => journalLines().length > 0);
    expect(journalLines().length).toBeGreaterThan(0); // GRNI/AP posted (existing engine)
  });

  it('billed > received → three-way match fails closed (CONFLICT), no approval', async () => {
    const po = await poReceived(100, 100);
    const b = await draftBill(po, 'BILL-over', 150); // billing 150 vs received 100
    const r = await approveInvoice(b, 'o1');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('CONFLICT');
    expect(String(bill(b).fields.approvedAt || '')).toBe(''); // still draft
  });

  it('already-approved invoice → re-approve refused (status guard)', async () => {
    const po = await poReceived(100, 100);
    const b = await draftBill(po, 'BILL-dup', 100);
    expect((await approveInvoice(b, 'd1')).ok).toBe(true);
    const again = await approveInvoice(b, 'd2'); // different key → reaches the module, refused
    expect(again.ok).toBe(false);
    expect(again.error!.code).toBe('CONFLICT');
    expect(approvedBills()).toHaveLength(1);
  });

  it('UNAUTHORIZED without operations:manage — no approval', async () => {
    const po = await poReceived(100, 100);
    const b = await draftBill(po, 'BILL-z', 100);
    currentPrincipal = fullPrincipal({ permissions: ['operations:read', 'procurement:read'] });
    const r = await approveInvoice(b, 'z1');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('UNAUTHORIZED');
    expect(String(bill(b).fields.approvedAt || '')).toBe('');
  });

  it('TENANT_SCOPE_VIOLATION when the renderer claims a foreign tenant', async () => {
    const po = await poReceived(100, 100);
    const b = await draftBill(po, 'BILL-t', 100);
    const r = await approveInvoice(b, 't1', 'tenant-EVIL');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('TENANT_SCOPE_VIOLATION');
    expect(String(bill(b).fields.approvedAt || '')).toBe('');
  });
});

// ===========================================================================
// Concurrency invariant (Part 9) — cumulative billed ≤ received under concurrency
// ===========================================================================

describe('S25 · concurrent over-billing invariant', () => {
  it('two DIFFERENT-key invoices of the full qty against one PO → only ONE approves (cumulative ≤ received)', async () => {
    const po = await poReceived(100, 100);
    const b1 = await draftBill(po, 'BILL-c1', 100);
    const b2 = await draftBill(po, 'BILL-c2', 100);
    const [r1, r2] = await Promise.all([approveInvoice(b1, 'c1'), approveInvoice(b2, 'c2')]);
    const okCount = [r1, r2].filter((r) => r.ok).length;
    expect(okCount).toBe(1); // exactly one — the second would over-bill beyond received 100
    expect(approvedBills()).toHaveLength(1);
  });

  it('100 concurrent same-key approvals → one economic effect (idempotency)', async () => {
    const po = await poReceived(100, 100);
    const b = await draftBill(po, 'BILL-once', 100);
    const results = await Promise.all(Array.from({ length: 100 }, () => approveInvoice(b, 'once')));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(approvedBills()).toHaveLength(1);
    expect(journal.records(scope.tenantId)).toHaveLength(1);
  });
});
