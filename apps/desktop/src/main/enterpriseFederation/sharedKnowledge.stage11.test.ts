/**
 * Phase 6 Stage 11 — shared knowledge (S7 composition): packages counted from
 * records, backing candidates via the Stage 7 topic join, absent linkage
 * declared as gaps — never invented.
 */
import { describe, expect, it } from 'vitest';
import { buildSharedKnowledge } from './sharedKnowledge';

describe('buildSharedKnowledge', () => {
  it('counts knowledge packages, topic-matches Stage 7 assets, and lists knowledge-class shares', () => {
    const v = buildSharedKnowledge({
      artifacts: [{ kind: 'knowledge_package' }, { kind: 'ai_worker' }],
      shares: [
        { kind: 'governance_policy', name: 'Data Handling Baseline', peerOrgName: 'Helios Commerce', direction: 'outbound', access: 'read' },
        { kind: 'project', name: 'Quarterly Close', peerOrgName: 'Aperture Capital', direction: 'inbound', access: 'read' },
      ],
      knowledgeAssets: [
        { id: 'ka:1', title: 'Data Handling SOP', topics: ['sop'] },
        { id: 'ka:2', title: 'Untagged Note', topics: [] },
      ],
      failures: {},
    });
    expect(v.packagesPublished).toBe(1);
    expect(v.knowledgeShares).toHaveLength(1);
    expect(v.backingCandidates).toEqual([{ id: 'ka:1', title: 'Data Handling SOP', matchedTopic: 'sop' }]);
  });

  it('no topic-matched assets and no knowledge-class shares → declared gaps, never padding', () => {
    const v = buildSharedKnowledge({
      artifacts: [],
      shares: [{ kind: 'project', name: 'X', peerOrgName: 'Y', direction: 'inbound', access: 'read' }],
      knowledgeAssets: [{ id: 'ka:2', title: 'Untagged', topics: ['random'] }],
      failures: {},
    });
    expect(v.backingCandidates).toEqual([]);
    expect(v.gaps.some((g) => g.detail.includes('no Stage 7 asset matches'))).toBe(true);
    expect(v.gaps.some((g) => g.detail.includes('closest recorded kind'))).toBe(true);
  });

  it('unreadable sources → unavailable entries; nothing fabricated', () => {
    const v = buildSharedKnowledge({ artifacts: null, shares: null, knowledgeAssets: null, failures: { 'knowledge-assets': 'inventory unreadable' } });
    expect(v.packagesPublished).toBe(0);
    expect(v.backingCandidates).toEqual([]);
    expect(v.unavailable).toContainEqual({ system: 'knowledge-assets', reason: 'inventory unreadable' });
  });
});
