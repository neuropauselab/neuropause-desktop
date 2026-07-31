/**
 * Phase 6 Stage 7 — the Knowledge Platform tab's pure view-model: header
 * stats, class rows with gap honesty, the nine dimension rows (null →
 * "not measurable"), standards/coverage/unit rows, recommendation rows, the
 * review queue, and the honesty strip. Renders what was computed — nothing
 * else.
 */
import { describe, expect, it } from 'vitest';
import type { KnowledgeAssetDashboard } from '@neuropause/shared';
import {
  classRows,
  coverageTone,
  dimensionRows,
  headerStats,
  priorityTone,
  recommendationRows,
  reviewRows,
  standardRows,
  unavailableLines,
  unitRows,
} from './knowledgeAssetsModel';

function dashboard(over: Partial<KnowledgeAssetDashboard> = {}): KnowledgeAssetDashboard {
  return {
    generatedAt: '2026-07-31T12:00:00.000Z',
    inventory: {
      total: 12,
      byClass: [
        { classId: 'executive-decision', label: 'Executive decisions', count: 5, authorityTier: 'governed', note: null },
        { classId: 'governed-document', label: 'Policy / SOP / ADR / playbook / spec documents', count: 7, authorityTier: 'provider-authoritative', note: null },
      ],
      gaps: [{ classId: 'capability-standard', label: 'Capability standard (renderer registry)', reason: 'declared boundary' }],
      withOwner: 9,
      stale: 2,
    },
    quality: {
      overall: 81,
      findings: 3,
      topFindings: [],
      dimensions: [
        { key: 'freshness', label: 'Freshness', score: 84, detail: '2 stale', findings: 2 },
        { key: 'evidence-integrity', label: 'Evidence integrity', score: null, detail: 'index unavailable — never guessed', findings: 0 },
      ],
    },
    standards: { defined: 3, total: 8 },
    coverage: {
      generatedAt: '2026-07-31T12:00:00.000Z',
      domains: [
        { domain: 'deployment', label: 'Deployment policy', assets: 4, classesPresent: ['governed-document'], freshest: '2026-07-25T10:00:00.000Z', bestAuthorityRank: 4, standardDefined: true, status: 'covered', note: '4 asset(s), standard defined.' },
        { domain: 'security', label: 'Security standards', assets: 0, classesPresent: [], freshest: null, bestAuthorityRank: null, standardDefined: false, status: 'gap', note: 'No knowledge asset speaks to this domain.' },
      ],
      units: [{ unitId: 'u1', unitName: 'Engineering', ownedAssets: 3, hasLead: true, status: 'covered' }],
      coveredDomains: 1,
      totalDomains: 8,
      note: 'computed',
    },
    lineageReady: 4,
    recommendations: [
      {
        id: 'kr:kq:outdated:x',
        rule: 'outdated',
        title: 'Outdated: Deployment Policy',
        detail: 'Past its window.',
        priority: 'high',
        evidence: ['doc-1'],
        authority: 'approved-document (rank 4)',
        confidence: 0.9,
        suggestedAction: 'Review it.',
      },
    ],
    reviewQueue: [{ assetId: 'ka:governed-document:doc-1', title: 'Deployment Policy', reason: 'stale — past its class staleness window', owner: 'Dana Lead' }],
    matrix: { totalRelations: 42, cells: 9 },
    unavailable: [{ system: 'graph', reason: 'edge feed not provided' }],
    ...over,
  };
}

describe('header stats + tones', () => {
  it('projects the five stats with honest tones', () => {
    const stats = headerStats(dashboard());
    expect(stats.map((s) => s.label)).toEqual(['Knowledge assets', 'Quality', 'Standards', 'Decision lineage', 'Relations']);
    expect(stats[0].value).toBe('12');
    expect(stats[1]).toMatchObject({ value: '81/100', tone: 'green' });
    expect(stats[2]).toMatchObject({ value: '3/8', tone: 'orange' });
    expect(stats[4].hint).toContain('never stored');
  });

  it('null quality renders n/a with a gray tone (not a fake score)', () => {
    const d = dashboard();
    d.quality.overall = null;
    const stats = headerStats(d);
    expect(stats[1]).toMatchObject({ value: 'n/a', tone: 'gray' });
  });

  it('tone helpers map coverage + priority deterministically', () => {
    expect(coverageTone('covered')).toBe('green');
    expect(coverageTone('partial')).toBe('orange');
    expect(coverageTone('gap')).toBe('red');
    expect(priorityTone('critical')).toBe('red');
    expect(priorityTone('low')).toBe('gray');
  });
});

describe('rows', () => {
  it('class rows include populated classes AND declared gaps (marked, with reasons)', () => {
    const rows = classRows(dashboard());
    expect(rows).toHaveLength(3);
    const gap = rows.find((r) => r.isGap);
    expect(gap?.classId).toBe('capability-standard');
    expect(gap?.countText).toBe('—');
    expect(gap?.note).toBe('declared boundary');
  });

  it('dimension rows keep null scores honest ("not measurable")', () => {
    const rows = dimensionRows(dashboard().quality.dimensions);
    expect(rows[0]).toMatchObject({ scoreText: '84/100', pct: 84, tone: 'green' });
    expect(rows[1]).toMatchObject({ scoreText: 'not measurable', pct: null, tone: 'gray' });
  });

  it('standard rows label defined vs asset-less domains', () => {
    const rows = standardRows(dashboard());
    expect(rows[0].statusText).toBe('defined · 4 asset(s)');
    expect(rows[1].statusText).toBe('no standard defined');
    expect(rows[1].tone).toBe('red');
  });

  it('unit rows summarize ownership coverage', () => {
    const rows = unitRows(dashboard());
    expect(rows[0].detail).toBe('3 owned asset(s) · lead assigned');
    expect(rows[0].tone).toBe('green');
  });

  it('recommendation rows carry evidence counts, confidence, authority, and the suggested action', () => {
    const rows = recommendationRows(dashboard().recommendations);
    expect(rows[0]).toMatchObject({ priority: 'high', tone: 'orange', confidencePct: 90, evidenceCount: 1 });
    expect(rows[0].authority).toContain('rank 4');
  });

  it('review rows fall back to "unassigned" without inventing an owner', () => {
    const rows = reviewRows(dashboard({ reviewQueue: [{ assetId: 'x', title: 'T', reason: 'no owner recorded', owner: null }] }));
    expect(rows[0].ownerText).toBe('unassigned');
  });

  it('the honesty strip lists every unavailable source', () => {
    expect(unavailableLines(dashboard())).toEqual(['graph: edge feed not provided']);
  });
});
