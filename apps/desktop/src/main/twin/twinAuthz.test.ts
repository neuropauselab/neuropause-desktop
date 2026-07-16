/**
 * P15 — Enterprise Digital Twin authorization tests: the channel→permission bijection (derived from
 * the channel registry), fail-loud registration on an unclassified channel, and field preservation.
 */
import { describe, expect, it } from 'vitest';
import { IpcChannel, RUNTIME_INVOKABLE_CHANNELS } from '@neuropause/shared';
import { TWIN_CHANNEL_PERMISSIONS, withTwinAuthz } from './twinAuthz';

const TWIN_CHANNELS = [
  IpcChannel.TwinOverview,
  IpcChannel.TwinDomains,
  IpcChannel.TwinTopology,
  IpcChannel.TwinHealth,
  IpcChannel.TwinReplay,
  IpcChannel.TwinScenario,
  IpcChannel.TwinImpact,
  IpcChannel.TwinExecutive,
];

describe('withTwinAuthz', () => {
  it('gates all 8 twin channels with twin:read and requireAuth', () => {
    const defs = TWIN_CHANNELS.map((channel) => ({ channel, schema: {} as never, handler: () => null }));
    const gated = withTwinAuthz(defs);
    expect(gated).toHaveLength(8);
    for (const g of gated) {
      expect(g.permission).toBe('twin:read');
      expect(g.requireAuth).toBe(true);
    }
  });

  it('classifies exactly the twin invokable channels (registry bijection, all read-only)', () => {
    const twinInvokable = RUNTIME_INVOKABLE_CHANNELS.filter((c) => c.startsWith('twin:'));
    expect(twinInvokable.length).toBe(8);
    for (const c of twinInvokable) expect(TWIN_CHANNEL_PERMISSIONS[c]).toBe('twin:read');
    expect(Object.keys(TWIN_CHANNEL_PERMISSIONS).sort()).toEqual([...twinInvokable].sort());
  });

  it('throws at startup on an unclassified channel (never silently unguarded)', () => {
    expect(() => withTwinAuthz([{ channel: IpcChannel.WorkforceWorkers, schema: {} as never, handler: () => null }])).toThrow(/no permission classification/);
  });

  it('preserves other handler fields (schema, audit)', () => {
    const schema = { parse: () => ({}) } as never;
    const [g] = withTwinAuthz([{ channel: IpcChannel.TwinOverview, schema, handler: () => 1, audit: true }]);
    expect(g.schema).toBe(schema);
    expect((g as { audit?: boolean }).audit).toBe(true);
  });
});
