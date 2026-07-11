/**
 * Enterprise Context — the entity-360 read-model (P2.5).
 *
 * Given ANY entity id in the unified Enterprise Knowledge Graph (a UDM node like
 * a document/person, or an ERP business entity like a customer/invoice/machine),
 * the Context Engine composes one grounded, cross-domain view of it from sources
 * that already exist:
 *   - the unified knowledge graph (immediate neighbors — UDM + bridged ERP),
 *   - the ERP relationship model (transitive blast-radius / impact, ERP only),
 *   - the universal timeline (recent activity that concerns the entity), and
 *   - AI memory (reference-only memories that cite the entity).
 *
 * It owns no storage and fabricates nothing: every field derives from a real
 * source object, and `sources` records which subsystems actually contributed so
 * the view is auditable. Types-only.
 */
import type { GraphEdgeType, GraphMeta, GraphNodeType } from './graph';

/** One immediate neighbor in the unified knowledge graph. */
export interface EnterpriseContextNeighbor {
  /** Graph node id of the neighbor (addressable — feed it back in for its own 360). */
  id: string;
  label: string;
  type: GraphNodeType;
  /** The relationship type connecting the focus entity to this neighbor. */
  edgeType: GraphEdgeType;
  direction: 'out' | 'in';
}

/** One entity within the transitive blast radius of an ERP business entity. */
export interface EnterpriseContextAffected {
  /** Addressable unified-graph id (ERP entities are `erp:`-prefixed). */
  id: string;
  label: string;
  kind: string;
  /** Deterministic risk score carried by the relationship model (0–100). */
  risk: number;
}

/**
 * Cross-domain impact — what a failure of this entity would touch. Present only
 * for ERP business entities (derived from the FK relationship model), never
 * fabricated for UDM nodes.
 */
export interface EnterpriseContextImpact {
  /** Total entities transitively reachable from the focus entity. */
  reach: number;
  /** Reachable entities sitting above the high-risk threshold. */
  atRisk: number;
  /** Reachable entity count by business kind. */
  byKind: Record<string, number>;
  /** The highest-risk reachable entities (ranked), capped for the view. */
  topAffected: EnterpriseContextAffected[];
}

/** One recent activity entry that concerns the focus entity. */
export interface EnterpriseContextActivity {
  id: string;
  at: string;
  kind: string;
  category: string;
  title: string;
  /** The business domain the entry came from (ERP module id / resource type). */
  sourceModule: string | null;
}

/** One AI memory that cites the focus entity (reference-only). */
export interface EnterpriseContextMemory {
  id: string;
  kind: string;
  title: string;
  /** A short excerpt of the memory text. */
  excerpt: string;
  occurredAt: string | null;
}

/** Which subsystems actually contributed to a context view (auditable provenance). */
export interface EnterpriseContextSources {
  graph: boolean;
  relationship: boolean;
  timeline: boolean;
  memory: boolean;
}

/** The resolved focus node (a projection of the graph node, or null when unknown). */
export interface EnterpriseContextNode {
  id: string;
  label: string;
  type: GraphNodeType;
  /** The source kind that produced the node (e.g. a UDM kind or `erp:<kind>`). */
  sourceKind: string | null;
  connectorId: string | null;
  metadata: GraphMeta;
}

/**
 * The composed entity-360. `node` is null when the id resolves to nothing in the
 * graph but timeline/memory still hold references — the view degrades gracefully
 * rather than 404-ing.
 */
export interface EnterpriseContext {
  /** The id as resolved in the unified graph (may be `erp:`-prefixed), or the raw input. */
  id: string;
  node: EnterpriseContextNode | null;
  /** Whether this entity carries ERP relationship intelligence (impact analysis). */
  isErp: boolean;
  /** Immediate neighbors in the unified knowledge graph (UDM + bridged ERP). */
  neighbors: EnterpriseContextNeighbor[];
  /** Cross-domain blast radius — ERP business entities only, else null. */
  impact: EnterpriseContextImpact | null;
  /** Recent activity concerning the entity (universal timeline). */
  activity: EnterpriseContextActivity[];
  /** AI memories that cite the entity. */
  memories: EnterpriseContextMemory[];
  sources: EnterpriseContextSources;
  generatedAt: string;
}
