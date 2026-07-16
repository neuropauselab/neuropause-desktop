/**
 * P18 — Enterprise Intelligence Network authorization tests: the channel→permission bijection (derived
 * from the channel registry), fail-loud registration on an unclassified channel, and field preservation.
 */
import { describe, expect, it } from 'vitest';
import { IpcChannel, RUNTIME_INVOKABLE_CHANNELS } from '@neuropause/shared';
import { NETWORK_CHANNEL_PERMISSIONS, withNetworkAuthz } from './networkAuthz';

const NETWORK_CHANNELS = [
  IpcChannel.NetworkOverview,
  IpcChannel.NetworkExchange,
  IpcChannel.NetworkBenchmarks,
  IpcChannel.NetworkInsights,
  IpcChannel.NetworkTrust,
  IpcChannel.NetworkOrganizations,
  IpcChannel.NetworkCollective,
  IpcChannel.NetworkGovernance,
];

describe('withNetworkAuthz', () => {
  it('gates all 8 network channels with network:read and requireAuth', () => {
    const defs = NETWORK_CHANNELS.map((channel) => ({ channel, schema: {} as never, handler: () => null }));
    const gated = withNetworkAuthz(defs);
    expect(gated).toHaveLength(8);
    for (const g of gated) {
      expect(g.permission).toBe('network:read');
      expect(g.requireAuth).toBe(true);
    }
  });

  it('classifies exactly the network invokable channels (registry bijection, all read-only)', () => {
    const invokable = RUNTIME_INVOKABLE_CHANNELS.filter((c) => c.startsWith('network:'));
    expect(invokable.length).toBe(8);
    for (const c of invokable) expect(NETWORK_CHANNEL_PERMISSIONS[c]).toBe('network:read');
    expect(Object.keys(NETWORK_CHANNEL_PERMISSIONS).sort()).toEqual([...invokable].sort());
  });

  it('throws at startup on an unclassified channel (never silently unguarded)', () => {
    expect(() => withNetworkAuthz([{ channel: IpcChannel.WorkforceWorkers, schema: {} as never, handler: () => null }])).toThrow(/no permission classification/);
  });

  it('preserves other handler fields (schema, audit)', () => {
    const schema = { parse: () => ({}) } as never;
    const [g] = withNetworkAuthz([{ channel: IpcChannel.NetworkOverview, schema, handler: () => 1, audit: true }]);
    expect(g.schema).toBe(schema);
    expect((g as { audit?: boolean }).audit).toBe(true);
  });
});
