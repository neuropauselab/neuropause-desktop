/**
 * HR → FW-10 Recruitment — the pure pipeline engine (fixed stage flow, live
 * stages, deterministic EMP-<n> numbering), the module's guards (one live
 * application per email+position, decided immutability, action-driven stage),
 * and the integration proof: HIRE from an offer creates a REAL Employee
 * through the Employees module's own validate hook, numbers it after the
 * highest existing EMP-<n>, and cross-links both records — while hire refuses
 * outside `offer` and without the employee register.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  EMPLOYEES_MODULE_ID,
  isLiveRecruitmentStage,
  nextEmployeeNumber,
  nextRecruitmentStage,
} from '@neuropause/shared';
import { createCandidateModule, ADVANCE_CANDIDATE_ACTION, HIRE_CANDIDATE_ACTION, REJECT_CANDIDATE_ACTION } from './candidateModule';
import { createEmployeeModule } from './employeeModule';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';

const T0 = '2026-08-07T09:00:00.000Z';

describe('Recruitment engine (pure)', () => {
  it('the happy path is fixed; offer and terminals never auto-advance', () => {
    expect(nextRecruitmentStage('applied')).toBe('screening');
    expect(nextRecruitmentStage('screening')).toBe('interview');
    expect(nextRecruitmentStage('interview')).toBe('offer');
    expect(nextRecruitmentStage('offer')).toBeNull(); // only Hire moves an offer
    expect(nextRecruitmentStage('hired')).toBeNull();
    expect(nextRecruitmentStage('rejected')).toBeNull();
    expect(isLiveRecruitmentStage('interview')).toBe(true);
    expect(isLiveRecruitmentStage('hired')).toBe(false);
  });

  it('EMP numbering: one past the highest existing, zero-padded, junk ignored', () => {
    expect(nextEmployeeNumber([])).toBe('EMP-0001');
    expect(nextEmployeeNumber(['EMP-0001', 'EMP-0007', 'EMP-3', 'E-99', 'junk'])).toBe('EMP-0008');
    expect(nextEmployeeNumber(['EMP-9999'])).toBe('EMP-10000'); // never wraps, only forward
  });
});

describe('Candidates module and the hire → employee integration', () => {
  let dir: string;
  let candidates: EnterpriseModule;
  let employees: EnterpriseModule;

  const ctx = (withEmployees = true): EnterpriseModuleActionContext =>
    ({
      actor: () => 'recruiter',
      now: () => T0,
      authorize: () => undefined,
      emit: () => undefined,
      moduleFor: (id: string) => (withEmployees && id === EMPLOYEES_MODULE_ID ? employees : null),
    }) as unknown as EnterpriseModuleActionContext;

  const createVia = (mod: EnterpriseModule, fields: Record<string, unknown>, title: string) => {
    const v = mod.hooks.validate({ fields });
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    return mod.store.create({ title, fields: v.values, actor: 't', now: T0 });
  };

  beforeEach(async () => {
    dir = join(tmpdir(), `np-recruit-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    candidates = createCandidateModule(join(dir, 'candidates.json'));
    employees = createEmployeeModule(join(dir, 'employees.json'));
    await Promise.all([candidates.store.load(), employees.store.load()]);
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

  const apply = (over: Record<string, unknown> = {}) =>
    createVia(
      candidates,
      { candidateName: 'Meera Iyer', email: 'meera@example.com', position: 'Backend Engineer', department: 'R&D', ...over },
      'Meera Iyer',
    );

  it('guards: stage always starts applied; ONE live application per email+position; re-apply after rejection is fine', async () => {
    const a = apply({ stage: 'offer' }); // user-forged stage is overridden
    expect(String(a.fields.stage)).toBe('applied');
    expect(
      candidates.hooks.validate({
        fields: { candidateName: 'M. Iyer', email: 'MEERA@example.com', position: 'backend engineer' },
      }).ok,
    ).toBe(false); // case-insensitive duplicate
    expect(
      candidates.hooks.validate({
        fields: { candidateName: 'Meera Iyer', email: 'meera@example.com', position: 'Platform Engineer' },
      }).ok,
    ).toBe(true); // different position — allowed
    await candidates.hooks.runAction!(REJECT_CANDIDATE_ACTION, candidates.store.get(a.id)!, ctx());
    expect(String(candidates.store.get(a.id)!.fields.stage)).toBe('rejected');
    // The application is decided → immutable; but a NEW application may open.
    expect(candidates.hooks.validate({ fields: { ...candidates.store.get(a.id)!.fields, notes: 'x' } }).ok).toBe(false);
    expect(
      candidates.hooks.validate({
        fields: { candidateName: 'Meera Iyer', email: 'meera@example.com', position: 'Backend Engineer' },
      }).ok,
    ).toBe(true);
  });

  it('stage is action-driven: advance walks the path, hire refuses before offer, terminals refuse everything', async () => {
    const a = apply();
    const record = () => candidates.store.get(a.id)!;
    expect((await candidates.hooks.runAction!(HIRE_CANDIDATE_ACTION, record(), ctx())).ok).toBe(false); // applied ≠ offer
    for (const expected of ['screening', 'interview', 'offer']) {
      const res = await candidates.hooks.runAction!(ADVANCE_CANDIDATE_ACTION, record(), ctx());
      expect(res.ok).toBe(true);
      expect(String(record().fields.stage)).toBe(expected);
    }
    const past = await candidates.hooks.runAction!(ADVANCE_CANDIDATE_ACTION, record(), ctx());
    expect(past.ok).toBe(false); // an offer advances only through Hire
    expect(past.error).toContain('Hire');
  });

  it('HIRE creates the employee through the register’s own guards, numbers it next, and cross-links', async () => {
    createVia(employees, { name: 'Existing Person', employeeNumber: 'EMP-0041' }, 'Existing Person');
    const a = apply();
    const record = () => candidates.store.get(a.id)!;
    for (let i = 0; i < 3; i++) await candidates.hooks.runAction!(ADVANCE_CANDIDATE_ACTION, record(), ctx());
    const hired = await candidates.hooks.runAction!(HIRE_CANDIDATE_ACTION, record(), ctx());
    expect(hired.ok, hired.ok ? '' : hired.error).toBe(true);
    expect(hired.message).toContain('EMP-0042'); // one past the highest existing
    const after = record();
    expect(String(after.fields.stage)).toBe('hired');
    const employee = employees.store.get(String(after.fields.hiredEmployee))!;
    expect(employee).toBeTruthy();
    expect(String(employee.fields.name)).toBe('Meera Iyer');
    expect(String(employee.fields.role)).toBe('Backend Engineer');
    expect(String(employee.fields.department)).toBe('R&D');
    expect(String(employee.fields.workEmail)).toBe('meera@example.com');
    expect(String(employee.fields.employeeNumber)).toBe('EMP-0042');
    expect(String(employee.fields.joinDate)).toBe('2026-08-07');
    // Decided → the application is immutable history now.
    expect(candidates.hooks.validate({ fields: { ...after.fields, notes: 'x' } }).ok).toBe(false);
    expect((await candidates.hooks.runAction!(REJECT_CANDIDATE_ACTION, after, ctx())).ok).toBe(false);
  });

  it('hire without the employee register refuses loudly', async () => {
    const a = apply();
    const record = () => candidates.store.get(a.id)!;
    for (let i = 0; i < 3; i++) await candidates.hooks.runAction!(ADVANCE_CANDIDATE_ACTION, record(), ctx());
    const res = await candidates.hooks.runAction!(HIRE_CANDIDATE_ACTION, record(), ctx(false));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('not available');
    expect(String(record().fields.stage)).toBe('offer'); // unchanged
  });
});
