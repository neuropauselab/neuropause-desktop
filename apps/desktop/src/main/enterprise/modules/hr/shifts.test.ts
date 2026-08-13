/**
 * HR → FW-4 Shifts — the pure shift engine (times, overnight spans, weekly
 * offs, expected working days), the module's guards, the additive employee
 * shift assignment, and the integration proof: Import Leave prefills present
 * days from the assigned shift's pattern — working days minus paid leave
 * minus LOP, with holidays never double-counted against weekly offs.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  expectedWorkingDays,
  parseShiftTime,
  parseWeeklyOffDays,
  shiftMinutes,
  weeklyOffsForShift,
} from '@neuropause/shared';
import { createAttendanceModule, IMPORT_LEAVE_ACTION } from './attendanceModule';
import { createEmployeeModule } from './employeeModule';
import { createHolidayModule } from './holidayModule';
import { createLeaveModule, APPROVE_LEAVE_ACTION } from './leaveModule';
import { createShiftModule } from './shiftModule';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';

const T0 = '2026-08-06T00:00:00.000Z';

describe('Shift engine (pure)', () => {
  it('parses strict 24h times and computes day + overnight spans', () => {
    expect(parseShiftTime('09:30')).toBe(570);
    expect(parseShiftTime('24:00')).toBeNull();
    expect(parseShiftTime('9:30')).toBeNull();
    expect(shiftMinutes('09:30', '18:00')).toBe(510);
    expect(shiftMinutes('22:00', '06:00')).toBe(480); // overnight
    expect(shiftMinutes('bad', '06:00')).toBeNull();
  });

  it('parses weekly-off tokens; empty = none; junk = null', () => {
    expect(parseWeeklyOffDays('SUN')).toEqual([0]);
    expect(parseWeeklyOffDays('sat, sun')).toEqual([0, 6]);
    expect(parseWeeklyOffDays('')).toEqual([]);
    expect(parseWeeklyOffDays('SUN,FUNDAY')).toBeNull();
  });

  it('expected working days: offs out, holidays out, holiday-on-off never double-counted', () => {
    // August 2026: 31 days; Saturdays 1,8,15,22,29 · Sundays 2,9,16,23,30.
    expect(expectedWorkingDays('2026-08', [])).toBe(31);
    expect(expectedWorkingDays('2026-08', [0, 6])).toBe(21);
    // 2026-08-15 is a Saturday (already off) → no change; 2026-08-11 is a Tuesday → −1.
    const holidays = new Set(['2026-08-15', '2026-08-11']);
    expect(expectedWorkingDays('2026-08', [0, 6], holidays)).toBe(20);
    expect(expectedWorkingDays('junk', [0])).toBe(0);
  });

  it('resolves an employee shift → offs, falling back to null honestly', () => {
    const shifts = [{ id: 's1', status: 'active', fields: { weeklyOffDays: 'SAT,SUN' } }];
    expect(weeklyOffsForShift(shifts, 's1')).toEqual([0, 6]);
    expect(weeklyOffsForShift(shifts, '')).toBeNull();
    expect(weeklyOffsForShift(shifts, 'ghost')).toBeNull();
  });
});

describe('Shift module, employee assignment, and attendance prefill', () => {
  let dir: string;
  let shifts: EnterpriseModule;
  let employees: EnterpriseModule;
  let holidays: EnterpriseModule;
  let leaves: EnterpriseModule;
  let attendance: EnterpriseModule;

  const ctx = (): EnterpriseModuleActionContext =>
    ({ actor: () => 'hr', now: () => T0, emit: () => {}, moduleFor: () => null }) as unknown as EnterpriseModuleActionContext;

  const createVia = (mod: EnterpriseModule, fields: Record<string, unknown>) => {
    const v = mod.hooks.validate({ fields });
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    return mod.store.create({ title: String(v.values[mod.descriptor.titleField ?? 'name'] ?? 'rec'), fields: v.values, actor: 't', now: T0 });
  };

  beforeEach(async () => {
    dir = join(tmpdir(), `np-shift-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    shifts = createShiftModule(join(dir, 'shifts.json'));
    await shifts.store.load();
    employees = createEmployeeModule(join(dir, 'employees.json'), undefined, shifts.store);
    await employees.store.load();
    holidays = createHolidayModule(join(dir, 'holidays.json'));
    await holidays.store.load();
    leaves = createLeaveModule(join(dir, 'leave.json'), employees.store);
    await leaves.store.load();
    attendance = createAttendanceModule(join(dir, 'attendance.json'), employees.store, leaves.store, holidays.store, shifts.store);
    await attendance.store.load();
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

  it('shift guards: times, tokens, grace, not-all-off, UNIQUE code; derives hours + overnight', () => {
    expect(shifts.hooks.validate({ fields: { code: 'GEN', name: 'G', startTime: '9:30', endTime: '18:00' } }).ok).toBe(false);
    expect(shifts.hooks.validate({ fields: { code: 'GEN', name: 'G', startTime: '09:30', endTime: '18:00', weeklyOffDays: 'FUNDAY' } }).ok).toBe(false);
    expect(shifts.hooks.validate({ fields: { code: 'GEN', name: 'G', startTime: '09:30', endTime: '18:00', weeklyOffDays: 'SUN,MON,TUE,WED,THU,FRI,SAT' } }).ok).toBe(false);
    expect(shifts.hooks.validate({ fields: { code: 'GEN', name: 'G', startTime: '09:30', endTime: '18:00', graceMinutes: 999 } }).ok).toBe(false);
    const night = shifts.hooks.validate({ fields: { code: 'night', name: 'Night', startTime: '22:00', endTime: '06:00', weeklyOffDays: 'sun' } });
    expect(night.ok).toBe(true);
    if (night.ok) {
      expect(night.values.code).toBe('NIGHT'); // normalized
      expect(night.values.hoursPerDay).toBe(8);
      expect(night.values.overnight).toBe('yes');
      expect(night.values.weeklyOffDays).toBe('SUN');
    }
    createVia(shifts, { code: 'GEN', name: 'General', startTime: '09:30', endTime: '18:00', weeklyOffDays: 'SAT,SUN' });
    expect(shifts.hooks.validate({ fields: { code: 'gen', name: 'Dup', startTime: '10:00', endTime: '19:00' } }).ok).toBe(false);
  });

  it('employee shiftRef guard: a live shift or nothing', () => {
    const shift = createVia(shifts, { code: 'GEN', name: 'General', startTime: '09:30', endTime: '18:00', weeklyOffDays: 'SAT,SUN' });
    expect(employees.hooks.validate({ fields: { name: 'A', employeeNumber: 'E1', shiftRef: 'ghost' } }).ok).toBe(false);
    expect(employees.hooks.validate({ fields: { name: 'A', employeeNumber: 'E1', shiftRef: shift.id } }).ok).toBe(true);
    expect(employees.hooks.validate({ fields: { name: 'A', employeeNumber: 'E1' } }).ok).toBe(true); // optional
  });

  it('IMPORT LEAVE prefills present days: working(20) − paid(2) − LOP(2) = 16', async () => {
    const shift = createVia(shifts, { code: 'GEN', name: 'General', startTime: '09:30', endTime: '18:00', weeklyOffDays: 'SAT,SUN' });
    createVia(employees, { name: 'Asha', employeeNumber: 'E1', role: 'Eng', department: 'R&D', monthlySalary: 31000, shiftRef: shift.id });
    const e = employees.store.list()[0].id;
    createVia(holidays, { name: 'Independence Day', date: '2026-08-15' }); // Saturday — already off
    createVia(holidays, { name: 'Raksha Bandhan', date: '2026-08-11' }); // Tuesday — real holiday
    const unpaid = createVia(leaves, { employee: e, kind: 'unpaid', fromDate: '2026-08-10', toDate: '2026-08-12' });
    await leaves.hooks.runAction!(APPROVE_LEAVE_ACTION, leaves.store.get(unpaid.id)!, ctx()); // 10,12 count (11 = holiday) → 2 LOP
    const sick = createVia(leaves, { employee: e, kind: 'sick', fromDate: '2026-08-20', toDate: '2026-08-21' });
    await leaves.hooks.runAction!(APPROVE_LEAVE_ACTION, leaves.store.get(sick.id)!, ctx()); // Thu,Fri → 2 paid
    const stmt = createVia(attendance, { employee: e, period: '2026-08' });
    const res = await attendance.hooks.runAction!(IMPORT_LEAVE_ACTION, attendance.store.get(stmt.id)!, ctx());
    expect(res.ok).toBe(true);
    const after = attendance.store.get(stmt.id)!;
    expect(Number(after.fields.lopDays)).toBe(2);
    expect(Number(after.fields.paidLeaveDays)).toBe(2);
    // expectedWorkingDays: 31 − 10 weekend days − 1 weekday holiday = 20 → present 20−2−2 = 16.
    expect(Number(after.fields.presentDays)).toBe(16);
    expect(String(after.fields.note)).toContain('prefilled to 16');
    // Day budget still sane: 16 + 2 + 2 = 20 ≤ 31.
  });

  it('no shift assigned → no prefill (FW-2 behavior preserved)', async () => {
    createVia(employees, { name: 'Ben', employeeNumber: 'E2', role: 'Eng', department: 'R&D', monthlySalary: 20000 });
    const e = employees.store.list()[0].id;
    const stmt = createVia(attendance, { employee: e, period: '2026-08', presentDays: 5 });
    const res = await attendance.hooks.runAction!(IMPORT_LEAVE_ACTION, attendance.store.get(stmt.id)!, ctx());
    expect(res.ok).toBe(true);
    expect(Number(attendance.store.get(stmt.id)!.fields.presentDays)).toBe(5); // untouched
    expect(String(attendance.store.get(stmt.id)!.fields.note)).not.toContain('prefilled');
  });
});
