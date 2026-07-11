/**
 * The business-memory projector (P2.5 — AI Auto-Memory).
 *
 * Distills the read-only ERP relationship model into durable, high-signal memory
 * items the AI can recall — the business equivalent of the UDM memory projector.
 * It memorializes only concrete, grounded facts that are worth remembering across
 * sessions: critical cross-domain dependencies, broken (unresolved-reference)
 * links, and disconnected master assets. Every item is a POINTER, not a copy:
 * `entityRefs` point at the real relationship-graph entities and `evidence` cites
 * the specific edge/node it derives from, so a recalled business memory is always
 * traceable to real records — never fabricated.
 *
 * Pure (no I/O). Deterministic ids (derived from the edge/node ids) mean a
 * re-projection REPLACES the previous business memories in place rather than
 * duplicating them — it merges into the SAME `applyProjected` pass as the UDM
 * projector, so there is one projected namespace, never a parallel store.
 */
import type { MemoryItem, RelationshipGraphModel } from '@neuropause/shared';

/** Caps keep memory high-signal — the model already sorts these lists by severity. */
const CRITICAL_CAP = 24;
const BROKEN_CAP = 24;
const DISCONNECTED_CAP = 12;

export function projectBusinessMemory(
  model: RelationshipGraphModel | null | undefined,
  now: string,
): MemoryItem[] {
  if (!model) return [];
  const label = new Map(model.nodes.map((n) => [n.id, n.label]));
  const name = (id: string): string => label.get(id) ?? id;
  const byId = new Map<string, MemoryItem>();

  const put = (item: MemoryItem): void => {
    // Deterministic id → a later, higher-signal item for the same subject wins deterministically.
    if (!byId.has(item.id)) byId.set(item.id, item);
  };

  // ── Critical cross-domain dependencies (the model pre-sorts by risk desc). ──
  for (const e of model.criticalEdges.slice(0, CRITICAL_CAP)) {
    const from = name(e.from);
    const to = name(e.to);
    put({
      id: `mem:erp:rel:${e.id}`,
      kind: 'relationship',
      origin: 'projected',
      title: `Critical dependency: ${from} → ${to}`,
      content: `${from} → ${to} (${e.type.replace(/_/g, ' ')}) is a critical dependency — risk ${e.risk}, health ${e.health}. A failure here cascades downstream.`,
      connectorId: null,
      source: 'erp',
      entityRefs: [e.from, e.to],
      tags: ['erp', 'relationship', 'critical'],
      occurredAt: e.lastUpdated || now,
      createdAt: now,
      updatedAt: now,
      evidence: { kind: 'enterprise-relationship', id: e.id },
      metadata: { relation: e.type, risk: e.risk, health: e.health },
    });
  }

  // ── Broken links — a referenced customer/product/machine/order record is missing. ──
  const broken = model.edges.filter((e) => e.health === 'broken').slice(0, BROKEN_CAP);
  for (const e of broken) {
    const from = name(e.from);
    const to = name(e.to);
    put({
      id: `mem:erp:rel:${e.id}`,
      kind: 'relationship',
      origin: 'projected',
      title: `Broken link: ${from} → ${to}`,
      content: `${from} → ${to} (${e.type.replace(/_/g, ' ')}) references a record that does not resolve — a data-integrity gap to repair.`,
      connectorId: null,
      source: 'erp',
      entityRefs: [e.from, e.to],
      tags: ['erp', 'relationship', 'broken'],
      occurredAt: e.lastUpdated || now,
      createdAt: now,
      updatedAt: now,
      evidence: { kind: 'enterprise-relationship', id: e.id },
      metadata: { relation: e.type, health: e.health },
    });
  }

  // ── Disconnected master assets — a machine/product/customer with no relationships. ──
  for (const n of model.disconnected.slice(0, DISCONNECTED_CAP)) {
    put({
      id: `mem:erp:ent:${n.id}`,
      kind: 'relationship',
      origin: 'projected',
      title: `Disconnected ${n.kind}: ${n.label}`,
      content: `${n.label} (${n.kind}) has no active relationships — an idle or orphaned master record to connect or retire.`,
      connectorId: null,
      source: 'erp',
      entityRefs: [n.id],
      tags: ['erp', 'relationship', 'disconnected'],
      occurredAt: n.lastUpdated || now,
      createdAt: now,
      updatedAt: now,
      evidence: { kind: `erp:${n.kind}`, id: n.id },
      metadata: { kind: n.kind, degree: n.degree, health: n.health },
    });
  }

  return [...byId.values()];
}
