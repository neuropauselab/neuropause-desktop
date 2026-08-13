import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_STATUTORY_RULE_SET,
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  deriveStatutoryPayrollRun,
  glAccountFromRecord,
  parseSalaryComponents,
  statutoryAccrualLines,
  statutoryRuleSetFromRecord,
  type Employee,
  type EnterpriseEntity,
  type SalaryComponent,
  type StatutoryRuleSet,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLedgerAccountModule } from '../finance/ledgerAccountModule';
import { createJournalEntryModule } from '../finance/journalEntryModule';
import { createEmployeeModule } from './employeeModule';
import { createPayrollRunModule } from './payrollRunModule';
import { createSalaryStructureModule } from './salaryStructureModule';
import { createStatutoryRuleModule } from './statutoryRuleModule';

const T0 = '2026-08-06T00:00:00.000Z';

const STRUCT_COMPONENTS = [
  JSON.stringify({ code: 'HRA', name: 'House Rent Allowance', kind: 'earning', calc: 'percentOfBasic', value: 40 }),
  JSON.stringify({ code: 'PROF', name: 'Society Fee', kind: 'deduction', calc: 'fixed', value: 200 }),
].join('\n');

const ruleSetOf = (): StatutoryRuleSet => {
  const record = {
    id: 'rs1', title: 'IN-FY2026-27', status: 'active', kind: 'statutoryRuleSet',
    fields: { ...DEFAULT_STATUTORY_RULE_SET },
    createdAt: T0, updatedAt: T0,
  } as unknown as EnterpriseEntity;
  const parsed = statutoryRuleSetFromRecord(record);
  if (!parsed.ruleSet) throw new Error(parsed.errors.join(' '));
  return parsed.ruleSet;
};

const emp = (over: Partial<Employee>): Employee => ({
  id: 'e1', employeeNumber: 'EMP-1', name: 'Kinjal', role: 'Instructor', department: 'Research',
  managerRef: '', workEmail: '', joinDate: '2025-01-01', monthlySalary: 0, exitedAt: null,
  createdAt: T0, updatedAt: T0, ...over,
});

describe('Statutory payroll derivation (pure) — gross-to-net with the verified seed', () => {
  it('computes the full chain per structured employee, keeps legacy flat lines apart, and balances the accrual', () => {
    const components = parseSalaryComponents(STRUCT_COMPONENTS).components;
    const structures = new Map<string, SalaryComponent[]>([['s1', components], ['s2', []]]);
    const run = deriveStatutoryPayrollRun(
      [
        // Structured, basic 20k + HRA 8k − PROF 200: gross 28,000, above the ESI ceiling.
        emp({ id: 'a', name: 'Kinjal', salaryStructureRef: 's1', basicSalary: 20000, workState: 'GJ' }),
        // Structured, bare template: gross 10,000 — ESI-eligible, below PT threshold.
        emp({ id: 'b', name: 'Dishant', salaryStructureRef: 's2', basicSalary: 10000, workState: 'GJ' }),
        // Legacy flat salary — no statutory computed, stated.
        emp({ id: 'c', name: 'Saurabh', monthlySalary: 90000 }),
        // Structured but no work state — PT skipped LOUDLY, everything else computes.
        emp({ id: 'd', name: 'NoState', salaryStructureRef: 's2', basicSalary: 16000 }),
        // Unsalaried and exited stay out.
        emp({ id: 'x', name: 'Zero' }),
        emp({ id: 'y', name: 'Gone', exitedAt: T0, monthlySalary: 50000 }),
      ],
      structures,
      ruleSetOf(),
      '2026-08',
    );
    expect(run.employeeCount).toBe(4);
    expect(run.statutoryCount).toBe(3);
    expect(run.flatCount).toBe(1);
    expect(run.unsalariedCount).toBe(1);
    expect(run.ptSkippedCount).toBe(1);
    const [saurabh, kinjal, noState, dishant] = run.lines; // sorted by gross desc
    expect(saurabh.mode).toBe('flat');
    expect(saurabh.netPay).toBe(90000);
    // Kinjal: PF on basic 20k restricted to ceiling → 1800; ESI base 28k > 21k → ineligible; PT 200; TDS 0 (336k−75k < 4L).
    expect(kinjal.gross).toBe(28000);
    expect(kinjal.pfEmployee).toBe(1800);
    expect(kinjal.pfEmployerTotal).toBe(1800);
    expect(kinjal.esiEligible).toBe(false);
    expect(kinjal.pt).toBe(200);
    expect(kinjal.tdsMonthly).toBe(0);
    expect(kinjal.otherDeductions).toBe(200);
    expect(kinjal.netPay).toBe(25800); // 28000 − 1800 − 0 − 200 − 0 − 200
    // Dishant: PF 1200/833+367; ESI 75/325; PT nil at 10k; net 10000 − 1200 − 75 = 8725.
    expect(dishant.gross).toBe(10000);
    expect(dishant.pfEmployee).toBe(1200);
    expect(dishant.esiEmployee).toBe(75);
    expect(dishant.esiEmployer).toBe(325);
    expect(dishant.pt).toBe(0);
    expect(dishant.netPay).toBe(8725);
    // NoState: PT skipped with a named reason — never a silent zero.
    expect(noState.ptSkipped).toBe(true);
    expect(noState.note).toContain('no work state');
    // The accrual BALANCES to the paisa, by construction.
    const lines = statutoryAccrualLines(run, '5300', '2200');
    const dr = lines.reduce((s, l) => s + l.debit, 0);
    const cr = lines.reduce((s, l) => s + l.credit, 0);
    expect(Math.round(dr * 100)).toBe(Math.round(cr * 100));
    expect(lines.some((l) => l.account === '2240')).toBe(false); // zero TDS line dropped, not faked
  });

  it('with no rule set every line is flat-legacy; with no structures the engine matches W4 behavior', () => {
    const run = deriveStatutoryPayrollRun(
      [emp({ id: 'a', name: 'K', monthlySalary: 80000 }), emp({ id: 'b', name: 'S', monthlySalary: 90000 })],
      new Map(),
      null,
      '2026-08',
    );
    expect(run.statutoryCount).toBe(0);
    expect(run.flatCount).toBe(2);
    expect(run.totalGross).toBe(170000);
    expect(run.totalNet).toBe(170000);
    expect(run.ruleSetCode).toBeNull();
  });
});

describe('Payroll runs over real stores — statutory engine, refusal gate, balanced GL posting', () => {
  let dir: string;
  let employees: EnterpriseModule;
  let structures: EnterpriseModule;
  let statutory: EnterpriseModule;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let runs: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-payproc-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    structures = createSalaryStructureModule(join(dir, 'structures.json'));
    statutory = createStatutoryRuleModule(join(dir, 'statutory.json'));
    employees = createEmployeeModule(join(dir, 'employees.json'), structures.store);
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    runs = createPayrollRunModule(join(dir, 'runs.json'), employees.store, structures.store, statutory.store);
    await Promise.all([
      structures.store.load(), statutory.store.load(), employees.store.load(),
      accounts.store.load(), journal.store.load(), runs.store.load(),
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
      accounts.store.flush(), journal.store.flush(), runs.store.flush(),
    ]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const create = (module: EnterpriseModule, fields: Record<string, unknown>, title: string): EnterpriseEntity => {
    const v = module.hooks.validate({ fields });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return module.store.create({ title, fields: v.values, actor: 't@np', now: T0 });
  };

  it('REFUSES to preview when structured employees exist but no rule set covers the period', () => {
    const s = create(structures, { structureCode: 'STD', structureName: 'Standard', componentsJson: STRUCT_COMPONENTS }, 'Standard');
    create(employees, { employeeNumber: 'E1', name: 'Kinjal', salaryStructureRef: s.id, basicSalary: 20000, workState: 'GJ' }, 'Kinjal');
    const refused = runs.hooks.validate({ fields: { periodKey: '2026-08' } });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(String(refused.errors.periodKey)).toContain('No statutory rule set covers 2026-08');
  });

  it('runs the full engine and posts ONE balanced multi-line accrual into the real GL', async () => {
    const s = create(structures, { structureCode: 'STD', structureName: 'Standard', componentsJson: STRUCT_COMPONENTS }, 'Standard');
    create(statutory, {}, 'IN-FY2026-27'); // untouched create = the verified seed
    create(employees, { employeeNumber: 'E1', name: 'Kinjal', salaryStructureRef: s.id, basicSalary: 20000, workState: 'GJ' }, 'Kinjal');
    create(employees, { employeeNumber: 'E2', name: 'Saurabh', monthlySalary: 90000 }, 'Saurabh');
    const v = runs.hooks.validate({ fields: { periodKey: '2026-08' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.values.totalGross).toBe(118000); // 28,000 statutory + 90,000 flat
    expect(v.values.totalNet).toBe(115800); // Kinjal 25,800 + Saurabh 90,000
    expect(v.values.statutoryCount).toBe(1);
    expect(v.values.flatCount).toBe(1);
    expect(v.values.ruleSetCode).toBe('IN-FY2026-27');
    expect(String(v.values.note)).toContain('1 flat-legacy');
    const rec = runs.store.create({ title: String(v.values.runNumber), fields: v.values, actor: 't@np', now: T0 });
    const posted = await runs.hooks.runAction!('post', rec, ctx);
    expect(posted.ok, posted.ok ? '' : posted.error).toBe(true);
    if (posted.ok) expect(String(posted.message)).toContain('BALANCED');
    const balance = (code: string): number => {
      const account = accounts.store.list().find((r) => String(r.fields.code) === code);
      return account ? glAccountFromRecord(account).balance : 0;
    };
    expect(balance('5300')).toBe(118000); // gross expense
    expect(balance('5310')).toBe(1950); // employer PF 1800 + EDLI 75 + admin 75
    expect(balance('2200')).toBe(115800); // net payable
    expect(balance('2210')).toBe(3750); // employee PF 1800 + employer-side 1950
    expect(balance('2230')).toBe(200); // Gujarat PT
    expect(balance('2250')).toBe(200); // contractual deduction
    expect(balance('2220')).toBe(0); // ESI: the one statutory employee sits above the ceiling — no ESI line posted
    expect(journal.store.list().some((r) => String(r.fields.entryNumber) === 'JE-PAYROLL-2026-08')).toBe(true);
    // Frozen + idempotent, exactly like W4.
    expect((await runs.hooks.runAction!('post', runs.store.get(rec.id)!, ctx)).ok).toBe(false);
    expect(runs.hooks.validate({ fields: { periodKey: '2026-08' } }).ok).toBe(false);
  });

  it('employee guard: a structure assignment without a positive basic is refused at the source', () => {
    const s = create(structures, { structureCode: 'STD2', structureName: 'Standard 2', componentsJson: '' }, 'Standard 2');
    const bad = employees.hooks.validate({
      fields: { employeeNumber: 'E9', name: 'X', salaryStructureRef: s.id },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(String(bad.errors.basicSalary)).toContain('positive basic');
  });
});
