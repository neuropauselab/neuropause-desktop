/**
 * Knowledge handler logic (V8.3 inc3). Framework-free so the wiring of
 * relatedMemories + graph expansion is unit-testable without Electron/IPC.
 *
 * Derives related memories from the local memory set (source of truth) and
 * activates the existing graph edges: an entity's graph neighbors expand the
 * source's entity set one hop. Reuses relatedMemories (V8.3 inc1/inc2) and the
 * GraphStore.neighbors API — no new store, no duplicated logic.
 */
import type { MemoryItem } from '@neuropause/shared';
import { relatedMemories, type RelatedMemory } from './knowledgeLinks';

/** The slice of GraphStore this handler needs (matches GraphStore.neighbors). */
export interface KnowledgeGraph {
  neighbors(q: { id: string; direction?: 'both' | 'out' | 'in'; limit?: number }): {
    node: unknown;
    neighbors: Array<{ node: { sourceId: string | null } }>;
  } | null;
}

export interface KnowledgeHandlerDeps {
  listItems: () => MemoryItem[];
  graph: KnowledgeGraph;
  /** Neighbor breadth per entity when expanding through the graph. Default 25. */
  neighborLimit?: number;
}

export interface RelatedMemoriesResult {
  memoryId: string;
  related: RelatedMemory[];
}

export function handleRelatedMemories(
  deps: KnowledgeHandlerDeps,
  input: { memoryId: string; limit?: number },
): RelatedMemoriesResult {
  const memories = deps.listItems();
  const neighborLimit = deps.neighborLimit ?? 25;

  // Activate the graph: map an entity ref → its graph-adjacent entity refs.
  const expandEntities = (entityId: string): string[] => {
    const result = deps.graph.neighbors({ id: entityId, direction: 'both', limit: neighborLimit });
    if (!result) return [];
    const out: string[] = [];
    for (const n of result.neighbors) {
      if (typeof n.node.sourceId === 'string' && n.node.sourceId) out.push(n.node.sourceId);
    }
    return out;
  };

  const related = relatedMemories(input.memoryId, memories, { limit: input.limit, expandEntities });
  return { memoryId: input.memoryId, related };
}
