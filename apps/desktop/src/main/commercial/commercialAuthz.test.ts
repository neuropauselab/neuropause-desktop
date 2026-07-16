/**
 * P20 — NeuroPause Platform v2 authorization tests: the channel→permission bijection (derived from the
 * channel registry), fail-loud registration on an unclassified channel, and field preservation.
 */
import { describe, expect, it } from 'vitest';
import { IpcChannel, RUNTIME_INVOKABLE_CHANNELS } from '@neuropause/shared';
import { COMMERCIAL_CHANNEL_PERMISSIONS, withCommercialAuthz } from './commercialAuthz';

const COMMERCIAL_CHANNELS = [
  IpcChannel.CommercialOverview,
  IpcChannel.CommercialSubscription,
  IpcChannel.CommercialLicensing,
  IpcChannel.CommercialBilling,
  IpcChannel.CommercialMetering,
  IpcChannel.CommercialDeployment,
  IpcChannel.CommercialCustomers,
  IpcChannel.CommercialAnalytics,
  IpcChannel.CommercialReleases,
  IpcChannel.CommercialAdministration,
  IpcChannel.CommercialGovernance,
];

describe('withCommercialAuthz', () => {
  it('gates all 11 commercial channels with commercial:read and requireAuth', () => {
    const defs = COMMERCIAL_CHANNELS.map((channel) => ({ channel, schema: {} as never, handler: () => null }));
    const gated = withCommercialAuthz(defs);
    expect(gated).toHaveLength(11);
    for (const g of gated) {
      expect(g.permission).toBe('commercial:read');
      expect(g.requireAuth).toBe(true);
    }
  });

  it('classifies exactly the commercial invokable channels (registry bijection, all read-only)', () => {
    const invokable = RUNTIME_INVOKABLE_CHANNELS.filter((c) => c.startsWith('commercial:'));
    expect(invokable.length).toBe(11);
    for (const c of invokable) expect(COMMERCIAL_CHANNEL_PERMISSIONS[c]).toBe('commercial:read');
    expect(Object.keys(COMMERCIAL_CHANNEL_PERMISSIONS).sort()).toEqual([...invokable].sort());
  });

  it('throws at startup on an unclassified channel (never silently unguarded)', () => {
    expect(() => withCommercialAuthz([{ channel: IpcChannel.WorkforceWorkers, schema: {} as never, handler: () => null }])).toThrow(/no permission classification/);
  });

  it('preserves other handler fields (schema, audit)', () => {
    const schema = { parse: () => ({}) } as never;
    const [g] = withCommercialAuthz([{ channel: IpcChannel.CommercialOverview, schema, handler: () => 1, audit: true }]);
    expect(g.schema).toBe(schema);
    expect((g as { audit?: boolean }).audit).toBe(true);
  });
});
