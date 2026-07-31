/**
 * Phase 6 Stage 7 — quality tests (7.5): the eight deterministic finding rules
 * (all evidence-cited; conflicts name their enhancement-#4 precedence winner;
 * broken references declare the id-shape heuristic), the nine dimensions with
 * null-honesty, and the finding ordering.
 */
import { describe, expect, it } from 'vitest';
import type { KnowledgeAsset } from '@neuropause/shared';
import { KNOWLEDGE_QUALITY_DIMENSIONS } from '@neuropause/shared';
import { rankOf } from './assetRegistry';
import { composeStandards } from './standards';
import { buildQualityReport, looksLikeRecordId } from './quality';

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
    provenance: [{ stage: 'created', at: '2026-06-01T10:00:00.000Z', evidence: ['doc-1'], note: null }],
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

function report(assets: KnowledgeAsset[], knownIds: Set<string> | null = new Set(['doc-1', 'doc-2', 'dec:1'])) {
  return buildQualityReport({
    assets,
    standards: composeStandards(assets, NOW_ISO),
    knownIds,
    nowIso: NOW_ISO,
    unavailable: [],
  });
}

describe('the eight finding rules — evidence-cited, deterministic', () => {
  it('outdated: stale assets are flagged with their record cited', () => {
    const r = report([asset({ freshness: 'stale', updatedAt: '2025-01-01T10:00:00.000Z' })]);
    const f = r.findings.find((x) => x.kind === 'outdated');
    expect(f?.evidence).toContain('doc-1');
    expect(f?.suggestedAction).toMatch(/existing governed write path/);
  });

  it('missing-owner: only ownership-expected classes are flagged; unowned stays a finding', () => {
    const r = report([
      asset({ owner: null, reviewOwner: null, ownerResolution: 'no author recorded' }),
      asset({ id: 'ka:connector-doc:notion', classId: 'connector-doc', recordId: 'notion', owner: null }),
    ]);
    const flagged = r.findings.filter((x) => x.kind === 'missing-owner');
    expect(flagged).toHaveLength(1);
    expect(flagged[0].assetIds).toEqual(['ka:governed-document:doc-1']);
  });

  it('conflict: same class+subkind, shared domain, topic overlap — the precedence winner is named (enhancement #4)', () => {
    const r = report([
      asset({}),
      asset({
        id: 'ka:governed-document:doc-2',
        recordId: 'doc-2',
        title: 'Deployment Policy (ops copy)',
        authorityRankKey: 'provider-document',
        authorityRank: rankOf('provider-document'),
        lifecycle: null,
        updatedAt: '2026-07-26T10:00:00.000Z',
      }),
    ]);
    const f = r.findings.find((x) => x.kind === 'conflict');
    expect(f).toBeDefined();
    expect(f?.assetIds).toHaveLength(2);
    expect(f?.evidence).toEqual(['doc-1', 'doc-2']);
    // the approved document (rank 4) outranks the unmarked provider document (rank 6) — even though it is older
    expect(f?.detail).toContain('“Deployment Policy”');
    expect(f?.authority).toContain('approved-document');
    expect(f?.confidence).toBe(0.7); // declared heuristic
  });

  it('broken-reference: only id-shaped strings that resolve nowhere; free text is never flagged', () => {
    expect(looksLikeRecordId('mem_abc123')).toBe(true);
    expect(looksLikeRecordId('notion:page:9')).toBe(true);
    expect(looksLikeRecordId('PR #214')).toBe(false);
    expect(looksLikeRecordId('https://example.com/x')).toBe(false);
    const r = report([asset({ evidence: ['doc-1', 'mem_gone99', 'PR #214'] })]);
    const f = r.findings.find((x) => x.kind === 'broken-reference');
    expect(f?.evidence).toEqual(['mem_gone99']);
    expect(f?.detail).toMatch(/heuristic/);
  });

  it('broken-reference is NOT measured without a known-id index (null-honesty)', () => {
    const r = report([asset({ evidence: ['mem_gone99'] })], null);
    expect(r.findings.filter((x) => x.kind === 'broken-reference')).toEqual([]);
    const dim = r.dimensions.find((d) => d.key === 'evidence-integrity');
    expect(dim?.score).toBeNull();
    expect(dim?.detail).toMatch(/never guessed/);
  });

  it('duplicate: normalized-equal titles in the same class', () => {
    const r = report([asset({}), asset({ id: 'ka:governed-document:doc-2', recordId: 'doc-2', title: '  deployment   policy ' })]);
    const f = r.findings.find((x) => x.kind === 'duplicate');
    expect(f?.assetIds).toHaveLength(2);
  });

  it('decision-without-evidence: a decision whose only evidence is itself', () => {
    const r = report([
      asset({
        id: 'ka:executive-decision:dec:1',
        classId: 'executive-decision',
        recordId: 'dec:1',
        title: 'Bare decision',
        subkind: 'other',
        authorityRankKey: 'governed-decision',
        authorityRank: 1,
        evidence: ['dec:1'],
        domains: [],
      }),
    ]);
    const f = r.findings.find((x) => x.kind === 'decision-without-evidence');
    expect(f?.severity).toBe('high');
    expect(f?.authority).toBe('governed-decision (rank 1)');
  });

  it('undocumented-standard: one finding per empty domain, authority honestly "none"', () => {
    const r = report([asset({})]); // only deployment is defined
    const gaps = r.findings.filter((x) => x.kind === 'undocumented-standard');
    expect(gaps).toHaveLength(7);
    expect(gaps[0].authority).toBe('none — nothing to rank');
  });

  it('review-overdue: stale + owned + no recorded review inside the window', () => {
    const r = report([
      asset({ freshness: 'stale', updatedAt: null, provenance: [{ stage: 'created', at: null, evidence: ['doc-1'], note: null }] }),
    ]);
    const f = r.findings.find((x) => x.kind === 'review-overdue');
    expect(f?.detail).toContain('Ava Chen');
  });
});

describe('the nine dimensions', () => {
  it('declares all nine keys, each with a score or an honest null', () => {
    const r = report([asset({})]);
    expect(r.dimensions.map((d) => d.key)).toEqual([...KNOWLEDGE_QUALITY_DIMENSIONS]);
    for (const d of r.dimensions) {
      if (d.score !== null) {
        expect(d.score).toBeGreaterThanOrEqual(0);
        expect(d.score).toBeLessThanOrEqual(100);
      }
      expect(d.detail.length).toBeGreaterThan(0);
    }
  });

  it('overall averages only the measurable dimensions; empty inventory keeps nulls honest', () => {
    const r = report([]);
    expect(r.dimensions.find((d) => d.key === 'freshness')?.score).toBeNull();
    expect(r.dimensions.find((d) => d.key === 'ownership')?.score).toBeNull();
    // standards coverage is still measurable (0/8 defined) — overall uses what exists
    expect(r.overall).not.toBeNull();
  });

  it('findings sort most-severe first', () => {
    const r = report([
      asset({ freshness: 'stale', updatedAt: '2025-01-01T10:00:00.000Z', criticality: 'high' }),
      asset({ id: 'ka:governed-document:doc-2', recordId: 'doc-2', title: 'Other Doc', topics: ['other'], domains: [] }),
    ]);
    const ranks = { critical: 3, high: 2, medium: 1, low: 0 } as const;
    for (let i = 1; i < r.findings.length; i += 1) {
      expect(ranks[r.findings[i - 1].severity]).toBeGreaterThanOrEqual(ranks[r.findings[i].severity]);
    }
  });
});
