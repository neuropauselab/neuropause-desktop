import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  commissionPlanFor,
  deriveCommissionStatement,
  type CommissionPlan,
  type CrmOpportunity,
} from '@neuropause/shared';
import type { EnterpriseModule } from '../../framework';
import { createOpportunityModule } from '../crm/opportunityModule';
import { createCommissionPlanModule } from './commissionPlanModule';
import { createCommissionStatementModule } from './commissionStatementModule';

const T0 = '2026-08-06T00:00:00.000Z';

const plan = (over: Partial<CommissionPlan>): CommissionPlan => ({
  id: 'p1', planName: 'House', scope: 'all', repName: '', ratePct: 5, active: true,
  priority: 100, createdAt: T0, updatedAt: T0, ...over,
});

const wonOpp = (over: Partial<CrmOpportunity>): CrmOpportunity => ({
  id: 'o1', name: 'Deal', account: '', sourceLeadRef: '', quoteRef: '', stage: 'closed-won',
  amount: 10000, probability: 100, weightedValue: 10000, expectedCloseDate: null,
  assignedTo: 'kinjal', closedAt: '2026-08-10T00:00:00.000Z', outcome: 'won', lostReason: '',
  createdAt: T0, updatedAt: T0, ...over,
});

describe('commission engine (pure) — plan precedence and period bounding', () => {
  it('rep-scoped plans beat the house plan; priority then name break ties; inactive skipped', () => {
    const plans = [
      plan({ id: 'a', planName: 'House', ratePct: 5 }),
      plan({ id: 'b', planName: 'Kinjal special', scope: 'rep', repName: 'kinjal', ratePct: 8 }),
      plan({ id: 'c', planName: 'Dormant', scope: 'rep', repName: 'kinjal', ratePct: 20, active: false }),
    ];
    expect(commissionPlanFor('kinjal', plans)?.planName).toBe('Kinjal special');
    expect(commissionPlanFor('saurabh', plans)?.planName).toBe('House');
    expect(commissionPlanFor('anyone', [plan({ active: false })])).toBeNull();
    const tied = [
      plan({ id: 'x', planName: 'B plan', priority: 10 }),
      plan({ id: 'y', planName: 'A plan', priority: 10 }),
    ];
    expect(commissionPlanFor('r', tied)?.planName).toBe('A plan');
  });

  it('counts only closed-won inside the period, honors the rep filter, surfaces plan-less reps at rate 0', () => {
    const opps = [
      wonOpp({}),
      wonOpp({ id: 'o2', amount: 5000, closedAt: '2026-08-20T00:00:00.000Z' }),
      wonOpp({ id: 'o3', closedAt: '2026-07-31T23:59:59.000Z' }), // prior period
      wonOpp({ id: 'o4', outcome: 'lost', stage: 'closed-lost' }), // lost — excluded
      wonOpp({ id: 'o5', assignedTo: 'saurabh', amount: 4000 }),
      wonOpp({ id: 'o6', assignedTo: '', amount: 1000 }), // → Unassigned, no plan
    ];
    const plans = [plan({ scope: 'rep', repName: 'kinjal', ratePct: 8, planName: 'Kinjal special' })];
    const s = deriveCommissionStatement(opps, plans, '2026-08', '');
    expect(s.repCount).toBe(3);
    const kinjal = s.rows.find((r) => r.rep === 'kinjal')!;
    expect(kinjal.wonValue).toBe(15000);
    expect(kinjal.commission).toBe(1200); // 8% of 15,000
    const saurabh = s.rows.find((r) => r.rep === 'saurabh')!;
    expect(saurabh.ratePct).toBe(0); // won business, no plan — visible, not dropped
    expect(saurabh.planName).toBeNull();
    expect(s.totalWonValue).toBe(20000);
    expect(s.totalCommission).toBe(1200);
    const filtered = deriveCommissionStatement(opps, plans, '2026-08', 'kinjal');
    expect(filtered.repCount).toBe(1);
    expect(filtered.totalWonValue).toBe(15000);
  });
});

describe('Commission Statements over real stores — generation, immutability, history', () => {
  let dir: string;
  let opps: EnterpriseModule;
  let plans: EnterpriseModule;
  let statements: EnterpriseModule;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-comm-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    opps = createOpportunityModule(join(dir, 'opps.json'));
    plans = createCommissionPlanModule(join(dir, 'plans.json'));
    statements = createCommissionStatementModule(join(dir, 'statements.json'), opps.store, plans.store);
    await Promise.all([opps.store.load(), plans.store.load(), statements.store.load()]);
    // Seed a won deal + a plan (store-level create: real records, snapshot inputs).
    opps.store.create({
      title: 'Acme win', fields: {
        name: 'Acme win', stage: 'closed-won', outcome: 'won', amount: 50000, probability: 100,
        weightedValue: 50000, assignedTo: 'kinjal', closedAt: '2026-08-15T00:00:00.000Z',
      }, actor: 't@np', now: T0,
    });
    const pv = plans.hooks.validate({ fields: { planName: 'House — 5%', scope: 'all', ratePct: 5, active: 'yes' } });
    expect(pv.ok).toBe(true);
    if (pv.ok) plans.store.create({ title: 'House — 5%', fields: pv.values, actor: 't@np', now: T0 });
  });

  afterEach(async () => {
    await Promise.all([opps.store.flush(), plans.store.flush(), statements.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('plan-book guards: positive rate ≤ 100 (validator max), named reps', () => {
    expect(plans.hooks.validate({ fields: { planName: 'X', scope: 'all', ratePct: 0, active: 'yes' } }).ok).toBe(false);
    expect(plans.hooks.validate({ fields: { planName: 'X', scope: 'all', ratePct: 101, active: 'yes' } }).ok).toBe(false);
    expect(plans.hooks.validate({ fields: { planName: 'X', scope: 'rep', ratePct: 5, active: 'yes' } }).ok).toBe(false);
  });

  it('creating a statement generates it; re-running keeps history; edits are refused', () => {
    const v = statements.hooks.validate({ fields: { periodKey: '2026-08' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.values.statementNumber).toBe('CS-2026-08-1');
    expect(v.values.totalWonValue).toBe(50000);
    expect(v.values.totalCommission).toBe(2500); // 5% house plan
    expect(v.values.repCount).toBe(1);
    const rows = JSON.parse(String(v.values.rows));
    expect(rows[0]).toMatchObject({ rep: 'kinjal', ratePct: 5, commission: 2500, planName: 'House — 5%' });
    const rec = statements.store.create({ title: String(v.values.statementNumber), fields: v.values, actor: 't@np', now: T0 });
    // Immutable: merged-field edits are refused.
    const edit = statements.hooks.validate({ fields: { ...statements.store.get(rec.id)!.fields, periodKey: '2026-09' } });
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(JSON.stringify(edit.errors)).toContain('immutable');
    // Re-running the same period is history, numbered -2.
    const v2 = statements.hooks.validate({ fields: { periodKey: '2026-08' } });
    expect(v2.ok).toBe(true);
    if (v2.ok) expect(v2.values.statementNumber).toBe('CS-2026-08-2');
    // Bad periods are refused.
    expect(statements.hooks.validate({ fields: { periodKey: 'Aug 2026' } }).ok).toBe(false);
  });
});
