/**
 * Phase 6 Stage 11 — shared knowledge: the Stage 7 composition. Joins the
 * recorded knowledge_package artifacts and knowledge-relevant federation
 * shares with the REAL Stage 7 assets whose topics match the registry's
 * knowledge_package topic tokens (the same topic join Stage 10 uses for
 * standards). Read-only (D-7): any actual sharing runs through the existing
 * governed fed:* surfaces. Pure; reads injected.
 */
import type { EfedGap, EfedSharedKnowledge, EfedUnavailable } from '@neuropause/shared';
import { EXCHANGE_KIND_BY_KEY } from './federationRegistry';

export interface SharedKnowledgeInput {
  artifacts: { kind: string }[] | null;
  shares: { kind: string; name: string; peerOrgName: string; direction: string; access: string }[] | null;
  knowledgeAssets: { id: string; title: string; topics: string[] }[] | null;
  failures: Record<string, string>;
}

export function buildSharedKnowledge(input: SharedKnowledgeInput): EfedSharedKnowledge {
  const unavailable: EfedUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({ system, reason }));
  const gaps: EfedGap[] = [];
  const topics = EXCHANGE_KIND_BY_KEY.get('knowledge_package')?.topics ?? [];

  const backingCandidates =
    input.knowledgeAssets === null
      ? []
      : input.knowledgeAssets
          .map((a) => {
            const matched = topics.find((t) => a.topics.includes(t));
            return matched ? { id: a.id, title: a.title, matchedTopic: matched } : null;
          })
          .filter((x): x is { id: string; title: string; matchedTopic: string } => x !== null);
  if (input.knowledgeAssets !== null && backingCandidates.length === 0) {
    gaps.push({ kind: 'mapping', subject: 'knowledge_package', detail: 'no Stage 7 asset matches the declared package topics' });
  }

  // Knowledge travels through the federation as governance_policy shares (the
  // recorded kinds) — a dedicated knowledge share kind does not exist and is
  // not invented; the gap says so when knowledge-like shares are absent.
  const knowledgeShares = (input.shares ?? []).filter((s) => s.kind === 'governance_policy');
  if (input.shares !== null && knowledgeShares.length === 0) {
    gaps.push({ kind: 'linkage', subject: 'shares', detail: 'no recorded share carries knowledge-class content (governance_policy is the closest recorded kind)' });
  }

  return {
    packagesPublished: input.artifacts === null ? 0 : input.artifacts.filter((a) => a.kind === 'knowledge_package').length,
    knowledgeShares: knowledgeShares.map((s) => ({ name: s.name, peerOrgName: s.peerOrgName, direction: s.direction, access: s.access })),
    backingCandidates,
    gaps,
    unavailable,
  };
}
