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
