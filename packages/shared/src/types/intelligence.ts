/**
 * Daily Intelligence — evidence-grounded briefings.
 *
 * A briefing is computed deterministically from real UDM + timeline evidence for
 * a period (morning / evening / weekly / monthly / quarterly). Every line cites
 * the records it came from; nothing is invented. When there is no source data,
 * the briefing says so plainly (`grounded: false`) rather than fabricating.
 *
 * Types-only.
 */

export type BriefingPeriod = 'morning' | 'evening' | 'weekly' | 'monthly' | 'quarterly';

export const BRIEFING_PERIODS: readonly BriefingPeriod[] = [
  'morning', 'evening', 'weekly', 'monthly', 'quarterly',
] as const;

/** A back-pointer to the evidence a briefing line is grounded in. */
export interface BriefingEvidence {
  kind: string;
  id: string;
}

export interface BriefingItem {
  text: string;
  detail: string | null;
  connectorId: string | null;
  at: string | null;
  evidence: BriefingEvidence[];
}

export type BriefingSectionId =
  | 'completed'
  | 'in_progress'
  | 'upcoming'
  | 'meetings'
  | 'documents'
  | 'activity'
  | 'attention'
  | 'release_health'
  | 'pr_health'
  | 'ci_health'
  | 'engineering_risk';

export interface BriefingSection {
  id: BriefingSectionId;
  title: string;
  items: BriefingItem[];
  /** True when there was no evidence for this section in the period. */
  empty: boolean;
}

export interface BriefingRange {
  since: string;
  until: string;
}

export interface Briefing {
  period: BriefingPeriod;
  generatedAt: string;
  range: BriefingRange;
  /** Deterministic one-line summary built from the section counts. */
  headline: string;
  sections: BriefingSection[];
  /** Total evidence references cited across the briefing. */
  evidenceCount: number;
  /** False when there is no connected data to brief on (honest empty state). */
  grounded: boolean;
}

// The briefing request shape (period + optional `now`) is defined and validated
// by the BriefingRequest Zod schema in the IPC contracts.
