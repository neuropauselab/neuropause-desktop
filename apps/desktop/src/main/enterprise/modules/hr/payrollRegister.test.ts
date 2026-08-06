import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  derivePayrollRegister,
  type EnterpriseEntity,
  type StatutoryPayrollRun,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLedgerAccountModule } from '../finance/ledgerAccountModule';
import { createJournalEntryModule } from '../finance/journalEntryModule';
import { createEmployeeModule } from './employeeModule';
import { createPayrollRunModule } from './payrollRunModule';
import { createPayrollRegisterModule } from './payrollRegisterModule';
import { createSalaryStructureModule } from './salaryStructureModule';
import { createStatutoryRuleModule } from './statutoryRuleModule';

const T0 = '2026-08-06T00:00:00.000Z';

const STRUCT = [
  JSON.stringify({ code: 'HRA', name: 'House Rent Allowance', kind: 'earning', calc: 'percentOfBasic', value: 40 }),
  JSON.stringify({ code: 'PROF', name: 'Society Fee', kind: 'deduction', calc: 'fixed', value: 200 }),
].join('\n');

const mkLine = (over: Record<string, unknown>) => ({
  employee: 'e', name: 'N', mode: 'statutory', gross: 0, basic: 0, earnings: [], contractualDeductions: [],
  pfEmployee: 0, pfEmployerTotal: 0, pfEdli: 0, pfAdmin: 0, esiEligible: false, esiEmployee: 0, esiEmployer: 0,
  pt: 0, ptSkipped: false, tdsMonthly: 0, otherDeductions: 0, netPay: 0, note: '', ...over,
});

describe('Payroll register derivation (pure)', () => {
  it('aggregates per employee across runs, derives totals, sorts by net, splits statutory vs flat', () => {
    const runs = [
      { lines: [
        mkLine({ employee: 'a', name: 'Kinjal', mode: 'statutory', gross: 28000, pfEmployee: 1800, pt: 200, otherDeductions: 200, pfEmployerTotal: 1950, netPay: 25800 }),
        mkLine({ employee: 'b', name: 'Saurabh', mode: 'flat', gross: 90000, netPay: 90000 }),
      ] },
    ] as unknown as StatutoryPayrollRun[];
    const reg = derivePayrollRegister(runs);
    expect(reg.employeeCount).toBe(2);
    expect(reg.statutoryCount).toBe(1);
    expect(reg.flatCount).toBe(1);
    expect(reg.rows[0].name).toBe('Saurabh'); // highest net first
    expect(reg.totalGross).toBe(118000);
    expect(reg.totalNet).toBe(115800);
    expect(reg.totalPfEmployee).toBe(1800);
    expect(reg.totalPt).toBe(200);
    expect(reg.totalEmployerPf).toBe(1950);
    const kinjal = reg.rows.find((r) => r.name === 'Kinjal')!;
    expect(kinjal.totalDeductions).toBe(2200); // 1800 PF + 200 PT + 200 contractual
  });

  it('sums the SAME employee across multiple runs (period corrections)', () => {
    const runs = [
      { lines: [mkLine({ employee: 'a', name: 'K', mode: 'flat', gross: 1000, netPay: 1000 })] },
      { lines: [mkLine({ employee: 'a', name: 'K', mode: 'flat', gross: 500, netPay: 500 })] },
    ] as unknown as StatutoryPayrollRun[];
    const reg = derivePayrollRegister(runs);
    expect(reg.employeeCount).toBe(1);
    expect(reg.runCount).toBe(2);
    expect(reg.rows[0].gross).toBe(1500);
    expect(reg.totalNet).toBe(1500);
  });
});

describe('Payroll register module over real stores', () => {
  let dir: string;
  let structures: EnterpriseModule;
  let statutory: EnterpriseModule;
  let employees: EnterpriseModule;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let runs: EnterpriseModule;
  let registers: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-payreg-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    structures = createSalaryStructureModule(join(dir, 'structures.json'));
    statutory = createStatutoryRuleModule(join(dir, 'statutory.json'));
    employees = createEmployeeModule(join(dir, 'employees.json'), structures.store);
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    runs = createPayrollRunModule(join(dir, 'runs.json'), employees.store, structures.store, statutory.store);
    registers = createPayrollRegisterModule(join(dir, 'registers.json'), runs.store);
    await Promise.all([
      structures.store.load(), statutory.store.load(), employees.store.load(),
      accounts.store.load(), journal.store.load(), runs.store.load(), registers.store.load(),
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
      accounts.store.flush(), journal.store.flush(), runs.store.flush(), registers.store.flush(),
    ]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const create = (module: EnterpriseModule, fields: Record<string, unknown>, title: string): EnterpriseEntity => {
    const v = module.hooks.validate({ fields });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return module.store.create({ title, fields: v.values, actor: 't@np', now: T0 });
  };

  it('generates an immutable register from the posted run, and reports empty honestly when none is posted', async () => {
    // Empty first — no posted run for the period.
    const empty = create(registers, { periodKey: '2026-08' }, 'reg');
    expect(empty.fields.employeeCount).toBe(0);
    expect(String(empty.fields.note)).toContain('no posted payroll run');
    expect(String(empty.fields.generatedAt).length).toBeGreaterThan(0);
    // Post a run, then generate.
    const s = create(structures, { structureCode: 'STD', structureName: 'Standard', componentsJson: STRUCT }, 'Standard');
    create(statutory, {}, 'IN-FY2026-27');
    create(employees, { employeeNumber: 'E1', name: 'Kinjal', salaryStructureRef: s.id, basicSalary: 20000, workState: 'GJ' }, 'Kinjal');
    create(employees, { employeeNumber: 'E2', name: 'Saurabh', monthlySalary: 90000 }, 'Saurabh');
    const rv = runs.hooks.validate({ fields: { periodKey: '2026-08' } });
    if (!rv.ok) throw new Error('unreachable');
    const runRec = runs.store.create({ title: String(rv.values.runNumber), fields: rv.values, actor: 't@np', now: T0 });
    await runs.hooks.runAction!('post', runRec, ctx);
    const reg = create(registers, { periodKey: '2026-08' }, 'reg');
    expect(reg.fields.employeeCount).toBe(2);
    expect(reg.fields.totalGross).toBe(118000);
    expect(reg.fields.totalNet).toBe(115800);
    expect(reg.fields.totalPfEmployee).toBe(1800);
    expect(reg.fields.reportNumber).toBe('PR-2026-08-2'); // second register for the period (empty one was first)
    expect(String(reg.fields.note)).toContain('1 statutory, 1 flat');
    // Immutable.
    expect(registers.hooks.validate({ fields: { ...reg.fields, totalNet: 0 } }).ok).toBe(false);
  });
});
