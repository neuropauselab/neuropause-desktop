import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  deriveBankAdvice,
  disbursementClearingLines,
  formatBankAdvice,
  glAccountFromRecord,
  hasCompleteBankDetails,
  type EmployeeBankDetails,
  type EnterpriseEntity,
  type StatutoryPayrollRun,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLedgerAccountModule } from '../finance/ledgerAccountModule';
import { createJournalEntryModule } from '../finance/journalEntryModule';
import { createEmployeeModule } from './employeeModule';
import { createPayrollRunModule } from './payrollRunModule';
import { createSalaryDisbursementModule } from './salaryDisbursementModule';
import { createSalaryStructureModule } from './salaryStructureModule';
import { createStatutoryRuleModule } from './statutoryRuleModule';

const T0 = '2026-08-06T00:00:00.000Z';

const STRUCT = [
  JSON.stringify({ code: 'HRA', name: 'House Rent Allowance', kind: 'earning', calc: 'percentOfBasic', value: 40 }),
  JSON.stringify({ code: 'PROF', name: 'Society Fee', kind: 'deduction', calc: 'fixed', value: 200 }),
].join('\n');

// A minimal run snapshot — only the fields deriveBankAdvice reads.
const runSnapshot = (lines: Array<{ employee: string; name: string; netPay: number }>): StatutoryPayrollRun =>
  ({ lines } as unknown as StatutoryPayrollRun);

describe('Bank advice derivation (pure)', () => {
  it('splits banked from unbanked, sorts by name, totals both sides, never pays the incomplete', () => {
    const bank = new Map<string, EmployeeBankDetails>([
      ['a', { accountNumber: '50100111', ifsc: 'HDFC0001234', bankName: 'HDFC' }],
      ['b', { accountNumber: '60200222', ifsc: 'ICIC0005678', bankName: 'ICICI' }],
      ['c', { accountNumber: '', ifsc: '', bankName: '' }],
      ['d', { accountNumber: '70300333', ifsc: 'BADIFSC', bankName: 'X' }], // invalid IFSC
      // 'e' has no entry at all
    ]);
    const advice = deriveBankAdvice(
      runSnapshot([
        { employee: 'b', name: 'Saurabh', netPay: 90000 },
        { employee: 'a', name: 'Kinjal', netPay: 25800 },
        { employee: 'c', name: 'Dishant', netPay: 8725 },
        { employee: 'd', name: 'Amit', netPay: 5000 },
        { employee: 'e', name: 'Zehra', netPay: 4000 },
        { employee: 'z', name: 'ZeroPay', netPay: 0 }, // net 0 → ignored entirely
      ]),
      bank,
    );
    expect(advice.rows.map((r) => r.name)).toEqual(['Kinjal', 'Saurabh']); // banked, sorted
    expect(advice.totalDisbursable).toBe(115800);
    expect(advice.bankedCount).toBe(2);
    expect(advice.unbanked.map((u) => [u.name, u.reason])).toEqual([
      ['Amit', 'IFSC is not a valid 11-character code'],
      ['Dishant', 'no bank account on file'],
      ['Zehra', 'no bank account on file'],
    ]);
    expect(advice.unbankedNet).toBe(17725);
    expect(advice.unbankedCount).toBe(3);
  });

  it('validates completeness and formats a deterministic advice + balanced clearing lines', () => {
    expect(hasCompleteBankDetails({ accountNumber: '1', ifsc: 'HDFC0001234', bankName: '' })).toBe(true);
    expect(hasCompleteBankDetails({ accountNumber: '', ifsc: 'HDFC0001234', bankName: '' })).toBe(false);
    expect(hasCompleteBankDetails({ accountNumber: '1', ifsc: 'nope', bankName: '' })).toBe(false);
    expect(hasCompleteBankDetails(undefined)).toBe(false);
    const advice = deriveBankAdvice(
      runSnapshot([{ employee: 'a', name: 'Kinjal', netPay: 25800 }]),
      new Map([['a', { accountNumber: '50100111', ifsc: 'HDFC0001234', bankName: 'HDFC' }]]),
    );
    const text = formatBankAdvice(advice, {
      runNumber: 'PAY-2026-08-1', periodKey: '2026-08', valueDate: '2026-08-06', debitAccount: '2200', creditAccount: '1000',
    });
    expect(text).toContain('NEFT SALARY DISBURSEMENT ADVICE');
    expect(text).toContain('Beneficiaries: 1 | Total: 25800.00');
    expect(text).toContain('Kinjal,50100111,HDFC0001234,25800.00,Salary 2026-08');
    // Balanced clearing lines; empty when nothing to pay.
    const lines = disbursementClearingLines(115800, '2200', '1000');
    expect(lines).toEqual([
      { account: '2200', debit: 115800, credit: 0 },
      { account: '1000', debit: 0, credit: 115800 },
    ]);
    expect(disbursementClearingLines(0, '2200', '1000')).toEqual([]);
  });
});

describe('Salary disbursement module over real stores — clears the payable, holds the unbanked', () => {
  let dir: string;
  let structures: EnterpriseModule;
  let statutory: EnterpriseModule;
  let employees: EnterpriseModule;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let runs: EnterpriseModule;
  let disbursements: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-disburse-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    structures = createSalaryStructureModule(join(dir, 'structures.json'));
    statutory = createStatutoryRuleModule(join(dir, 'statutory.json'));
    employees = createEmployeeModule(join(dir, 'employees.json'), structures.store);
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    runs = createPayrollRunModule(join(dir, 'runs.json'), employees.store, structures.store, statutory.store);
    disbursements = createSalaryDisbursementModule(join(dir, 'disb.json'), runs.store, employees.store);
    await Promise.all([
      structures.store.load(), statutory.store.load(), employees.store.load(),
      accounts.store.load(), journal.store.load(), runs.store.load(), disbursements.store.load(),
    ]);
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) =>
        id === LEDGER_ACCOUNTS_MODULE_ID ? accounts : id === JOURNAL_ENTRIES_MODULE_ID ? journal : null,
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([
      structures.store.flush(), statutory.store.flush(), employees.store.flush(),
      accounts.store.flush(), journal.store.flush(), runs.store.flush(), disbursements.store.flush(),
    ]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const create = (module: EnterpriseModule, fields: Record<string, unknown>, title: string): EnterpriseEntity => {
    const v = module.hooks.validate({ fields });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return module.store.create({ title, fields: v.values, actor: 't@np', now: T0 });
  };

  const balance = (code: string): number => {
    const account = accounts.store.list().find((r) => String(r.fields.code) === code);
    return account ? glAccountFromRecord(account).balance : 0;
  };

  async function postedRun(): Promise<EnterpriseEntity> {
    const s = create(structures, { structureCode: 'STD', structureName: 'Standard', componentsJson: STRUCT }, 'Standard');
    const s2 = create(structures, { structureCode: 'BARE', structureName: 'Bare', componentsJson: '' }, 'Bare');
    create(statutory, {}, 'IN-FY2026-27');
    create(employees, { employeeNumber: 'E1', name: 'Kinjal', salaryStructureRef: s.id, basicSalary: 20000, workState: 'GJ', bankAccountNumber: '50100111', bankIfsc: 'HDFC0001234' }, 'Kinjal');
    create(employees, { employeeNumber: 'E2', name: 'Saurabh', monthlySalary: 90000, bankAccountNumber: '60200222', bankIfsc: 'ICIC0005678' }, 'Saurabh');
    create(employees, { employeeNumber: 'E3', name: 'Dishant', salaryStructureRef: s2.id, basicSalary: 10000, workState: 'GJ' }, 'Dishant'); // no bank
    const v = runs.hooks.validate({ fields: { periodKey: '2026-08' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    const rec = runs.store.create({ title: String(v.values.runNumber), fields: v.values, actor: 't@np', now: T0 });
    const posted = await runs.hooks.runAction!('post', rec, ctx);
    expect(posted.ok, posted.ok ? '' : posted.error).toBe(true);
    return runs.store.get(rec.id)!;
  }

  it('refuses to disburse a run that is not posted, and one that predates W6 processing', async () => {
    create(statutory, {}, 'IN-FY2026-27');
    create(employees, { employeeNumber: 'E2', name: 'Saurabh', monthlySalary: 90000, bankAccountNumber: '60200222', bankIfsc: 'ICIC0005678' }, 'Saurabh');
    const v = runs.hooks.validate({ fields: { periodKey: '2026-08' } });
    if (!v.ok) throw new Error('unreachable');
    const preview = runs.store.create({ title: String(v.values.runNumber), fields: v.values, actor: 't@np', now: T0 });
    const refused = disbursements.hooks.validate({ fields: { payrollRunRef: preview.id } });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(String(refused.errors.payrollRunRef)).toContain('Only a POSTED');
    // A posted run with no statutory detail (pre-W6) cannot be disbursed.
    runs.store.update(preview.id, { fields: { status: 'posted', postedAt: T0, statutoryJson: '' }, actor: 't@np', now: T0 });
    const noDetail = disbursements.hooks.validate({ fields: { payrollRunRef: preview.id } });
    expect(noDetail.ok).toBe(false);
    if (!noDetail.ok) expect(String(noDetail.errors.payrollRunRef)).toContain('no processed detail');
  });

  it('previews banked vs held, posts Dr 2200 / Cr 1000 for the banked total, leaves the unbanked owed', async () => {
    const run = await postedRun();
    expect(balance('2200')).toBe(124525); // full net accrued (Kinjal 25800 + Saurabh 90000 + Dishant 8725)
    const v = disbursements.hooks.validate({ fields: { payrollRunRef: run.id } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.values.totalDisbursable).toBe(115800); // Kinjal + Saurabh; Dishant held
    expect(v.values.bankedCount).toBe(2);
    expect(v.values.unbankedCount).toBe(1);
    expect(v.values.unbankedNet).toBe(8725);
    expect(v.values.disbursementNumber).toBe('DISB-PAY-2026-08-1-1');
    expect(String(v.values.bankAdvice)).toContain('Kinjal,50100111,HDFC0001234,25800.00');
    const rec = disbursements.store.create({ title: String(v.values.disbursementNumber), fields: v.values, actor: 't@np', now: T0 });
    const done = await disbursements.hooks.runAction!('disburse', rec, ctx);
    expect(done.ok, done.ok ? '' : done.error).toBe(true);
    if (done.ok) expect(String(done.message)).toContain('does not transmit');
    // The payable is cleared by exactly the banked total; the held employee stays owed.
    expect(balance('2200')).toBe(8725);
    expect(balance('1000')).toBe(-115800); // cash out
    expect(journal.store.list().some((r) => String(r.fields.entryNumber) === 'JE-DISBURSE-PAY-2026-08-1')).toBe(true);
    // Immutable + one per run.
    expect((await disbursements.hooks.runAction!('disburse', disbursements.store.get(rec.id)!, ctx)).ok).toBe(false);
    const second = disbursements.hooks.validate({ fields: { payrollRunRef: run.id } });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(String(second.errors.payrollRunRef)).toContain('already disbursed');
  });

  it('refuses to post when nothing is banked, and refuses a bad IFSC at the employee source', async () => {
    const s2 = create(structures, { structureCode: 'BARE', structureName: 'Bare', componentsJson: '' }, 'Bare');
    create(statutory, {}, 'IN-FY2026-27');
    create(employees, { employeeNumber: 'E3', name: 'Dishant', salaryStructureRef: s2.id, basicSalary: 10000, workState: 'GJ' }, 'Dishant');
    const v = runs.hooks.validate({ fields: { periodKey: '2026-08' } });
    if (!v.ok) throw new Error('unreachable');
    const rec = runs.store.create({ title: String(v.values.runNumber), fields: v.values, actor: 't@np', now: T0 });
    await runs.hooks.runAction!('post', rec, ctx);
    const dv = disbursements.hooks.validate({ fields: { payrollRunRef: rec.id } });
    expect(dv.ok, JSON.stringify('errors' in dv ? dv.errors : {})).toBe(true);
    if (!dv.ok) throw new Error('unreachable');
    expect(dv.values.totalDisbursable).toBe(0);
    const drec = disbursements.store.create({ title: String(dv.values.disbursementNumber), fields: dv.values, actor: 't@np', now: T0 });
    const refused = await disbursements.hooks.runAction!('disburse', drec, ctx);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(String(refused.error)).toContain('Nothing to disburse');
    // Bad IFSC refused at the employee validate.
    const badEmp = employees.hooks.validate({ fields: { employeeNumber: 'E9', name: 'X', bankIfsc: 'NOTVALID' } });
    expect(badEmp.ok).toBe(false);
    if (!badEmp.ok) expect(String(badEmp.errors.bankIfsc)).toContain('11 characters');
  });
});
