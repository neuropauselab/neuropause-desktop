/**
 * Phase 6 Stage 7 — enhancement #4: deterministic Authority Resolution.
 *
 * Whenever conflicting assets exist, precedence is EXACTLY:
 *   Governed Decision → Governance Policy → Organization Standard →
 *   Approved Document → Versioned Prompt → Provider Document →
 *   Explicit Memory → Derived Knowledge
 * (AUTHORITY_PRECEDENCE in shared types), then freshness (newer updatedAt
 * wins; missing timestamps lose), then stable id order. The method string is
 * part of every result so a resolution is always explainable and reproducible.
 * Pure; no store, no side effects.
 */
import type { AuthorityResolution, KnowledgeAsset } from '@neuropause/shared';
import { AUTHORITY_RANK_BY_KEY } from './assetRegistry';

export const RESOLUTION_METHOD = 'authority-precedence → freshness → stable-id';

/** Total order over assets: rank asc → updatedAt desc (null last) → id asc. */
export function compareAuthority(a: KnowledgeAsset, b: KnowledgeAsset): number {
  if (a.authorityRank !== b.authorityRank) return a.authorityRank - b.authorityRank;
  const at = a.updatedAt ? Date.parse(a.updatedAt) : NaN;
  const bt = b.updatedAt ? Date.parse(b.updatedAt) : NaN;
  const aOk = Number.isFinite(at);
  const bOk = Number.isFinite(bt);
  if (aOk && bOk && at !== bt) return bt - at;
  if (aOk !== bOk) return aOk ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function reasonFor(asset: KnowledgeAsset, index: number, total: number): string {
  const rank = AUTHORITY_RANK_BY_KEY.get(asset.authorityRankKey);
  const label = rank ? rank.label : asset.authorityRankKey;
  if (index === 0) {
    return total === 1
      ? `Only candidate (${label}, rank ${asset.authorityRank}).`
      : `Highest precedence among ${total} candidates (${label}, rank ${asset.authorityRank}${
          asset.updatedAt ? `, updated ${asset.updatedAt.slice(0, 10)}` : ''
        }).`;
  }
  return `${label} (rank ${asset.authorityRank})${
    asset.updatedAt ? `, updated ${asset.updatedAt.slice(0, 10)}` : ', no timestamp'
  } — outranked by the winner.`;
}

/**
 * Resolve conflicting assets deterministically. Empty input → no winner
 * (honest), never a fabricated one.
 */
export function resolveAuthority(assets: readonly KnowledgeAsset[]): AuthorityResolution {
  const ranked = [...assets].sort(compareAuthority);
  return {
    winnerAssetId: ranked.length > 0 ? ranked[0].id : null,
    ranked: ranked.map((a, i) => ({
      assetId: a.id,
      title: a.title,
      rankKey: a.authorityRankKey,
      rank: a.authorityRank,
      reason: reasonFor(a, i, ranked.length),
    })),
    method: RESOLUTION_METHOD,
  };
}
