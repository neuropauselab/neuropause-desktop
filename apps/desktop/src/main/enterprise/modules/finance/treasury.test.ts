/**
 * Finance → FW-12 Treasury Positions — the pure composition engine (cash
 * selected by the cash-flow statement's own rule, open-invoice receivables,
 * approved-bill payables, net = cash + AR − AP) and the module proof: Refresh
 * derives every figure from the live stores through the runtime context,
 * stamps the statement in place, states which side was counted as zero when a
 * source module is unavailable, and refuses without the chart of accounts.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  FINANCE_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  VENDOR_BILLS_MODULE_ID,
  deriveTreasuryPosition,
  type EnterpriseEntity,
} from '@neuropause/shared';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createInvoiceModule } from './invoiceModule';
import { createVendorBillModule } from './vendorBillModule';
import { createTreasuryPositionModule, REFRESH_TREASURY_ACTION } from './treasuryPositionModule';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';

const T0 = '2026-08-07T15:00:00.000Z';

let entitySeq = 0;
const entity = (fields: Record<string, unknown>, status = 'active'): EnterpriseEntity =>
  ({
    id: `ent-${++entitySeq}`,
    moduleId: 'x', kind: 'x', title: 'x', status,
    fields, tags: [], rev: 0, createdAt: T0, updatedAt: T0, createdBy: null, updatedBy: null, metadata: {},
  }) as unknown as EnterpriseEntity;

describe('Treasury engine (pure)', () => {
  it('cash uses the cash-flow selection rule: tagged cash, or code 1000 on auto; archived/deleted never count', () => {
    const position = deriveTreasuryPosition({
      accounts: [
        entity({ code: '1000', name: 'Cash', class: 'asset', balance: 5000 }), // auto → cash control
        entity({ code: '1020', name: 'HDFC Current', class: 'asset', balance: 2500, cashFlowCategory: 'cash' }),
        entity({ code: '1200', name: 'AR Control', class: 'asset', balance: 9999 }), // not cash
        entity({ code: '1030', name: 'Old Bank', class: 'asset', balance: 100, cashFlowCategory: 'cash' }, 'deleted'),
        entity({ code: '5000', name: 'Expense', class: 'expense', balance: 77, cashFlowCategory: 'operating' }),
      ],
      invoices: [],
      vendorBills: [],
    });
    expect(position.cashAccounts.map((a) => a.code)).toEqual(['1000', '1020']);
    expect(position.cashBalance).toBe(7500);
    expect(position.netPosition).toBe(7500);
  });

  it('receivables = OPEN invoices outstanding; payables = APPROVED bills outstanding; net = cash + AR − AP', () => {
    const position = deriveTreasuryPosition({
      accounts: [entity({ code: '1000', name: 'Cash', class: 'asset', balance: 1000 })],
      invoices: [
        entity({ number: 'INV-1', amount: 800, taxRate: 0, amountPaid: 300, status: 'partially_paid' }), // 500 open
        entity({ number: 'INV-2', amount: 200, taxRate: 0, amountPaid: 0, status: 'issued' }), // 200 open
        entity({ number: 'INV-3', amount: 999, taxRate: 0, amountPaid: 0, status: 'draft' }), // not owed yet
        entity({ number: 'INV-4', amount: 999, taxRate: 0, amountPaid: 999, status: 'paid' }), // done
        entity({ number: 'INV-5', amount: 999, taxRate: 0, amountPaid: 0, status: 'cancelled' }), // dead
      ],
      vendorBills: [
        entity({ billNumber: 'BILL-1', amount: 400, taxRate: 0, amountPaid: 100, status: 'approved' }), // 300 owed
        entity({ billNumber: 'BILL-2', amount: 999, taxRate: 0, amountPaid: 0, status: 'draft' }), // not committed
        entity({ billNumber: 'BILL-3', amount: 999, taxRate: 0, amountPaid: 999, status: 'paid' }), // done
      ],
    });
    expect(position.receivablesOutstanding).toBe(700);
    expect(position.openInvoiceCount).toBe(2);
    expect(position.payablesOutstanding).toBe(300);
    expect(position.openBillCount).toBe(1);
    expect(position.netPosition).toBe(1400); // 1000 + 700 − 300
  });
});

describe('Treasury Positions module over real stores', () => {
  let dir: string;
  let accounts: EnterpriseModule;
  let invoices: EnterpriseModule;
  let bills: EnterpriseModule;
  let treasury: EnterpriseModule;

  const ctx = (omit: string[] = []): EnterpriseModuleActionContext =>
    ({
      actor: () => 'cfo',
      now: () => T0,
      authorize: () => undefined,
      emit: () => undefined,
      moduleFor: (id: string) =>
        omit.includes(id)
          ? null
          : id === LEDGER_ACCOUNTS_MODULE_ID
            ? accounts
            : id === FINANCE_MODULE_ID
              ? invoices
              : id === VENDOR_BILLS_MODULE_ID
                ? bills
                : null,
    }) as unknown as EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-treas-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    invoices = createInvoiceModule(join(dir, 'invoices.json'));
    bills = createVendorBillModule(join(dir, 'bills.json'));
    treasury = createTreasuryPositionModule(join(dir, 'treasury.json'));
    await Promise.all([accounts.store.load(), invoices.store.load(), bills.store.load(), treasury.store.load()]);
    // Books as pre-existing data would sit on disk (module math is not under test here).
    accounts.store.create({ title: '1000 · Cash', fields: { code: '1000', name: 'Cash', class: 'asset', currency: 'USD', balance: 5000 } as EnterpriseEntity['fields'], actor: 't', now: T0 });
    accounts.store.create({ title: '1020 · Bank', fields: { code: '1020', name: 'HDFC Current', class: 'asset', currency: 'USD', balance: 2500, cashFlowCategory: 'cash' } as EnterpriseEntity['fields'], actor: 't', now: T0 });
    invoices.store.create({ title: 'INV-1', fields: { number: 'INV-1', amount: 800, taxRate: 0, amountPaid: 300, status: 'partially_paid' } as EnterpriseEntity['fields'], actor: 't', now: T0 });
    bills.store.create({ title: 'BILL-1', fields: { billNumber: 'BILL-1', amount: 400, taxRate: 0, amountPaid: 100, status: 'approved' } as EnterpriseEntity['fields'], actor: 't', now: T0 });
  });
  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 25));
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      await new Promise((r) => setTimeout(r, 100));
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  const mkStatement = () => {
    const v = treasury.hooks.validate({ fields: { name: 'August cash position' } });
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    return treasury.store.create({ title: 'August cash position', fields: v.values, actor: 't', now: T0 });
  };

  it('REFRESH derives and stamps every figure from the live books', async () => {
    const rec = mkStatement();
    const res = await treasury.hooks.runAction!(REFRESH_TREASURY_ACTION, treasury.store.get(rec.id)!, ctx());
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    expect(res.message).toContain('net 7,700'); // 7500 + 500 − 300
    const f = treasury.store.get(rec.id)!.fields;
    expect(Number(f.cashBalance)).toBe(7500);
    expect(Number(f.receivablesOutstanding)).toBe(500);
    expect(Number(f.payablesOutstanding)).toBe(300);
    expect(Number(f.netPosition)).toBe(7700);
    expect(Number(f.openInvoiceCount)).toBe(1);
    expect(Number(f.openBillCount)).toBe(1);
    expect(String(f.asOfDate)).toBe('2026-08-07');
    expect(JSON.parse(String(f.cashBreakdown))).toHaveLength(2);
    // The books move → the SAME statement re-refreshes in place.
    bills.store.create({ title: 'BILL-2', fields: { billNumber: 'BILL-2', amount: 1000, taxRate: 0, amountPaid: 0, status: 'approved' } as EnterpriseEntity['fields'], actor: 't', now: T0 });
    const again = await treasury.hooks.runAction!(REFRESH_TREASURY_ACTION, treasury.store.get(rec.id)!, ctx());
    expect(again.ok).toBe(true);
    expect(Number(treasury.store.get(rec.id)!.fields.payablesOutstanding)).toBe(1300);
    expect(Number(treasury.store.get(rec.id)!.fields.netPosition)).toBe(6700);
  });

  it('missing sides are STATED, never silent; a missing chart refuses outright', async () => {
    const rec = mkStatement();
    const partial = await treasury.hooks.runAction!(REFRESH_TREASURY_ACTION, treasury.store.get(rec.id)!, ctx([VENDOR_BILLS_MODULE_ID]));
    expect(partial.ok).toBe(true);
    expect(partial.message).toContain('payables counted as 0');
    expect(Number(treasury.store.get(rec.id)!.fields.payablesOutstanding)).toBe(0);
    const refused = await treasury.hooks.runAction!(REFRESH_TREASURY_ACTION, treasury.store.get(rec.id)!, ctx([LEDGER_ACCOUNTS_MODULE_ID]));
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain('Chart of Accounts');
  });
});
