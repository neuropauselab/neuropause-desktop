import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RANKING_WEIGHTS,
  rankMemories,
  type RankingCandidate,
  type RankingQuery,
} from './memoryRanking';

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

  it('confidence reflects corroboration: two signals beat one', () => {
    const conf = (over: Partial<RankingCandidate>): number =>
      rankMemories({ now: NOW }, [candidate({ memoryId: 'x', ...over })])[0].confidence;

    // Pre-A6 these were equal, because a mean does not know how many terms it has.
    expect(conf({ keywordScore: 0.8, vectorScore: 0.8 })).toBeGreaterThan(
      conf({ keywordScore: 0.8 }),
    );
    // Even a weak corroborating signal is more evidence than none.
    expect(conf({ keywordScore: 0.8, vectorScore: 0.2 })).toBeGreaterThan(
      conf({ keywordScore: 0.8 }),
    );
    // …but it corroborates less than a strong one, so it still ranks between them.
    expect(conf({ keywordScore: 0.8, vectorScore: 0.2 })).toBeLessThan(
      conf({ keywordScore: 0.8, vectorScore: 0.8 })
    );
  });

  it('degradation can no longer inflate confidence past the healthy hybrid (A6)', () => {
    // The exact shape of the defect. `memoryRetriever.search` normalizes by the
    // best hit, so the top lexical candidate is *always* keywordScore 1.0 — under
    // the old mean it scored a flat 1.00 with the vector store dead, beating the
    // 0.90 it scored when semantic was healthy and agreed with it.
    const degraded = rankMemories({ now: NOW }, [
      candidate({ memoryId: 'top', keywordScore: 1 }),
    ])[0];
    const healthy = rankMemories({ now: NOW }, [
      candidate({ memoryId: 'top', keywordScore: 1, vectorScore: 0.8 }),
    ])[0];

    expect(degraded.confidence).toBeLessThan(healthy.confidence);
    // And it no longer clears the renderer's "High Confidence" chip threshold
    // (`memoryExplanation.ts` HIGH_CONFIDENCE_THRESHOLD = 0.8) on a lexical-only
    // recall, which is the user-visible half of the bug.
    expect(degraded.confidence).toBeLessThan(0.8);
    expect(healthy.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('never claims corroboration a signal did not provide, and never punishes one it did', () => {
    const conf = (over: Partial<RankingCandidate>, q: RankingQuery = {}): number =>
      rankMemories({ now: NOW, ...q }, [candidate({ memoryId: 'x', ...over })])[0].confidence;

    // Monotone: an explicit zero vector score is not "missing", but adding it
    // cannot lower confidence either — it contributes nothing, exactly like absence.
    expect(conf({ keywordScore: 0.6, vectorScore: 0 })).toBe(conf({ keywordScore: 0.6 }));
    // A perfect match on both signals is the only route to full confidence.
    expect(conf({ keywordScore: 1, vectorScore: 1 })).toBe(1);
    // Nothing matched: no corroboration to report.
    expect(conf({ keywordScore: 0 })).toBe(0);
  });

  it('does not dock a query that never asked for semantic corroboration', () => {
    // Weighting vector at 0 says "rank on keywords" — absence of a vector score
    // is then not missing evidence, and confidence must not be discounted for it.
    const out = rankMemories({ now: NOW, weights: { vector: 0 } }, [
      candidate({ memoryId: 'x', keywordScore: 0.9 }),
    ])[0];
    expect(out.confidence).toBeCloseTo(0.9, 5);
  });

  it('reports no confidence when the query seeks no relevance signal at all', () => {
    // Ranking purely on recency/importance/pinned: there is no match quality to
    // be confident about, and 0 is the honest answer rather than a divide by zero.
    const out = rankMemories({ now: NOW, weights: { keyword: 0, vector: 0 } }, [
      candidate({ memoryId: 'x', keywordScore: 1, vectorScore: 1, pinned: true }),
    ])[0];
    expect(out.confidence).toBe(0);
    expect(Number.isFinite(out.score)).toBe(true);
  });

  it('leaves ordering untouched — confidence explains a result, it does not rank it', () => {
    // `compareScored` reads `score`, never `confidence`; this guards the A6 change
    // against silently becoming a retrieval change. The two can diverge because
    // `score` also carries recency/importance/pinned, which say nothing about how
    // well the *query* was matched — a pinned keyword hit outranks a better-
    // corroborated one, and both facts are reported honestly.
    const out = rankMemories({ now: NOW }, [
      candidate({ memoryId: 'pinned-lexical', keywordScore: 0.8, pinned: true, timestamp: NOW }),
      candidate({ memoryId: 'corroborated', keywordScore: 0.3, vectorScore: 0.75, timestamp: NOW }),
    ]);
    expect(out.map((r) => r.memoryId)).toEqual(['pinned-lexical', 'corroborated']);
    expect(out[0].score).toBeGreaterThan(out[1].score);
    // …even though the lower-ranked one is the better-corroborated of the two.
    expect(out[1].confidence).toBeGreaterThan(out[0].confidence);
  });
});
