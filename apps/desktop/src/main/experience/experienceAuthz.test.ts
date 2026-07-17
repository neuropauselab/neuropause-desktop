/**
 * Experience Program v1.0 — authorization tests: the channel→permission bijection (derived from the channel
 * registry), fail-loud registration on an unclassified channel, and field preservation.
 */
import { describe, expect, it } from 'vitest';
import { IpcChannel, RUNTIME_INVOKABLE_CHANNELS } from '@neuropause/shared';
import { EXPERIENCE_CHANNEL_PERMISSIONS, withExperienceAuthz } from './experienceAuthz';

const EXPERIENCE_CHANNELS = [
  IpcChannel.ExperienceHome,
  IpcChannel.ExperienceDecisions,
  IpcChannel.ExperienceSummaries,
  IpcChannel.ExperienceIntents,
  IpcChannel.ExperienceGovernance,
];

describe('withExperienceAuthz', () => {
  it('gates all 5 experience channels with experience:read and requireAuth', () => {
    const defs = EXPERIENCE_CHANNELS.map((channel) => ({ channel, schema: {} as never, handler: () => null }));
    const gated = withExperienceAuthz(defs);
    expect(gated).toHaveLength(5);
    for (const g of gated) {
      expect(g.permission).toBe('experience:read');
      expect(g.requireAuth).toBe(true);
    }
  });

  it('classifies exactly the experience invokable channels (registry bijection, all read-only)', () => {
    const invokable = RUNTIME_INVOKABLE_CHANNELS.filter((c) => c.startsWith('experience:'));
    expect(invokable.length).toBe(5);
    for (const c of invokable) expect(EXPERIENCE_CHANNEL_PERMISSIONS[c]).toBe('experience:read');
    expect(Object.keys(EXPERIENCE_CHANNEL_PERMISSIONS).sort()).toEqual([...invokable].sort());
  });

  it('throws at startup on an unclassified channel (never silently unguarded)', () => {
    expect(() => withExperienceAuthz([{ channel: IpcChannel.WorkforceWorkers, schema: {} as never, handler: () => null }])).toThrow(/no permission classification/);
  });

  it('preserves other handler fields (schema, audit)', () => {
    const schema = { parse: () => ({}) } as never;
    const [g] = withExperienceAuthz([{ channel: IpcChannel.ExperienceHome, schema, handler: () => 1, audit: true }]);
    expect(g.schema).toBe(schema);
    expect((g as { audit?: boolean }).audit).toBe(true);
  });
});
