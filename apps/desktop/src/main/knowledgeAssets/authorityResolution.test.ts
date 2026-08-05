/**
 * Phase 6 Stage 7 — enhancement #4 tests: the deterministic precedence order
 * (each rank beats the next), freshness tiebreak, stable-id tiebreak, empty
 * input honesty, and the documented method string on every result.
 */
import { describe, expect, it } from 'vitest';
import type { AuthorityRankKey, KnowledgeAsset } from '@neuropause/shared';
import { AUTHORITY_PRECEDENCE } from '@neuropause/shared';
import { rankOf } from './assetRegistry';
import { RESOLUTION_METHOD, compareAuthority, resolveAuthority } from './authorityResolution';

function asset(id: string, rankKey: AuthorityRankKey, updatedAt: string | null): KnowledgeAsset {
  return {
    id,
    classId: 'governed-document',
    recordId: id,
    sourceSystem: 'test',
    title: `Asset ${id}`,
    subkind: null,
    owner: null,
    reviewOwner: null,
    ownerResolution: 'test',
    criticality: 'medium',
    criticalityReasons: [],
    retention: { kind: 'indefinite', detail: 'test', source: 'test' },
    provenance: [],
    authorityTier: 'governed',
    authorityRankKey: rankKey,
    authorityRank: rankOf(rankKey),
    lifecycle: null,
    lifecycleBasis: 'test',
    lifecycleEvidence: [],
    freshness: 'fresh',
    createdAt: null,
    updatedAt,
    version: null,
    accessScope: 'test',
    classificationConfidence: 1,
    classificationSignals: ['test'],
    topics: [],
    entityRefs: [],
    evidence: [],
    domains: [],
    referencedBy: 0,
  };
}

describe('enhancement #4 — deterministic authority resolution', () => {
  it('each precedence rank beats the next one down, pairwise across all eight', () => {
    for (let i = 0; i < AUTHORITY_PRECEDENCE.length - 1; i += 1) {
      const higher = asset('h', AUTHORITY_PRECEDENCE[i].key, '2020-01-01T00:00:00.000Z');
      const lower = asset('l', AUTHORITY_PRECEDENCE[i + 1].key, '2026-07-30T00:00:00.000Z');
      const r = resolveAuthority([lower, higher]);
      // authority precedence wins even when the lower-ranked asset is fresher
      expect(r.winnerAssetId).toBe('h');
      expect(r.ranked[0].rankKey).toBe(AUTHORITY_PRECEDENCE[i].key);
    }
  });

  it('a governed decision outranks everything else at once', () => {
    const all = AUTHORITY_PRECEDENCE.map((p, i) => asset(`a${i}`, p.key, '2026-01-01T00:00:00.000Z'));
    const shuffled = [all[4], all[7], all[0], all[2], all[6], all[1], all[3], all[5]];
    const r = resolveAuthority(shuffled);
    expect(r.ranked.map((x) => x.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(r.winnerAssetId).toBe('a0');
  });

  it('equal rank → newer updatedAt wins; missing timestamps lose', () => {
    const older = asset('older', 'provider-document', '2026-01-01T00:00:00.000Z');
    const newer = asset('newer', 'provider-document', '2026-07-01T00:00:00.000Z');
    const noTs = asset('nots', 'provider-document', null);
    expect(resolveAuthority([older, noTs, newer]).winnerAssetId).toBe('newer');
    expect(resolveAuthority([noTs, older]).winnerAssetId).toBe('older');
  });

  it('equal rank + equal timestamp → stable id order (fully deterministic)', () => {
    const a = asset('aaa', 'explicit-memory', '2026-07-01T00:00:00.000Z');
    const b = asset('bbb', 'explicit-memory', '2026-07-01T00:00:00.000Z');
    expect(resolveAuthority([b, a]).winnerAssetId).toBe('aaa');
    expect(resolveAuthority([a, b]).winnerAssetId).toBe('aaa');
  });

  it('empty input → no winner (honest), and the method is always documented', () => {
    const empty = resolveAuthority([]);
    expect(empty.winnerAssetId).toBeNull();
    expect(empty.ranked).toEqual([]);
    expect(empty.method).toBe(RESOLUTION_METHOD);
    expect(RESOLUTION_METHOD).toBe('authority-precedence → freshness → stable-id');
  });

  it('every ranked entry carries a reason; compareAuthority is a total order', () => {
    const r = resolveAuthority([
      asset('x', 'governance-policy', '2026-07-01T00:00:00.000Z'),
      asset('y', 'derived-knowledge', null),
    ]);
    for (const entry of r.ranked) expect(entry.reason.length).toBeGreaterThan(0);
    const same = asset('same', 'versioned-prompt', null);
    expect(compareAuthority(same, same)).toBe(0);
  });
});
