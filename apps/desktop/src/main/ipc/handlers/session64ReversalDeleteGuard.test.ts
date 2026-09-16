/**
 * ERP Session 64 — the reversal-record DELETE boundary (the S63 census's STOP-class find).
 *
 * Before this fence, a forced delete of a `finance-payment-reversals` row flipped the
 * invoice/bill back to PAID through the shared reconciler while the booked `${base}-REV`
 * GL entry stayed uncompensated — an un-reversal wearing a delete, destroying a record
 * whose own validate hook declares it "immutable historical evidence". The fence is ONE
 * entry in the EXISTING canonical ECONOMIC_DELETE_GUARD (no second guard, no new policy):
 * unconditional refusal, independent of `force`, reached BEFORE any dependency assessment
 * or reconciliation side effect. Rig mirrors session61PaymentReversalGoverned (the live
 * command spine + the real delete door + real GL balances).
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
  VENDOR_BILLS_MODULE_ID,
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
  const p = join(tmpdir(), `np-s64-${tag}-${randomUUID()}.json`);
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
const fullPrincipal = (): Principal =>
  ({ actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: PERMS });

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
  for (const m of [accounts, createJournalEntryModule(tmp('jrnl'), accounts.store), invoiceMod, paymentMod, billMod, vpayMod, reversalMod])
    registry.register(m);
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
const deleteIn = (moduleId: string, id: string, force?: boolean) =>
  H(IpcChannel.EnterpriseModuleDelete)({ moduleId, id, ...(force ? { force: true } : {}) }) as Promise<{ ok: boolean; errors?: Record<string, string> }>;
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

interface DispatchResult { ok: boolean; data?: { id?: string }; replayed?: boolean; error?: { code: string; message: string } }
async function dispatch(operation: string, target: string | undefined, idem: string, payload: Record<string, unknown> = {}): Promise<DispatchResult> {
  return (await runSecureHandler(
    def,
    { operation, ...(target ? { target } : {}), payload, idempotencyKey: idem },
    { isAuthenticated: () => true },
  )) as DispatchResult;
}

async function customerReversalFixture(tag: string, amount: number): Promise<{ invId: string; payId: string; revId: string }> {
  const inv = await createIn(FINANCE_MODULE_ID, { number: `INV-${tag}`, customer: 'Acme', amount, currency: 'USD', taxRate: 0 });
  const invId = inv.record!.id;
  expect((await dispatch('IssueCustomerInvoice', invId, `iss-${tag}`)).ok).toBe(true);
  await flushUntil(() => balance(AR) === amount);
  const pay = await dispatch('ReceiveCustomerPayment', undefined, `rc-${tag}`, { paymentNumber: `PAY-${tag}`, invoiceRef: invId, amount, method: 'bank_transfer' });
  expect(pay.ok, JSON.stringify(pay.error)).toBe(true);
  await flushUntil(() => balance(CASH) === amount);
  const rev = await dispatch('ReverseCustomerPayment', pay.data!.id!, `rev-${tag}`, { reason: 'bounced cheque' });
  expect(rev.ok, JSON.stringify(rev.error)).toBe(true);
  await flushUntil(() => reversals().length >= 1 && balance(CASH) === 0);
  return { invId, payId: pay.data!.id!, revId: reversals()[reversals().length - 1].id };
}

describe('S64 · the reversal record cannot be deleted (the un-reversal delete door closed)', () => {
  it('A+C+G: customer reversal delete REFUSED (plain and force) — zero mutation to record, payment, invoice, GL, journal, and the refusal precedes any reconciliation side effect', async () => {
    const { invId, payId, revId } = await customerReversalFixture('a', 900);
    // post-reversal truth: cash back to 0, AR restored, invoice re-opened
    expect(balance(CASH)).toBe(0);
    expect(balance(AR)).toBe(900);
    expect(String(invoice(invId).fields.status)).toBe('issued');
    const revSnapshot = JSON.stringify(reversals()[0].fields);
    const paySnapshot = JSON.stringify(payment(payId).fields);
    const invSnapshot = JSON.stringify(invoice(invId).fields);
    const journalCount = journal.records(scope.tenantId).length;

    const del = await deleteIn(PAYMENT_REVERSALS_MODULE_ID, revId);
    expect(del.ok).toBe(false);
    expect(String(del.errors?._ ?? '')).toMatch(/immutable historical evidence/i);
    const delForce = await deleteIn(PAYMENT_REVERSALS_MODULE_ID, revId, true);
    expect(delForce.ok).toBe(false);

    // C — NOTHING moved: the reversal row survives untouched, the original payment is
    // byte-identical, the invoice stays re-opened (no flip back to paid), GL balances
    // unchanged, and the durable journal gained no record from the refused deletes.
    expect(reversals()).toHaveLength(1);
    expect(JSON.stringify(reversals()[0].fields)).toBe(revSnapshot);
    expect(JSON.stringify(payment(payId).fields)).toBe(paySnapshot);
    expect(JSON.stringify(invoice(invId).fields)).toBe(invSnapshot);
    expect(balance(CASH)).toBe(0);
    expect(balance(AR)).toBe(900);
    expect(journal.records(scope.tenantId).length).toBe(journalCount);
    // G — ordering: the refusal came from the ECONOMIC guard (its message), which the
    // delete handler consults BEFORE the dependency assessment and BEFORE any store
    // mutation — the zero-mutation snapshots above are the behavioral proof.
  });

  it('B: vendor reversal record delete REFUSED (plain and force), bill stays re-opened', async () => {
    const bill = await createIn(VENDOR_BILLS_MODULE_ID, { billNumber: 'VB-s64', vendor: 'Acme', amount: 400 });
    // approve via the raw store (the approve path is certified elsewhere; this pin targets the delete door)
    registry.get(VENDOR_BILLS_MODULE_ID)!.store.update(bill.record!.id, { fields: { ...bill.record!.fields, status: 'approved', approvedAt: '2026-09-03T11:00:00.000Z' }, actor: 'fixture', now: '2026-09-03T11:00:00.000Z' });
    const vpay = await dispatch('PaySupplierInvoice', undefined, 'vp-s64', { paymentNumber: 'VPAY-s64', billRef: bill.record!.id, amount: 400, method: 'bank_transfer' });
    expect(vpay.ok, JSON.stringify(vpay.error)).toBe(true);
    const rev = await dispatch('ReverseVendorPayment', vpay.data!.id!, 'vrev-s64', { reason: 'wrong vendor' });
    expect(rev.ok, JSON.stringify(rev.error)).toBe(true);
    await flushUntil(() => reversals().length === 1);
    const revId = reversals()[0].id;

    expect((await deleteIn(PAYMENT_REVERSALS_MODULE_ID, revId)).ok).toBe(false);
    expect((await deleteIn(PAYMENT_REVERSALS_MODULE_ID, revId, true)).ok).toBe(false);
    expect(reversals()).toHaveLength(1);
    // bill remains re-opened by the reversal (not flipped back to paid by the refused delete)
    const billNow = registry.get(VENDOR_BILLS_MODULE_ID)!.store.get(bill.record!.id)!;
    expect(String(billNow.fields.status)).not.toBe('paid');
  });

  it('D+E: the legitimate reversal path is untouched — a NEW reversal still works and same-key replay stays idempotent', async () => {
    const { payId } = await customerReversalFixture('d', 300);
    const replay = await dispatch('ReverseCustomerPayment', payId, 'rev-d', { reason: 'bounced cheque' });
    expect(replay.ok).toBe(true);
    expect(replay.replayed).toBe(true);
    expect(reversals()).toHaveLength(1); // one reversal, ever
  });

  it('F: cross-tenant delete of a reversal is invisible (tenant isolation precedes the guard)', async () => {
    const { revId } = await customerReversalFixture('f', 100);
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    const del = await deleteIn(PAYMENT_REVERSALS_MODULE_ID, revId, true);
    expect(del.ok).toBe(false); // not found in tenant-B's scope — never reaches the guard
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    expect(reversals()).toHaveLength(1);
  });
});
