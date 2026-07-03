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
  | 'upcoming_deadline';

export const RECOMMENDATION_KINDS: readonly RecommendationKind[] = [
  'next_task', 'stale_task', 'blocked_project', 'pending_document', 'unanswered', 'upcoming_deadline',
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
