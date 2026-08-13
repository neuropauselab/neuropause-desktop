/**
 * HR → FW-2 Leave + Holiday Calendar — the pure leave engine, both modules'
 * guards, the human-in-the-loop approval lifecycle, and the cross-module
 * proof: approved unpaid leave (holidays excluded) becomes LOP through the
 * Attendance statement's Import Leave action — and from there prorates
 * payroll exactly like FW-1.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  deriveLeavePeriodSummary,
  holidayDateSet,
  leaveDaysInPeriod,
  leaveRangesOverlap,
  leaveSpanDays,
  parseLeaveDate,
} from '@neuropause/shared';
import { createAttendanceModule, IMPORT_LEAVE_ACTION, CONFIRM_ATTENDANCE_ACTION } from './attendanceModule';
import { createEmployeeModule } from './employeeModule';
import { createHolidayModule } from './holidayModule';
import { createLeaveModule, APPROVE_LEAVE_ACTION, REJECT_LEAVE_ACTION } from './leaveModule';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';

const T0 = '2026-08-06T00:00:00.000Z';

// ── Pure engine ────────────────────────────────────────────────────────────

describe('Leave engine (pure)', () => {
  it('parses strict dates and rejects rollovers', () => {
    expect(parseLeaveDate('2026-08-10')).not.toBeNull();
    expect(parseLeaveDate('2026-02-30')).toBeNull();
    expect(parseLeaveDate('2026-8-1')).toBeNull();
    expect(parseLeaveDate('')).toBeNull();
  });

  it('counts inclusive spans and detects overlap', () => {
    expect(leaveSpanDays('2026-08-10', '2026-08-10')).toBe(1);
    expect(leaveSpanDays('2026-08-10', '2026-08-12')).toBe(3);
    expect(leaveSpanDays('2026-08-12', '2026-08-10')).toBe(0);
    expect(leaveRangesOverlap('2026-08-10', '2026-08-12', '2026-08-12', '2026-08-14')).toBe(true);
    expect(leaveRangesOverlap('2026-08-10', '2026-08-12', '2026-08-13', '2026-08-14')).toBe(false);
  });

  it('month-clips spans and excludes declared holidays', () => {
    // Spans July→August: only the August days count for 2026-08.
    expect(leaveDaysInPeriod('2026-07-30', '2026-08-02', '2026-08')).toBe(2);
    // 3-day span with one declared holiday inside → 2 countable days.
    const holidays = new Set(['2026-08-11']);
    expect(leaveDaysInPeriod('2026-08-10', '2026-08-12', '2026-08', holidays)).toBe(2);
    expect(leaveDaysInPeriod('2026-08-10', '2026-08-12', '2026-09')).toBe(0);
  });

  it('summarizes only APPROVED requests for the right employee', () => {
    const rec = (fields: Record<string, unknown>, status = 'active') => ({ status, fields });
    const leaves = [
      rec({ status: 'approved', employee: 'e1', kind: 'unpaid', fromDate: '2026-08-10', toDate: '2026-08-12' }),
      rec({ status: 'approved', employee: 'e1', kind: 'sick', fromDate: '2026-08-20', toDate: '2026-08-21' }),
      rec({ status: 'pending', employee: 'e1', kind: 'unpaid', fromDate: '2026-08-25', toDate: '2026-08-26' }), // pending — ignored
      rec({ status: 'approved', employee: 'e2', kind: 'unpaid', fromDate: '2026-08-01', toDate: '2026-08-05' }), // other employee
    ];
    const holidays = new Set(['2026-08-11']);
    const s = deriveLeavePeriodSummary(leaves, holidays, 'e1', '2026-08');
    expect(s).toEqual({ paidLeaveDays: 2, unpaidLeaveDays: 2, requestCount: 2 });
  });

  it('folds holiday records into a date set, skipping deleted and junk', () => {
    const set = holidayDateSet([
      { status: 'active', fields: { date: '2026-08-15' } },
      { status: 'deleted', fields: { date: '2026-08-16' } },
      { status: 'active', fields: { date: 'not-a-date' } },
    ]);
    expect([...set]).toEqual(['2026-08-15']);
  });
});

// ── Modules (store-backed) ─────────────────────────────────────────────────

describe('Leave + Holiday modules and the attendance import', () => {
  let dir: string;
  let employees: EnterpriseModule;
  let holidays: EnterpriseModule;
  let leaves: EnterpriseModule;
  let attendance: EnterpriseModule;

  const ctx = (): EnterpriseModuleActionContext =>
    ({ actor: () => 'hr-manager', now: () => T0, emit: () => {}, moduleFor: () => null }) as unknown as EnterpriseModuleActionContext;

  const createVia = (mod: EnterpriseModule, fields: Record<string, unknown>) => {
    const v = mod.hooks.validate({ fields });
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    return mod.store.create({ title: String(v.values[mod.descriptor.titleField ?? 'name'] ?? 'rec'), fields: v.values, actor: 'test', now: T0 });
  };

  beforeEach(async () => {
    dir = join(tmpdir(), `np-leave-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    employees = createEmployeeModule(join(dir, 'employees.json'));
    await employees.store.load();
    holidays = createHolidayModule(join(dir, 'holidays.json'));
    await holidays.store.load();
    leaves = createLeaveModule(join(dir, 'leave.json'), employees.store);
    await leaves.store.load();
    attendance = createAttendanceModule(join(dir, 'attendance.json'), employees.store, leaves.store, holidays.store);
    await attendance.store.load();
    createVia(employees, { name: 'Asha', employeeNumber: 'E1', role: 'Engineer', department: 'R&D', monthlySalary: 31000 });
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

  const employeeId = (): string => employees.store.list()[0].id;

  it('holiday calendar is a set — duplicate dates refuse', () => {
    createVia(holidays, { name: 'Independence Day', date: '2026-08-15' });
    const dup = holidays.hooks.validate({ fields: { name: 'Dup', date: '2026-08-15' } });
    expect(dup.ok).toBe(false);
    const badDate = holidays.hooks.validate({ fields: { name: 'X', date: '2026-02-30' } });
    expect(badDate.ok).toBe(false);
  });

  it('leave guards: real employee, date order, kind, and no overlapping live request', () => {
    const e = employeeId();
    expect(leaves.hooks.validate({ fields: { employee: 'ghost', kind: 'paid', fromDate: '2026-08-10', toDate: '2026-08-11' } }).ok).toBe(false);
    expect(leaves.hooks.validate({ fields: { employee: e, kind: 'paid', fromDate: '2026-08-12', toDate: '2026-08-10' } }).ok).toBe(false);
    expect(leaves.hooks.validate({ fields: { employee: e, kind: 'vacation', fromDate: '2026-08-10', toDate: '2026-08-11' } }).ok).toBe(false);
    createVia(leaves, { employee: e, kind: 'paid', fromDate: '2026-08-10', toDate: '2026-08-12' });
    // Overlap with the pending request refuses; adjacent dates pass.
    expect(leaves.hooks.validate({ fields: { employee: e, kind: 'sick', fromDate: '2026-08-12', toDate: '2026-08-13' } }).ok).toBe(false);
    expect(leaves.hooks.validate({ fields: { employee: e, kind: 'sick', fromDate: '2026-08-13', toDate: '2026-08-14' } }).ok).toBe(true);
  });

  it('approval lifecycle: pending → approved/rejected, once, audited; rejection frees the dates', async () => {
    const e = employeeId();
    const req = createVia(leaves, { employee: e, kind: 'unpaid', fromDate: '2026-08-10', toDate: '2026-08-12' });
    const approve = await leaves.hooks.runAction!(APPROVE_LEAVE_ACTION, leaves.store.get(req.id)!, ctx());
    expect(approve.ok).toBe(true);
    const decided = leaves.store.get(req.id)!;
    expect(String(decided.fields.status)).toBe('approved');
    expect(String(decided.fields.decidedBy)).toBe('hr-manager');
    // Deciding again refuses.
    expect((await leaves.hooks.runAction!(REJECT_LEAVE_ACTION, decided, ctx())).ok).toBe(false);
    // A rejected request frees its dates for a new one.
    const req2 = createVia(leaves, { employee: e, kind: 'paid', fromDate: '2026-08-20', toDate: '2026-08-21' });
    await leaves.hooks.runAction!(REJECT_LEAVE_ACTION, leaves.store.get(req2.id)!, ctx());
    expect(leaves.hooks.validate({ fields: { employee: e, kind: 'sick', fromDate: '2026-08-20', toDate: '2026-08-21' } }).ok).toBe(true);
  });

  it('IMPORT LEAVE: approved unpaid minus holidays → LOP on the draft statement; confirm feeds the FW-1 map', async () => {
    const e = employeeId();
    createVia(holidays, { name: 'Independence Day', date: '2026-08-11' });
    // Approved unpaid 10–12 Aug (3 days, one is a holiday → 2 LOP) + approved sick 20–21 (2 paid days).
    const unpaid = createVia(leaves, { employee: e, kind: 'unpaid', fromDate: '2026-08-10', toDate: '2026-08-12' });
    await leaves.hooks.runAction!(APPROVE_LEAVE_ACTION, leaves.store.get(unpaid.id)!, ctx());
    const sick = createVia(leaves, { employee: e, kind: 'sick', fromDate: '2026-08-20', toDate: '2026-08-21' });
    await leaves.hooks.runAction!(APPROVE_LEAVE_ACTION, leaves.store.get(sick.id)!, ctx());
    // Draft statement, then import.
    const stmt = createVia(attendance, { employee: e, period: '2026-08' });
    const imported = await attendance.hooks.runAction!(IMPORT_LEAVE_ACTION, attendance.store.get(stmt.id)!, ctx());
    expect(imported.ok).toBe(true);
    const after = attendance.store.get(stmt.id)!;
    expect(Number(after.fields.lopDays)).toBe(2);
    expect(Number(after.fields.paidLeaveDays)).toBe(2);
    expect(String(after.fields.note)).toContain('2 approved request(s)'.replace('2 approved', '2 approved')); // note names the import
    // Confirm → the FW-1 attendance map sees exactly these LOP days.
    const confirmed = await attendance.hooks.runAction!(CONFIRM_ATTENDANCE_ACTION, attendance.store.get(stmt.id)!, ctx());
    expect(confirmed.ok).toBe(true);
    const { deriveAttendanceByEmployee } = await import('@neuropause/shared');
    const map = deriveAttendanceByEmployee(attendance.store.list(), '2026-08');
    expect(map.get(e)).toEqual({ lopDays: 2, presentDays: 0, paidLeaveDays: 2 });
    // And importing into a CONFIRMED statement refuses.
    expect((await attendance.hooks.runAction!(IMPORT_LEAVE_ACTION, attendance.store.get(stmt.id)!, ctx())).ok).toBe(false);
  });

  it('import with no approved leave changes nothing and says so', async () => {
    const e = employeeId();
    const stmt = createVia(attendance, { employee: e, period: '2026-09', presentDays: 30 });
    const res = await attendance.hooks.runAction!(IMPORT_LEAVE_ACTION, attendance.store.get(stmt.id)!, ctx());
    expect(res.ok).toBe(true);
    expect(res.message).toContain('No approved leave');
    const after = attendance.store.get(stmt.id)!;
    expect(Number(after.fields.lopDays)).toBe(0);
    expect(Number(after.fields.presentDays)).toBe(30);
  });
});
