import { describe, it, expect } from 'vitest';
import {
  composeCapabilityGraph,
  type CapabilityGraphSources,
  type DiscoveredCapabilityLite,
} from './capabilityGraph';

// The real substrate today: mail.send is the ONE governed-certified mutation;
// calendar.create is a governed-but-unproven mutation; mail.read is a read.
const CAPS: DiscoveredCapabilityLite[] = [
  { capability: 'mail.send', connector: 'microsoft-entra', mutates: true, assurance: 'governed-certified' },
  { capability: 'calendar.create', connector: 'microsoft-entra', mutates: true, assurance: 'governance-not-proven' },
];

const sources = (over: Partial<CapabilityGraphSources> = {}): CapabilityGraphSources => ({
  scope: () => true,
  capabilities: () => CAPS,
  laneFor: (c) => (c === 'mail.send' ? { lane: 'draft', serving: 'referenceDrafter' } : null),
  workflowFor: (c) => (c === 'mail.send' ? 'capability:m365.propose → governedSend' : null),
  purposeFor: (c) => (c === 'mail.send' ? 'send-email' : c),
  ...over,
});

describe('Capability Graph · Slice 1 · the observable object', () => {
  it('CONTRACT — the certified capability routes PURPOSE → CAPABILITY → LANE → CONNECTOR → WORKFLOW (propose-only)', () => {
    const g = composeCapabilityGraph(sources());
    expect(g.routes).toHaveLength(1);
    expect(g.routes[0]).toMatchObject({
      purpose: 'send-email',
      capability: 'mail.send',
      lane: 'draft (serving referenceDrafter)',
      connector: 'microsoft-entra',
      workflow: 'capability:m365.propose → governedSend',
    });
  });

  it('FAILURE/UNKNOWN — an uncertified mutation is EXCLUDED and reported as a NOT_GOVERNED gap (never routed)', () => {
    const g = composeCapabilityGraph(sources());
    expect(g.routes.some((r) => r.capability === 'calendar.create')).toBe(false);
    const gap = g.gaps.find((x) => x.capability === 'calendar.create');
    expect(gap).toMatchObject({ kind: 'not-governed', connector: 'microsoft-entra' });
    expect(gap?.reason).toMatch(/NOT GOVERNED/);
  });

  it('FAILURE/UNKNOWN — a certified capability with no lane/workflow is a MISSING gap, not a fabricated route', () => {
    const g = composeCapabilityGraph(sources({ laneFor: () => null }));
    expect(g.routes).toHaveLength(0);
    expect(g.gaps.find((x) => x.capability === 'mail.send')).toMatchObject({ kind: 'missing' });
  });

  it('VERIFICATION — no capability is INVENTED: every route/gap names a capability the sources reported', () => {
    const g = composeCapabilityGraph(sources());
    const named = new Set([...g.routes.map((r) => r.capability), ...g.gaps.map((x) => x.capability)]);
    for (const n of named) expect(CAPS.some((c) => c.capability === n)).toBe(true);
    // and the routable set is EXACTLY the governed-certified capabilities that resolve.
    expect(g.routes.map((r) => r.capability)).toEqual(['mail.send']);
  });

  it('COLLECTION BOUNDARY — an unresolved tenant → an EMPTY graph, never "all capabilities"', () => {
    const g = composeCapabilityGraph(sources({ scope: () => false }));
    expect(g.scopeResolved).toBe(false);
    expect(g.routes).toEqual([]);
    expect(g.gaps).toEqual([]);
  });
});
