/**
 * Phase 6 Stage 11 — shared strategy (S10 composition): joint initiatives from
 * the recorded share↔capability intersection; the capability-federation view
 * beside the Stage 10 conditions; empty intersections declared.
 */
import { describe, expect, it } from 'vitest';
import { buildSharedStrategy } from './sharedStrategy';

const INITIATIVES = [
  { id: 'init-operational-cadence', label: 'Operational review cadence', state: 'done', capabilityKeys: ['operations'] },
  { id: 'init-ai-enablement', label: 'Governed AI enablement', state: 'advancing', capabilityKeys: ['engineering', 'security'] },
];

describe('buildSharedStrategy', () => {
  it('joint initiatives = initiatives whose capabilities intersect recorded partner shares', () => {
    const v = buildSharedStrategy({
      initiatives: INITIATIVES,
      capabilities: [
        { key: 'operations', label: 'Operations', condition: 'on-track' },
        { key: 'engineering', label: 'Engineering', condition: 'at-risk' },
      ],
      shares: [
        // ai_worker maps to operations+engineering → intersects BOTH initiatives.
        { kind: 'ai_worker', name: 'Compliance Reviewer', peerOrgName: 'Helios Commerce', direction: 'outbound' },
      ],
      artifacts: [{ kind: 'workflow_template' }],
      failures: {},
    });
    expect(v.jointInitiatives.map((j) => j.initiativeId).sort()).toEqual(['init-ai-enablement', 'init-operational-cadence']);
    expect(v.jointInitiatives[0].partnerShares[0].peerOrgName).toBe('Helios Commerce');
    const ops = v.capabilities.find((c) => c.key === 'operations')!;
    expect(ops.condition).toBe('on-track');
    expect(ops.sharesOut).toBe(1);
    expect(ops.artifacts).toBe(1); // workflow_template maps to operations
    expect(ops.initiatives).toBe(1);
    // A capability untouched by shares/artifacts stays at zero — honest.
    const manufacturing = v.capabilities.find((c) => c.key === 'manufacturing')!;
    expect(manufacturing.sharesOut + manufacturing.sharesIn + manufacturing.artifacts).toBe(0);
    expect(manufacturing.condition).toBe('unknown'); // not in the injected map slice
  });

  it('a governance_policy share intersects only compliance/risk initiatives — none here → declared gap', () => {
    const v = buildSharedStrategy({
      initiatives: INITIATIVES,
      capabilities: [],
      shares: [{ kind: 'governance_policy', name: 'Baseline', peerOrgName: 'Aperture', direction: 'inbound' }],
      artifacts: [],
      failures: {},
    });
    expect(v.jointInitiatives).toEqual([]);
    expect(v.gaps.some((g) => g.detail.includes('no recorded partner share intersects'))).toBe(true);
  });

  it('an unreadable capability map degrades conditions to unknown WITH a gap', () => {
    const v = buildSharedStrategy({ initiatives: [], capabilities: null, shares: [], artifacts: [], failures: { 'strategy-capabilities': 'unreadable' } });
    expect(v.capabilities).toHaveLength(12);
    expect(v.capabilities.every((c) => c.condition === 'unknown')).toBe(true);
    expect(v.gaps.some((g) => g.subject === 'capabilities')).toBe(true);
    expect(v.unavailable).toContainEqual({ system: 'strategy-capabilities', reason: 'unreadable' });
  });
});
