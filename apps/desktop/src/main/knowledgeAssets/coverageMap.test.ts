/**
 * Phase 6 Stage 7 — enhancement #2 tests: the coverage map measures the eight
 * domains + org units from real inventory/standards/org-chart inputs, reports
 * gaps as gaps (no padding, no storage), and degrades honestly without an org.
 */
import { describe, expect, it } from 'vitest';
import type { KnowledgeAsset } from '@neuropause/shared';
import { STANDARD_DOMAINS } from '@neuropause/shared';
import { rankOf } from './assetRegistry';
import { buildCoverageMap } from './coverageMap';
import { composeStandards } from './standards';
import type { OrgLite } from './assetInventory';

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
    authorityRankKey: 'approved-document',
    authorityRank: rankOf('approved-document'),
    lifecycle: 'approved',
    lifecycleBasis: 'marker',
    lifecycleEvidence: ['doc-1'],
    freshness: 'fresh',
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-07-25T10:00:00.000Z',
    version: null,
    accessScope: 'intelligence:read',
    classificationConfidence: 0.9,
    classificationSignals: ['title'],
    topics: ['deployment', 'policy'],
    entityRefs: [],
    evidence: ['doc-1'],
    domains: ['deployment'],
    referencedBy: 0,
    ...over,
  };
}

const ORG: OrgLite = {
  org: { id: 'org-1', name: 'Neuropause' },
  units: [
    { id: 'u-eng', name: 'Engineering', leadUserId: 'user-ava' },
    { id: 'u-ops', name: 'Operations', leadUserId: null },
  ],
  users: [
    { id: 'user-ava', name: 'Ava Chen', unitId: 'u-eng' },
    { id: 'user-bo', name: 'Ben Ortiz', unitId: 'u-ops' },
  ],
};

describe('enhancement #2 — the knowledge coverage map', () => {
  it('always renders all eight domains; empty ones are gap rows, never padded', () => {
    const assets = [asset({})];
    const standards = composeStandards(assets, NOW_ISO);
    const map = buildCoverageMap(assets, standards, ORG, NOW_ISO);
    expect(map.domains).toHaveLength(STANDARD_DOMAINS.length);
    const deployment = map.domains.find((d) => d.domain === 'deployment');
    expect(deployment?.status).toBe('covered');
    expect(deployment?.standardDefined).toBe(true);
    expect(deployment?.bestAuthorityRank).toBe(4);
    expect(deployment?.freshest).toBe('2026-07-25T10:00:00.000Z');
    const security = map.domains.find((d) => d.domain === 'security');
    expect(security?.status).toBe('gap');
    expect(security?.assets).toBe(0);
    expect(map.coveredDomains).toBe(1);
    expect(map.totalDomains).toBe(8);
  });

  it('assets without a defined standard make the domain partial (not covered)', () => {
    // derived assets touch the domain but cannot define a standard
    const assets = [
      asset({
        id: 'ka:workflow-definition:wf:x',
        classId: 'workflow-definition',
        recordId: 'wf:x',
        authorityRankKey: 'derived-knowledge',
        authorityRank: rankOf('derived-knowledge'),
        lifecycle: null,
        domains: ['operations'],
      }),
    ];
    const standards = composeStandards(assets, NOW_ISO);
    const map = buildCoverageMap(assets, standards, ORG, NOW_ISO);
    const ops = map.domains.find((d) => d.domain === 'operations');
    expect(ops?.assets).toBe(1);
    expect(ops?.standardDefined).toBe(false);
    expect(ops?.status).toBe('partial');
  });

  it('a majority-stale covered domain degrades to partial with the share stated', () => {
    const assets = [
      asset({}),
      asset({ id: 'ka:governed-document:doc-2', recordId: 'doc-2', freshness: 'stale', updatedAt: '2025-01-01T10:00:00.000Z' }),
      asset({ id: 'ka:governed-document:doc-3', recordId: 'doc-3', freshness: 'stale', updatedAt: '2025-01-02T10:00:00.000Z' }),
    ];
    const standards = composeStandards(assets, NOW_ISO);
    const map = buildCoverageMap(assets, standards, ORG, NOW_ISO);
    const deployment = map.domains.find((d) => d.domain === 'deployment');
    expect(deployment?.status).toBe('partial');
    expect(deployment?.note).toMatch(/67% of the domain's assets are stale/);
  });

  it('org-unit coverage: owned+led = covered, one of the two = partial, neither = gap', () => {
    const assets = [asset({}), asset({ id: 'ka:explicit-memory:m1', classId: 'explicit-memory', recordId: 'm1', owner: 'Ben Ortiz' })];
    const standards = composeStandards(assets, NOW_ISO);
    const map = buildCoverageMap(assets, standards, ORG, NOW_ISO);
    const eng = map.units.find((u) => u.unitId === 'u-eng');
    expect(eng).toMatchObject({ ownedAssets: 1, hasLead: true, status: 'covered' });
    const ops = map.units.find((u) => u.unitId === 'u-ops');
    expect(ops).toMatchObject({ ownedAssets: 1, hasLead: false, status: 'partial' });
  });

  it('without an org chart, unit coverage is honestly unavailable (no invented units)', () => {
    const assets = [asset({})];
    const standards = composeStandards(assets, NOW_ISO);
    const map = buildCoverageMap(assets, standards, null, NOW_ISO);
    expect(map.units).toEqual([]);
    expect(map.note).toMatch(/unavailable/);
  });
});
