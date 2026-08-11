/**
 * Feedback: shapes shared between the main-process store and the renderer form.
 * Feedback is captured locally and export-based — the same posture as crash
 * reporting and telemetry; there is no remote ingestion service.
 */
export type FeedbackCategory = 'bug' | 'idea' | 'question' | 'praise';

export const FEEDBACK_CATEGORIES: readonly FeedbackCategory[] = [
  'bug',
  'idea',
  'question',
  'praise',
];

export interface FeedbackEntry {
  id: string;
  /**
   * P13C ROUND 3 — the organization whose member submitted this.
   *
   * Optional because entries written before this round have no owner, and an
   * unowned entry is visible to NOBODY rather than guessed into a tenant.
   */
  tenantId?: string | null;
  category: FeedbackCategory;
  message: string;
  createdAt: string;
  /** App version at submit time, for triage context (null if unknown). */
  appVersion: string | null;
  /** Optional free-form context, e.g. the active view when submitted. */
  context: string | null;
}

export interface FeedbackExport {
  exportedAt: string;
  entries: FeedbackEntry[];
}
