/**
 * Topic clustering (V8.3 inc5) — the next derived-knowledge layer.
 *
 * Groups memories into topics purely from the `entityRefs` they already carry:
 * two memories belong to the same topic when they are connected — directly or
 * transitively — through shared (discriminating) entities. A topic is therefore a
 * connected component of the "memories linked by shared entities" graph. Adds no
 * store, copies no data; memory remains the source of truth.
 *
 * Pure and I/O-free. Reuses the same rarity/hub-entity discipline as knowledgeLinks
 * so ubiquitous entities don't collapse everything into one topic.
 */
import type { MemoryItem } from '@neuropause/shared';

export interface TopicCluster {
  /** Deterministic id derived from the members (stable across runs). */
  id: string;
  /** Best-effort label: the entity most characteristic of the cluster. */
  label: string;
  /** Member memory ids (sorted). */
  memoryIds: string[];
  /** The entities that define this topic, most-shared first (top-k). */
  entities: string[];
  size: number;
}

export interface TopicClustersOptions {
  /** Ignore entities shared by more than this fraction of the corpus. Default 0.5. */
  maxEntityFrequency?: number;
  /** Drop topics smaller than this (singletons by default). Default 2. */
  minClusterSize?: number;
  /** Max defining entities to report per topic. Default 3. */
  maxTopicEntities?: number;
}

/** Minimal union-find over string keys. */
class UnionFind {
  private parent = new Map<string, string>();

  private find(x: string): string {
    let root = this.parent.get(x) ?? x;
    if (root === x) {
      this.parent.set(x, x);
      return x;
    }
    root = this.find(root);
    this.parent.set(x, root); // path compression
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  add(x: string): void {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }

  groups(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const key of this.parent.keys()) {
      const root = this.find(key);
      const list = out.get(root) ?? [];
      list.push(key);
      out.set(root, list);
    }
    return out;
  }
}

function entityFrequencies(memories: readonly MemoryItem[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const m of memories) {
    for (const ref of new Set(m.entityRefs)) freq.set(ref, (freq.get(ref) ?? 0) + 1);
  }
  return freq;
}

export function topicClusters(
  memories: readonly MemoryItem[],
  options: TopicClustersOptions = {},
): TopicCluster[] {
  const maxFreq = options.maxEntityFrequency ?? 0.5;
  const minSize = Math.max(1, options.minClusterSize ?? 2);
  const maxEntities = Math.max(1, options.maxTopicEntities ?? 3);

  const live = memories.filter((m) => !m.sync?.deleted);
  const total = live.length;
  if (total === 0) return [];

  const freq = entityFrequencies(live);
  // An entity shared by only 2 memories is a valid link; only 3+ can be a hub.
  const freqCap = Math.max(2, Math.floor(total * maxFreq));

  // Group memories by each discriminating entity, unioning co-referencing memories.
  const uf = new UnionFind();
  for (const m of live) uf.add(m.id);

  const entityToMembers = new Map<string, string[]>();
  for (const m of live) {
    for (const ref of new Set(m.entityRefs)) {
      if ((freq.get(ref) ?? 0) > freqCap) continue; // skip hub entities
      const members = entityToMembers.get(ref) ?? [];
      members.push(m.id);
      entityToMembers.set(ref, members);
    }
  }
  for (const members of entityToMembers.values()) {
    for (let i = 1; i < members.length; i += 1) uf.union(members[0], members[i]);
  }

  // Assemble clusters from the connected components.
  const memberEntities = new Map<string, Set<string>>();
  for (const m of live) {
    memberEntities.set(
      m.id,
      new Set([...new Set(m.entityRefs)].filter((ref) => (freq.get(ref) ?? 0) <= freqCap)),
    );
  }

  const clusters: TopicCluster[] = [];
  for (const [, memberIds] of uf.groups()) {
    if (memberIds.length < minSize) continue;

    // Rank the cluster's defining entities by how many members reference them.
    const withinFreq = new Map<string, number>();
    for (const id of memberIds) {
      for (const ref of memberEntities.get(id) ?? []) {
        withinFreq.set(ref, (withinFreq.get(ref) ?? 0) + 1);
      }
    }
    // Only entities actually shared within the cluster (freq ≥ 2) define the topic.
    const defining = [...withinFreq.entries()]
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([ref]) => ref);

    if (defining.length === 0) continue; // a component with no genuinely shared entity

    const sortedMembers = [...memberIds].sort();
    clusters.push({
      id: `topic:${sortedMembers[0]}`,
      label: defining[0],
      memoryIds: sortedMembers,
      entities: defining.slice(0, maxEntities),
      size: sortedMembers.length,
    });
  }

  clusters.sort((a, b) => b.size - a.size || (a.id < b.id ? -1 : 1));
  return clusters;
}
