/**
 * Shared classification and date helpers for Daily Intelligence and the
 * Recommendation Engine. Status strings vary by connector (`open`/`closed`,
 * `active`/`archived`, `unread`/`read`, `confirmed`, …); these normalize them
 * into coarse classes the intelligence rules can reason over. Honestly
 * heuristic — the normalizer is conservative and falls back to 'other'.
 */
import type { BriefingPeriod, UnifiedEntity } from '@neuropause/shared';

export type StatusClass = 'completed' | 'open' | 'archived' | 'unread' | 'other';

const COMPLETED = /^(closed|done|complete|completed|merged|resolved|cancelled|canceled|shipped)$/;
const OPEN = /^(open|active|todo|to-do|in[_\s-]?progress|inprogress|pending|draft|tentative|wip|started)$/;

export function classifyStatus(status: string | null): StatusClass {
  if (!status) return 'other';
  const s = status.trim().toLowerCase();
  if (s === 'archived') return 'archived';
  if (s === 'unread') return 'unread';
  if (COMPLETED.test(s)) return 'completed';
  if (OPEN.test(s)) return 'open';
  return 'other';
}

export function isOpenTask(e: UnifiedEntity): boolean {
  return e.kind === 'task' && classifyStatus(e.status) === 'open';
}

export function isCompleted(e: UnifiedEntity): boolean {
  return classifyStatus(e.status) === 'completed';
}

/** The instant an entity "happened": its event timestamp, else last update. */
export function eventTime(e: UnifiedEntity): string {
  return e.timestamp ?? e.updatedAt;
}

export function daysBetween(aIso: string, bIso: string): number {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.abs(b - a) / 86_400_000;
}

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Math.round(n * 1000) / 1000));
}

/** Inclusive time window for a briefing period, relative to `now`. */
export function rangeFor(period: BriefingPeriod, now: string): { since: string; until: string } {
  const end = new Date(now);
  const start = new Date(now);
  switch (period) {
    // Phase 6 Stage 5 — the Afternoon Update shares the morning's same-day window,
    // as does the evening wrap-up: all three brief on what happened today.
    case 'morning':
    case 'afternoon':
    case 'evening':
      start.setHours(0, 0, 0, 0);
      break;
    case 'weekly':
      start.setDate(start.getDate() - 7);
      break;
    case 'monthly':
      start.setDate(start.getDate() - 30);
      break;
    case 'quarterly':
      start.setDate(start.getDate() - 90);
      break;
  }
  return { since: start.toISOString(), until: end.toISOString() };
}
