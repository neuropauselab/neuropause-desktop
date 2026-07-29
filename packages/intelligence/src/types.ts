/**
 * Shared Wave 3 types. Entities/edges/evidence/timeline for the knowledge graph;
 * confidence + AiAnswer for the governed, evidence-grounded AI surface. Every AI
 * answer carries evidence, confidence, sources, and audit/replay ids — the shapes
 * that make "reference evidence, have confidence metadata, be auditable" structural.
 */
export type EntityType =
  | 'organization' | 'user' | 'team' | 'project' | 'task' | 'okr' | 'objective' | 'key_result'
  | 'meeting' | 'document' | 'connector' | 'repository' | 'issue' | 'pull_request' | 'email'
  | 'calendar_event' | 'customer' | 'partner' | 'policy' | 'compliance_control' | 'risk'
  | 'release' | 'artifact' | 'dashboard' | 'event';

export type RelationType =
  | 'member_of' | 'owns' | 'measures' | 'tracks' | 'depends_on' | 'blocks' | 'assigned_to'
  | 'part_of' | 'relates_to' | 'connected_to' | 'produced' | 'affects';

/** A pointer back to the real source row/record an entity or answer is grounded in. */
export interface EvidenceRef {
  kind: string;
  id: string;
  source: string;
  detail?: string;
  at?: number;
}

export interface Entity {
  id: string;
  type: EntityType;
  tenantId: string;
  label: string;
  metadata: Record<string, unknown>;
  evidence: EvidenceRef[];
  createdAt: number;
}

export interface Edge {
  id: string;
  from: string;
  to: string;
  type: RelationType;
  tenantId: string;
  metadata?: Record<string, unknown>;
}

export interface TimelineEvent {
  at: number;
  type: string;
  entityId: string;
  detail: string;
  source: string;
  tenantId: string;
}

/** Deterministic confidence derived from how much real evidence backs an answer. */
export interface Confidence {
  score: number; // 0..1
  basis: string;
  evidenceCount: number;
}

/** A governed, evidence-grounded AI answer. */
export interface AiAnswer {
  text: string;
  confidence: Confidence;
  evidence: EvidenceRef[];
  sources: string[];
  model: string;
  provider: string;
  auditId: string;
  replayId: string;
  latencyMs: number;
  costUsd: number;
}

/** A deterministic reasoning result over the graph — always evidence-backed. */
export interface Inference {
  question: string;
  kind: string;
  answer: string;
  confidence: Confidence;
  evidence: EvidenceRef[];
  steps: string[];
}

/** Compute confidence from the evidence backing an answer (no fabrication: 0 evidence → low). */
export function computeConfidence(evidence: EvidenceRef[], basis = 'evidence-count'): Confidence {
  const n = evidence.length;
  // saturating curve: 0→0, 1→0.55, 2→0.7, 3→0.78, … capped at 0.95
  const score = n === 0 ? 0 : Math.min(0.95, 0.4 + 0.15 * Math.log2(n + 1) + 0.15);
  return { score: Math.round(score * 100) / 100, basis, evidenceCount: n };
}
