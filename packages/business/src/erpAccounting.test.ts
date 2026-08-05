import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createBusinessPlatform, type BusinessPlatform } from './platform';

describe('Modules 4,5 — ERP posting engine + Accounting', () => {
  let runtime: EnterpriseRuntime;
  let biz: BusinessPlatform;

  beforeAll(() => {
    const clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    biz = createBusinessPlatform(runtime, { clock });
  });

  it('the posting engine REJECTS an unbalanced entry and posts a balanced one', async () => {
    const erp = biz.erp();
    const cash = await erp.createAccount({ code: '1000', name: 'Cash', class: 'asset' });
    const rev = await erp.createAccount({ code: '4000', name: 'Revenue', class: 'revenue' });
    const bad = await erp.createJournalEntry({ memo: 'bad', lines: [{ accountId: cash.id, debit: 100, credit: 0 }, { accountId: rev.id, debit: 0, credit: 50 }] });
    await expect(erp.post(bad.id)).rejects.toThrow(/unbalanced/);
    const good = await erp.createJournalEntry({ memo: 'sale', lines: [{ accountId: cash.id, debit: 100, credit: 0 }, { accountId: rev.id, debit: 0, credit: 100 }] });
    await erp.post(good.id);
    expect(erp.accountBalance(cash.id)).toBe(100);
    expect(erp.accountBalance(rev.id)).toBe(100);
    expect(erp.trialBalance().balanced).toBe(true);
  });

  it('financial statements are EMPTY until data, then derived from posted balances', () => {
    const clock = new ManualClock(1);
    const rt = createEnterpriseRuntime({ clock });
    const fresh = createBusinessPlatform(rt, { clock });
    const empty = fresh.accounting().financialStatements();
    expect(empty.hasData).toBe(false);
    expect(empty.revenue).toBe(0);
    expect(empty.note).toMatch(/no accounting data/i);
    // biz has one posted sale (revenue 100)
    const stmt = biz.accounting().financialStatements();
    expect(stmt.hasData).toBe(true);
    expect(stmt.revenue).toBe(100);
  });

  it('AR invoices start empty; a payment settles the LEDGER only (bank settlement is regulated)', async () => {
    expect(biz.accounting().count()).toBe(0);
    const inv = await biz.accounting().createInvoice({ kind: 'receivable', partyId: 'cust-1', amount: 1000 });
    await biz.accounting().issueInvoice(inv.id);
    expect(biz.accounting().receivablesOutstanding()).toBe(1000);
    const pay = await biz.accounting().recordPayment(inv.id, 1000);
    expect(pay.note).toMatch(/regulated-external/i);
    expect(biz.accounting().invoices('receivable')[0]!.status).toBe('paid');
    expect(biz.accounting().receivablesOutstanding()).toBe(0);
  });

  it('computes a straight-line depreciation schedule', async () => {
    const asset = await biz.accounting().createFixedAsset({ name: 'Server', cost: 12000, usefulLifeYears: 3 });
    const schedule = biz.accounting().depreciation(asset.id);
    expect(schedule.length).toBe(3);
    expect(schedule[0]!.expense).toBe(4000);
    expect(schedule[2]!.bookValue).toBe(0);
  });
});
