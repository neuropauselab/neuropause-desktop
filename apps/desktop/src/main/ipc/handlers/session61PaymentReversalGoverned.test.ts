/**
 * ERP Session 61 (D4/D6) — GOVERNED PAYMENT REVERSAL through the LIVE
 * platform:command.dispatch path + the FINANCIAL DELETE BOUNDARY.
 *
 * These pins drive the REAL command spine (runSecureHandler → application boundary
 * → command bus → authorization → create the reversal record → durable journal →
 * event → outbox → audit) and the REAL EnterpriseModuleDelete door, proving the
 * command-level negative controls the module test cannot: authorization,
 * tenant-scope validation, cross-tenant invisibility, idempotent replay, durable
 * event/audit, and that DELETE cannot substitute for a reversal.
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
import { createLedgerAccountModule } from '../../enterprise/modules/finance/ledgerAccountModule';
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createInvoiceModule } from '../../enterprise/modules/finance/invoiceModule';
import { createPaymentModule } from '../../enterprise/modules/finance/paymentModule';
import { createVendorBillModule } from '../../enterprise/modules/finance/vendorBillModule';
import { createVendorPaymentModule } from '../../enterprise/modules/finance/vendorPaymentModule';
import { createPaymentReversalModule } from '../../enterprise/modules/finance/paymentReversalModule';
import { PAYMENT_REVERSALS_MODULE_ID } from '../../enterprise/modules/finance/paymentReconcile';
import { DurableCommandJournal } from '../../platform/command/durableCommandJournal';
import { runSecureHandler } from '../secureBridge';
import type { Principal } from '../../platform/application/requestContext';
import { buildPlatformCommandDispatchDef } from './platformCommandIpc';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s61-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};
const PERMS: EnterprisePermission[] = ['operations:read', 'operations:manage', 'sales:read', 'sales:manage'];

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
    broadcast: () => undefined, notify: () => undefined, actor: () => 'op@np.dev', now: () => '2026-09-03T12:00:00.000Z',
  };
}
const fullPrincipal = (over: Partial<Principal> = {}): Principal =>
  ({ actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: PERMS, ...over });

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  audit = []; currentPrincipal = fullPrincipal();
  registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(tmp('acct'));
  accountsStore = accounts.store;
  const invoiceMod = createInvoiceModule(tmp('inv'));
  const paymentMod = createPaymentModule(tmp('pay'), invoiceMod.store);
  const billMod = createVendorBillModule(tmp('bill'));
  const vpayMod = createVendorPaymentModule(tmp('vpay'), billMod.store);
  const reversalMod = createPaymentReversalModule(tmp('rev'), paymentMod.store, vpayMod.store);
  for (const m of [
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    invoiceMod,
    paymentMod,
    billMod,
    vpayMod,
    reversalMod,
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
const payment = (id: string) => registry.get(PAYMENTS_MODULE_ID)!.store.get(id)!;
const reversals = () => registry.get(PAYMENT_REVERSALS_MODULE_ID)!.store.list().filter((r) => r.status !== 'deleted');
function balance(code: string): number {
  const a = accountsStore.list().find((r) => String(r.fields.code) === code);
  return a ? glAccountFromRecord(a).balance : 0;
}
async function flushUntil(pred: () => boolean, ms = 1500): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 5));
}
const AR = '1100', CASH = '1000';

interface DispatchResult { ok: boolean; data?: { id?: string; originalPaymentId?: string }; replayed?: boolean; error?: { code: string; message: string } }
async function dispatch(operation: string, target: string | undefined, idem: string, payload: Record<string, unknown> = {}, claimedTenantId?: string): Promise<DispatchResult> {
  return (await runSecureHandler(
    def,
    { operation, ...(target ? { target } : {}), payload, idempotencyKey: idem, ...(claimedTenantId ? { claimedTenantId } : {}) },
    { isAuthenticated: () => true },
  )) as DispatchResult;
}

// draft invoice → IssueCustomerInvoice (books Dr AR / Cr Revenue). Returns the invoice id.
async function issuedInvoice(number: string, amount: number, idem: string): Promise<string> {
  const inv = await createIn(FINANCE_MODULE_ID, { number, customer: 'Acme', amount, currency: 'USD', taxRate: 0 });
  const id = inv.record!.id;
  expect((await dispatch('IssueCustomerInvoice', id, `iss-${idem}`)).ok).toBe(true);
  await flushUntil(() => balance(AR) === amount);
  return id;
}
// ReceiveCustomerPayment (cleared → Dr Cash / Cr AR). Returns the payment id.
async function clearedPayment(invoiceId: string, amount: number, idem: string): Promise<string> {
  const r = await dispatch('ReceiveCustomerPayment', undefined, `rc-${idem}`, { paymentNumber: `PAY-${idem}`, invoiceRef: invoiceId, amount, method: 'bank_transfer' });
  expect(r.ok, JSON.stringify(r.error)).toBe(true);
  await flushUntil(() => balance(CASH) === amount);
  return r.data!.id!;
}
const reverse = (paymentId: string | undefined, idem: string, reason = 'bounced cheque', claimedTenantId?: string): Promise<DispatchResult> =>
  dispatch('ReverseCustomerPayment', paymentId, `rev-${idem}`, { reason }, claimedTenantId);

describe('S61 · governed ReverseCustomerPayment through the live command spine', () => {
  it('POSITIVE: reversal unwinds cash/AR, re-opens the invoice, leaves the original immutable, and emits event + audit', async () => {
    const invId = await issuedInvoice('INV-1', 900, 'a');
    const payId = await clearedPayment(invId, 900, 'a');
    expect(balance(CASH)).toBe(900);
    expect(balance(AR)).toBe(0);
    const paySnapshot = JSON.stringify(payment(payId).fields);

    const r = await reverse(payId, 'a');
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(reversals()).toHaveLength(1);
    // durable event + audit
    expect(journal.records(scope.tenantId).some((x) => x.event.type === 'CustomerPaymentReversed')).toBe(true);
    expect(audit.length).toBeGreaterThan(0);
    await flushUntil(() => balance(CASH) === 0);
    expect(balance(CASH)).toBe(0); // cash restored
    expect(balance(AR)).toBe(900); // receivable restored
    // invoice re-opened; original payment byte-identical
    expect(String(invoice(invId).fields.status)).toBe('issued');
    expect(Number(invoice(invId).fields.amountPaid)).toBe(0);
    expect(JSON.stringify(payment(payId).fields)).toBe(paySnapshot);
  });

  it('DUPLICATE: reversing the same payment twice is refused — one reversal, one -REV', async () => {
    const invId = await issuedInvoice('INV-2', 500, 'b');
    const payId = await clearedPayment(invId, 500, 'b');
    expect((await reverse(payId, 'b1')).ok).toBe(true);
    await flushUntil(() => reversals().length === 1);
    const second = await reverse(payId, 'b2');
    expect(second.ok).toBe(false);
    expect(reversals()).toHaveLength(1);
  });

  it('IDEMPOTENT replay: same idempotency key returns the first result — one reversal', async () => {
    const invId = await issuedInvoice('INV-3', 400, 'c');
    const payId = await clearedPayment(invId, 400, 'c');
    const first = await reverse(payId, 'c');
    expect(first.ok).toBe(true);
    await flushUntil(() => reversals().length === 1);
    const replay = await reverse(payId, 'c'); // same rev-c key
    expect(replay.replayed).toBe(true);
    expect(reversals()).toHaveLength(1);
  });

  it('UNAUTHORIZED without operations:manage — no reversal', async () => {
    const invId = await issuedInvoice('INV-4', 300, 'd');
    const payId = await clearedPayment(invId, 300, 'd');
    currentPrincipal = fullPrincipal({ permissions: ['operations:read'] });
    const r = await reverse(payId, 'd');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('UNAUTHORIZED');
    expect(reversals()).toHaveLength(0);
  });

  it('TENANT_SCOPE_VIOLATION when the renderer claims a foreign tenant', async () => {
    const invId = await issuedInvoice('INV-5', 300, 'e');
    const payId = await clearedPayment(invId, 300, 'e');
    const r = await reverse(payId, 'e', 'bounced', 'tenant-EVIL');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('TENANT_SCOPE_VIOLATION');
    expect(reversals()).toHaveLength(0);
  });

  it('CROSS-TENANT: a payment from another tenant is invisible → reversal refused', async () => {
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    const invB = await issuedInvoice('INV-B', 300, 'f');
    const payB = await clearedPayment(invB, 300, 'f');
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    currentPrincipal = fullPrincipal();
    const r = await reverse(payB, 'f');
    expect(r.ok).toBe(false); // foreign payment not found in tenant-A
    expect(reversals()).toHaveLength(0);
  });

  it('NONEXISTENT payment → reversal refused', async () => {
    await issuedInvoice('INV-6', 300, 'g'); // seed the store
    const r = await reverse('does-not-exist', 'g');
    expect(r.ok).toBe(false);
    expect(reversals()).toHaveLength(0);
  });

  // ── D6: DELETE cannot substitute for reversal ──
  it('D6: deleting a CLEARED payment is refused and directs to the governed reversal (even with force)', async () => {
    const invId = await issuedInvoice('INV-7', 200, 'h');
    const payId = await clearedPayment(invId, 200, 'h');
    const del = (await H(IpcChannel.EnterpriseModuleDelete)({ moduleId: PAYMENTS_MODULE_ID, id: payId })) as { ok: boolean; errors?: Record<string, string> };
    expect(del.ok).toBe(false);
    expect(JSON.stringify(del.errors)).toMatch(/reverse it through the governed payment reversal/i);
    const delForce = (await H(IpcChannel.EnterpriseModuleDelete)({ moduleId: PAYMENTS_MODULE_ID, id: payId, force: true })) as { ok: boolean };
    expect(delForce.ok).toBe(false); // economic history is not deletable, force or not
    expect(String(payment(payId).status)).not.toBe('deleted');
  });
});
