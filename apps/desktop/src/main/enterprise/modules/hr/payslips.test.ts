import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  PAYSLIPS_MODULE_ID,
  buildPayslipFields,
  formatPayslipText,
  payslipFromRecord,
  payslipNumber,
  type EnterpriseEntity,
  type StatutoryPayrollLine,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLedgerAccountModule } from '../finance/ledgerAccountModule';
import { createJournalEntryModule } from '../finance/journalEntryModule';
import { createEmployeeModule } from './employeeModule';
import { createPayrollRunModule } from './payrollRunModule';
import { createPayslipModule } from './payslipModule';
import { createSalaryStructureModule } from './salaryStructureModule';
import { createStatutoryRuleModule } from './statutoryRuleModule';

const T0 = '2026-08-06T00:00:00.000Z';

const STRUCT = [
  JSON.stringify({ code: 'HRA', name: 'House Rent Allowance', kind: 'earning', calc: 'percentOfBasic', value: 40 }),
  JSON.stringify({ code: 'PROF', name: 'Society Fee', kind: 'deduction', calc: 'fixed', value: 200 }),
].join('\n');

const kinjalLine: StatutoryPayrollLine = {
  employee: 'a', name: 'Kinjal', mode: 'statutory', gross: 28000, basic: 20000,
  earnings: [{ code: 'BASIC', name: 'Basic', amount: 20000 }, { code: 'HRA', name: 'House Rent Allowance', amount: 8000 }],
  contractualDeductions: [{ code: 'PROF', name: 'Society Fee', amount: 200 }],
  pfEmployee: 1800, pfEmployerTotal: 1800, pfEdli: 75, pfAdmin: 75,
  esiEligible: false, esiEmployee: 0, esiEmployer: 0,
  pt: 200, ptSkipped: false, tdsMonthly: 0, otherDeductions: 200, netPay: 25800, note: '',
};

describe('Payslip building + rendering (pure)', () => {
  it('itemizes earnings and only non-zero statutory deductions, derives totals, keeps employer cost separate', () => {
    const fields = buildPayslipFields(kinjalLine, {
      runNumber: 'PAY-2026-08-1', periodKey: '2026-08', employeeNumber: 'EMP-1', generatedAt: T0,
    });
    expect(fields.payslipNumber).toBe('PS-PAY-2026-08-1-EMP-1');
    expect(fields.grossEarnings).toBe(28000);
    expect(fields.netPay).toBe(25800);
    expect(fields.totalDeductions).toBe(2200); // PF 1800 + PT 200 + PROF 200; ESI/TDS zero → not shown
    expect(fields.pfEmployer).toBe(1800);
    const deductions = JSON.parse(String(fields.deductionsJson));
    expect(deductions.map((d: { code: string }) => d.code)).toEqual(['PF', 'PT', 'PROF']); // no ESI/TDS lines
    // Round-trip through a record projection.
    const payslip = payslipFromRecord({ id: 'p1', title: 'x', status: 'active', fields } as unknown as EnterpriseEntity);
    expect(payslip.earnings.map((e) => e.amount)).toEqual([20000, 8000]);
    expect(payslip.deductions).toHaveLength(3);
    const text = formatPayslipText(payslip);
    expect(text).toContain('PAYSLIP — 2026-08');
    expect(text).toContain('Kinjal (EMP-1)');
    expect(text).toContain('House Rent Allowance');
    expect(text).toContain('Employer contributions (not deducted): PF 1800.00, ESI 0.00');
    expect(text).toMatch(/NET PAY\s+25800\.00/);
  });

  it('a flat-salary line renders a single Gross Salary earning and no statutory deductions', () => {
    const flat: StatutoryPayrollLine = {
      employee: 'c', name: 'Saurabh', mode: 'flat', gross: 90000, basic: 0,
      earnings: [{ code: 'GROSS', name: 'Gross Salary', amount: 90000 }], contractualDeductions: [],
      pfEmployee: 0, pfEmployerTotal: 0, pfEdli: 0, pfAdmin: 0,
      esiEligible: false, esiEmployee: 0, esiEmployer: 0,
      pt: 0, ptSkipped: false, tdsMonthly: 0, otherDeductions: 0, netPay: 90000, note: '',
    };
    const fields = buildPayslipFields(flat, { runNumber: 'PAY-2026-08-1', periodKey: '2026-08', employeeNumber: 'EMP-2', generatedAt: T0 });
    expect(fields.totalDeductions).toBe(0);
    expect(fields.netPay).toBe(90000);
    expect(JSON.parse(String(fields.deductionsJson))).toEqual([]);
    expect(payslipNumber('PAY-2026-08-1', 'EMP-2')).toBe('PS-PAY-2026-08-1-EMP-2');
  });
});

describe('Payslip module + payroll run action over real stores', () => {
  let dir: string;
  let structures: EnterpriseModule;
  let statutory: EnterpriseModule;
  let employees: EnterpriseModule;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let runs: EnterpriseModule;
  let payslips: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-payslip-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    structures = createSalaryStructureModule(join(dir, 'structures.json'));
    statutory = createStatutoryRuleModule(join(dir, 'statutory.json'));
    employees = createEmployeeModule(join(dir, 'employees.json'), structures.store);
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    runs = createPayrollRunModule(join(dir, 'runs.json'), employees.store, structures.store, statutory.store);
    payslips = createPayslipModule(join(dir, 'payslips.json'));
    await Promise.all([
      structures.store.load(), statutory.store.load(), employees.store.load(),
      accounts.store.load(), journal.store.load(), runs.store.load(), payslips.store.load(),
    ]);
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) =>
        id === LEDGER_ACCOUNTS_MODULE_ID ? accounts
        : id === JOURNAL_ENTRIES_MODULE_ID ? journal
        : id === PAYSLIPS_MODULE_ID ? payslips
        : null,
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([
      structures.store.flush(), statutory.store.flush(), employees.store.flush(),
      accounts.store.flush(), journal.store.flush(), runs.store.flush(), payslips.store.flush(),
    ]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const create = (module: EnterpriseModule, fields: Record<string, unknown>, title: string): EnterpriseEntity => {
    const v = module.hooks.validate({ fields });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return module.store.create({ title, fields: v.values, actor: 't@np', now: T0 });
  };

  it('generates one immutable payslip per employee from a posted run, idempotently', async () => {
    const s = create(structures, { structureCode: 'STD', structureName: 'Standard', componentsJson: STRUCT }, 'Standard');
    create(statutory, {}, 'IN-FY2026-27');
    create(employees, { employeeNumber: 'EMP-1', name: 'Kinjal', salaryStructureRef: s.id, basicSalary: 20000, workState: 'GJ' }, 'Kinjal');
    create(employees, { employeeNumber: 'EMP-2', name: 'Saurabh', monthlySalary: 90000 }, 'Saurabh');
    const v = runs.hooks.validate({ fields: { periodKey: '2026-08' } });
    if (!v.ok) throw new Error('unreachable');
    const rec = runs.store.create({ title: String(v.values.runNumber), fields: v.values, actor: 't@np', now: T0 });
    // Payslips only after posting.
    expect((await runs.hooks.runAction!('generatePayslips', rec, ctx)).ok).toBe(false);
    await runs.hooks.runAction!('post', rec, ctx);
    const gen = await runs.hooks.runAction!('generatePayslips', runs.store.get(rec.id)!, ctx);
    expect(gen.ok, gen.ok ? '' : gen.error).toBe(true);
    if (gen.ok) expect(String(gen.message)).toContain('Generated 2 payslip(s)');
    expect(payslips.store.list()).toHaveLength(2);
    const kinjal = payslips.store.list().map(payslipFromRecord).find((p) => p.employeeName === 'Kinjal')!;
    expect(kinjal.payslipNumber).toBe('PS-PAY-2026-08-1-EMP-1');
    expect(kinjal.grossEarnings).toBe(28000);
    expect(kinjal.netPay).toBe(25800);
    expect(kinjal.pfEmployee).toBe(1800);
    expect(kinjal.generatedAt).toBe(T0);
    // Idempotent — a second generation adds nothing.
    const again = await runs.hooks.runAction!('generatePayslips', runs.store.get(rec.id)!, ctx);
    if (again.ok) expect(String(again.message)).toContain('skipped 2');
    expect(payslips.store.list()).toHaveLength(2);
    // Immutable — any edit to a generated payslip is refused.
    const slip = payslips.store.list()[0];
    expect(payslips.hooks.validate({ fields: { ...slip.fields, netPay: 999 } }).ok).toBe(false);
  });
});
