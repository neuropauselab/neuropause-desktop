import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  computeSalaryBreakup,
  parseSalaryComponents,
  type SalaryComponent,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createEmployeeModule } from './employeeModule';
import { createSalaryStructureModule } from './salaryStructureModule';

const T0 = '2026-08-06T00:00:00.000Z';

const line = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ code: 'HRA', name: 'House Rent Allowance', kind: 'earning', calc: 'percentOfBasic', value: 40, ...over });

describe('Salary structure domain rules (pure)', () => {
  it('parses JSON-per-line components with defaults, and reports problems by line number', () => {
    const parsed = parseSalaryComponents(
      [
        line(),
        line({ code: 'conv', name: 'Conveyance', calc: 'fixed', value: 1600, esiWage: false, taxable: false }),
        line({ code: 'DA', name: 'Dearness Allowance', value: 10, pfWage: true }),
        line({ code: 'PROF', name: 'Society Fee', kind: 'deduction', calc: 'fixed', value: 200 }),
      ].join('\n'),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.components.map((c) => c.code)).toEqual(['HRA', 'CONV', 'DA', 'PROF']); // codes uppercased
    const [hra, conv, da, prof] = parsed.components;
    // Earning defaults: pfWage false, esiWage true, taxable true — flags override.
    expect([hra.pfWage, hra.esiWage, hra.taxable]).toEqual([false, true, true]);
    expect([conv.pfWage, conv.esiWage, conv.taxable]).toEqual([false, false, false]);
    expect(da.pfWage).toBe(true);
    // Deductions never carry wage-base flags.
    expect([prof.pfWage, prof.esiWage, prof.taxable]).toEqual([false, false, false]);
  });

  it('refuses bad lines loudly: bad JSON, reserved BASIC, duplicates, bad enums, flags on deductions', () => {
    const parsed = parseSalaryComponents(
      [
        'not json',
        line({ code: 'BASIC' }),
        line({ code: 'HRA' }),
        line({ code: 'hra', name: 'Duplicate' }),
        line({ code: 'X', kind: 'bonus' }),
        line({ code: 'Y', value: -5 }),
        line({ code: 'Z', value: 600 }),
        line({ code: 'CUT', name: 'Recovery', kind: 'deduction', calc: 'fixed', value: 100, taxable: true }),
      ].join('\n'),
    );
    expect(parsed.errors).toHaveLength(7);
    expect(parsed.errors[0]).toContain('Line 1: not valid JSON');
    expect(parsed.errors[1]).toContain('"BASIC" is reserved');
    expect(parsed.errors[2]).toContain('duplicate code "HRA"'); // line 4 vs line 3, case-insensitive
    expect(parsed.errors[3]).toContain('"kind" must be');
    expect(parsed.errors[4]).toContain('"value" must be a number ≥ 0');
    expect(parsed.errors[5]).toContain('capped at 500');
    expect(parsed.errors[6]).toContain('"taxable" applies to earnings only');
    expect(parsed.components.map((c) => c.code)).toEqual(['HRA']); // only the one clean line survives
    expect(parseSalaryComponents('')).toEqual({ components: [], errors: [] });
    expect(parseSalaryComponents(null)).toEqual({ components: [], errors: [] });
  });

  it('computes the breakup deterministically — implicit BASIC first, round2 math, honest wage bases', () => {
    const components: SalaryComponent[] = [
      { code: 'HRA', name: 'HRA', kind: 'earning', calc: 'percentOfBasic', value: 40, pfWage: false, esiWage: true, taxable: true },
      { code: 'DA', name: 'DA', kind: 'earning', calc: 'percentOfBasic', value: 10, pfWage: true, esiWage: true, taxable: true },
      { code: 'CONV', name: 'Conveyance', kind: 'earning', calc: 'fixed', value: 1600, pfWage: false, esiWage: false, taxable: false },
      { code: 'PROF', name: 'Society Fee', kind: 'deduction', calc: 'fixed', value: 200, pfWage: false, esiWage: false, taxable: false },
    ];
    const b = computeSalaryBreakup(components, 20000);
    expect(b.lines.map((l) => [l.code, l.amount])).toEqual([
      ['BASIC', 20000], ['HRA', 8000], ['DA', 2000], ['CONV', 1600], ['PROF', 200],
    ]);
    expect(b.grossEarnings).toBe(31600);
    expect(b.totalDeductions).toBe(200);
    expect(b.netPay).toBe(31400);
    // Bases: BASIC counts everywhere; DA is PF wage; CONV is outside ESI/taxable.
    expect(b.pfWageBase).toBe(22000);
    expect(b.esiWageBase).toBe(30000);
    expect(b.taxableBase).toBe(30000);
    // Zero basic: percent lines collapse to 0, fixed lines survive; negative clamps.
    expect(computeSalaryBreakup(components, 0).grossEarnings).toBe(1600);
    expect(computeSalaryBreakup(components, -5).grossEarnings).toBe(1600);
    // Fractional percent math is round2, not floating dust.
    expect(computeSalaryBreakup(components, 33333).lines[1].amount).toBe(13333.2);
  });
});

describe('Salary structure + employee modules over real stores — guards, markers, assignment', () => {
  let dir: string;
  let structures: EnterpriseModule;
  let employees: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-salstruct-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    structures = createSalaryStructureModule(join(dir, 'structures.json'));
    employees = createEmployeeModule(join(dir, 'employees.json'), structures.store);
    await Promise.all([structures.store.load(), employees.store.load()]);
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: () => null,
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([structures.store.flush(), employees.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const makeStructure = (over: Record<string, unknown> = {}) => {
    const v = structures.hooks.validate({
      fields: {
        structureCode: 'STD-2026',
        structureName: 'Standard 2026',
        referenceBasic: 20000,
        componentsJson: [line(), line({ code: 'PROF', name: 'Society Fee', kind: 'deduction', calc: 'fixed', value: 200 })].join('\n'),
        ...over,
      },
    });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return structures.store.create({ title: String(v.values.structureName), fields: v.values, actor: 't@np', now: T0 });
  };

  it('creates templates, surfaces line-numbered component errors, and previews at the reference basic', async () => {
    const rec = makeStructure();
    expect(rec.fields.status).toBe('active');
    const bad = structures.hooks.validate({
      fields: { structureCode: 'X', structureName: 'X', componentsJson: 'nope' },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(String(bad.errors.componentsJson)).toContain('Line 1');
    const summary = await structures.hooks.summarize!(structures.store.get(rec.id)!);
    expect(summary.headline).toContain('STD-2026 · 2 component(s)');
    expect(summary.summary).toContain('gross 28,000'); // 20000 + 40% HRA — en-US pinned
    expect(summary.summary).toContain('PF 20,000'); // HRA is not PF wage by default
    expect(summary.risk).toBe('low');
    // Unconfigured template (no components, no reference) is flagged, not fabricated.
    const empty = makeStructure({ structureCode: 'EMPTY', structureName: 'Empty', referenceBasic: 0, componentsJson: '' });
    expect((await structures.hooks.summarize!(structures.store.get(empty.id)!)).risk).toBe('medium');
  });

  it('archives as immutable history — edits refused, forged markers refused', async () => {
    const rec = makeStructure();
    const archived = await structures.hooks.runAction!('archive', rec, ctx);
    expect(archived.ok).toBe(true);
    const frozen = structures.store.get(rec.id)!;
    expect(frozen.fields.status).toBe('archived');
    expect(structures.hooks.validate({ fields: { ...frozen.fields, structureName: 'Renamed' } }).ok).toBe(false);
    expect((await structures.hooks.runAction!('archive', frozen, ctx)).ok).toBe(false);
    // A forged marker on a fresh input is refused the same way (merged-input guard).
    expect(structures.hooks.validate({ fields: { structureCode: 'F', structureName: 'F', archivedAt: T0 } }).ok).toBe(false);
  });

  it('guards employee assignment: unknown and archived templates refused, active accepted, no-ref untouched', async () => {
    const rec = makeStructure();
    const hire = (fields: Record<string, unknown>) =>
      employees.hooks.validate({
        fields: { employeeNumber: `EMP-${randomUUID().slice(0, 4)}`, name: 'Kinjal', ...fields },
      });
    expect(hire({}).ok).toBe(true); // W4 behavior untouched
    expect(hire({ salaryStructureRef: 'ghost' }).ok).toBe(false);
    const ok = hire({ salaryStructureRef: rec.id, basicSalary: 25000 });
    expect(ok.ok, JSON.stringify('errors' in ok ? ok.errors : {})).toBe(true);
    if (ok.ok) expect(ok.values.basicSalary).toBe(25000);
    expect(hire({ basicSalary: -1 }).ok).toBe(false); // min 0 enforced by the descriptor
    await structures.hooks.runAction!('archive', rec, ctx);
    const archivedRef = hire({ salaryStructureRef: rec.id });
    expect(archivedRef.ok).toBe(false);
    if (!archivedRef.ok) expect(String(archivedRef.errors.salaryStructureRef)).toContain('archived');
  });
});
