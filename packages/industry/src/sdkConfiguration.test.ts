import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createIndustryPlatform, type IndustryPlatform } from './platform';
import type { IndustrySolution } from './types';

const emptySolution = (key: string, reusesDomains: string[]): IndustrySolution => ({ key, name: key, reusesDomains, objects: [], workflows: [], kpis: [], compliancePacks: [], connectors: [], aiSkills: [], documentTemplates: [] });

describe('Industry SDK + Configuration Engine', () => {
  let runtime: EnterpriseRuntime;
  let ind: IndustryPlatform;

  beforeAll(() => {
    const clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    ind = createIndustryPlatform(runtime, { clock });
  });

  it('preloads 20 vertical solution packs, each reusing Wave 8 domains', () => {
    expect(ind.sdk().count()).toBe(20);
    for (const sol of ind.industries()) expect(sol.reusesDomains.length).toBeGreaterThan(0);
    expect(ind.sdk().keys()).toEqual(expect.arrayContaining(['healthcare', 'banking', 'retail', 'manufacturing', 'education', 'aviation']));
  });

  it('registers a custom vertical (governed) and activates it for a tenant', async () => {
    await ind.sdk().register(emptySolution('maritime', ['assets', 'projects']));
    expect(ind.sdk().count()).toBe(21);
    await ind.sdk().activate('tenant-1', 'maritime');
    expect(ind.sdk().activeIndustry('tenant-1')).toBe('maritime');
    await expect(ind.sdk().activate('tenant-1', 'nonexistent')).rejects.toThrow(/no industry/);
  });

  it('rejects a vertical that would duplicate business logic (no reused domains)', async () => {
    await expect(ind.sdk().register(emptySolution('bad', []))).rejects.toThrow(/reuse/i);
  });

  it('configures a tenant entirely as data — no source-code change', async () => {
    const cfg = await ind.configuration().configure('tenant-1', { industry: 'healthcare', country: 'IN', currency: 'INR', branding: { theme: 'dark', colors: { primary: '#0f766e', secondary: '#14b8a6' } } });
    expect(cfg.currency).toBe('INR');
    expect(cfg.country).toBe('IN');
    expect(cfg.branding.theme).toBe('dark');
    ind.configuration().addBusinessRule('tenant-1', { name: 'maxDiscount', rule: 'discount <= 20' });
    ind.configuration().addCustomField('tenant-1', { object: 'Encounter', field: 'referralSource', type: 'text' });
    ind.configuration().addApprovalPolicy('tenant-1', { operation: 'refund', approvers: 2 });
    const stored = ind.configuration().get('tenant-1')!;
    expect(stored.businessRules.length).toBe(1);
    expect(stored.customFields.length).toBe(1);
    expect(stored.approvalPolicies.length).toBe(1);
  });
});
