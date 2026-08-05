import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createIndustryPlatform, type IndustryPlatform } from './platform';
import { INDUSTRY_KEYS } from './constants';

describe('20 Industry Solution Packs', () => {
  let runtime: EnterpriseRuntime;
  let ind: IndustryPlatform;

  beforeAll(() => {
    const clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    ind = createIndustryPlatform(runtime, { clock });
  });

  it('registers all twenty verticals with objects, KPIs, compliance, connectors, and reused domains', () => {
    const sols = ind.industries();
    expect(sols.length).toBe(20);
    expect(ind.sdk().keys().sort()).toEqual([...INDUSTRY_KEYS].sort());
    for (const s of sols) {
      expect(s.reusesDomains.length, `${s.key} must reuse domains`).toBeGreaterThan(0);
      expect(s.kpis.length, `${s.key} kpis`).toBeGreaterThan(0);
      expect(s.connectors.length, `${s.key} connectors`).toBeGreaterThan(0);
      expect(s.compliancePacks.length, `${s.key} compliance`).toBeGreaterThan(0);
      expect(s.objects.length, `${s.key} objects`).toBeGreaterThan(0);
    }
  });

  it('healthcare reuses core domains rather than duplicating them', () => {
    const hc = ind.sdk().get('healthcare')!;
    expect(hc.reusesDomains).toEqual(expect.arrayContaining(['healthcare', 'crm', 'hr', 'finance']));
    expect(hc.objects.every((o) => o.reusesDomain.length > 0)).toBe(true);
  });

  it('industry KPIs are 0 with no business data — never fabricated', () => {
    const kpis = ind.analytics().kpis('healthcare');
    expect(kpis.length).toBeGreaterThan(0);
    expect(kpis.every((k) => k.value === 0)).toBe(true);
    expect(ind.analytics().dashboard('healthcare').hasData).toBe(false);
    expect(ind.analytics().dashboard('healthcare').note).toBe('No business data available');
  });

  it('aggregate views span every registered pack', () => {
    expect(ind.sdk().allObjects().length).toBeGreaterThan(20);
    expect(ind.sdk().allConnectors().length).toBeGreaterThan(20);
    expect(ind.sdk().allCompliancePacks().length).toBeGreaterThan(20);
  });
});
