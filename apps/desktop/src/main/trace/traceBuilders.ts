/**
 * Pure builders for the three traces. Each takes its data (and, where the graph
 * is involved, injected lookups) so it unit-tests without Electron. The runtime
 * wires the UDM, timeline, memory, and graph singletons into these.
 */
import type {
  ContextTrace,
  EnterpriseTimelineEntry,
  GovernanceDecision,
  GovernanceTrace,
  GovernanceTraceList,
  MemoryItem,
  RelationshipPath,
  RelationshipTrace,
  TraceEntityRef,
  TraceEvent,
  UnifiedEntity,
} from '@neuropause/shared';

/** A graph neighbor, flattened for trace use. */
export interface TraceNeighbor {
  id: string;
  type: string;
  label: string;
  connectorId: string | null;
  updatedAt: string;
  rel: string;
  direction: 'out' | 'in';
}

function entityRef(e: UnifiedEntity): TraceEntityRef {
  return { id: e.id, kind: e.kind, title: e.title, connectorId: e.connectorId, at: e.timestamp ?? e.updatedAt };
}

function neighborRef(n: TraceNeighbor): TraceEntityRef {
  return { id: n.id, kind: n.type, title: n.label, connectorId: n.connectorId, at: n.updatedAt };
}

function toEvent(e: EnterpriseTimelineEntry): TraceEvent {
  return { id: e.id, at: e.at, kind: e.kind, title: e.title, source: e.source };
}

function eventsTouching(events: EnterpriseTimelineEntry[], ids: Set<string>): TraceEvent[] {
  return events
    .filter((e) => e.entityRefs.some((r) => ids.has(r)) || (e.resourceId !== null && ids.has(e.resourceId)))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .map(toEvent);
}

function toDecision(m: MemoryItem): GovernanceDecision {
  return {
    id: m.id,
    title: m.title,
    content: m.content,
    at: m.occurredAt ?? m.createdAt,
    actor: { id: null, label: m.source },
    origin: m.origin,
  };
}

/* ── Governance Trace™ ── */

export function listGovernanceDecisions(
  memories: MemoryItem[],
  text: string | undefined,
  limit: number,
): GovernanceTraceList {
  const t = text?.trim().toLowerCase();
  const decisions = memories
    .filter((m) => m.kind === 'decision')
    .filter((m) => !t || m.title.toLowerCase().includes(t) || m.content.toLowerCase().includes(t))
    .sort((a, b) => ((a.occurredAt ?? a.createdAt) < (b.occurredAt ?? b.createdAt) ? 1 : -1));
  return { decisions: decisions.slice(0, limit).map(toDecision), total: decisions.length };
}

export interface GovernanceData {
  memories: MemoryItem[];
  entities: UnifiedEntity[];
  events: EnterpriseTimelineEntry[];
}

export function buildGovernanceTrace(decisionId: string, data: GovernanceData): GovernanceTrace | null {
  const decision =
    data.memories.find((m) => m.id === decisionId && m.kind === 'decision') ??
    data.memories.find((m) => m.id === decisionId);
  if (!decision) return null;

  const byId = new Map(data.entities.map((e) => [e.id, e]));
  const evidence: TraceEntityRef[] = [];
  for (const ref of decision.entityRefs) {
    const e = byId.get(ref);
    if (e) evidence.push(entityRef(e));
  }
  const timeline = eventsTouching(data.events, new Set(decision.entityRefs));

  return {
    decision: toDecision(decision),
    evidence,
    timeline,
    approvals: [],
    policies: [],
    grounded: true,
  };
}

/* ── Context Trace™ ── */

export interface ContextData {
  entities: UnifiedEntity[];
  events: EnterpriseTimelineEntry[];
  memories: MemoryItem[];
  neighbors: (nodeId: string) => TraceNeighbor[];
}

export function buildContextTrace(entityId: string, data: ContextData): ContextTrace {
  const byId = new Map(data.entities.map((e) => [e.id, e]));
  const subj = byId.get(entityId);
  const subject = subj ? entityRef(subj) : null;

  const timeline = eventsTouching(data.events, new Set([entityId]));
  const related = data.neighbors(entityId).map(neighborRef);
  const memories = data.memories
    .filter((m) => m.entityRefs.includes(entityId))
    .map((m) => ({ id: m.id, kind: m.kind, title: m.title, at: m.occurredAt }));

  const grounded = subject !== null || timeline.length > 0 || related.length > 0 || memories.length > 0;
  return { subject, timeline, related, memories, grounded };
}

/* ── Relationship Trace™ ── */

export interface RelationshipData {
  resolveRef: (nodeId: string) => TraceEntityRef | null;
  neighbors: (nodeId: string) => TraceNeighbor[];
}

export function buildRelationshipTrace(nodeId: string, data: RelationshipData): RelationshipTrace {
  const root = data.resolveRef(nodeId);
  const ns = data.neighbors(nodeId);
  const related = ns.map((n) => ({ rel: n.rel, direction: n.direction, node: neighborRef(n) }));
  const byType: Record<string, number> = {};
  for (const n of ns) byType[n.rel] = (byType[n.rel] ?? 0) + 1;
  return { root, related, byType, grounded: root !== null || related.length > 0 };
}

export interface RelationshipPathData {
  /** Ordered refs from `from` to `to`, or [] if unreachable. */
  pathRefs: (from: string, to: string) => TraceEntityRef[];
}

export function buildRelationshipPath(from: string, to: string, data: RelationshipPathData): RelationshipPath {
  const nodes = data.pathRefs(from, to);
  return { from, to, found: nodes.length > 0, nodes, length: Math.max(0, nodes.length - 1) };
}
