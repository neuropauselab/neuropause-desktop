/**
 * Founder suggested questions — derived deterministically from current data. The
 * Mission Brief drives most of it (engineering signals surface release/engineering
 * questions; attention/activity sections surface their own), with optional live
 * signals (pending approvals, workers needing attention) layered on when provided.
 * A handful of evergreen executive questions are always offered as a baseline.
 * Pure — no model, no fabrication; every suggestion maps to a real intent.
 */
import type { Briefing, BriefingSectionId, FounderSuggestedQuestion } from '@neuropause/shared';

export interface FounderSuggestionsInput {
  briefing: Briefing;
  /** Optional live signal; when omitted, the approvals question is not surfaced. */
  pendingApprovals?: number;
  /** Optional live signal; when omitted, the worker-attention question is not surfaced. */
  workersNeedingAttention?: number;
}

const ENGINEERING_SECTIONS: BriefingSectionId[] = [
  'ci_health',
  'pr_health',
  'release_health',
  'engineering_risk',
];

/** Evergreen executive questions, always offered as a baseline. */
const EVERGREEN: FounderSuggestedQuestion[] = [
  { text: 'What should I work on today?', intent: 'morning-brief', reason: null },
  { text: "What's the biggest business risk?", intent: 'business-risk', reason: null },
  { text: 'Summarize yesterday.', intent: 'timeline', reason: null },
];

export function deriveFounderSuggestions(
  input: FounderSuggestionsInput,
  limit = 6,
): FounderSuggestedQuestion[] {
  const filled = new Set<BriefingSectionId>(
    input.briefing.sections.filter((s) => !s.empty).map((s) => s.id),
  );
  const dynamic: FounderSuggestedQuestion[] = [];

  if ((input.pendingApprovals ?? 0) > 0) {
    dynamic.push({
      text: 'What needs my approval?',
      intent: 'approvals',
      reason: `${input.pendingApprovals} pending`,
    });
  }

  if (ENGINEERING_SECTIONS.some((id) => filled.has(id))) {
    dynamic.push({
      text: "What's blocking Release 1.0?",
      intent: 'release-status',
      reason: 'engineering signals in your data',
    });
    dynamic.push({
      text: "Show today's engineering risks.",
      intent: 'engineering',
      reason: 'engineering signals in your data',
    });
  }

  if ((input.workersNeedingAttention ?? 0) > 0) {
    dynamic.push({
      text: 'Which AI workers need attention?',
      intent: 'ai-workers',
      reason: `${input.workersNeedingAttention} need attention`,
    });
  }

  if (filled.has('attention')) {
    dynamic.push({
      text: 'What needs attention right now?',
      intent: 'business-risk',
      reason: 'attention items in your brief',
    });
  }

  if (filled.has('activity')) {
    dynamic.push({
      text: 'What changed overnight?',
      intent: 'timeline',
      reason: 'recent activity',
    });
  }

  // Data-specific first, then evergreen; dedupe by text, capped.
  const seen = new Set<string>();
  const out: FounderSuggestedQuestion[] = [];
  for (const q of [...dynamic, ...EVERGREEN]) {
    if (seen.has(q.text)) continue;
    seen.add(q.text);
    out.push(q);
    if (out.length >= limit) break;
  }
  return out;
}
