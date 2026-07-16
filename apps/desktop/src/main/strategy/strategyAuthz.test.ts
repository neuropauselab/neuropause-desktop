/**
 * P14 — Strategy Platform authorization tests: the channel→permission bijection (derived from the
 * channel registry), fail-loud registration on an unclassified channel, and field preservation.
 */
import { describe, expect, it } from 'vitest';
import { IpcChannel, RUNTIME_INVOKABLE_CHANNELS } from '@neuropause/shared';
import { STRATEGY_CHANNEL_PERMISSIONS, withStrategyAuthz } from './strategyAuthz';

const STRATEGY_CHANNELS = [
  IpcChannel.StrategyOverview,
  IpcChannel.StrategyGoals,
  IpcChannel.StrategyPlanning,
  IpcChannel.StrategyReasoning,
  IpcChannel.StrategyOptimization,
  IpcChannel.StrategySimulation,
  IpcChannel.StrategyDecisions,
];

describe('withStrategyAuthz', () => {
  it('gates all 7 strategy channels with strategy:read and requireAuth', () => {
    const defs = STRATEGY_CHANNELS.map((channel) => ({ channel, schema: {} as never, handler: () => null }));
    const gated = withStrategyAuthz(defs);
    expect(gated).toHaveLength(7);
    for (const g of gated) {
      expect(g.permission).toBe('strategy:read');
      expect(g.requireAuth).toBe(true);
    }
  });

  it('classifies exactly the strategy invokable channels (registry bijection, all read-only)', () => {
    const strategyInvokable = RUNTIME_INVOKABLE_CHANNELS.filter((c) => c.startsWith('strategy:'));
    expect(strategyInvokable.length).toBe(7);
    for (const c of strategyInvokable) expect(STRATEGY_CHANNEL_PERMISSIONS[c]).toBe('strategy:read');
    expect(Object.keys(STRATEGY_CHANNEL_PERMISSIONS).sort()).toEqual([...strategyInvokable].sort());
  });

  it('throws at startup on an unclassified channel (never silently unguarded)', () => {
    expect(() =>
      withStrategyAuthz([{ channel: IpcChannel.WorkforceWorkers, schema: {} as never, handler: () => null }]),
    ).toThrow(/no permission classification/);
  });

  it('preserves other handler fields (schema, audit)', () => {
    const schema = { parse: () => ({}) } as never;
    const [g] = withStrategyAuthz([{ channel: IpcChannel.StrategyOverview, schema, handler: () => 1, audit: true }]);
    expect(g.schema).toBe(schema);
    expect((g as { audit?: boolean }).audit).toBe(true);
  });
});
