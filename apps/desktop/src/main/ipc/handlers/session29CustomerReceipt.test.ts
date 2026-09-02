/**
 * ERP Session 29 — O2C: Customer Receipt → AR settlement through the LIVE platform:command.dispatch
 * path. ONE governed command routing the EXISTING customer-payment engine:
 *   ReceiveCustomerPayment → create `finance-payments` (status cleared) → onChange:
 *     • posts Dr Cash (1000) / Cr Accounts Receivable (1100), and
 *     • reconciles the invoice's paid amount + status from the real payment ledger.
 * No new receipt/AR/cash engine, no invented settlement/cash-account/credit policy. Eligibility
 * (invoice must exist), overpayment refusal, duplicate-transaction-ref refusal, partial accumulation
 * and the AR/Cash journal are all the repository's DEFINED behavior.
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
  PAYMENTS_MODULE_ID,
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
import { createPaymentModule } from '../../enterprise/modules/finance/paymentModule';
import { createOrderModule } from '../../enterprise/modules/sales/orderModule';
import { __resetInvoiceConversionChainsForTests } from '../../enterprise/modules/sales/conversion';
import { DurableCommandJournal } from '../../platform/command/durableCommandJournal';
import { runSecureHandler } from '../secureBridge';
import type { Principal } from '../../platform/application/requestContext';
import { buildPlatformCommandDispatchDef } from './platformCommandIpc';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s29-${tag}-${randomUUID()}.json`);
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
  const invoiceMod = createInvoiceModule(tmp('inv'));
  for (const m of [
    createProductModule(tmp('prod')),
    createStockMovementModule(tmp('mv')),
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    invoiceMod,
    createPaymentModule(tmp('pay'), invoiceMod.store),
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
const invoice = (id: string) => registry.get(FINANCE_MODULE_ID)!.store.get(id)!;
const payments = () => registry.get(PAYMENTS_MODULE_ID)!.store.list().filter((r) => r.status !== 'deleted');
function balance(code: string): number {
  const a = accountsStore.list().find((r) => String(r.fields.code) === code);
  return a ? glAccountFromRecord(a).balance : 0;
}
async function flushUntil(pred: () => boolean, ms = 1500): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 5));
}
const AR = '1100', CASH = '1000';

interface DispatchResult { ok: boolean; data?: { id?: string; invoiceId?: string; status?: string }; replayed?: boolean; error?: { code: string; message: string } }
async function dispatch(operation: string, target: string | undefined, idem: string, payload: Record<string, unknown> = {}, claimedTenantId?: string): Promise<DispatchResult> {
  return (await runSecureHandler(
    def,
    { operation, ...(target ? { target } : {}), payload, idempotencyKey: idem, ...(claimedTenantId ? { claimedTenantId } : {}) },
    { isAuthenticated: () => true },
  )) as DispatchResult;
}
async function receive(invoiceRef: string, amount: number, idem: string, extra: Record<string, unknown> = {}, claimedTenantId?: string): Promise<DispatchResult> {
  return dispatch('ReceiveCustomerPayment', undefined, idem, { paymentNumber: `PAY-${idem}`, invoiceRef, amount, method: 'bank_transfer', ...extra }, claimedTenantId);
}

// Ship → invoice → ISSUE an order's invoice (AR posted). Returns the issued invoice id.
async function issuedInvoice(total = 900, orderNumber = 'SO-1'): Promise<string> {
  await createIn('inventory-products', { sku: 'SKU-A', name: 'A', standardCost: 5 });
  await createIn(STOCK_MOVEMENTS_MODULE_ID, { movementNumber: `MV-${orderNumber}`, type: 'receive', product: 'SKU-A', warehouse: 'WH-1', quantity: 100 });
  const o = await createIn(ORDERS_MODULE_ID, { orderNumber, customer: 'Acme Inc.', product: 'SKU-A', warehouse: 'WH-1', orderedQty: 40, currency: 'USD', total });
  const orderId = o.record!.id;
  expect((await dispatch('ShipSalesOrder', orderId, `ship-${orderNumber}`)).ok).toBe(true);
  const invoiceId = (await dispatch('InvoiceSalesOrder', orderId, `inv-${orderNumber}`)).data!.invoiceId!;
  expect((await dispatch('IssueCustomerInvoice', invoiceId, `iss-${orderNumber}`)).ok).toBe(true);
  await flushUntil(() => balance(AR) === total);
  expect(balance(AR)).toBe(total); // AR booked by the issue
  return invoiceId;
}

// ===========================================================================
// Customer Receipt → AR settlement / Cash
// ===========================================================================

describe('S29 · ReceiveCustomerPayment (Customer Receipt → AR settlement)', () => {
  it('full receipt: Dr Cash / Cr AR settles the invoice to paid + event/audit', async () => {
    const invoiceId = await issuedInvoice(900, 'SO-1');
    const r = await receive(invoiceId, 900, 'rc1');
    expect(r.ok).toBe(true);
    expect(payments()).toHaveLength(1);
    expect(journal.records(scope.tenantId).some((x) => x.event.type === 'CustomerPaymentReceived')).toBe(true);
    expect(journal.pendingOutbox(scope.tenantId).length).toBeGreaterThanOrEqual(1);
    expect(audit.length).toBeGreaterThan(0);
    await flushUntil(() => balance(AR) === 0 && balance(CASH) === 900);
    expect(balance(CASH)).toBe(900); // Dr Cash
    expect(balance(AR)).toBe(0);     // Cr AR — receivable cleared
    expect(String(invoice(invoiceId).fields.status)).toBe('paid');
  });

  it('partial receipts accumulate: 400 then 500 settles a 900 invoice', async () => {
    const invoiceId = await issuedInvoice(900, 'SO-part');
    expect((await receive(invoiceId, 400, 'p-a')).ok).toBe(true);
    await flushUntil(() => balance(AR) === 500);
    expect(balance(CASH)).toBe(400);
    expect(balance(AR)).toBe(500);
    expect(String(invoice(invoiceId).fields.status)).toBe('partially_paid');
    expect((await receive(invoiceId, 500, 'p-b')).ok).toBe(true);
    await flushUntil(() => balance(AR) === 0);
    expect(balance(CASH)).toBe(900);
    expect(balance(AR)).toBe(0);
    expect(String(invoice(invoiceId).fields.status)).toBe('paid');
  });

  it('OVERPAYMENT beyond the invoice balance is refused — no GL', async () => {
    const invoiceId = await issuedInvoice(900, 'SO-over');
    const r = await receive(invoiceId, 1000, 'ov1');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('VALIDATION_ERROR');
    expect(payments()).toHaveLength(0);
    expect(balance(CASH)).toBe(0);
    expect(balance(AR)).toBe(900); // unchanged
  });

  it('DUPLICATE transaction ref is refused', async () => {
    const invoiceId = await issuedInvoice(900, 'SO-dup');
    expect((await receive(invoiceId, 400, 'd-a', { transactionRef: 'TXN-1' })).ok).toBe(true);
    const dup = await receive(invoiceId, 400, 'd-b', { transactionRef: 'TXN-1' });
    expect(dup.ok).toBe(false);
    expect(dup.error!.code).toBe('VALIDATION_ERROR');
    expect(payments()).toHaveLength(1);
  });

  it('a NONEXISTENT invoice ref is refused — no GL', async () => {
    await issuedInvoice(900, 'SO-nx'); // seed a real invoice so the store is non-empty
    const r = await receive('INV-does-not-exist', 100, 'nx1');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('VALIDATION_ERROR');
    expect(balance(CASH)).toBe(0);
  });

  it('UNAUTHORIZED without operations:manage — no receipt', async () => {
    const invoiceId = await issuedInvoice(900, 'SO-z');
    currentPrincipal = fullPrincipal({ permissions: ['sales:read', 'operations:read'] });
    const r = await receive(invoiceId, 900, 'z1');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('UNAUTHORIZED');
    expect(payments()).toHaveLength(0);
    expect(balance(AR)).toBe(900);
  });

  it('TENANT_SCOPE_VIOLATION when the renderer claims a foreign tenant', async () => {
    const invoiceId = await issuedInvoice(900, 'SO-t');
    const r = await receive(invoiceId, 900, 't1', {}, 'tenant-EVIL');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('TENANT_SCOPE_VIOLATION');
    expect(payments()).toHaveLength(0);
  });

  it("a foreign-tenant invoice is invisible → receipt refused (no matching invoice)", async () => {
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    const foreignInv = await issuedInvoice(900, 'SO-B');
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    currentPrincipal = fullPrincipal();
    const r = await receive(foreignInv, 900, 'f1');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('VALIDATION_ERROR'); // invisible in tenant-A → "no matching invoice"
    expect(payments()).toHaveLength(0);
  });
});

// ===========================================================================
// Idempotency + concurrency (reproduce-first) + restart
// ===========================================================================

describe('S29 · idempotency + concurrency + restart', () => {
  it('100 concurrent SAME-key receipts → ONE payment + ONE Cash/AR effect', async () => {
    const invoiceId = await issuedInvoice(900, 'SO-once');
    const results = await Promise.all(Array.from({ length: 100 }, () => receive(invoiceId, 900, 'once')));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(payments()).toHaveLength(1);
    await flushUntil(() => balance(CASH) === 900);
    expect(balance(CASH)).toBe(900); // single-flight → one posting, never 90000
    expect(balance(AR)).toBe(0);
    expect(journal.records(scope.tenantId).filter((x) => x.event.type === 'CustomerPaymentReceived')).toHaveLength(1);
  });

  it('two DIFFERENT-key full receipts against one invoice → exactly ONE succeeds (AR overpayment invariant holds)', async () => {
    const invoiceId = await issuedInvoice(900, 'SO-conc');
    const [r1, r2] = await Promise.all([receive(invoiceId, 900, 'k1'), receive(invoiceId, 900, 'k2')]);
    expect([r1, r2].filter((r) => r.ok).length).toBe(1); // the second sees the first applied → overpayment refused
    await flushUntil(() => balance(CASH) === 900);
    expect(balance(CASH)).toBe(900); // never 1800
    expect(balance(AR)).toBe(0);
    expect(payments()).toHaveLength(1);
  });

  it('survives restart: durable journal reloads and the key replays (no second receipt/GL)', async () => {
    const invoiceId = await issuedInvoice(900, 'SO-durable');
    const first = await receive(invoiceId, 900, 'durable');
    await flushUntil(() => balance(CASH) === 900);
    await journal.reload();
    expect(journal.pendingOutbox('tenant-A').length).toBeGreaterThanOrEqual(1);
    const replay = await receive(invoiceId, 900, 'durable');
    expect(replay.replayed).toBe(true);
    expect(replay.data!.id).toBe(first.data!.id);
    expect(payments()).toHaveLength(1);
    expect(balance(CASH)).toBe(900); // no second Dr Cash / Cr AR
    expect(balance(AR)).toBe(0);
  });
});
