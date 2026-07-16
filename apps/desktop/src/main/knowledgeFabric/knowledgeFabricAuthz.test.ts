/**
 * P16 — Enterprise Knowledge Fabric authorization tests: the channel→permission bijection (derived from
 * the channel registry), fail-loud registration on an unclassified channel, and field preservation.
 */
import { describe, expect, it } from 'vitest';
import { IpcChannel, RUNTIME_INVOKABLE_CHANNELS } from '@neuropause/shared';
import { KNOWLEDGE_CHANNEL_PERMISSIONS, withKnowledgeAuthz } from './knowledgeFabricAuthz';

const FABRIC_CHANNELS = [
  IpcChannel.FabricOverview,
  IpcChannel.FabricSources,
  IpcChannel.FabricRelationships,
  IpcChannel.FabricClassification,
  IpcChannel.FabricLineage,
  IpcChannel.FabricEvidence,
  IpcChannel.FabricGovernance,
  IpcChannel.FabricAnalytics,
];

describe('withKnowledgeAuthz', () => {
  it('gates all 8 fabric channels with knowledge:read and requireAuth', () => {
    const defs = FABRIC_CHANNELS.map((channel) => ({ channel, schema: {} as never, handler: () => null }));
    const gated = withKnowledgeAuthz(defs);
    expect(gated).toHaveLength(8);
    for (const g of gated) {
      expect(g.permission).toBe('knowledge:read');
      expect(g.requireAuth).toBe(true);
    }
  });

  it('classifies exactly the fabric invokable channels (registry bijection, all read-only)', () => {
    const fabricInvokable = RUNTIME_INVOKABLE_CHANNELS.filter((c) => c.startsWith('fabric:'));
    expect(fabricInvokable.length).toBe(8);
    for (const c of fabricInvokable) expect(KNOWLEDGE_CHANNEL_PERMISSIONS[c]).toBe('knowledge:read');
    expect(Object.keys(KNOWLEDGE_CHANNEL_PERMISSIONS).sort()).toEqual([...fabricInvokable].sort());
  });

  it('throws at startup on an unclassified channel (never silently unguarded)', () => {
    expect(() => withKnowledgeAuthz([{ channel: IpcChannel.WorkforceWorkers, schema: {} as never, handler: () => null }])).toThrow(/no permission classification/);
  });

  it('preserves other handler fields (schema, audit)', () => {
    const schema = { parse: () => ({}) } as never;
    const [g] = withKnowledgeAuthz([{ channel: IpcChannel.FabricOverview, schema, handler: () => 1, audit: true }]);
    expect(g.schema).toBe(schema);
    expect((g as { audit?: boolean }).audit).toBe(true);
  });
});
