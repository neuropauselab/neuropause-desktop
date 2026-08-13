import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  EMPLOYEES_MODULE_ID,
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  deriveOrgChart,
  derivePayrollRun,
  glAccountFromRecord,
  managerChainCycle,
  type Employee,
  type EnterpriseEntity,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLedgerAccountModule } from '../finance/ledgerAccountModule';
import { createJournalEntryModule } from '../finance/journalEntryModule';
import { createEmployeeModule } from './employeeModule';
import { createPayrollRunModule } from './payrollRunModule';

const T0 = '2026-08-06T00:00:00.000Z';

const emp = (over: Partial<Employee>): Employee => ({
  id: 'e1', employeeNumber: 'EMP-1', name: 'Kinjal', role: 'Instructor', department: 'Research',
  managerRef: '', workEmail: '', joinDate: '2025-01-01', monthlySalary: 80000, exitedAt: null,
  createdAt: T0, updatedAt: T0, ...over,
});

describe('HR domain rules (pure)', () => {
  it('detects manager-chain cycles and derives the org chart by level', () => {
    const a = emp({ id: 'a', name: 'Saurabh', managerRef: '' });
    const b = emp({ id: 'b', name: 'Kinjal', managerRef: 'a' });
    const c = emp({ id: 'c', name: 'Dishant', managerRef: 'b' });
    const byId = new Map([['a', a], ['b', b], ['c', c]]);
    expect(managerChainCycle('a', 'c', byId)).toEqual(['c', 'b', 'a']); // a→c would loop
    expect(managerChainCycle('c', 'a', byId)).toBeNull(); // c under a is fine
    const chart = deriveOrgChart([a, b, c, emp({ id: 'd', name: 'Gone', exitedAt: T0 })]);
    expect(chart.map((n) => [n.name, n.level, n.directReports])).toEqual([
      ['Saurabh', 0, 1], ['Kinjal', 1, 1], ['Dishant', 2, 0],
    ]);
  });

  it('gathers only active salaried employees into a run, counting the unsalaried', () => {
    const run = derivePayrollRun([
      emp({}),
      emp({ id: 'e2', name: 'Saurabh', monthlySalary: 90000 }),
      emp({ id: 'e3', name: 'NoPay', monthlySalary: 0 }),
      emp({ id: 'e4', name: 'Gone', exitedAt: T0, monthlySalary: 70000 }),
    ]);
    expect(run.employeeCount).toBe(2);
    expect(run.totalGross).toBe(170000);
    expect(run.unsalariedCount).toBe(1);
    expect(run.lines[0].name).toBe('Saurabh'); // highest salary first
  });
});

describe('HR modules over real stores — org guards, payroll accrual into the real GL', () => {
  let dir: string;
  let employees: EnterpriseModule;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let runs: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-hr-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    employees = createEmployeeModule(join(dir, 'employees.json'));
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    runs = createPayrollRunModule(join(dir, 'runs.json'), employees.store);
    await Promise.all([employees.store.load(), accounts.store.load(), journal.store.load(), runs.store.load()]);
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) =>
        id === LEDGER_ACCOUNTS_MODULE_ID ? accounts
        : id === JOURNAL_ENTRIES_MODULE_ID ? journal
        : id === EMPLOYEES_MODULE_ID ? employees
        : null,
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([employees.store.flush(), accounts.store.flush(), journal.store.flush(), runs.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const hire = (over: Record<string, unknown> = {}): EnterpriseEntity => {
    const v = employees.hooks.validate({
      fields: { employeeNumber: `EMP-${randomUUID().slice(0, 4)}`, name: 'Kinjal', role: 'Instructor', monthlySalary: 80000, ...over },
    });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return employees.store.create({ title: String(v.values.name), fields: v.values, actor: 't@np', now: T0 });
  };

  it('guards the org chain and freezes exited employees', async () => {
    const boss = hire({ name: 'Saurabh', monthlySalary: 90000 });
    hire({ managerRef: boss.id });
    expect(employees.hooks.validate({ fields: { employeeNumber: 'X', name: 'X', managerRef: 'ghost' } }).ok).toBe(false);
    const exit = await employees.hooks.runAction!('exit', boss, ctx);
    expect(exit.ok).toBe(true);
    if (exit.ok) expect(String(exit.message)).toContain('1 direct report(s)');
    expect(employees.hooks.validate({ fields: { ...employees.store.get(boss.id)!.fields, role: 'CEO' } }).ok).toBe(false);
  });

  it('posts the monthly accrual into the REAL ledger — accounts ensured, idempotent, once', async () => {
    hire({});
    hire({ name: 'Saurabh', monthlySalary: 90000 });
    const v = runs.hooks.validate({ fields: { periodKey: '2026-08' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.values.totalGross).toBe(170000);
    const rec = runs.store.create({ title: String(v.values.runNumber), fields: v.values, actor: 't@np', now: T0 });
    const res = await runs.hooks.runAction!('post', rec, ctx);
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    // The accrual is REAL: accounts ensured, entry posted, balances move.
    const expense = accounts.store.list().find((r) => String(r.fields.code) === '5300')!;
    const payable = accounts.store.list().find((r) => String(r.fields.code) === '2200')!;
    expect(glAccountFromRecord(expense).balance).toBe(170000);
    expect(glAccountFromRecord(payable).balance).toBe(170000);
    expect(journal.store.list().some((r) => String(r.fields.entryNumber) === 'JE-PAYROLL-2026-08')).toBe(true);
    // Frozen + one accrual per month.
    expect((await runs.hooks.runAction!('post', runs.store.get(rec.id)!, ctx)).ok).toBe(false);
    expect(runs.hooks.validate({ fields: { periodKey: '2026-08' } }).ok).toBe(false);
    expect(runs.hooks.validate({ fields: { ...runs.store.get(rec.id)!.fields, periodKey: '2026-09' } }).ok).toBe(false);
  });
});
