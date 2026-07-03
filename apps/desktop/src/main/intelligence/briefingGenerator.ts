/**
 * The briefing generator. Builds a period briefing purely from UDM entities and
 * timeline entries — deterministic and fully cited. Every item carries the
 * evidence it was derived from, and when there is no source data the briefing
 * reports `grounded: false` with empty sections rather than inventing content.
 */
import type {
  Briefing,
  BriefingItem,
  BriefingPeriod,
  BriefingSection,
  BriefingSectionId,
  EnterpriseTimelineEntry,
  UnifiedEntity,
} from '@neuropause/shared';
import {
  classifyStatus,
  eventTime,
  daysBetween,
  isCompleted,
  isOpenTask,
  rangeFor,
} from './classify';

export interface IntelligenceInput {
  entities: UnifiedEntity[];
  events: EnterpriseTimelineEntry[];
  now: string;
}

const CAP = 20;

function excerpt(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function label(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1).replace(/_/g, ' ');
}

function item(text: string, e: UnifiedEntity, at?: string | null): BriefingItem {
  return {
    text,
    detail: e.body ? excerpt(e.body, 140) : null,
    connectorId: e.connectorId,
    at: at ?? eventTime(e),
    evidence: [{ kind: e.kind, id: e.id }],
  };
}

function section(id: BriefingSectionId, title: string, items: BriefingItem[]): BriefingSection {
  return { id, title, items, empty: items.length === 0 };
}

function isMeetingKind(e: UnifiedEntity): boolean {
  return e.kind === 'calendar_event' || e.kind === 'event';
}

function buildHeadline(
  period: BriefingPeriod,
  c: {
    completed: number;
    inProgress: number;
    upcoming: number;
    meetings: number;
    attention: number;
    releases: number;
    prsAwaitingReview: number;
    ciFailing: number;
  },
): string {
  const lead =
    period === 'morning'
      ? 'Today'
      : period === 'evening'
        ? 'Today so far'
        : period === 'weekly'
          ? 'This week'
          : period === 'monthly'
            ? 'This month'
            : 'This quarter';
  const parts: string[] = [];
  if (c.completed) parts.push(`${c.completed} completed`);
  if (c.inProgress) parts.push(`${c.inProgress} in progress`);
  if (c.upcoming) parts.push(`${c.upcoming} upcoming`);
  if (c.meetings) parts.push(`${c.meetings} meeting${c.meetings === 1 ? '' : 's'}`);
  if (c.releases) parts.push(`${c.releases} release${c.releases === 1 ? '' : 's'}`);
  if (c.prsAwaitingReview)
    parts.push(`${c.prsAwaitingReview} PR${c.prsAwaitingReview === 1 ? '' : 's'} awaiting review`);
  if (c.ciFailing) parts.push(`CI failing on ${c.ciFailing} branch${c.ciFailing === 1 ? '' : 'es'}`);
  if (c.attention) parts.push(`${c.attention} needing attention`);
  return parts.length > 0 ? `${lead}: ${parts.join(', ')}.` : `${lead}: a quiet period — nothing notable recorded.`;
}

export function generateBriefing(period: BriefingPeriod, input: IntelligenceInput): Briefing {
  const range = rangeFor(period, input.now);
  const inRange = (iso: string | null): boolean => !!iso && iso >= range.since && iso <= range.until;
  const grounded = input.entities.length > 0 || input.events.length > 0;

  const completed = input.entities
    .filter((e) => isCompleted(e) && inRange(e.updatedAt))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, CAP)
    .map((e) => item(`${label(e.kind)} completed: ${e.title}`, e, e.updatedAt));

  const inProgress = input.entities
    .filter((e) => isOpenTask(e))
    .sort((a, b) => eventTime(b).localeCompare(eventTime(a)))
    .slice(0, CAP)
    .map((e) => item(`Open task: ${e.title}`, e));

  const upcoming = input.entities
    .filter((e) => isMeetingKind(e) && e.timestamp !== null && e.timestamp > input.now)
    .sort((a, b) => (a.timestamp as string).localeCompare(b.timestamp as string))
    .slice(0, CAP)
    .map((e) => item(`Upcoming: ${e.title}`, e, e.timestamp));

  const meetings = input.entities
    .filter((e) => isMeetingKind(e) && inRange(eventTime(e)) && (e.timestamp === null || e.timestamp <= input.now))
    .sort((a, b) => eventTime(b).localeCompare(eventTime(a)))
    .slice(0, CAP)
    .map((e) => item(`Meeting: ${e.title}`, e, eventTime(e)));

  const documents = input.entities
    .filter((e) => e.kind === 'document' && inRange(e.updatedAt))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, CAP)
    .map((e) => item(`Document: ${e.title}`, e, e.updatedAt));

  const evInRange = input.events.filter((ev) => inRange(ev.at));
  const byCat = new Map<string, { count: number; ids: string[] }>();
  for (const ev of evInRange) {
    let c = byCat.get(ev.category);
    if (!c) byCat.set(ev.category, (c = { count: 0, ids: [] }));
    c.count++;
    if (c.ids.length < 5) c.ids.push(ev.id);
  }
  const activity: BriefingItem[] = [...byCat.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([cat, v]) => ({
      text: `${v.count} ${cat} event${v.count === 1 ? '' : 's'}`,
      detail: null,
      connectorId: null,
      at: null,
      evidence: v.ids.map((id) => ({ kind: 'event', id })),
    }));

  const staleOpen = input.entities
    .filter((e) => isOpenTask(e) && daysBetween(eventTime(e), input.now) > 7)
    .slice(0, 10)
    .map((e) => item(`Stale task (${Math.floor(daysBetween(eventTime(e), input.now))}d): ${e.title}`, e));
  const unread = input.entities
    .filter((e) => e.kind === 'notification' && classifyStatus(e.status) === 'unread')
    .slice(0, 10)
    .map((e) => item(`Unread: ${e.title}`, e));
  const attention = [...staleOpen, ...unread];

  // ─── GitHub health signals (Increment 3) ─────────────────────────────────
  // Turn synced GitHub entities into actionable health: releases shipped, PRs
  // needing review, CI pass/fail, and a synthesized engineering-risk list. Each
  // line stays fully cited; nothing is invented.
  const meta = (e: UnifiedEntity): Record<string, unknown> => e.metadata as Record<string, unknown>;
  const repoOf = (e: UnifiedEntity): string | null => {
    const r = meta(e).repository;
    return typeof r === 'string' ? r : null;
  };
  const ageDays = (e: UnifiedEntity): number => Math.floor(daysBetween(eventTime(e), input.now));
  const reviewersOf = (e: UnifiedEntity): number =>
    typeof meta(e).reviewers === 'number' ? (meta(e).reviewers as number) : 0;

  // Release health — releases newest-first; always show the latest so "last
  // shipped" is visible even when nothing shipped in the window.
  const releaseEntities = input.entities
    .filter((e) => e.kind === 'activity' && meta(e).activityKind === 'release' && meta(e).draft !== true)
    .sort((a, b) => eventTime(b).localeCompare(eventTime(a)));
  const releasesInRange = releaseEntities.filter((e) => inRange(eventTime(e)));
  const releaseShown = releasesInRange.length > 0 ? releasesInRange.slice(0, CAP) : releaseEntities.slice(0, 1);
  const releaseHealth = releaseShown.map((e) => {
    const tag = typeof meta(e).tag === 'string' ? (meta(e).tag as string) : e.title;
    const repo = repoOf(e);
    const pre = meta(e).prerelease === true ? ' (pre-release)' : '';
    return item(`Released ${tag}${pre}${repo ? ` · ${repo}` : ''} — ${ageDays(e)}d ago`, e, eventTime(e));
  });

  // PR health — open PRs oldest-first (most stale first); awaiting-review when
  // reviewers were requested, drafts called out separately.
  const openPrs = input.entities
    .filter((e) => e.kind === 'task' && meta(e).isPullRequest === true && classifyStatus(e.status) !== 'completed')
    .sort((a, b) => eventTime(a).localeCompare(eventTime(b)));
  const prHealth = openPrs.slice(0, CAP).map((e) => {
    const repo = repoOf(e);
    const lead = meta(e).draft === true ? 'Draft PR' : reviewersOf(e) > 0 ? 'PR awaiting review' : 'Open PR';
    return item(`${lead} (${ageDays(e)}d): ${e.title}${repo ? ` · ${repo}` : ''}`, e, eventTime(e));
  });
  const prsAwaitingReview = openPrs.filter((e) => meta(e).draft !== true && reviewersOf(e) > 0);

  // CI health — recent runs grouped by repo@branch, surfacing failing lanes.
  const ciRuns = input.entities.filter((e) => e.kind === 'activity' && meta(e).activityKind === 'ci_run');
  const ciInRange = ciRuns.filter((e) => inRange(eventTime(e)));
  const ciScope = ciInRange.length > 0 ? ciInRange : ciRuns;
  const ciByLane = new Map<string, { total: number; failed: number; failures: UnifiedEntity[]; latest: string }>();
  for (const e of ciScope) {
    const branch = typeof meta(e).branch === 'string' ? (meta(e).branch as string) : 'unknown';
    const lane = `${repoOf(e) ?? 'repo'}@${branch}`;
    let g = ciByLane.get(lane);
    if (!g) ciByLane.set(lane, (g = { total: 0, failed: 0, failures: [], latest: '' }));
    const conclusion = meta(e).conclusion;
    if (conclusion === 'success' || conclusion === 'failure') {
      g.total++;
      if (conclusion === 'failure') {
        g.failed++;
        if (g.failures.length < 5) g.failures.push(e);
      }
    }
    const t = eventTime(e);
    if (t > g.latest) g.latest = t;
  }
  const failingLanes = [...ciByLane.entries()]
    .filter(([, g]) => g.failed > 0)
    .sort((a, b) => b[1].failed - a[1].failed);
  const ciHealth: BriefingItem[] = failingLanes.slice(0, CAP).map(([lane, g]) => ({
    text: `CI failing: ${lane} — ${g.failed}/${g.total} recent runs failed`,
    detail: null,
    connectorId: g.failures[0]?.connectorId ?? null,
    at: g.latest || null,
    evidence: g.failures.map((e) => ({ kind: e.kind, id: e.id })),
  }));

  // Engineering risk — a prioritized synthesis across the signals above.
  const STALE_PR_DAYS = 3;
  const STALE_ISSUE_DAYS = 14;
  const stalePrs = prsAwaitingReview.filter((e) => ageDays(e) > STALE_PR_DAYS);
  const staleIssues = input.entities.filter(
    (e) =>
      e.kind === 'task' &&
      meta(e).isPullRequest !== true &&
      isOpenTask(e) &&
      daysBetween(eventTime(e), input.now) > STALE_ISSUE_DAYS,
  );
  const engineeringRisk: BriefingItem[] = [];
  if (stalePrs.length > 0) {
    engineeringRisk.push({
      text: `${stalePrs.length} pull request${stalePrs.length === 1 ? '' : 's'} awaiting review for >${STALE_PR_DAYS}d`,
      detail: null,
      connectorId: stalePrs[0]?.connectorId ?? null,
      at: null,
      evidence: stalePrs.slice(0, 5).map((e) => ({ kind: e.kind, id: e.id })),
    });
  }
  for (const [lane, g] of failingLanes) {
    engineeringRisk.push({
      text: `CI unstable on ${lane} (${g.failed} recent failure${g.failed === 1 ? '' : 's'})`,
      detail: null,
      connectorId: g.failures[0]?.connectorId ?? null,
      at: g.latest || null,
      evidence: g.failures.map((e) => ({ kind: e.kind, id: e.id })),
    });
  }
  if (staleIssues.length > 0) {
    engineeringRisk.push({
      text: `${staleIssues.length} open issue${staleIssues.length === 1 ? '' : 's'} stale for >${STALE_ISSUE_DAYS}d`,
      detail: null,
      connectorId: staleIssues[0]?.connectorId ?? null,
      at: null,
      evidence: staleIssues.slice(0, 5).map((e) => ({ kind: e.kind, id: e.id })),
    });
  }

  const sections: BriefingSection[] = [
    section('engineering_risk', 'Engineering risk', engineeringRisk),
    section('release_health', 'Release health', releaseHealth),
    section('pr_health', 'Pull requests', prHealth),
    section('ci_health', 'CI health', ciHealth),
    section('completed', period === 'morning' ? 'Recently completed' : 'Completed', completed),
    section('in_progress', 'In progress', inProgress),
    section('upcoming', 'Upcoming', upcoming),
    section('meetings', 'Meetings', meetings),
    section('documents', 'Documents', documents),
    section('activity', 'Activity', activity),
    section('attention', 'Needs attention', attention),
  ];

  const evidenceCount = sections.reduce(
    (n, s) => n + s.items.reduce((m, i) => m + i.evidence.length, 0),
    0,
  );

  const headline = grounded
    ? buildHeadline(period, {
        completed: completed.length,
        inProgress: inProgress.length,
        upcoming: upcoming.length,
        meetings: meetings.length,
        attention: attention.length,
        releases: releasesInRange.length,
        prsAwaitingReview: prsAwaitingReview.length,
        ciFailing: failingLanes.length,
      })
    : 'No connected data yet — connect an account to receive grounded briefings.';

  return { period, generatedAt: input.now, range, headline, sections, evidenceCount, grounded };
}
