/**
 * ERP Session 28 — Order-to-Cash: Customer Invoice → AR through the LIVE platform:command.dispatch
 * path. Two governed commands, both routing EXISTING actions:
 *   InvoiceSalesOrder    → sales-order `convertToInvoice` → DRAFT customer invoice (no GL yet).
 *   IssueCustomerInvoice → finance-invoice `issue`        → Dr AR (1100) / Cr Sales Revenue (4000).
 * No new invoice/AR/GL engine, no invented pricing/tax/numbering/revenue-recognition policy.
 * Eligibility (shipped/fulfilled/closed), already-invoiced guard, amount = order total, tax not
 * re-applied, and the AR journal are all the repository's DEFINED behavior.
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
  FINANCE_MODULE_ID,
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
import { createOrderModule } from '../../enterprise/modules/sales/orderModule';
import { __resetInvoiceConversionChainsForTests } from '../../enterprise/modules/sales/conversion';
import { DurableCommandJournal } from '../../platform/command/durableCommandJournal';
import { runSecureHandler } from '../secureBridge';
import type { Principal } from '../../platform/application/requestContext';
import { buildPlatformCommandDispatchDef } from './platformCommandIpc';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s28-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};
const PERMS: EnterprisePermission[] = ['sales:read', 'sales:manage', 'inventory:read', 'inventory:manage', 'operations:read', 'operations:manage'];

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
  for (const m of [
    createProductModule(tmp('prod')),
    createStockMovementModule(tmp('mv')),
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    createInvoiceModule(tmp('inv')),
    createOrderModule(tmp('so')),
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
  H(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string }>;
const order = (id: string) => registry.get(ORDERS_MODULE_ID)!.store.get(id)!;
const invoices = () => registry.get(FINANCE_MODULE_ID)!.store.list().filter((r) => r.status !== 'deleted');
const invoice = (id: string) => registry.get(FINANCE_MODULE_ID)!.store.get(id)!;
function balance(code: string): number {
  const a = accountsStore.list().find((r) => String(r.fields.code) === code);
  return a ? glAccountFromRecord(a).balance : 0;
}
async function flushUntil(pred: () => boolean, ms = 1500): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 5));
}

interface DispatchResult { ok: boolean; data?: { id?: string; invoiceId?: string; status?: string }; replayed?: boolean; error?: { code: string; message: string } }
async function dispatch(operation: string, target: string | undefined, idem: string, claimedTenantId?: string): Promise<DispatchResult> {
  return (await runSecureHandler(
    def,
    { operation, ...(target ? { target } : {}), payload: {}, idempotencyKey: idem, ...(claimedTenantId ? { claimedTenantId } : {}) },
    { isAuthenticated: () => true },
  )) as DispatchResult;
}
const AR = '1100', REV = '4000';

// Seed on-hand, create a pending SO for `total`, ship it → returns the shipped order id.
async function shippedOrder(total = 900, orderNumber = 'SO-1'): Promise<string> {
  await createIn('inventory-products', { sku: 'SKU-A', name: 'A', standardCost: 5 });
  await createIn(STOCK_MOVEMENTS_MODULE_ID, { movementNumber: `MV-${orderNumber}`, type: 'receive', product: 'SKU-A', warehouse: 'WH-1', quantity: 100 });
  const o = await createIn(ORDERS_MODULE_ID, {
    orderNumber, customer: 'Acme Inc.', product: 'SKU-A', warehouse: 'WH-1', orderedQty: 40, currency: 'USD', total,
  });
  expect(o.ok).toBe(true);
  const id = o.record!.id;
  expect((await dispatch('ShipSalesOrder', id, `ship-${orderNumber}`)).ok).toBe(true);
  expect(String(order(id).fields.status)).toBe('shipped');
  return id;
}

// ===========================================================================
// The O2C invoice → AR chain on the live path
// ===========================================================================

describe('S28 · InvoiceSalesOrder → IssueCustomerInvoice (Customer Invoice → AR)', () => {
  it('invoices a shipped order (draft, no GL) then issuing posts Dr AR / Cr Revenue', async () => {
    const id = await shippedOrder(900, 'SO-1');

    // 1) Invoice the shipped order → DRAFT invoice, NO AR yet.
    const inv = await dispatch('InvoiceSalesOrder', id, 'inv1');
    expect(inv.ok).toBe(true);
    const invoiceId = inv.data!.invoiceId!;
    expect(invoiceId).toBeTruthy();
    expect(String(invoice(invoiceId).fields.status)).toBe('draft');
    expect(String(order(id).fields.convertedInvoice)).toBe(invoiceId);
    expect(journal.records(scope.tenantId).some((r) => r.event.type === 'SalesOrderInvoiced')).toBe(true);
    await flushUntil(() => false, 60); // let any GL onChange settle (there is none for a draft)
    expect(balance(AR)).toBe(0); // a DRAFT posts nothing
    expect(balance(REV)).toBe(0);

    // 2) Issue the invoice → Dr AR / Cr Revenue.
    const iss = await dispatch('IssueCustomerInvoice', invoiceId, 'iss1');
    expect(iss.ok).toBe(true);
    expect(String(invoice(invoiceId).fields.status)).toBe('issued');
    expect(journal.records(scope.tenantId).some((r) => r.event.type === 'CustomerInvoiceIssued')).toBe(true);
    await flushUntil(() => balance(AR) === 900);
    expect(balance(AR)).toBe(900); // Dr AR
    expect(Math.abs(balance(REV))).toBe(900); // Cr Revenue (tax 0 → subtotal == total)
    expect(audit.length).toBeGreaterThan(0);
  });

  it('cannot invoice an UNSHIPPED (pending) order', async () => {
    await createIn('inventory-products', { sku: 'SKU-A', name: 'A', standardCost: 5 });
    const o = await createIn(ORDERS_MODULE_ID, { orderNumber: 'SO-p', customer: 'Acme', product: 'SKU-A', warehouse: 'WH-1', orderedQty: 10, currency: 'USD', total: 90 });
    const r = await dispatch('InvoiceSalesOrder', o.record!.id, 'p1');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('CONFLICT');
    expect(invoices()).toHaveLength(0);
  });

  it('cannot invoice a CANCELLED order', async () => {
    await createIn('inventory-products', { sku: 'SKU-A', name: 'A', standardCost: 5 });
    const o = await createIn(ORDERS_MODULE_ID, { orderNumber: 'SO-x', customer: 'Acme', product: 'SKU-A', warehouse: 'WH-1', orderedQty: 10, currency: 'USD', total: 90 });
    expect((await actIn(ORDERS_MODULE_ID, o.record!.id, 'cancel')).ok).toBe(true);
    const r = await dispatch('InvoiceSalesOrder', o.record!.id, 'x1');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('CONFLICT');
    expect(invoices()).toHaveLength(0);
  });

  it('cannot DOUBLE-invoice an already-invoiced order (one invoice)', async () => {
    const id = await shippedOrder(900, 'SO-d');
    expect((await dispatch('InvoiceSalesOrder', id, 'd1')).ok).toBe(true);
    const again = await dispatch('InvoiceSalesOrder', id, 'd2'); // different key → reaches the module, refused
    expect(again.ok).toBe(false);
    expect(again.error!.code).toBe('CONFLICT');
    expect(invoices()).toHaveLength(1);
  });

  it('cannot RE-ISSUE an already-issued invoice (status guard), no double AR', async () => {
    const id = await shippedOrder(900, 'SO-ri');
    const invoiceId = (await dispatch('InvoiceSalesOrder', id, 'ri1')).data!.invoiceId!;
    expect((await dispatch('IssueCustomerInvoice', invoiceId, 'ri2')).ok).toBe(true);
    await flushUntil(() => balance(AR) === 900);
    const again = await dispatch('IssueCustomerInvoice', invoiceId, 'ri3');
    expect(again.ok).toBe(false);
    expect(again.error!.code).toBe('CONFLICT');
    expect(balance(AR)).toBe(900); // not doubled
  });

  it('UNAUTHORIZED without operations:manage — no invoice', async () => {
    const id = await shippedOrder(900, 'SO-z');
    currentPrincipal = fullPrincipal({ permissions: ['sales:read', 'sales:manage', 'operations:read'] });
    const r = await dispatch('InvoiceSalesOrder', id, 'z1');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('UNAUTHORIZED');
    expect(invoices()).toHaveLength(0);
  });

  it('TENANT_SCOPE_VIOLATION when the renderer claims a foreign tenant', async () => {
    const id = await shippedOrder(900, 'SO-t');
    const r = await dispatch('InvoiceSalesOrder', id, 't1', 'tenant-EVIL');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('TENANT_SCOPE_VIOLATION');
    expect(invoices()).toHaveLength(0);
  });

  it('a foreign-tenant order is invisible → invoice refused (NOT_FOUND)', async () => {
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    const foreign = await shippedOrder(900, 'SO-B');
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    currentPrincipal = fullPrincipal();
    const r = await dispatch('InvoiceSalesOrder', foreign, 'f1');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('NOT_FOUND');
  });
});

// ===========================================================================
// Idempotency + concurrency (reproduce-first) + restart
// ===========================================================================

describe('S28 · idempotency + concurrency + restart', () => {
  it('100 concurrent SAME-key InvoiceSalesOrder → ONE invoice', async () => {
    const id = await shippedOrder(900, 'SO-once');
    const results = await Promise.all(Array.from({ length: 100 }, () => dispatch('InvoiceSalesOrder', id, 'once')));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(invoices()).toHaveLength(1);
    expect(journal.records(scope.tenantId).filter((r) => r.event.type === 'SalesOrderInvoiced')).toHaveLength(1);
  });

  it('100 concurrent SAME-key IssueCustomerInvoice → ONE AR effect (AR = total, not 100x)', async () => {
    const id = await shippedOrder(900, 'SO-iss');
    const invoiceId = (await dispatch('InvoiceSalesOrder', id, 'i-mk')).data!.invoiceId!;
    const results = await Promise.all(Array.from({ length: 100 }, () => dispatch('IssueCustomerInvoice', invoiceId, 'i-once')));
    expect(results.every((r) => r.ok)).toBe(true);
    await flushUntil(() => balance(AR) === 900);
    expect(balance(AR)).toBe(900); // single-flight → one posting, never 90000
    expect(Math.abs(balance(REV))).toBe(900);
  });

  it('two DIFFERENT-key InvoiceSalesOrder of the same order → only ONE invoice', async () => {
    const id = await shippedOrder(900, 'SO-conc');
    const [r1, r2] = await Promise.all([dispatch('InvoiceSalesOrder', id, 'k1'), dispatch('InvoiceSalesOrder', id, 'k2')]);
    expect([r1, r2].filter((r) => r.ok).length).toBe(1); // the convertedInvoice guard admits exactly one
    expect(invoices()).toHaveLength(1);
  });

  it('two DIFFERENT-key IssueCustomerInvoice of the same invoice → only ONE AR effect', async () => {
    const id = await shippedOrder(900, 'SO-ci');
    const invoiceId = (await dispatch('InvoiceSalesOrder', id, 'ci-mk')).data!.invoiceId!;
    const [r1, r2] = await Promise.all([dispatch('IssueCustomerInvoice', invoiceId, 'ck1'), dispatch('IssueCustomerInvoice', invoiceId, 'ck2')]);
    expect([r1, r2].filter((r) => r.ok).length).toBe(1); // the status machine admits exactly one issue
    await flushUntil(() => balance(AR) === 900);
    expect(balance(AR)).toBe(900);
  });

  it('survives restart: durable journal reloads and both keys replay (no second effect)', async () => {
    const id = await shippedOrder(900, 'SO-durable');
    const invoiceId = (await dispatch('InvoiceSalesOrder', id, 'd-inv')).data!.invoiceId!;
    const first = await dispatch('IssueCustomerInvoice', invoiceId, 'd-iss');
    await flushUntil(() => balance(AR) === 900);
    await journal.reload();
    expect(journal.pendingOutbox('tenant-A').length).toBeGreaterThanOrEqual(1);
    const replayInv = await dispatch('InvoiceSalesOrder', id, 'd-inv');
    const replayIss = await dispatch('IssueCustomerInvoice', invoiceId, 'd-iss');
    expect(replayInv.replayed).toBe(true);
    expect(replayIss.replayed).toBe(true);
    expect(replayIss.data!.status).toBe(first.data!.status);
    expect(invoices()).toHaveLength(1);
    expect(balance(AR)).toBe(900); // no second AR posting
  });
});
