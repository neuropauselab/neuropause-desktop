import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeEnvironmentModel, type RequiredElement } from './environmentModel';
import { liveEnvironmentSources } from './liveSources';
// REAL upstream producers — the live proof exercises these, not fixtures:
import { composeCapabilityGraph } from '../capabilityGraph/capabilityGraph';
import { capabilityGraphSources } from '../capabilityGraph/liveSources';
import { composeWorkspaceDomain } from '../enterprise/workspaceFoundation/domainAggregate';
import { toWorkspaceDomainField, DOMAIN_MODULES } from '../enterprise/workspaceFoundation/domainSources';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

const cap = (id: string): RequiredElement => ({ id, kind: 'capability', label: id });
const data = (moduleId: string): RequiredElement => ({ id: moduleId, kind: 'data', label: moduleId });

// A REAL L4 graph composed through the real assurance predicate (mutationAssuranceFor):
//   mail.send (microsoft-entra) → routed;  chat.post (slack) → NOT_GOVERNED gap.
const realGraph = () =>
  composeCapabilityGraph(
    capabilityGraphSources({
      mutations: () => [
        { capabilityId: 'mail.send', connectorId: 'microsoft-entra' },
        { capabilityId: 'chat.post', connectorId: 'slack' },
      ],
      scope: () => true,
    }),
  );

// A REAL L1 rollup composed through the real aggregate:
//   people = 3 (present), customers = 0 (present-but-empty), leads = absent store (unavailable).
const realRollup = () =>
  toWorkspaceDomainField(
    composeWorkspaceDomain(DOMAIN_MODULES, {
      scope: () => TEST_TENANT_SCOPE,
      now: () => '2026-08-19T00:00:00.000Z',
      moduleCount: (id) => (id === 'hr-employees' ? 3 : id === 'crm-customers' ? 0 : null),
    }),
  );

describe('L2 · live wiring — the four states derive from the REAL L4 graph', () => {
  it('a routed capability → HAVE; a NOT_GOVERNED gap → NEED; an unknown capability → UNKNOWN', () => {
    const m = composeEnvironmentModel(
      'send-email',
      [cap('mail.send'), cap('chat.post'), cap('never.heard.of')],
      liveEnvironmentSources({ capabilityGraph: realGraph(), dataDomains: null }),
    );
    expect(m.have).toEqual(['mail.send']); // the one governed route in the real graph
    expect(m.need).toEqual(['chat.post']); // the real NOT_GOVERNED gap
    expect(m.unknown).toEqual(['never.heard.of']); // not in the graph → UNKNOWN, never HAVE
  });

  it('an unresolved-scope graph makes every capability UNAVAILABLE (never "all capabilities")', () => {
    const emptyGraph = composeCapabilityGraph(
      capabilityGraphSources({ mutations: () => [], scope: () => false }),
    );
    const m = composeEnvironmentModel(
      'send-email',
      [cap('mail.send')],
      liveEnvironmentSources({ capabilityGraph: emptyGraph, dataDomains: null }),
    );
    expect(m.unavailable).toEqual(['mail.send']);
    expect(m.have).toEqual([]);
  });
});

describe('L2 · live wiring — the four states derive from the REAL L1 rollup', () => {
  it('present-with-records → HAVE; present-but-empty → NEED; an unavailable slice → UNAVAILABLE', () => {
    const m = composeEnvironmentModel(
      'run-workspace',
      [data('hr-employees'), data('crm-customers'), data('leads')],
      liveEnvironmentSources({ capabilityGraph: realGraph(), dataDomains: realRollup() }),
    );
    expect(m.have).toEqual(['hr-employees']); // count 3
    expect(m.need).toEqual(['crm-customers']); // count 0 — reachable but empty
    expect(m.unavailable).toEqual(['leads']); // no store → honest UNAVAILABLE, never a fake 0
  });

  it('LOCAL-MODE HONESTY — an absent L1 rollup makes data elements UNAVAILABLE, never a fabricated 0', () => {
    const m = composeEnvironmentModel(
      'run-workspace',
      [data('hr-employees')],
      liveEnvironmentSources({ capabilityGraph: realGraph(), dataDomains: null }),
    );
    expect(m.unavailable).toEqual(['hr-employees']);
    expect(m.need).toEqual([]); // "cannot read the rollup" is never reported as an empty domain
  });
});

describe('L2 · live wiring — invariant', () => {
  it('READ-ONLY ADAPTER — imports only TYPES; no value import into collection/governance/execution', () => {
    const src = readFileSync(join(__dirname, 'liveSources.ts'), 'utf8');
    const valueImports = src.match(/^import\s+(?!type\b)[^;]*from\s+'[^']*'/gm) ?? [];
    expect(valueImports).toEqual([]);
  });
});
