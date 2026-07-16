/**
 * P19 — Autonomous Operations authorization tests: the channel→permission bijection (derived from the
 * channel registry), fail-loud registration on an unclassified channel, and field preservation.
 */
import { describe, expect, it } from 'vitest';
import { IpcChannel, RUNTIME_INVOKABLE_CHANNELS } from '@neuropause/shared';
import { AUTOOPS_CHANNEL_PERMISSIONS, withAutoOpsAuthz } from './autoOpsAuthz';

const AUTOOPS_CHANNELS = [
  IpcChannel.AutoOpsOverview,
  IpcChannel.AutoOpsPlans,
  IpcChannel.AutoOpsExecution,
  IpcChannel.AutoOpsRecovery,
  IpcChannel.AutoOpsOptimization,
  IpcChannel.AutoOpsIncidents,
  IpcChannel.AutoOpsApprovals,
  IpcChannel.AutoOpsMonitoring,
  IpcChannel.AutoOpsAnalytics,
  IpcChannel.AutoOpsGovernance,
];

describe('withAutoOpsAuthz', () => {
  it('gates all 10 operations channels with autonomousops:read and requireAuth', () => {
    const defs = AUTOOPS_CHANNELS.map((channel) => ({ channel, schema: {} as never, handler: () => null }));
    const gated = withAutoOpsAuthz(defs);
    expect(gated).toHaveLength(10);
    for (const g of gated) {
      expect(g.permission).toBe('autonomousops:read');
      expect(g.requireAuth).toBe(true);
    }
  });

  it('classifies exactly the autonomousops invokable channels (registry bijection, all read-only)', () => {
    const invokable = RUNTIME_INVOKABLE_CHANNELS.filter((c) => c.startsWith('autonomousops:'));
    expect(invokable.length).toBe(10);
    for (const c of invokable) expect(AUTOOPS_CHANNEL_PERMISSIONS[c]).toBe('autonomousops:read');
    expect(Object.keys(AUTOOPS_CHANNEL_PERMISSIONS).sort()).toEqual([...invokable].sort());
  });

  it('throws at startup on an unclassified channel (never silently unguarded)', () => {
    expect(() => withAutoOpsAuthz([{ channel: IpcChannel.WorkforceWorkers, schema: {} as never, handler: () => null }])).toThrow(/no permission classification/);
  });

  it('preserves other handler fields (schema, audit)', () => {
    const schema = { parse: () => ({}) } as never;
    const [g] = withAutoOpsAuthz([{ channel: IpcChannel.AutoOpsOverview, schema, handler: () => 1, audit: true }]);
    expect(g.schema).toBe(schema);
    expect((g as { audit?: boolean }).audit).toBe(true);
  });
});
