/**
 * Traces — explainable chains over the intelligence layer.
 *
 *   - **Governance Trace™** (M8): how a decision connects to evidence — the
 *     decision record, its actor, the entities it references, and the timeline
 *     around them. Approval/policy slots are reserved for a future approval
 *     source (none is connected today), so they are present but empty rather
 *     than fabricated.
 *   - **Context Trace™** (M9): everything known about a subject over time — its
 *     timeline, graph-related entities, and memories.
 *   - **Relationship Trace™** (M10): relationship-first view of the knowledge
 *     graph — an entity's typed relationships, and the path between two entities.
 *
 * Types-only.
 */

export interface TraceEntityRef {
  id: string;
  kind: string;
  title: string;
  connectorId: string | null;
  at: string | null;
}

export interface TraceEvent {
  id: string;
  at: string;
  kind: string;
  title: string;
  source: string;
}

/* ── Governance Trace™ (M8) ── */

export interface GovernanceActor {
  id: string | null;
  label: string | null;
}

export interface GovernanceDecision {
  id: string;
  title: string;
  content: string;
  at: string;
  actor: GovernanceActor;
  origin: string;
}

/** Reserved for a future approval source; empty until one is connected. */
export interface GovernanceApproval {
  id: string;
  approver: string;
  at: string;
  status: string;
}
export interface GovernancePolicy {
  id: string;
  name: string;
}

export interface GovernanceTrace {
  decision: GovernanceDecision;
  /** The decision's referenced entities, resolved. */
  evidence: TraceEntityRef[];
  /** Timeline events touching the decision's entities. */
  timeline: TraceEvent[];
  approvals: GovernanceApproval[];
  policies: GovernancePolicy[];
  grounded: boolean;
}

export interface GovernanceTraceList {
  decisions: GovernanceDecision[];
  total: number;
}

/* ── Context Trace™ (M9) ── */

export interface ContextMemoryRef {
  id: string;
  kind: string;
  title: string;
  at: string | null;
}

export interface ContextTrace {
  subject: TraceEntityRef | null;
  timeline: TraceEvent[];
  related: TraceEntityRef[];
  memories: ContextMemoryRef[];
  grounded: boolean;
}

/* ── Relationship Trace™ (M10) ── */

export type RelationshipDirection = 'out' | 'in';

export interface RelationshipEdge {
  rel: string;
  direction: RelationshipDirection;
  node: TraceEntityRef;
}

export interface RelationshipTrace {
  root: TraceEntityRef | null;
  related: RelationshipEdge[];
  byType: Record<string, number>;
  grounded: boolean;
}

export interface RelationshipPath {
  from: string;
  to: string;
  found: boolean;
  nodes: TraceEntityRef[];
  length: number;
}
