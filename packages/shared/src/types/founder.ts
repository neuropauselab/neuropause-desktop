/**
 * Founder AI — evidence-grounded answers about the business.
 *
 * Founder AI answers questions ONLY from connected data, and it is scrupulous
 * about the difference between a **fact** (a statement read directly from the
 * UDM / graph / timeline, with evidence) and a **suggestion** (a derived
 * recommendation). The two are returned in separate arrays so the UI — and the
 * reader — can never mistake one for the other. There is no language model in
 * the loop: intent is matched by rule and every answer is computed, so it cannot
 * fabricate. When nothing in the connected data answers a question, it says so.
 *
 * Types-only.
 */

export type FounderIntent = 'overview' | 'status' | 'blocked' | 'activity' | 'count' | 'find' | 'who';

export const FOUNDER_INTENTS: readonly FounderIntent[] = [
  'overview', 'status', 'blocked', 'activity', 'count', 'find', 'who',
] as const;

export interface FounderEvidence {
  kind: string;
  id: string;
}

/** A statement read directly from connected data. */
export interface FounderFact {
  text: string;
  evidence: FounderEvidence[];
}

/** A derived recommendation — explicitly not a fact. */
export interface FounderSuggestion {
  text: string;
  evidence: FounderEvidence[];
}

/** A record surfaced as supporting context. */
export interface FounderReference {
  id: string;
  kind: string;
  title: string;
  connectorId: string | null;
  at: string | null;
}

export interface FounderAnswer {
  question: string;
  intent: FounderIntent;
  /** Deterministic plain-language synthesis built from the facts. */
  summary: string;
  facts: FounderFact[];
  suggestions: FounderSuggestion[];
  references: FounderReference[];
  evidenceCount: number;
  /** False when there is no connected data to answer from. */
  grounded: boolean;
}

// The ask request shape (text + optional `now`) is defined and validated by the
// FounderAskRequest Zod schema in the IPC contracts.
