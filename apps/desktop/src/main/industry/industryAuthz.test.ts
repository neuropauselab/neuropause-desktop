/**
 * P13 — Industry Platform authorization tests: the channel→permission bijection, fail-loud
 * registration on an unclassified channel, and field preservation.
 */
import { describe, expect, it } from 'vitest';
import { IpcChannel, RUNTIME_INVOKABLE_CHANNELS } from '@neuropause/shared';
import { INDUSTRY_CHANNEL_PERMISSIONS, withIndustryAuthz } from './industryAuthz';

const INDUSTRY_CHANNELS = [
  IpcChannel.IndustryOverview,
  IpcChannel.IndustrySuites,
  IpcChannel.IndustryKpis,
  IpcChannel.IndustryCompliance,
  IpcChannel.IndustryCollections,
  IpcChannel.IndustryReadiness,
];

describe('withIndustryAuthz', () => {
  it('gates all 6 industry channels with industry:read and requireAuth', () => {
    const defs = INDUSTRY_CHANNELS.map((channel) => ({ channel, schema: {} as never, handler: () => null }));
    const gated = withIndustryAuthz(defs);
    expect(gated).toHaveLength(6);
    for (const g of gated) {
      expect(g.permission).toBe('industry:read');
      expect(g.requireAuth).toBe(true);
    }
  });

  it('classifies exactly the industry invokable channels (registry bijection, all read-only)', () => {
    // Derive the truth set from the channel registry (like ecosystemAuthz/cloudAuthz), so a future
    // industry channel added to RUNTIME_INVOKABLE_CHANNELS but left unclassified fails this test.
    const industryInvokable = RUNTIME_INVOKABLE_CHANNELS.filter((c) => c.startsWith('industry:'));
    expect(industryInvokable.length).toBe(6);
    // Every invokable industry channel is classified as a read…
    for (const c of industryInvokable) expect(INDUSTRY_CHANNEL_PERMISSIONS[c]).toBe('industry:read');
    // …and there is no stale/extra mapping (bijection both ways).
    expect(Object.keys(INDUSTRY_CHANNEL_PERMISSIONS).sort()).toEqual([...industryInvokable].sort());
  });

  it('throws at startup on an unclassified channel (never silently unguarded)', () => {
    expect(() =>
      withIndustryAuthz([{ channel: IpcChannel.WorkforceWorkers, schema: {} as never, handler: () => null }]),
    ).toThrow(/no permission classification/);
  });

  it('preserves other handler fields (schema, audit)', () => {
    const schema = { parse: () => ({}) } as never;
    const [g] = withIndustryAuthz([{ channel: IpcChannel.IndustryOverview, schema, handler: () => 1, audit: true }]);
    expect(g.schema).toBe(schema);
    expect((g as { audit?: boolean }).audit).toBe(true);
  });
});
