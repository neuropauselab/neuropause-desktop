/**
 * Knowledge health (V8.3 inc8) — the last V8.3 capability. A read-only snapshot of
 * how well-connected the derived knowledge layer is: how many memories fall into
 * topics, how many are orphaned, and the entity-link density. Pure derivation over
 * memories (+ the verified topicClusters); adds no store, copies no data.
 */
import type { MemoryItem } from '@neuropause/shared';
import { topicClusters, type TopicClustersOptions } from './topicClusters';

export interface KnowledgeHealth {
  totalMemories: number;
  /** Memories carrying at least one entity ref. */
  memoriesWithEntities: number;
  /** Average distinct entity refs per memory (link density). */
  avgEntitiesPerMemory: number;
  topicCount: number;
  /** Memories that belong to at least one topic. */
  memoriesInTopics: number;
  /** Memories in no topic (isolated). */
  orphanCount: number;
  /** memoriesInTopics / total, 0..100. */
  coveragePercent: number;
  largestTopicSize: number;
}

const EMPTY: KnowledgeHealth = {
  totalMemories: 0,
  memoriesWithEntities: 0,
  avgEntitiesPerMemory: 0,
  topicCount: 0,
  memoriesInTopics: 0,
  orphanCount: 0,
  coveragePercent: 0,
  largestTopicSize: 0,
};

export function knowledgeHealth(
  memories: readonly MemoryItem[],
  options: TopicClustersOptions = {},
): KnowledgeHealth {
  const live = memories.filter((m) => !m.sync?.deleted);
  const total = live.length;
  if (total === 0) return { ...EMPTY };

  const clusters = topicClusters(live, options);
  const inTopics = new Set<string>();
  for (const c of clusters) for (const id of c.memoryIds) inTopics.add(id);

  let entityTotal = 0;
  let withEntities = 0;
  for (const m of live) {
    const distinct = new Set(m.entityRefs).size;
    entityTotal += distinct;
    if (distinct > 0) withEntities += 1;
  }

  const memoriesInTopics = inTopics.size;
  return {
    totalMemories: total,
    memoriesWithEntities: withEntities,
    avgEntitiesPerMemory: Number((entityTotal / total).toFixed(2)),
    topicCount: clusters.length,
    memoriesInTopics,
    orphanCount: total - memoriesInTopics,
    coveragePercent: Math.round((memoriesInTopics / total) * 100),
    largestTopicSize: clusters.reduce((mx, c) => Math.max(mx, c.size), 0),
  };
}
