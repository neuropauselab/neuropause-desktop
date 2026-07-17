/**
 * Intent Experience Program v2.0 — authorization tests: the channel→permission bijection (derived from the
 * channel registry), fail-loud registration on an unclassified channel, and field preservation.
 */
import { describe, expect, it } from 'vitest';
import { IpcChannel, RUNTIME_INVOKABLE_CHANNELS } from '@neuropause/shared';
import { INTENT_CHANNEL_PERMISSIONS, withIntentAuthz } from './intentAuthz';

const INTENT_CHANNELS = [IpcChannel.IntentBoard, IpcChannel.IntentWorkspaces, IpcChannel.IntentGovernance];

describe('withIntentAuthz', () => {
  it('gates all 3 intent channels with intent:read and requireAuth', () => {
    const defs = INTENT_CHANNELS.map((channel) => ({ channel, schema: {} as never, handler: () => null }));
    const gated = withIntentAuthz(defs);
    expect(gated).toHaveLength(3);
    for (const g of gated) {
      expect(g.permission).toBe('intent:read');
      expect(g.requireAuth).toBe(true);
    }
  });

  it('classifies exactly the intent invokable channels (registry bijection, all read-only)', () => {
    const invokable = RUNTIME_INVOKABLE_CHANNELS.filter((c) => c.startsWith('intent:'));
    expect(invokable.length).toBe(3);
    for (const c of invokable) expect(INTENT_CHANNEL_PERMISSIONS[c]).toBe('intent:read');
    expect(Object.keys(INTENT_CHANNEL_PERMISSIONS).sort()).toEqual([...invokable].sort());
  });

  it('throws at startup on an unclassified channel (never silently unguarded)', () => {
    expect(() => withIntentAuthz([{ channel: IpcChannel.WorkforceWorkers, schema: {} as never, handler: () => null }])).toThrow(/no permission classification/);
  });

  it('preserves other handler fields (schema, audit)', () => {
    const schema = { parse: () => ({}) } as never;
    const [g] = withIntentAuthz([{ channel: IpcChannel.IntentBoard, schema, handler: () => 1, audit: true }]);
    expect(g.schema).toBe(schema);
    expect((g as { audit?: boolean }).audit).toBe(true);
  });
});
