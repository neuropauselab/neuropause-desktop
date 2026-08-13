/**
 * Mobile M1-04 — companion dashboard projections. Locks the KPI mapping
 * (fields carried, optional band/trend preserved and omitted cleanly) and the
 * family rollup (grouping, record-count sums, deterministic order).
 */
import { describe, expect, it } from 'vitest';
import type { EnterpriseModuleSummary, ExecutiveCenterSnapshot } from '@neuropause/shared';
import { buildCompanionFamilies, buildCompanionSnapshot } from './companionDashboards';

const exec = {
  generatedAt: '2026-08-07T12:00:00.000Z',
  kpis: [
    {
      key: 'cash',
      label: 'Cash position',
      value: null,
      display: '₹1.2M',
      band: 'healthy',
      trend: 'up',
    },
    { key: 'pipeline', label: 'Pipeline', value: 62, display: '62%' },
  ],
} as unknown as ExecutiveCenterSnapshot;

function summary(id: string, group: string, recordCount: number): EnterpriseModuleSummary {
  return { id, group, recordCount } as unknown as EnterpriseModuleSummary;
}

describe('buildCompanionSnapshot', () => {
  it('carries key/label/display and preserves band/trend, omitting when absent', () => {
    const snap = buildCompanionSnapshot(exec);
    expect(snap.generatedAt).toBe('2026-08-07T12:00:00.000Z');
    expect(snap.kpis[0]).toEqual({
      key: 'cash',
      label: 'Cash position',
      display: '₹1.2M',
      band: 'healthy',
      trend: 'up',
    });
    // No band/trend on the second KPI — keys must be absent, not undefined.
    expect(snap.kpis[1]).toEqual({ key: 'pipeline', label: 'Pipeline', display: '62%' });
    expect('band' in snap.kpis[1]).toBe(false);
  });
});

describe('buildCompanionFamilies', () => {
  it('groups modules, sums record counts, and orders by record count then name', () => {
    const families = buildCompanionFamilies([
      summary('finance-invoices', 'Finance', 10),
      summary('finance-payments', 'Finance', 5),
      summary('crm-leads', 'CRM', 20),
      summary('hr-employees', 'HR', 20),
    ]);
    expect(families).toEqual([
      { group: 'CRM', moduleCount: 1, recordCount: 20 },
      { group: 'HR', moduleCount: 1, recordCount: 20 },
      { group: 'Finance', moduleCount: 2, recordCount: 15 },
    ]);
  });

  it('falls back to "Other" for a module with no group', () => {
    const families = buildCompanionFamilies([
      { id: 'x', recordCount: 3 } as unknown as EnterpriseModuleSummary,
    ]);
    expect(families).toEqual([{ group: 'Other', moduleCount: 1, recordCount: 3 }]);
  });
});
