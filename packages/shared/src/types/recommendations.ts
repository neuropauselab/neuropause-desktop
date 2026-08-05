/**
 * Recommendation Engine — what to do next, with evidence.
 *
 * Deterministic rules over the UDM and timeline produce recommendations (next
 * task, stale task, blocked project, unread/unanswered, upcoming deadline). Each
 * one cites the records that triggered it — recommendations are suggestions
 * grounded in fact, never speculation presented as fact.
 *
 * Types-only.
 */

export type RecommendationKind =
  | 'next_task'
  | 'stale_task'
  | 'blocked_project'
  | 'pending_document'
  | 'unanswered'
  | 'upcoming_deadline'
  // Phase 6 Stage 5 — additive productivity kinds (deterministic, evidence-backed).
  | 'open_approval'
  | 'connector_issue'
  | 'automation_opportunity'
  | 'followup_conversation'
  | 'unanswered_email';

export const RECOMMENDATION_KINDS: readonly RecommendationKind[] = [
  'next_task', 'stale_task', 'blocked_project', 'pending_document', 'unanswered', 'upcoming_deadline',
  'open_approval', 'connector_issue', 'automation_opportunity', 'followup_conversation', 'unanswered_email',
] as const;

export type RecommendationPriority = 'low' | 'normal' | 'high';

export interface RecommendationEvidence {
  kind: string;
  id: string;
}

export interface Recommendation {
  id: string;
  kind: RecommendationKind;
  title: string;
  /** Plain-language reason this surfaced. */
  rationale: string;
  priority: RecommendationPriority;
  /** Ranking score in 0..1. */
  score: number;
  connectorId: string | null;
  entityRefs: string[];
  evidence: RecommendationEvidence[];
  /* ── Phase 6 Stage 5 — explainability additions (5.11; optional + additive). ── */
  /** The concrete next step this recommendation suggests. */
  suggestedAction?: string;
  /** The systems/surfaces this touches (e.g. ['workforce','approvals']). */
  affectedSystems?: string[];
  /** 0..1 confidence in the underlying evidence. */
  confidence?: number;
}

export interface RecommendationQuery {
  kinds?: RecommendationKind[];
  limit?: number;
  /** ISO 'now' override (for deterministic generation/testing). */
  now?: string;
}

export interface RecommendationSet {
  generatedAt: string;
  recommendations: Recommendation[];
  total: number;
  byKind: Record<string, number>;
  /** False when there is no connected data to reason over. */
  grounded: boolean;
}
