import { describe, expect, it } from 'vitest';
import { DEFAULT_RANKING_WEIGHTS, rankMemories, type RankingCandidate } from './memoryRanking';

const NOW = '2026-07-06T00:00:00.000Z';

function candidate(over: Partial<RankingCandidate> & { memoryId: string }): RankingCandidate {
  return {
    keywordScore: 0.5,
    timestamp: NOW,
    scope: 'organization',
    orgId: 'org-1',
    deleted: false,
    ...over,
  };
}

describe('rankMemories — filtering', () => {
  it('never returns deleted memories', () => {
    const out = rankMemories({ now: NOW }, [
      candidate({ memoryId: 'a', keywordScore: 0.9, deleted: true }),
      candidate({ memoryId: 'b', keywordScore: 0.1 }),
    ]);
    expect(out.map((r) => r.memoryId)).toEqual(['b']);
  });

  it('excludes wrong organization when org filter is set', () => {
    const out = rankMemories({ now: NOW, filters: { organizationId: 'org-1' } }, [
      candidate({ memoryId: 'mine', orgId: 'org-1' }),
      candidate({ memoryId: 'other', orgId: 'org-2' }),
    ]);
    expect(out.map((r) => r.memoryId)).toEqual(['mine']);
  });

  it('filters by scope, project, tag, and date range', () => {
    const cs = [
      candidate({ memoryId: 'p', scope: 'personal' }),
      candidate({ memoryId: 'proj', project: 'alpha' }),
      candidate({ memoryId: 'tagged', tags: ['fundraising'] }),
      candidate({ memoryId: 'old', timestamp: '2026-01-01T00:00:00.000Z' }),
    ];
    expect(
      rankMemories({ now: NOW, filters: { scope: 'personal' } }, cs).map((r) => r.memoryId),
    ).toEqual(['p']);
    expect(
      rankMemories({ now: NOW, filters: { project: 'alpha' } }, cs).map((r) => r.memoryId),
    ).toEqual(['proj']);
    expect(
      rankMemories({ now: NOW, filters: { tag: 'fundraising' } }, cs).map((r) => r.memoryId),
    ).toEqual(['tagged']);
    expect(
      rankMemories({ now: NOW, filters: { since: '2026-06-01T00:00:00.000Z' } }, cs).map(
        (r) => r.memoryId,
      ),
    ).not.toContain('old');
  });
});

describe('rankMemories — scoring', () => {
  it('ranks a more recent memory higher when keyword scores are equal', () => {
    const out = rankMemories({ now: NOW }, [
      candidate({ memoryId: 'old', timestamp: '2026-05-01T00:00:00.000Z' }),
      candidate({ memoryId: 'new', timestamp: '2026-07-05T00:00:00.000Z' }),
    ]);
    expect(out[0].memoryId).toBe('new');
  });

  it('gives a pinned memory a boost over an equivalent unpinned one', () => {
    const out = rankMemories({ now: NOW }, [
      candidate({ memoryId: 'plain', pinned: false }),
      candidate({ memoryId: 'pinned', pinned: true }),
    ]);
    expect(out[0].memoryId).toBe('pinned');
    expect(out[0].score).toBeGreaterThan(out[1].score);
  });

  it('boosts by importance', () => {
    const out = rankMemories({ now: NOW }, [
      candidate({ memoryId: 'low', importance: 0 }),
      candidate({ memoryId: 'high', importance: 1 }),
    ]);
    expect(out[0].memoryId).toBe('high');
  });

  it('treats a missing vector score as zero (keyword-only still ranks)', () => {
    const out = rankMemories({ now: NOW }, [
      candidate({ memoryId: 'a', keywordScore: 0.2 }),
      candidate({ memoryId: 'b', keywordScore: 0.8 }),
    ]);
    expect(out.map((r) => r.memoryId)).toEqual(['b', 'a']);
  });

  it('uses the vector score when present', () => {
    const out = rankMemories({ now: NOW }, [
      candidate({ memoryId: 'kw', keywordScore: 0.9, vectorScore: 0 }),
      candidate({ memoryId: 'vec', keywordScore: 0, vectorScore: 0.9 }),
    ]);
    // keyword weight (.45) > vector weight (.35), so equal raw scores favor keyword.
    expect(out[0].memoryId).toBe('kw');
  });

  it('scores fall within 0..100', () => {
    const out = rankMemories({ now: NOW }, [
      candidate({ memoryId: 'max', keywordScore: 1, vectorScore: 1, importance: 1, pinned: true }),
    ]);
    expect(out[0].score).toBeGreaterThan(0);
    expect(out[0].score).toBeLessThanOrEqual(100);
  });
});

describe('rankMemories — weight tuning', () => {
  it('recency dominates when its weight is raised', () => {
    const cs = [
      candidate({ memoryId: 'strongOld', keywordScore: 1, timestamp: '2026-01-01T00:00:00.000Z' }),
      candidate({ memoryId: 'weakNew', keywordScore: 0.1, timestamp: '2026-07-06T00:00:00.000Z' }),
    ];
    // Default: keyword-heavy → strongOld wins.
    expect(rankMemories({ now: NOW }, cs)[0].memoryId).toBe('strongOld');
    // Recency-heavy → weakNew wins.
    const out = rankMemories(
      { now: NOW, weights: { keyword: 0.1, recency: 5, vector: 0, importance: 0, pinned: 0 } },
      cs,
    );
    expect(out[0].memoryId).toBe('weakNew');
  });

  it('accepts partial weights, filling the rest from defaults', () => {
    const out = rankMemories({ now: NOW, weights: { keyword: 1 } }, [candidate({ memoryId: 'a' })]);
    expect(out).toHaveLength(1);
    expect(DEFAULT_RANKING_WEIGHTS.vector).toBeGreaterThan(0);
  });
});

describe('rankMemories — determinism & tie-breaking', () => {
  it('is deterministic: same input yields the same order', () => {
    const cs = [
      candidate({ memoryId: 'a', keywordScore: 0.5 }),
      candidate({ memoryId: 'b', keywordScore: 0.5 }),
      candidate({ memoryId: 'c', keywordScore: 0.5 }),
    ];
    const first = rankMemories({ now: NOW }, cs).map((r) => r.memoryId);
    const second = rankMemories({ now: NOW }, cs).map((r) => r.memoryId);
    expect(first).toEqual(second);
  });

  it('breaks exact ties by pinned, then recency, then memoryId', () => {
    const out = rankMemories({ now: NOW }, [
      candidate({ memoryId: 'zzz', keywordScore: 0.5, timestamp: NOW }),
      candidate({ memoryId: 'aaa', keywordScore: 0.5, timestamp: NOW }),
      candidate({ memoryId: 'pinned', keywordScore: 0.5, timestamp: NOW, pinned: true }),
    ]);
    expect(out[0].memoryId).toBe('pinned'); // pinned first
    expect(out.slice(1).map((r) => r.memoryId)).toEqual(['aaa', 'zzz']); // then memoryId asc
  });

  it('respects the limit', () => {
    const cs = Array.from({ length: 10 }, (_, i) =>
      candidate({ memoryId: `m${i}`, keywordScore: i / 10 }),
    );
    expect(rankMemories({ now: NOW, limit: 3 }, cs)).toHaveLength(3);
  });
});

describe('rankMemories — explanation & confidence', () => {
  it('explains each result with its strongest factor first', () => {
    const out = rankMemories({ now: NOW }, [
      candidate({ memoryId: 'a', keywordScore: 0.9, pinned: true, timestamp: NOW }),
    ]);
    const factors = out[0].reasons.map((r) => r.factor);
    expect(factors).toContain('keyword');
    expect(factors).toContain('pinned');
    // Sorted by contribution descending.
    const contribs = out[0].reasons.map((r) => r.contribution);
    expect([...contribs].sort((x, y) => y - x)).toEqual(contribs);
  });

  it('confidence reflects corroboration: two signals vs one', () => {
    const both = rankMemories({ now: NOW }, [
      candidate({ memoryId: 'both', keywordScore: 0.8, vectorScore: 0.8 }),
    ])[0];
    const one = rankMemories({ now: NOW }, [candidate({ memoryId: 'one', keywordScore: 0.8 })])[0];
    expect(both.confidence).toBeCloseTo(0.8, 5);
    expect(one.confidence).toBeCloseTo(0.8, 5);
    // A weak second signal lowers confidence below the strong single signal.
    const mixed = rankMemories({ now: NOW }, [
      candidate({ memoryId: 'mixed', keywordScore: 0.8, vectorScore: 0.2 }),
    ])[0];
    expect(mixed.confidence).toBeLessThan(one.confidence);
  });
});
