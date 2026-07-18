/**
 * Knowledge Workspace v1.0 — model tests. Lock the pure lens: honest status/band/severity → tone maps, the
 * defensive keyword tone, the knowledge-gap catalog (never empty / always "Requires architecture"), the
 * fixed section id, and the pure memory/search/decision summaries over the real knowledge DTO shapes.
 */
import { describe, expect, it } from 'vitest';
import type { EnterpriseSearchResult, ExecutiveDecision, MemoryCounts } from '@neuropause/shared';
import {
  KNOWLEDGE_GAPS,
  KNOWLEDGE_SECTION_ID,
  bandTone,
  complianceStatusTone,
  keywordTone,
  knowledgeGapMeta,
  severityTone,
  summarizeDecisions,
  summarizeMemory,
  summarizeSearch,
} from './knowledgeModel';

const memoryCounts = (byKind: Record<string, number>, byOrigin: Record<string, number>): MemoryCounts =>
  ({ total: Object.values(byKind).reduce((a, b) => a + b, 0), byKind, byOrigin, lastBuiltAt: '2026-07-18T00:00:00Z' } as MemoryCounts);

const searchResult = (groups: { source: string; total: number }[], hits: number, total: number): EnterpriseSearchResult =>
  ({
    query: 'q',
    hits: Array.from({ length: hits }, (_, i) => ({ id: `h${i}` })),
    groups: groups.map((g) => ({ source: g.source, hits: [], total: g.total })),
    total,
    backends: ['local', 'lexical'],
  } as unknown as EnterpriseSearchResult);

const decision = (status: string, priority: string, confidence: number): ExecutiveDecision =>
  ({ id: status + priority, title: 't', status, priority, confidence } as unknown as ExecutiveDecision);

describe('status / band / severity → tone maps', () => {
  it('compliance status tones are honest', () => {
    expect(complianceStatusTone('pass')).toBe('green');
    expect(complianceStatusTone('warn')).toBe('orange');
    expect(complianceStatusTone('fail')).toBe('red');
  });

  it('band tone escalates healthy → watch → at-risk/critical', () => {
    expect(bandTone('healthy')).toBe('green');
    expect(bandTone('watch')).toBe('orange');
    expect(bandTone('at-risk')).toBe('red');
    expect(bandTone('critical')).toBe('red');
  });

  it('severity tone maps info/warning/critical', () => {
    expect(severityTone('info')).toBe('gray');
    expect(severityTone('warning')).toBe('orange');
    expect(severityTone('critical')).toBe('red');
  });

  it('keyword tone classifies decision status + priority defensively', () => {
    expect(keywordTone('accepted')).toBe('green');
    expect(keywordTone('completed')).toBe('green');
    expect(keywordTone('low')).toBe('green');
    expect(keywordTone('in_progress')).toBe('orange');
    expect(keywordTone('medium')).toBe('orange');
    expect(keywordTone('blocked')).toBe('red');
    expect(keywordTone('rejected')).toBe('red');
    expect(keywordTone('high')).toBe('red');
    expect(keywordTone('archived')).toBe('gray');
    expect(keywordTone(null)).toBe('gray');
  });
});

describe('knowledge-gap catalog (honesty ledger)', () => {
  it('is non-empty and every gap requires architecture with an area, capability and reason', () => {
    expect(KNOWLEDGE_GAPS.length).toBeGreaterThanOrEqual(5);
    for (const g of KNOWLEDGE_GAPS) {
      expect(g.area.length).toBeGreaterThan(0);
      expect(g.capability.length).toBeGreaterThan(0);
      expect(g.reason.length).toBeGreaterThan(0);
      expect(g.requirement).toBe('Requires architecture');
    }
    expect(knowledgeGapMeta().label).toBe('Requires architecture');
  });

  it('records Documents, Research Library, Architecture Library, Playbooks and SOPs as absent', () => {
    const areas = KNOWLEDGE_GAPS.map((g) => g.area);
    expect(areas).toContain('Documents');
    expect(areas).toContain('Research Library');
    expect(areas).toContain('Architecture Library');
    expect(areas).toContain('Playbooks');
    expect(areas).toContain('SOPs');
  });
});

describe('section id', () => {
  it('is the fixed "knowledge" id', () => {
    expect(KNOWLEDGE_SECTION_ID).toBe('knowledge');
  });
});

describe('pure knowledge summaries', () => {
  it('summarizeMemory counts total, distinct kinds/origins and the top kind', () => {
    const s = summarizeMemory(memoryCounts({ decision: 5, document: 2, conversation: 3 }, { manual: 6, slack: 4 }));
    expect(s.total).toBe(10);
    expect(s.kinds).toBe(3);
    expect(s.origins).toBe(2);
    expect(s.topKind).toEqual({ kind: 'decision', count: 5 });
    expect(s.lastBuiltAt).toBe('2026-07-18T00:00:00Z');
    expect(summarizeMemory(null)).toEqual({ total: 0, kinds: 0, origins: 0, topKind: null, lastBuiltAt: null });
  });

  it('summarizeSearch tallies total, hit count, backends and per-source breakdown', () => {
    const s = summarizeSearch(searchResult([{ source: 'memory', total: 4 }, { source: 'graph', total: 2 }], 6, 6));
    expect(s.total).toBe(6);
    expect(s.hitCount).toBe(6);
    expect(s.backends).toEqual(['local', 'lexical']);
    expect(s.bySource).toEqual([{ source: 'memory', total: 4 }, { source: 'graph', total: 2 }]);
    expect(summarizeSearch(null)).toEqual({ total: 0, hitCount: 0, backends: [], bySource: [] });
  });

  it('summarizeDecisions tallies status, average confidence and high-priority count', () => {
    const s = summarizeDecisions([
      decision('accepted', 'high', 0.8),
      decision('blocked', 'critical', 0.6),
      decision('draft', 'low', 0.4),
    ]);
    expect(s.total).toBe(3);
    expect(s.byStatus).toEqual({ accepted: 1, blocked: 1, draft: 1 });
    expect(s.highPriority).toBe(2);
    expect(s.avgConfidence).toBeCloseTo(0.6, 5);
    expect(summarizeDecisions([])).toEqual({ total: 0, byStatus: {}, avgConfidence: 0, highPriority: 0 });
  });
});
