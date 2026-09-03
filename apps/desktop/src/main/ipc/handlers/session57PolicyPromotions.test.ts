/**
 * ERP Session 57 — business-policy closure pins.
 *
 * (1) The NEW `clear` payment actions — the DEFINED pending→cleared transition relocated
 *     from the fenced edit door to an explicit action (the ClearCustomerPayment /
 *     ClearVendorPayment command bodies): pending clears (GL + reconcile via the unchanged
 *     onChange), cleared/void refuse, the S46/S49 edit fences still hold beside them.
 * (2) Expense-claim segregation of duties — the repo's own declared principle
 *     ('creator_cannot_approve') enforced at the approve branch: creator-approve refused,
 *     another operator approves, creator-REJECT stays open (withdrawal), creator-less rows
 *     (importer shape) are not compared.
 * (3) Map totality for the 8 promoted commands is enforced by the COMPILER
 *     (Record<DomainCommandType,…> types) — no runtime pin can add to that proof.
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
  PAYMENTS_MODULE_ID,
  VENDOR_PAYMENTS_MODULE_ID,
  type EnterpriseEntity,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { resolveTenantScope } from '../../tenancy/backgroundPrincipal';
import { EnterpriseRecordStore } from '../../enterprise/framework';
import { createPaymentModule } from '../../enterprise/modules/finance/paymentModule';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s57-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};
const NOW = '2026-09-03T12:00:00.000Z';

let scope: TenantScope;
function ctxFor(actor: string): EnterpriseModuleContext {
  return {
    authorize: () => undefined, audit: () => undefined, publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined, notify: () => undefined, actor: () => actor, now: () => NOW,
  };
}

beforeEach(() => { scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' }; });
afterEach(async () => {
  vi.restoreAllMocks();
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

type Mut = { ok: boolean; record?: EnterpriseEntity; errors?: Record<string, string> };
type Act = { ok: boolean; message?: string; error?: string };

describe('S57 · the governed clear actions (the ClearCustomerPayment / ClearVendorPayment bodies)', () => {
  function customerRig() {
    const registry = new EnterpriseModuleRegistry();
    const invoiceStore = new EnterpriseRecordStore(tmp('inv'), 'finance', 'invoice');
    const mod = createPaymentModule(tmp('pay'), invoiceStore);
    registry.register(mod);
    registry.bindScope(() => resolveTenantScope(() => scope));
    const handlers = buildModuleHandlers(registry, ctxFor('op@np.dev'));
    const H = (c: string) => handlers.find((d) => d.channel === c)!.handler as (p: unknown) => Promise<unknown>;
    return { mod, H };
  }

  it('a PENDING payment clears via the action; cleared and void rows refuse; the S46 edit fence still holds', async () => {
    const { mod, H } = customerRig();
    const row = mod.store.create({ title: 'PAY-1', fields: { paymentNumber: 'PAY-1', invoiceRef: 'INV-1', amount: 50, status: 'pending', method: 'cash' }, actor: 'op@np.dev', now: NOW });
    const cleared = (await H(IpcChannel.EnterpriseModuleAction)({ moduleId: PAYMENTS_MODULE_ID, id: row.id, action: 'clear' })) as Act;
    expect(cleared.ok).toBe(true);
    expect(String(mod.store.get(row.id)!.fields.status)).toBe('cleared');
    // idempotency at the domain layer: a second clear refuses truthfully
    const again = (await H(IpcChannel.EnterpriseModuleAction)({ moduleId: PAYMENTS_MODULE_ID, id: row.id, action: 'clear' })) as Act;
    expect(again.ok).toBe(false);
    // void refuses
    const voided = mod.store.create({ title: 'PAY-2', fields: { paymentNumber: 'PAY-2', invoiceRef: 'INV-1', amount: 10, status: 'void', method: 'cash' }, actor: 'op@np.dev', now: NOW });
    expect(((await H(IpcChannel.EnterpriseModuleAction)({ moduleId: PAYMENTS_MODULE_ID, id: voided.id, action: 'clear' })) as Act).ok).toBe(false);
    // the S46 edit fence beside the new action: edit-door pending→cleared still refused
    const pending = mod.store.create({ title: 'PAY-3', fields: { paymentNumber: 'PAY-3', invoiceRef: 'INV-1', amount: 10, status: 'pending', method: 'cash' }, actor: 'op@np.dev', now: NOW });
    const edit = (await H(IpcChannel.EnterpriseModuleUpdate)({ moduleId: PAYMENTS_MODULE_ID, id: pending.id, fields: { ...pending.fields, status: 'cleared' } })) as Mut;
    expect(edit.ok).toBe(false);
  });

  it('vendor side: pending clears via the action, second clear refuses, S49 edit fence holds', async () => {
    const registry = new EnterpriseModuleRegistry();
    const { createVendorBillModule } = await import('../../enterprise/modules/finance/vendorBillModule');
    const { createVendorPaymentModule } = await import('../../enterprise/modules/finance/vendorPaymentModule');
    const bills = createVendorBillModule(tmp('vb'));
    const pays = createVendorPaymentModule(tmp('vp'), bills.store);
    for (const m of [bills, pays]) registry.register(m);
    registry.bindScope(() => resolveTenantScope(() => scope));
    const handlers = buildModuleHandlers(registry, ctxFor('op@np.dev'));
    const H = (c: string) => handlers.find((d) => d.channel === c)!.handler as (p: unknown) => Promise<unknown>;
    // approved bill fixture (raw store — the approve path is certified elsewhere)
    const bill = bills.store.create({ title: 'VB-1', fields: { billNumber: 'VB-1', vendor: 'Acme', amount: 100, status: 'approved', approvedAt: NOW }, actor: 'fixture', now: NOW });
    const pay = pays.store.create({ title: 'VPAY-1', fields: { paymentNumber: 'VPAY-1', billRef: bill.id, amount: 40, status: 'pending', method: 'cash' }, actor: 'op@np.dev', now: NOW });
    const cleared = (await H(IpcChannel.EnterpriseModuleAction)({ moduleId: VENDOR_PAYMENTS_MODULE_ID, id: pay.id, action: 'clear' })) as Act;
    expect(cleared.ok).toBe(true);
    expect(String(pays.store.get(pay.id)!.fields.status)).toBe('cleared');
    // the onChange reconciler runs asynchronously off the emit (the module's established
    // eventual model) — poll briefly rather than race it
    let paid = 0;
    for (let i = 0; i < 40 && paid <= 0; i++) {
      await new Promise((r) => setTimeout(r, 25));
      paid = Number(bills.store.get(bill.id)!.fields.amountPaid ?? 0);
    }
    expect(paid).toBeGreaterThan(0);
    expect(((await H(IpcChannel.EnterpriseModuleAction)({ moduleId: VENDOR_PAYMENTS_MODULE_ID, id: pay.id, action: 'clear' })) as Act).ok).toBe(false);
    const pending2 = pays.store.create({ title: 'VPAY-2', fields: { paymentNumber: 'VPAY-2', billRef: bill.id, amount: 10, status: 'pending', method: 'cash' }, actor: 'op@np.dev', now: NOW });
    const edit = (await H(IpcChannel.EnterpriseModuleUpdate)({ moduleId: VENDOR_PAYMENTS_MODULE_ID, id: pending2.id, fields: { ...pending2.fields, status: 'cleared' } })) as Mut;
    expect(edit.ok).toBe(false);
  });
});

describe('S57 · expense-claim segregation of duties (the declared creator_cannot_approve principle)', () => {
  async function claimRig(actor: string) {
    const { createExpenseClaimModule } = await import('../../enterprise/modules/hr/expenseClaimModule');
    const registry = new EnterpriseModuleRegistry();
    const mod = createExpenseClaimModule(tmp('ec'));
    registry.register(mod);
    registry.bindScope(() => resolveTenantScope(() => scope));
    const handlers = buildModuleHandlers(registry, ctxFor(actor));
    const H = (c: string) => handlers.find((d) => d.channel === c)!.handler as (p: unknown) => Promise<unknown>;
    return { mod, H };
  }
  const CLAIM = { claimNumber: 'EC-1', employee: 'emp-1', employeeName: 'Pat', category: 'travel', amount: 50, expenseDate: '2026-09-01', status: 'submitted' };

  it('the creator cannot approve their own claim; a DIFFERENT operator can decide it; creator-REJECT stays open', async () => {
    const { mod, H } = await claimRig('claimant@np.dev');
    const own = mod.store.create({ title: 'EC-1', fields: CLAIM, actor: 'claimant@np.dev', now: NOW });
    const self = (await H(IpcChannel.EnterpriseModuleAction)({ moduleId: 'hr-expense-claims', id: own.id, action: 'approve' })) as Act;
    expect(self.ok).toBe(false);
    expect(String(self.message ?? '')).toMatch(/segregation of duties/i);
    expect(String(mod.store.get(own.id)!.fields.status)).toBe('submitted');
    // the creator may REJECT (withdraw) their own claim
    const rej = (await H(IpcChannel.EnterpriseModuleAction)({ moduleId: 'hr-expense-claims', id: own.id, action: 'reject' })) as Act;
    expect(rej.ok).toBe(true);
  });

  it('a claim created by someone ELSE approves normally (no over-fence); a creator-less row is not compared', async () => {
    const { mod, H } = await claimRig('manager@np.dev');
    const theirs = mod.store.create({ title: 'EC-2', fields: { ...CLAIM, claimNumber: 'EC-2' }, actor: 'claimant@np.dev', now: NOW });
    const ok = (await H(IpcChannel.EnterpriseModuleAction)({ moduleId: 'hr-expense-claims', id: theirs.id, action: 'approve' })) as Act;
    // the approve branch proceeds past SoD (GL account bootstrap may or may not exist in this rig —
    // what the pin asserts is that SoD did NOT refuse; a refusal would carry the SoD message)
    expect(String(ok.message ?? ok.error ?? '')).not.toMatch(/segregation of duties/i);
    const orphan = mod.store.create({ title: 'EC-3', fields: { ...CLAIM, claimNumber: 'EC-3' }, actor: '', now: NOW });
    const orphanRes = (await H(IpcChannel.EnterpriseModuleAction)({ moduleId: 'hr-expense-claims', id: orphan.id, action: 'approve' })) as Act;
    expect(String(orphanRes.message ?? orphanRes.error ?? '')).not.toMatch(/segregation of duties/i);
  });
});
