/**
 * The recommendation engine. Deterministic rules over the UDM and timeline,
 * each producing recommendations grounded in cited evidence:
 *
 *   - open tasks → "continue" (recent) or "stale" (untouched > 14d),
 *   - projects with open tasks but no recorded activity → "may be stalled",
 *   - unread notifications → "unanswered",
 *   - calendar events within 3 days → "upcoming deadline".
 *
 * Pure (entities + timeline injected), so it unit-tests from synthetic data.
 */
import type {
  EnterpriseTimelineEntry,
  Recommendation,
  RecommendationKind,
  RecommendationPriority,
  RecommendationQuery,
  UnifiedEntity,
} from '@neuropause/shared';
import { classifyStatus, clamp01, daysBetween, eventTime, isOpenTask } from '../intelligence/classify';

export interface RecommendationInput {
  entities: UnifiedEntity[];
  events: EnterpriseTimelineEntry[];
  now: string;
}

const STALE_DAYS = 14;
const DEADLINE_DAYS = 3;

function rec(
  kind: RecommendationKind,
  title: string,
  rationale: string,
  priority: RecommendationPriority,
  score: number,
  e: UnifiedEntity,
): Recommendation {
  return {
    id: `rec:${kind}:${e.id}`,
    kind,
    title,
    rationale,
    priority,
    score: clamp01(score),
    connectorId: e.connectorId,
    entityRefs: [e.id],
    evidence: [{ kind: e.kind, id: e.id }],
  };
}

export function generateRecommendations(
  input: RecommendationInput,
  query: RecommendationQuery = {},
): Recommendation[] {
  const recs: Recommendation[] = [];

  // Latest recorded activity per entity, from the timeline.
  const lastActivity = new Map<string, string>();
  for (const ev of input.events) {
    for (const ref of ev.entityRefs) {
      const prev = lastActivity.get(ref);
      if (!prev || ev.at > prev) lastActivity.set(ref, ev.at);
    }
  }

  const openTasks = input.entities.filter(isOpenTask);

  // Open tasks → stale (old) or next (recent).
  for (const t of openTasks) {
    const age = daysBetween(eventTime(t), input.now);
    if (age > STALE_DAYS) {
      recs.push(
        rec('stale_task', `Stale task: ${t.title}`, `No update in ${Math.floor(age)} days.`, 'high', 0.6 + age / 120, t),
      );
    } else {
      recs.push(
        rec('next_task', `Continue: ${t.title}`, `Open task, last touched ${Math.floor(age)}d ago.`, 'normal', 0.5 - age / 60, t),
      );
    }
  }

  // Projects with open child tasks but no recorded activity → stalled.
  const projects = input.entities.filter(
    (e) => e.kind === 'project' && classifyStatus(e.status) !== 'archived',
  );
  for (const p of projects) {
    const childOpen = openTasks.filter((t) => t.containerId === p.id);
    if (childOpen.length === 0) continue;
    const last = lastActivity.get(p.id);
    const idle = last ? daysBetween(last, input.now) : Number.POSITIVE_INFINITY;
    if (idle > STALE_DAYS) {
      recs.push({
        id: `rec:blocked_project:${p.id}`,
        kind: 'blocked_project',
        title: `Project may be stalled: ${p.title}`,
        rationale: `${childOpen.length} open task(s) and no recorded activity in ${
          Number.isFinite(idle) ? `${Math.floor(idle)} days` : 'a while'
        }.`,
        priority: 'high',
        score: clamp01(0.7),
        connectorId: p.connectorId,
        entityRefs: [p.id, ...childOpen.map((t) => t.id)],
        evidence: [{ kind: 'project', id: p.id }, ...childOpen.slice(0, 3).map((t) => ({ kind: 'task', id: t.id }))],
      });
    }
  }

  // Unread notifications → unanswered.
  for (const n of input.entities.filter(
    (e) => e.kind === 'notification' && classifyStatus(e.status) === 'unread',
  )) {
    recs.push(rec('unanswered', `Unread: ${n.title}`, 'Unread notification awaiting a response.', 'normal', 0.45, n));
  }

  // Calendar events within the deadline horizon → upcoming.
  for (const e of input.entities.filter(
    (x) => (x.kind === 'calendar_event' || x.kind === 'event') && x.timestamp !== null && x.timestamp > input.now,
  )) {
    const days = daysBetween(input.now, e.timestamp as string);
    if (days <= DEADLINE_DAYS) {
      recs.push(
        rec(
          'upcoming_deadline',
          `Upcoming: ${e.title}`,
          `Scheduled in ${days < 1 ? 'under a day' : `${Math.ceil(days)} day(s)`}.`,
          days < 1 ? 'high' : 'normal',
          0.8 - days / 10,
          e,
        ),
      );
    }
  }

  let out = recs;
  if (query.kinds && query.kinds.length > 0) {
    const k = new Set(query.kinds);
    out = out.filter((r) => k.has(r.kind));
  }
  out.sort((a, b) => b.score - a.score);
  const limit = query.limit ?? 50;
  return out.slice(0, limit);
}
