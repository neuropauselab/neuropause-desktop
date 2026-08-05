/**
 * Phase 6 Stage 7 — standards tests (7.6): composition picks the current
 * standard through the enhancement-#4 precedence, "no standard defined" is a
 * first-class honest answer, non-current lifecycles never define standards,
 * and informational classes cannot define one.
 */
import { describe, expect, it } from 'vitest';
import type { KnowledgeAsset } from '@neuropause/shared';
import { rankOf } from './assetRegistry';
import { composeStandards } from './standards';

const NOW_ISO = '2026-07-31T12:00:00.000Z';

function asset(over: Partial<KnowledgeAsset>): KnowledgeAsset {
  return {
    id: 'ka:governed-document:doc-1',
    classId: 'governed-document',
    recordId: 'doc-1',
    sourceSystem: 'notion',
    title: 'Deployment Policy',
    subkind: 'policy',
    owner: 'Ava Chen',
    reviewOwner: 'Ava Chen',
    ownerResolution: 'author',
    criticality: 'medium',
    criticalityReasons: [],
    retention: { kind: 'provider-managed', detail: 'x', source: 'y' },
    provenance: [],
    authorityTier: 'provider-authoritative',
    authorityRankKey: 'provider-document',
    authorityRank: rankOf('provider-document'),
    lifecycle: null,
    lifecycleBasis: 'no marker',
    lifecycleEvidence: [],
    freshness: 'fresh',
    createdAt: null,
    updatedAt: '2026-07-01T10:00:00.000Z',
    version: null,
    accessScope: 'intelligence:read',
    classificationConfidence: 0.8,
    classificationSignals: ['title'],
    topics: ['deployment'],
    entityRefs: [],
    evidence: ['doc-1'],
    domains: ['deployment'],
    referencedBy: 0,
    ...over,
  };
}

describe('standards composition (7.6 + enhancement #4)', () => {
  it('a governed decision beats an approved document beats a provider document for the same domain', () => {
    const r = composeStandards(
      [
        asset({}),
        asset({
          id: 'ka:governed-document:doc-2',
          recordId: 'doc-2',
          title: 'Deployment Runbook (approved)',
          authorityRankKey: 'approved-document',
          authorityRank: rankOf('approved-document'),
          lifecycle: 'approved',
        }),
        asset({
          id: 'ka:executive-decision:dec:1',
          classId: 'executive-decision',
          recordId: 'dec:1',
          title: 'Deploy weekly, gated by CI',
          authorityRankKey: 'governed-decision',
          authorityRank: rankOf('governed-decision'),
          lifecycle: 'approved',
        }),
      ],
      NOW_ISO,
    );
    const dep = r.domains.find((d) => d.domain === 'deployment');
    expect(dep?.defined).toBe(true);
    expect(dep?.candidates).toBe(3);
    expect(dep?.current[0]).toMatchObject({ assetId: 'ka:executive-decision:dec:1', rank: 1 });
    expect(dep?.resolution?.method).toBe('authority-precedence → freshness → stable-id');
    expect(dep?.resolution?.ranked.map((x) => x.rank)).toEqual([1, 4, 6]);
  });

  it('"no standard defined" is first-class and honest for empty domains', () => {
    const r = composeStandards([asset({})], NOW_ISO);
    expect(r.definedCount).toBe(1);
    expect(r.totalDomains).toBe(8);
    const sec = r.domains.find((d) => d.domain === 'security');
    expect(sec?.defined).toBe(false);
    expect(sec?.current).toEqual([]);
    expect(sec?.resolution).toBeNull();
    expect(sec?.note).toMatch(/No standard defined/);
  });

  it('superseded/deprecated/archived assets never define the current standard', () => {
    const r = composeStandards(
      [
        asset({ lifecycle: 'superseded' }),
        asset({ id: 'ka:governed-document:doc-2', recordId: 'doc-2', lifecycle: 'archived' }),
      ],
      NOW_ISO,
    );
    expect(r.domains.find((d) => d.domain === 'deployment')?.defined).toBe(false);
  });

  it('informational classes (connector docs, derived intelligence) cannot define standards', () => {
    const r = composeStandards(
      [
        asset({ id: 'ka:connector-doc:notion', classId: 'connector-doc', recordId: 'notion', domains: ['operations'] }),
        asset({ id: 'ka:derived-intelligence:x', classId: 'derived-intelligence', recordId: 'x', domains: ['operations'] }),
      ],
      NOW_ISO,
    );
    expect(r.domains.find((d) => d.domain === 'operations')?.defined).toBe(false);
  });

  it('co-equal same-rank assets surface together as the current standard set (capped)', () => {
    const r = composeStandards(
      [
        asset({ domains: ['security'], title: 'Access Control Policy', topics: ['access'] }),
        asset({ id: 'ka:governed-document:doc-2', recordId: 'doc-2', domains: ['security'], title: 'Encryption Policy', topics: ['encryption'], updatedAt: '2026-06-01T10:00:00.000Z' }),
      ],
      NOW_ISO,
    );
    const sec = r.domains.find((d) => d.domain === 'security');
    expect(sec?.current).toHaveLength(2);
    expect(sec?.current[0].assetId).toBe('ka:governed-document:doc-1'); // fresher wins the top slot
  });
});
