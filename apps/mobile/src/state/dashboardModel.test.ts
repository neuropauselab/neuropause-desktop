/**
 * Mobile M1-09 — pure tests for the Dashboard view-model adapters.
 */
import { describe, expect, it } from 'vitest';
import type { CompanionFamilySummary, FamilyDashboardData } from '@neuropause/shared';
import { colors } from '../theme/tokens';
import { bandColor, familyBars, moduleBars, statusDonutSlices, trendBars } from './dashboardModel';

const families: CompanionFamilySummary[] = [
  { group: 'Finance', moduleCount: 6, recordCount: 1200 },
  { group: 'HR', moduleCount: 4, recordCount: 350 },
];

const family = (over: Partial<FamilyDashboardData> = {}): FamilyDashboardData => ({
  kpis: [{ label: 'Open', value: '12' }],
  creationTrend: [
    { month: 'Mar', count: 3 },
    { month: 'Apr', count: 7 },
  ],
  hasRecords: true,
  moduleBars: [
    { name: 'Invoices', active: 40 },
    { name: 'Bills', active: 25 },
  ],
  statusDonut: {
    title: 'Invoice status',
    slices: [
      { name: 'Paid', value: 30 },
      { name: 'Open', value: 10 },
    ],
  },
  lowStock: null,
  headcountByDept: null,
  funnel: null,
  expiringContracts: null,
  ...over,
});

describe('dashboardModel', () => {
  it('maps families to record-count bars, capped', () => {
    expect(familyBars(families)).toEqual([
      { label: 'Finance', value: 1200 },
      { label: 'HR', value: 350 },
    ]);
    expect(familyBars(families, 1)).toHaveLength(1);
  });

  it('maps a family dashboard to module bars and trend bars', () => {
    const f = family();
    expect(moduleBars(f)).toEqual([
      { label: 'Invoices', value: 40 },
      { label: 'Bills', value: 25 },
    ]);
    expect(trendBars(f)).toEqual([
      { label: 'Mar', value: 3 },
      { label: 'Apr', value: 7 },
    ]);
  });

  it('maps the status donut, and returns [] when a family has none', () => {
    expect(statusDonutSlices(family())).toEqual([
      { name: 'Paid', value: 30 },
      { name: 'Open', value: 10 },
    ]);
    expect(statusDonutSlices(family({ statusDonut: null }))).toEqual([]);
  });

  it('colours KPI bands from the shared tokens, accent when unbanded', () => {
    expect(bandColor('healthy')).toBe(colors.bands.healthy);
    expect(bandColor('critical')).toBe(colors.bands.critical);
    expect(bandColor(undefined)).toBe(colors.accent);
  });
});
