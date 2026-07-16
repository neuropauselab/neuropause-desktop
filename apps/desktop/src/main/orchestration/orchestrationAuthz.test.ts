/**
 * P17 — Global AI Orchestration authorization tests: the channel→permission bijection (derived from the
 * channel registry), fail-loud registration on an unclassified channel, and field preservation.
 */
import { describe, expect, it } from 'vitest';
import { IpcChannel, RUNTIME_INVOKABLE_CHANNELS } from '@neuropause/shared';
import { ORCHESTRATION_CHANNEL_PERMISSIONS, withOrchestrationAuthz } from './orchestrationAuthz';

const ORCHESTRATION_CHANNELS = [
  IpcChannel.OrchestrationOverview,
  IpcChannel.OrchestrationGoals,
  IpcChannel.OrchestrationWorkforce,
  IpcChannel.OrchestrationCloud,
  IpcChannel.OrchestrationKnowledge,
  IpcChannel.OrchestrationFlows,
  IpcChannel.OrchestrationCoordination,
  IpcChannel.OrchestrationGovernance,
];

describe('withOrchestrationAuthz', () => {
  it('gates all 8 orchestration channels with orchestration:read and requireAuth', () => {
    const defs = ORCHESTRATION_CHANNELS.map((channel) => ({ channel, schema: {} as never, handler: () => null }));
    const gated = withOrchestrationAuthz(defs);
    expect(gated).toHaveLength(8);
    for (const g of gated) {
      expect(g.permission).toBe('orchestration:read');
      expect(g.requireAuth).toBe(true);
    }
  });

  it('classifies exactly the orchestration invokable channels (registry bijection, all read-only)', () => {
    const invokable = RUNTIME_INVOKABLE_CHANNELS.filter((c) => c.startsWith('orchestration:'));
    expect(invokable.length).toBe(8);
    for (const c of invokable) expect(ORCHESTRATION_CHANNEL_PERMISSIONS[c]).toBe('orchestration:read');
    expect(Object.keys(ORCHESTRATION_CHANNEL_PERMISSIONS).sort()).toEqual([...invokable].sort());
  });

  it('throws at startup on an unclassified channel (never silently unguarded)', () => {
    expect(() => withOrchestrationAuthz([{ channel: IpcChannel.WorkforceWorkers, schema: {} as never, handler: () => null }])).toThrow(/no permission classification/);
  });

  it('preserves other handler fields (schema, audit)', () => {
    const schema = { parse: () => ({}) } as never;
    const [g] = withOrchestrationAuthz([{ channel: IpcChannel.OrchestrationOverview, schema, handler: () => 1, audit: true }]);
    expect(g.schema).toBe(schema);
    expect((g as { audit?: boolean }).audit).toBe(true);
  });
});
