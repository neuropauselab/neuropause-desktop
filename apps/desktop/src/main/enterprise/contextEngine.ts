/**
 * The Context Engine — entity-360 composition (P2.5).
 *
 * Given any entity id in the unified Enterprise Knowledge Graph, it assembles one
 * grounded, cross-domain view by READING (never writing, never storing) four
 * existing subsystems:
 *   - the unified knowledge graph        → immediate neighbors (UDM + bridged ERP),
 *   - the ERP relationship model         → transitive impact / blast-radius (ERP only),
 *   - the universal enterprise timeline  → recent activity that concerns the entity,
 *   - AI memory                          → reference-only memories that cite the entity.
 *
 * Pure and Electron-free: every source is an injected closure, so it unit-tests
 * with fakes; the runtime (enterprise composition root) wires the real graph
 * store, relationship provider, timeline, and memory store. It fabricates
 * nothing — the `sources` flags record which subsystems actually contributed.
 *
 * Id resolution: a caller may pass a graph node id (ERP entities are
 * `erp:`-prefixed) or a raw entity/record id. ERP entities are detected by the
 * prefix; the un-prefixed record id is what the timeline and memory key on.
 */
import {
  ERP_NODE_PREFIX,
  impactAnalysis,
  type EnterpriseContext,
  type EnterpriseContextActivity,
  type EnterpriseContextImpact,
  type EnterpriseContextMemory,
  type EnterpriseContextNeighbor,
  type EnterpriseContextRequest,
  type EnterpriseTimelineEntry,
  type GraphNeighbors,
  type GraphNeighborsQuery,
  type GraphNode,
  type MemoryItem,
  type RelationshipGraphModel,
} from '@neuropause/shared';

/** Live read-only sources, injected by the composition root (or a test). */
export interface ContextEngineDeps {
  /** Unified-graph node lookup. */
  getNode: (id: string) => GraphNode | null;
  /** Unified-graph immediate neighbors. */
  neighbors: (q: GraphNeighborsQuery) => GraphNeighbors | null;
  /** The read-only ERP relationship model (cached), or null when unavailable. */
  relationshipModel: () => RelationshipGraphModel | null;
  /** Timeline entries that concern an entity, newest first. */
  timeline: (entityRef: string, limit: number) => EnterpriseTimelineEntry[];
  /** AI memories that cite an entity. */
  memories: (entityRef: string, limit: number) => MemoryItem[];
  now: () => string;
}

function excerpt(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** Compose the entity-360 for one id. Deterministic; reads only. */
export function buildEnterpriseContext(
  deps: ContextEngineDeps,
  req: EnterpriseContextRequest,
): EnterpriseContext {
  const rawId = req.id.trim();
  const neighborLimit = req.neighborLimit ?? 60;
  const activityLimit = req.activityLimit ?? 40;
  const memoryLimit = req.memoryLimit ?? 20;
  const impactDepth = req.impactDepth ?? 3;

  // Resolve the id to a graph node. Accept a raw ERP record id by also trying the
  // `erp:` form — so callers can address an entity by either its graph id or record id.
  let node = deps.getNode(rawId);
  let gid: string | null = node ? rawId : null;
  if (!node && !rawId.startsWith(ERP_NODE_PREFIX)) {
    const erpId = `${ERP_NODE_PREFIX}${rawId}`;
    const erpNode = deps.getNode(erpId);
    if (erpNode) {
      node = erpNode;
      gid = erpId;
    }
  }

  const resolvedId = gid ?? rawId;
  const isErp = resolvedId.startsWith(ERP_NODE_PREFIX);
  // The un-prefixed record/entity id the timeline + memory subsystems key on.
  const recordId = isErp ? resolvedId.slice(ERP_NODE_PREFIX.length) : resolvedId;

  // ── Neighbors — unified knowledge graph (only when the node exists in it). ──
  const neighbors: EnterpriseContextNeighbor[] = [];
  if (gid) {
    const n = deps.neighbors({ id: gid, limit: neighborLimit });
    if (n) {
      for (const link of n.neighbors) {
        neighbors.push({
          id: link.node.id,
          label: link.node.label,
          type: link.node.type,
          edgeType: link.edge.type,
          direction: link.direction,
        });
      }
    }
  }

  // ── Impact — transitive blast radius, ERP business entities only. ──
  let impact: EnterpriseContextImpact | null = null;
  let relationshipUsed = false;
  if (isErp) {
    const model = deps.relationshipModel();
    if (model) {
      const ia = impactAnalysis(model, recordId, impactDepth);
      if (ia) {
        relationshipUsed = true;
        impact = {
          reach: ia.reach,
          atRisk: ia.atRisk,
          byKind: ia.byKind,
          topAffected: ia.affected.slice(0, 12).map((a) => ({
            id: `${ERP_NODE_PREFIX}${a.id}`,
            label: a.label,
            kind: a.kind,
            risk: a.risk,
          })),
        };
      }
    }
  }

  // ── Timeline — recent activity that concerns the entity. ──
  const activity: EnterpriseContextActivity[] = deps.timeline(recordId, activityLimit).map((e) => ({
    id: e.id,
    at: e.at,
    kind: e.kind,
    category: e.category,
    title: e.title,
    sourceModule: e.sourceModule,
  }));

  // ── Memory — reference-only memories that cite the entity. ──
  const memories: EnterpriseContextMemory[] = deps.memories(recordId, memoryLimit).map((m) => ({
    id: m.id,
    kind: m.kind,
    title: m.title,
    excerpt: excerpt(m.content, 200),
    occurredAt: m.occurredAt,
  }));

  return {
    id: resolvedId,
    node: node
      ? {
          id: node.id,
          label: node.label,
          type: node.type,
          sourceKind: node.sourceKind,
          connectorId: node.connectorId,
          metadata: node.metadata,
        }
      : null,
    isErp,
    neighbors,
    impact,
    activity,
    memories,
    sources: {
      graph: Boolean(gid),
      relationship: relationshipUsed,
      timeline: activity.length > 0,
      memory: memories.length > 0,
    },
    generatedAt: deps.now(),
  };
}
