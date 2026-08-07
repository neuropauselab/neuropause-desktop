/**
 * HR → FW-11 OKRs — the pure engine (strict quarter keys, guarded key-result
 * JSON, capped equal-weighted arithmetic progress) and the module proof:
 * owner must be a live employee, progress is derived at validate (a check-in
 * is an ordinary edit of an ACTIVE objective), activate/close drive the
 * lifecycle, and a closed quarter is immutable history.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { okrProgress, parseKeyResults, parseOkrPeriod } from '@neuropause/shared';
import { createEmployeeModule } from './employeeModule';
import { createOkrModule, ACTIVATE_OKR_ACTION, CLOSE_OKR_ACTION } from './okrModule';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';

const T0 = '2026-08-07T09:00:00.000Z';

describe('OKR engine (pure)', () => {
  it('quarter keys are strict YYYY-Qn', () => {
    expect(parseOkrPeriod('2026-Q3')).toEqual({ year: 2026, quarter: 3 });
    expect(parseOkrPeriod('2026-Q5')).toBeNull();
    expect(parseOkrPeriod('2026-08')).toBeNull();
    expect(parseOkrPeriod('q3-2026')).toBeNull();
  });

  it('key-result JSON is guarded, every failure naming its fix', () => {
    expect(parseKeyResults('not json').ok).toBe(false);
    expect(parseKeyResults('{}').ok).toBe(false);
    expect(parseKeyResults('[]').ok).toBe(false);
    expect(parseKeyResults(JSON.stringify(new Array(13).fill({ kr: 'x', target: 1 }))).ok).toBe(false);
    const noKr = parseKeyResults('[{"target":10}]');
    expect(noKr.ok).toBe(false);
    if (!noKr.ok) expect(noKr.error).toContain('Key result 1');
    expect(parseKeyResults('[{"kr":"x","target":0}]').ok).toBe(false);
    expect(parseKeyResults('[{"kr":"x","target":10,"current":-1}]').ok).toBe(false);
    const ok = parseKeyResults('[{"kr":"Ship v2","target":100,"current":40,"unit":"%"},{"kr":"NPS 60","target":60}]');
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.keyResults).toHaveLength(2);
      expect(ok.keyResults[1].current).toBe(0); // defaulted
    }
  });

  it('progress: capped per KR, equal-weighted overall — over-achieving one KR never masks another', () => {
    const p = okrProgress([
      { kr: 'a', target: 100, current: 40, unit: '%' },
      { kr: 'b', target: 50, current: 120, unit: '' }, // 240% raw → capped 100
      { kr: 'c', target: 10, current: 0, unit: '' },
    ]);
    expect(p.perKeyResult).toEqual([40, 100, 0]);
    expect(p.overall).toBe(47); // mean(40,100,0) rounded
    expect(p.achievedCount).toBe(1);
    expect(okrProgress([]).overall).toBe(0);
  });
});

describe('OKRs module over real stores', () => {
  let dir: string;
  let employees: EnterpriseModule;
  let okrs: EnterpriseModule;
  let ownerId: string;

  const ctx = (): EnterpriseModuleActionContext =>
    ({ actor: () => 'lead', now: () => T0, authorize: () => undefined, emit: () => undefined, moduleFor: () => null }) as unknown as EnterpriseModuleActionContext;

  const createVia = (mod: EnterpriseModule, fields: Record<string, unknown>, title: string) => {
    const v = mod.hooks.validate({ fields });
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    return mod.store.create({ title, fields: v.values, actor: 't', now: T0 });
  };

  beforeEach(async () => {
    dir = join(tmpdir(), `np-okr-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    employees = createEmployeeModule(join(dir, 'employees.json'));
    okrs = createOkrModule(join(dir, 'okrs.json'), employees.store);
    await Promise.all([employees.store.load(), okrs.store.load()]);
    ownerId = createVia(employees, { name: 'Asha Rao', employeeNumber: 'EMP-0001' }, 'Asha Rao').id;
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

  const KRS = '[{"kr":"Ship onboarding v2","target":100,"current":40,"unit":"%"},{"kr":"Cut signup time","target":50,"current":50,"unit":"s"}]';

  it('guards: quarter format, KR JSON, live owner; progress derived at validate', async () => {
    expect(okrs.hooks.validate({ fields: { objective: 'X', owner: ownerId, period: '2026-08', keyResults: KRS } }).ok).toBe(false);
    expect(okrs.hooks.validate({ fields: { objective: 'X', owner: ownerId, period: '2026-Q3', keyResults: 'junk' } }).ok).toBe(false);
    expect(okrs.hooks.validate({ fields: { objective: 'X', owner: 'ghost', period: '2026-Q3', keyResults: KRS } }).ok).toBe(false);
    const o = createVia(okrs, { objective: 'Effortless onboarding', owner: ownerId, period: '2026-Q3', keyResults: KRS }, 'Effortless onboarding');
    expect(Number(o.fields.progressPct)).toBe(70); // mean(40, 100)
    expect(Number(o.fields.krCount)).toBe(2);
    expect(Number(o.fields.achievedCount)).toBe(1);
    expect(String(o.fields.ownerName)).toBe('Asha Rao');
    expect(String(o.fields.stage ?? o.fields.status)).toBe('draft');
  });

  it('an exited owner is refused', async () => {
    const gone = createVia(employees, { name: 'Left Person', employeeNumber: 'EMP-0002' }, 'Left Person');
    await employees.hooks.runAction!('exit', employees.store.get(gone.id)!, ctx());
    expect(okrs.hooks.validate({ fields: { objective: 'X', owner: gone.id, period: '2026-Q3', keyResults: KRS } }).ok).toBe(false);
  });

  it('lifecycle: activate → check-in recomputes progress and KEEPS active → close freezes forever', async () => {
    const o = createVia(okrs, { objective: 'Effortless onboarding', owner: ownerId, period: '2026-Q3', keyResults: KRS }, 'Effortless onboarding');
    expect((await okrs.hooks.runAction!(CLOSE_OKR_ACTION, okrs.store.get(o.id)!, ctx())).ok).toBe(false); // draft can't close
    const act = await okrs.hooks.runAction!(ACTIVATE_OKR_ACTION, okrs.store.get(o.id)!, ctx());
    expect(act.ok).toBe(true);
    expect(String(okrs.store.get(o.id)!.fields.status)).toBe('active');
    // Check-in: an ordinary edit — currents move, progress re-derives, status STAYS active.
    const checkedIn = okrs.hooks.validate({
      fields: {
        ...okrs.store.get(o.id)!.fields,
        keyResults: '[{"kr":"Ship onboarding v2","target":100,"current":90,"unit":"%"},{"kr":"Cut signup time","target":50,"current":50,"unit":"s"}]',
      },
    });
    expect(checkedIn.ok).toBe(true);
    if (checkedIn.ok) {
      okrs.store.update(o.id, { fields: checkedIn.values, actor: 'lead', now: T0 });
      expect(Number(okrs.store.get(o.id)!.fields.progressPct)).toBe(95); // mean(90, 100)
      expect(String(okrs.store.get(o.id)!.fields.status)).toBe('active'); // marker kept it active
    }
    const closed = await okrs.hooks.runAction!(CLOSE_OKR_ACTION, okrs.store.get(o.id)!, ctx());
    expect(closed.ok).toBe(true);
    expect(closed.message).toContain('95%');
    expect(String(okrs.store.get(o.id)!.fields.status)).toBe('closed');
    // Closed = immutable; and double-activate refuses.
    expect(okrs.hooks.validate({ fields: { ...okrs.store.get(o.id)!.fields, notes: 'x' } }).ok).toBe(false);
    expect((await okrs.hooks.runAction!(ACTIVATE_OKR_ACTION, okrs.store.get(o.id)!, ctx())).ok).toBe(false);
  });
});
