/**
 * Enterprise Knowledge Graph (NCEA 11.1, Phase 1). ONE governed graph over every
 * enterprise entity. It composes the entity registry (typed references, no copies)
 * with the first-class RelationshipStore. Registration is idempotent by entity
 * key, so re-observing an entity updates its label/metadata without forking it —
 * the "never duplicate knowledge" guarantee at the storage level.
 */
import type { Clock } from '@neuropause/cloud-core';
import { type EntityKind, type EntityRef, type EntityNode, entityKey, refKey } from './entities';
import type { RelationshipStore } from './relationships';
import type { KnowledgeGovernance } from './governance';

export interface RegisterEntityInput {
  kind: EntityKind;
  id: string;
  label: string;
  source?: string;
  metadata?: Record<string, unknown>;
  actor?: string;
}

export class EnterpriseKnowledgeGraph {
  private readonly nodes = new Map<string, EntityNode>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: KnowledgeGovernance,
    private readonly relationships: RelationshipStore,
  ) {}

  /** Register (or idempotently update) a typed reference to an authoritative record. */
  async register(input: RegisterEntityInput): Promise<EntityNode> {
    const key = entityKey(input.kind, input.id);
    const now = this.clock.now();
    const existing = this.nodes.get(key);
    const node: EntityNode = {
      key,
      kind: input.kind,
      sourceId: input.id,
      label: input.label,
      source: input.source ?? 'workspace',
      metadata: { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.nodes.set(key, node);
    await this.governance.record({
      domain: 'knowledge',
      action: existing ? `update.${input.kind}` : `register.${input.kind}`,
      entity: key,
      actor: input.actor ?? 'system',
      ok: true,
      meta: { label: node.label, source: node.source },
    });
    return node;
  }

  get(ref: EntityRef): EntityNode | undefined {
    return this.nodes.get(refKey(ref));
  }

  getByKey(key: string): EntityNode | undefined {
    return this.nodes.get(key);
  }

  has(ref: EntityRef): boolean {
    return this.nodes.has(refKey(ref));
  }

  list(kind?: EntityKind): EntityNode[] {
    const all = [...this.nodes.values()];
    return kind ? all.filter((n) => n.kind === kind) : all;
  }

  count(): number {
    return this.nodes.size;
  }

  /** One-hop neighbour entity nodes (via the relationship store). */
  neighbors(ref: EntityRef): EntityNode[] {
    return this.relationships
      .neighbors(refKey(ref))
      .map((k) => this.nodes.get(k))
      .filter((n): n is EntityNode => Boolean(n));
  }

  /** Shortest relationship path (entity keys) between two entities, BFS, or []. */
  path(from: EntityRef, to: EntityRef, maxDepth = 6): string[] {
    const start = refKey(from);
    const goal = refKey(to);
    if (start === goal) return [start];
    const seen = new Set<string>([start]);
    const queue: Array<{ key: string; trail: string[] }> = [{ key: start, trail: [start] }];
    while (queue.length) {
      const { key, trail } = queue.shift()!;
      if (trail.length > maxDepth) continue;
      for (const next of this.relationships.neighbors(key)) {
        if (next === goal) return [...trail, next];
        if (!seen.has(next)) {
          seen.add(next);
          queue.push({ key: next, trail: [...trail, next] });
        }
      }
    }
    return [];
  }

  /** The entity + its immediate relationships — the unit Mission Control renders. */
  subgraph(ref: EntityRef): { node: EntityNode | undefined; neighbors: EntityNode[]; edgeCount: number } {
    const key = refKey(ref);
    return {
      node: this.nodes.get(key),
      neighbors: this.neighbors(ref),
      edgeCount: this.relationships.of(key).length,
    };
  }
}
