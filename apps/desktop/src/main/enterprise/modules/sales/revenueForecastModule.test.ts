import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  deriveRevenueForecast,
  forecastMonths,
  type CrmOpportunity,
} from '@neuropause/shared';
import type { EnterpriseModule } from '../../framework';
import { createOpportunityModule } from '../crm/opportunityModule';
import { createRevenueForecastModule } from './revenueForecastModule';

const T0 = '2026-08-06T00:00:00.000Z';

const opp = (over: Partial<CrmOpportunity>): CrmOpportunity => ({
  id: 'o1', name: 'Deal', account: '', sourceLeadRef: '', quoteRef: '', stage: 'proposal',
  amount: 20000, probability: 50, weightedValue: 10000, expectedCloseDate: '2026-09-15',
  assignedTo: 'kinjal', closedAt: null, outcome: null, lostReason: '',
  createdAt: T0, updatedAt: T0, ...over,
});

describe('revenue forecast engine (pure) — buckets, bookings, outside visibility', () => {
  it('spans the horizon with calendar-exact months', () => {
    expect(forecastMonths('2026-11-20', 3)).toEqual(['2026-11', '2026-12', '2027-01']);
  });

  it('weights open deals into their close month, books wins, and surfaces the outside bucket', () => {
    const opps = [
      opp({}), // Sep, weighted 10,000
      opp({ id: 'o2', amount: 8000, probability: 25, weightedValue: 2000, expectedCloseDate: '2026-08-20' }),
      opp({ id: 'o3', expectedCloseDate: null, weightedValue: 5000 }), // unscheduled → outside
      opp({ id: 'o4', expectedCloseDate: '2027-06-01', weightedValue: 3000 }), // beyond horizon → outside
      opp({ id: 'o5', stage: 'closed-won', outcome: 'won', amount: 40000, probability: 100, weightedValue: 40000, closedAt: '2026-08-15T00:00:00.000Z' }),
      opp({ id: 'o6', stage: 'closed-lost', outcome: 'lost', probability: 0, weightedValue: 0 }), // excluded
    ];
    const f = deriveRevenueForecast(opps, '2026-08-06', 3);
    expect(f.rows.map((r) => r.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(f.rows[0]).toMatchObject({ month: '2026-08', openWeighted: 2000, wonBooked: 40000, wonCount: 1 });
    expect(f.rows[1]).toMatchObject({ month: '2026-09', openWeighted: 10000, openCount: 1 });
    expect(f.rows[2]).toMatchObject({ month: '2026-10', openWeighted: 0 });
    expect(f.pipelineWeighted).toBe(12000);
    expect(f.bookedInHorizon).toBe(40000);
    expect(f.outsideWeighted).toBe(8000); // 5,000 unscheduled + 3,000 distant — visible, not smeared
    expect(f.outsideCount).toBe(2);
    expect(f.openDeals).toBe(4);
  });
});

describe('Revenue Forecasts over real stores — generation, immutability, guards', () => {
  let dir: string;
  let opps: EnterpriseModule;
  let forecasts: EnterpriseModule;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-rf-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    opps = createOpportunityModule(join(dir, 'opps.json'));
    forecasts = createRevenueForecastModule(join(dir, 'forecasts.json'), opps.store);
    await Promise.all([opps.store.load(), forecasts.store.load()]);
    opps.store.create({
      title: 'Open deal', fields: {
        name: 'Open deal', stage: 'proposal', amount: 20000, probability: 50,
        weightedValue: 10000, expectedCloseDate: '2026-09-15',
      }, actor: 't@np', now: T0,
    });
    opps.store.create({
      title: 'Unscheduled deal', fields: {
        name: 'Unscheduled deal', stage: 'qualification', amount: 6000, probability: 25, weightedValue: 1500,
      }, actor: 't@np', now: T0,
    });
  });

  afterEach(async () => {
    await Promise.all([opps.store.flush(), forecasts.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('creating a forecast generates it from the real pipeline; edits are refused', () => {
    const v = forecasts.hooks.validate({ fields: { asOfDate: '2026-08-06', horizonMonths: 2 } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.values.forecastNumber).toBe('RF-2026-08-06-1');
    expect(v.values.pipelineWeighted).toBe(10000);
    expect(v.values.outsideWeighted).toBe(1500);
    expect(v.values.openDeals).toBe(2);
    const rows = JSON.parse(String(v.values.rows));
    expect(rows.map((r: { month: string }) => r.month)).toEqual(['2026-08', '2026-09']);
    expect(String(v.values.note)).toContain('outside the horizon');
    const rec = forecasts.store.create({ title: String(v.values.forecastNumber), fields: v.values, actor: 't@np', now: T0 });
    const edit = forecasts.hooks.validate({ fields: { ...forecasts.store.get(rec.id)!.fields, horizonMonths: 6 } });
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(JSON.stringify(edit.errors)).toContain('immutable');
    // The validator's max caps the horizon at 12.
    expect(forecasts.hooks.validate({ fields: { asOfDate: '2026-08-06', horizonMonths: 24 } }).ok).toBe(false);
  });
});
