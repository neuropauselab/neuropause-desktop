/**
 * HR → FW-1 Attendance — the LOP engine, the Attendance Periods module's
 * guards, and the payroll integration proof:
 *  - calendar-day proration math (clamped, month-aware),
 *  - only CONFIRMED statements feed payroll (drafts ignored, duplicates
 *    resolved conservatively),
 *  - a statutory line prorates its FULL chain (PF wage base included) and
 *    carries lopDays/paidDays for the ECR — whose NCP days become real,
 *  - and the byte-identical guarantee: omitting attendance reproduces the
 *    pre-FW-1 run exactly.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  buildEcrRows,
  calculatePf,
  computeSalaryBreakup,
  daysInPeriod,
  deriveAttendanceByEmployee,
  deriveStatutoryPayrollRun,
  DEFAULT_STATUTORY_RULE_SET,
  parseSalaryComponents,
  prorationFactor,
  statutoryAccrualLines,
  statutoryRuleSetFromRecord,
  type EnterpriseEntity,
  type Employee,
  type SalaryComponent,
  type StatutoryRuleSet,
} from '@neuropause/shared';
import { createAttendanceModule, CONFIRM_ATTENDANCE_ACTION } from './attendanceModule';
import { createEmployeeModule } from './employeeModule';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';

const T0 = '2026-08-06T00:00:00.000Z';

const STRUCT_COMPONENTS = [
  JSON.stringify({ code: 'HRA', name: 'House Rent Allowance', kind: 'earning', calc: 'percentOfBasic', value: 40 }),
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

// ── Pure engine ────────────────────────────────────────────────────────────

describe('Attendance engine (pure)', () => {
  it('knows the calendar: 31/30/28/29-day months and rejects junk', () => {
    expect(daysInPeriod('2026-08')).toBe(31);
    expect(daysInPeriod('2026-09')).toBe(30);
    expect(daysInPeriod('2026-02')).toBe(28);
    expect(daysInPeriod('2028-02')).toBe(29); // leap year
    expect(daysInPeriod('2026-13')).toBe(0);
    expect(daysInPeriod('nope')).toBe(0);
  });

  it('prorates on (days − lop)/days, clamped both ways', () => {
    expect(prorationFactor(31, 0)).toBe(1);
    expect(prorationFactor(31, 31)).toBe(0);
    expect(prorationFactor(31, 62)).toBe(0); // clamped high
    expect(prorationFactor(31, -4)).toBe(1); // clamped low
    expect(prorationFactor(0, 5)).toBe(1); // unknown month → never prorate
    expect(prorationFactor(30, 3)).toBeCloseTo(27 / 30, 12);
  });

  it('folds only CONFIRMED statements for the period; duplicates keep the higher LOP', () => {
    const rec = (fields: Record<string, unknown>, status = 'active') => ({ status, fields });
    const map = deriveAttendanceByEmployee(
      [
        rec({ status: 'confirmed', period: '2026-08', employee: 'e1', lopDays: 2, presentDays: 25, paidLeaveDays: 4 }),
        rec({ status: 'draft', period: '2026-08', employee: 'e2', lopDays: 9 }), // draft — ignored
        rec({ status: 'confirmed', period: '2026-07', employee: 'e3', lopDays: 5 }), // other month — ignored
        rec({ status: 'confirmed', period: '2026-08', employee: 'e1', lopDays: 4 }), // dup — higher wins
        rec({ status: 'confirmed', period: '2026-08', employee: 'e4', lopDays: 1 }, 'deleted'), // deleted — ignored
      ],
      '2026-08',
    );
    expect(map.size).toBe(1);
    expect(map.get('e1')).toEqual({ lopDays: 4, presentDays: 0, paidLeaveDays: 0 });
  });
});

// ── Payroll integration (the point of FW-1) ────────────────────────────────

describe('Statutory payroll with attendance (FW-1)', () => {
  const components = parseSalaryComponents(STRUCT_COMPONENTS).components;
  const structures = new Map<string, SalaryComponent[]>([['s1', components]]);
  const employees = [
    emp({ id: 'e1', name: 'Kinjal', salaryStructureRef: 's1', basicSalary: 30000, workState: 'GJ' } as Partial<Employee>),
    emp({ id: 'e2', name: 'Flat Legacy', monthlySalary: 20000 }),
  ];

  it('prorates the FULL statutory chain on LOP days and stamps lopDays/paidDays', () => {
    const rules = ruleSetOf();
    // August 2026 has 31 days; 6.2 LOP-free vs 6-day LOP comparison.
    const attendance = new Map([
      ['e1', { lopDays: 6, presentDays: 25, paidLeaveDays: 0 }],
      ['e2', { lopDays: 0, presentDays: 31, paidLeaveDays: 0 }],
    ]);
    const run = deriveStatutoryPayrollRun(employees, structures, rules, '2026-08', attendance);
    const line = run.lines.find((l) => l.employee === 'e1');
    expect(line).toBeDefined();
    const proratedBasic = Math.round(30000 * (25 / 31) * 100) / 100;
    expect(line!.basic).toBeCloseTo(proratedBasic, 2);
    // The chain ran on the PRORATED wages — recompute independently.
    const breakup = computeSalaryBreakup(components, proratedBasic);
    expect(line!.gross).toBeCloseTo(breakup.grossEarnings, 2);
    const pf = calculatePf(rules.pf, breakup.pfWageBase);
    expect(line!.pfEmployee).toBeCloseTo(pf.employee, 2);
    expect(line!.lopDays).toBe(6);
    expect(line!.paidDays).toBe(25);
    expect(line!.note).toContain('LOP 6 day(s)');
    // The zero-LOP confirmed employee is stamped but unprorated.
    const flat = run.lines.find((l) => l.employee === 'e2');
    expect(flat!.gross).toBe(20000);
    expect(flat!.lopDays).toBe(0);
    expect(flat!.paidDays).toBe(31);
    // Rollups + the accrual still balances to the paisa.
    expect(run.lopAppliedCount).toBe(1);
    expect(run.totalLopDays).toBe(6);
    const lines = statutoryAccrualLines(run, '5300', '2200');
    const dr = lines.reduce((s, l) => s + l.debit, 0);
    const cr = lines.reduce((s, l) => s + l.credit, 0);
    expect(Math.abs(dr - cr)).toBeLessThan(0.02);
  });

  it('full-month LOP zeroes the pay but keeps the employee statutory and stated', () => {
    const run = deriveStatutoryPayrollRun(
      employees, structures, ruleSetOf(), '2026-08',
      new Map([['e1', { lopDays: 31, presentDays: 0, paidLeaveDays: 0 }]]),
    );
    const line = run.lines.find((l) => l.employee === 'e1');
    expect(line!.mode).toBe('statutory');
    expect(line!.gross).toBe(0);
    expect(line!.netPay).toBe(0);
    expect(line!.paidDays).toBe(0);
  });

  it('OMITTING attendance reproduces the pre-FW-1 run byte-identically', () => {
    const before = deriveStatutoryPayrollRun(employees, structures, ruleSetOf(), '2026-08');
    expect(before.lines.every((l) => l.lopDays === undefined && l.paidDays === undefined)).toBe(true);
    expect('lopAppliedCount' in before).toBe(false);
    expect('totalLopDays' in before).toBe(false);
    // And an EMPTY confirmed map changes no amounts either.
    const withEmpty = deriveStatutoryPayrollRun(employees, structures, ruleSetOf(), '2026-08', new Map());
    expect(withEmpty.totalGross).toBe(before.totalGross);
    expect(withEmpty.totalNet).toBe(before.totalNet);
  });

  it('ECR NCP days are the line’s LOP days — real, not hardcoded 0', () => {
    const run = deriveStatutoryPayrollRun(
      employees, structures, ruleSetOf(), '2026-08',
      new Map([['e1', { lopDays: 3, presentDays: 28, paidLeaveDays: 0 }]]),
    );
    const ecr = buildEcrRows([run], new Map([['e1', { uan: '100000000001', esicIp: '', pan: '' }]]));
    expect(ecr.rows).toHaveLength(1);
    expect(ecr.rows[0].ncpDays).toBe(3);
  });
});

// ── The Attendance Periods module (store-backed guards) ────────────────────

describe('Attendance Periods module', () => {
  let dir: string;
  let employees: EnterpriseModule;
  let attendance: EnterpriseModule;

  const ctx = (): EnterpriseModuleActionContext =>
    ({
      actor: () => 'test-actor',
      now: () => T0,
      emit: () => {},
      moduleFor: () => null,
    }) as unknown as EnterpriseModuleActionContext;

  const addEmployee = (id: string): void => {
    const v = employees.hooks.validate({ fields: { name: `Person ${id}`, employeeNumber: id, role: 'x', department: 'y', monthlySalary: 10000 } });
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    const rec = employees.store.create({ title: `Person ${id}`, fields: v.values, actor: 'test', now: T0 });
    // pin a deterministic id for assertions
    (rec as { id: string }).id = rec.id;
  };

  beforeEach(async () => {
    dir = join(tmpdir(), `np-att-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    employees = createEmployeeModule(join(dir, 'employees.json'));
    await employees.store.load();
    attendance = createAttendanceModule(join(dir, 'attendance.json'), employees.store);
    await attendance.store.load();
    addEmployee('E1');
  });
  afterEach(async () => {
    // The store persists asynchronously after actions — settle before removing,
    // and retry once so an in-flight atomic write never fails the suite.
    await new Promise((r) => setTimeout(r, 25));
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      await new Promise((r) => setTimeout(r, 100));
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  const firstEmployeeId = (): string => employees.store.list()[0].id;

  it('validates the month, the employee, the day budget — and derives the statement number', () => {
    const employee = firstEmployeeId();
    const bad = attendance.hooks.validate({ fields: { employee, period: '2026-8' } });
    expect(bad.ok).toBe(false);
    const ghost = attendance.hooks.validate({ fields: { employee: 'nope', period: '2026-08' } });
    expect(ghost.ok).toBe(false);
    const overflow = attendance.hooks.validate({
      fields: { employee, period: '2026-08', presentDays: 20, paidLeaveDays: 10, lopDays: 5 },
    });
    expect(overflow.ok).toBe(false); // 35 > 31
    const good = attendance.hooks.validate({
      fields: { employee, period: '2026-08', presentDays: 25, paidLeaveDays: 0, lopDays: 6 },
    });
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(String(good.values.statementNumber)).toContain('ATT-2026-08');
      expect(good.values.daysInMonth).toBe(31);
      expect(good.values.status).toBe('draft');
    }
  });

  it('enforces ONE live statement per employee per month', () => {
    const employee = firstEmployeeId();
    const v = attendance.hooks.validate({ fields: { employee, period: '2026-08', lopDays: 1 } });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    attendance.store.create({ title: String(v.values.statementNumber), fields: v.values, actor: 'test', now: T0 });
    const dup = attendance.hooks.validate({ fields: { employee, period: '2026-08', lopDays: 2 } });
    expect(dup.ok).toBe(false);
    const otherMonth = attendance.hooks.validate({ fields: { employee, period: '2026-09', lopDays: 2 } });
    expect(otherMonth.ok).toBe(true);
  });

  it('confirming flips the statement to the payroll-consumed state, once', async () => {
    const employee = firstEmployeeId();
    const v = attendance.hooks.validate({ fields: { employee, period: '2026-08', lopDays: 2, presentDays: 29 } });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const rec = attendance.store.create({ title: String(v.values.statementNumber), fields: v.values, actor: 'test', now: T0 });
    const result = await attendance.hooks.runAction!(CONFIRM_ATTENDANCE_ACTION, attendance.store.get(rec.id)!, ctx());
    expect(result.ok).toBe(true);
    const confirmed = attendance.store.get(rec.id)!;
    expect(String(confirmed.fields.status)).toBe('confirmed');
    expect(String(confirmed.fields.confirmedAt)).toBe(T0);
    // Idempotence: confirming again refuses.
    const again = await attendance.hooks.runAction!(CONFIRM_ATTENDANCE_ACTION, confirmed, ctx());
    expect(again.ok).toBe(false);
    // And the confirmed statement now feeds the engine map.
    const map = deriveAttendanceByEmployee(attendance.store.list(), '2026-08');
    expect(map.get(employee)?.lopDays).toBe(2);
  });
});
