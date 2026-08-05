/**
 * Relationships (NCEA 11.1, Phase 1). Relationships are FIRST-CLASS: a typed,
 * directed, governed edge between two entities that can itself carry evidence and
 * an explanation. "Every relationship is explainable" means an edge may cite the
 * evidence that justifies it. Stored once (one graph); queried by entity or type.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { EntityRef } from './entities';
import { refKey } from './entities';
import type { KnowledgeGovernance } from './governance';

export const RELATIONSHIP_TYPES = [
  'owns',
  'member-of',
  'assigned-to',
  'depends-on',
  'blocks',
  'relates-to',
  'derived-from',
  'references',
  'mitigates',
  'contributes-to',
  'decides',
  'supports',
  'governed-by',
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export interface Relationship {
  id: string;
  from: string; // entity key
  to: string; // entity key
  type: RelationshipType;
  /** Evidence justifying the edge — this is what makes it explainable. */
  evidenceIds: string[];
  explanation?: string;
  createdAt: number;
}

export class RelationshipStore {
  private readonly edges = new Map<string, Relationship>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: KnowledgeGovernance,
  ) {}

  async relate(
    from: EntityRef,
    to: EntityRef,
    type: RelationshipType,
    options: { evidenceIds?: string[]; explanation?: string; actor?: string } = {},
  ): Promise<Relationship> {
    const edge: Relationship = {
      id: randomId('rel'),
      from: refKey(from),
      to: refKey(to),
      type,
      evidenceIds: options.evidenceIds ?? [],
      ...(options.explanation ? { explanation: options.explanation } : {}),
      createdAt: this.clock.now(),
    };
    this.edges.set(edge.id, edge);
    await this.governance.record({
      domain: 'relationship',
      action: `relate.${type}`,
      entity: edge.from,
      actor: options.actor ?? 'system',
      ok: true,
      ...(edge.evidenceIds.length ? { evidenceIds: edge.evidenceIds } : {}),
      meta: { to: edge.to, type },
    });
    return edge;
  }

  get(id: string): Relationship | undefined {
    return this.edges.get(id);
  }

  all(): Relationship[] {
    return [...this.edges.values()];
  }

  /** Every edge touching an entity (in or out). */
  of(key: string): Relationship[] {
    return [...this.edges.values()].filter((e) => e.from === key || e.to === key);
  }

  outgoing(key: string): Relationship[] {
    return [...this.edges.values()].filter((e) => e.from === key);
  }

  byType(type: RelationshipType): Relationship[] {
    return [...this.edges.values()].filter((e) => e.type === type);
  }

  /** Neighbour entity keys reachable from `key` in one hop (either direction). */
  neighbors(key: string): string[] {
    const out = new Set<string>();
    for (const e of this.of(key)) out.add(e.from === key ? e.to : e.from);
    return [...out];
  }
}
