import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createBusinessPlatform, type BusinessPlatform } from './platform';

describe('Modules 6,7,8 — Payroll, Banking, Tax (compute, never execute)', () => {
  let runtime: EnterpriseRuntime;
  let biz: BusinessPlatform;

  beforeAll(() => {
    const clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    biz = createBusinessPlatform(runtime, { clock });
  });

  it('payroll engine computes net pay but NEVER disburses (regulated-external)', async () => {
    await biz.payroll().registerCompensation({ employeeId: 'e1', base: 5000, allowances: [{ name: 'housing', amount: 1000 }], deductions: [{ name: 'pf', amount: 500 }], withholdingRatePct: 10 });
    const slip = biz.payroll().computePayslip('e1');
    expect(slip.gross).toBe(6000);
    expect(slip.taxWithheld).toBe(600);
    expect(slip.net).toBe(4900);
    const run = await biz.payroll().prepareRun('2026-07');
    expect(run.status).toBe('prepared');
    expect(run.evidence).toBe('regulated-external');
    expect(run.note).toMatch(/REGULATED-EXTERNAL/);
  });

  it('banking models a ledger + reconciliation but moves NO money', async () => {
    const acc = await biz.banking().registerAccount({ name: 'Operating' });
    await biz.banking().recordEntry({ accountId: acc.id, amount: 1000, kind: 'credit', memo: 'deposit' });
    await biz.banking().recordEntry({ accountId: acc.id, amount: 300, kind: 'debit', memo: 'bill' });
    expect(biz.banking().cashPosition(acc.id)).toBe(700);
    const pi = await biz.banking().instruct({ fromAccountId: acc.id, toReference: 'vendor-1', amount: 500, rail: 'ach' });
    expect(pi.status).toBe('prepared');
    expect(pi.evidence).toBe('regulated-external');
    expect(biz.banking().reconcile(acc.id, [1000, -300]).reconciled).toBe(true);
  });

  it('tax engine computes tax but NEVER files (regulated-external)', async () => {
    const j = await biz.tax().defineJurisdiction({ name: 'India', country: 'IN' });
    await biz.tax().defineRule({ jurisdictionId: j.id, taxType: 'gst', ratePct: 18 });
    const calc = biz.tax().computeTax({ amount: 1000, jurisdictionId: j.id, taxType: 'gst' });
    expect(calc.tax).toBe(180);
    expect(calc.total).toBe(1180);
    const filing = await biz.tax().prepareFiling({ jurisdictionId: j.id, period: 'Q1', taxDue: 180 });
    expect(filing.status).toBe('prepared');
    expect(filing.evidence).toBe('regulated-external');
  });
});
