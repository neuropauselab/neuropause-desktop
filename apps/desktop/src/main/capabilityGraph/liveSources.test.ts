import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeCapabilityGraph } from './capabilityGraph';
import { capabilityGraphSources, type CatalogMutation } from './liveSources';

// Real substrate: mail.send + a cohort mutation on the certified connector, and a
// mutation on a NON-certified connector. Routed through the REAL mutationAssuranceFor.
const MUTATIONS: CatalogMutation[] = [
  { capabilityId: 'mail.send', connectorId: 'microsoft-entra' },
  { capabilityId: 'calendar.create', connectorId: 'microsoft-entra' },
  { capabilityId: 'chat.post', connectorId: 'slack' },
];

const graph = (mutations = MUTATIONS, scope = true) =>
  composeCapabilityGraph(capabilityGraphSources({ mutations: () => mutations, scope: () => scope }));

describe('L4 · live wiring — proven against the REAL assurance predicate', () => {
  it('mail.send is the ONE fully-routable capability (certified + resolves a lane + workflow)', () => {
    const g = graph();
    expect(g.routes).toHaveLength(1);
    expect(g.routes[0]).toMatchObject({
      capability: 'mail.send',
      purpose: 'send-email',
      lane: 'draft (serving referenceDrafter)',
      connector: 'microsoft-entra',
      workflow: 'capability:m365.propose → governedSend',
    });
  });

  it('a mutation on a NON-certified connector → NOT_GOVERNED (never routed around)', () => {
    const gap = graph().gaps.find((x) => x.capability === 'chat.post');
    expect(gap).toMatchObject({ kind: 'not-governed', connector: 'slack' });
  });

  it('a certified-connector mutation with no resolved lane/workflow → MISSING (honest, not a fabricated route)', () => {
    // calendar.create is governed-certified per the per-connector predicate, but the graph
    // resolves no lane/workflow for it yet → MISSING (the per-capability certification is S23).
    const gap = graph().gaps.find((x) => x.capability === 'calendar.create');
    expect(gap).toMatchObject({ kind: 'missing', connector: 'microsoft-entra' });
    expect(graph().routes.some((r) => r.capability === 'calendar.create')).toBe(false);
  });

  it('no invention — every route/gap names a real catalog mutation; unresolved tenant → empty graph', () => {
    const g = graph();
    const named = new Set([...g.routes.map((r) => r.capability), ...g.gaps.map((x) => x.capability)]);
    for (const n of named) expect(MUTATIONS.some((m) => m.capabilityId === n)).toBe(true);
    const empty = graph(MUTATIONS, false);
    expect(empty.routes).toEqual([]);
    expect(empty.gaps).toEqual([]);
  });

  it('PROPOSAL-ONLY INVARIANT — the wiring reads registries/predicates; no import into execution', () => {
    const src = readFileSync(join(__dirname, 'liveSources.ts'), 'utf8');
    const valueImports = src.match(/^import\s+(?!type\b)[^;]*from\s+'[^']*'/gm) ?? [];
    for (const line of valueImports) {
      expect(line).not.toMatch(/executor|governedSend|governedAction|cst\/|connectors\/index|CstKernel/);
    }
    // The only value import is the READ-only assurance predicate.
    expect(valueImports.join('\n')).toMatch(/mutationAssuranceFor.*liveCapabilitySources/);
  });
});
