/**
 * Phase 6 Stage 5 — Work Hub: the PURE view-model.
 *
 * The Work Hub is the personal-workday surface (D-1): Today + My Work +
 * Executive tabs composed ENTIRELY from feeds that already exist (briefing
 * generator, recommendation engine, notification inbox, workforce jobs,
 * assistant conversations/tasks, UDM entities, ExecuteEngine history, the
 * executive snapshot). Following the house `*Model.ts` convention: every export
 * is a pure projection over already-loaded data — no I/O, no React, no IPC.
 *
 * Positioning (locked in sections.ts): Mission Control = organizational
 * operations landing · Today's Intent = strategy outcomes · Work Hub = YOUR day.
 *
 * Honesty contract (the Stage 2 tile contract): every tile is one of
 * loading | ready | unavailable(reason); an empty feed renders an explicit
 * empty state; nothing is fabricated. The Productivity Timeline (approved
 * addition #1) and the descriptive Work Summary (addition #2) are chronological
 * / aggregate COMPOSITIONS of existing records — no new execution infrastructure.
 */
import type {
  AssistantConversationSummary,
  Briefing,
  ExecutionSession,
  ExecutiveSnapshot,
  InboxNotification,
  InsightDashboard,
  Recommendation,
  UnifiedEntity,
} from '@neuropause/shared';
import type { SectionId } from '../shell/sections';

/* ── The tile contract ───────────────────────────────────────────────────── */

export type TileState<T> =
  | { state: 'loading' }
  | { state: 'ready'; data: T }
  | { state: 'unavailable'; reason: string };

export const tileLoading = <T,>(): TileState<T> => ({ state: 'loading' });
export const tileReady = <T,>(data: T): TileState<T> => ({ state: 'ready', data });
export const tileUnavailable = <T,>(reason: string): TileState<T> => ({
  state: 'unavailable',
  reason,
});

/** Wrap an async loader into the tile contract (per-source independent settle). */
export async function settleTile<T>(load: () => Promise<T>): Promise<TileState<T>> {
  try {
    return tileReady(await load());
  } catch (err) {
    return tileUnavailable(err instanceof Error ? err.message : String(err));
  }
}

/* ── Tabs ────────────────────────────────────────────────────────────────── */

export type HubTabId = 'today' | 'my-work' | 'executive';

export const HUB_TABS: { id: HubTabId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'my-work', label: 'My Work' },
  { id: 'executive', label: 'Executive' },
];

/* ── Deep links (notification → existing section; reuse, no new routes) ──── */

const DEEP_LINK_SECTIONS: Record<string, SectionId> = {
  hub: 'hub',
  workforce: 'workforce',
  connections: 'connectors',
  automations: 'automation-center',
  'mission-control': 'mission-control',
  'enterprise/briefings': 'intelligence',
  // Phase 6 Stage 6 — insight items land in the Intelligence workspace.
  intelligence: 'intelligence',
  // Phase 6 Stage 7 — knowledge-hygiene items land in the Knowledge workspace.
  knowledge: 'knowledge',
  assistant: 'assistant',
  search: 'search',
  notifications: 'notifications',
};

/** Resolve a notification deep link to an EXISTING section (null = no nav). */
export function sectionForDeepLink(deepLink: string | null): SectionId | null {
  if (!deepLink) return null;
  return DEEP_LINK_SECTIONS[deepLink] ?? null;
}

/** Human label for a notification source key. Unknown keys read as-is. */
export function sourceLabel(sourceKey: string): string {
  const LABELS: Record<string, string> = {
    'mission-brief-morning': 'Morning Brief',
    'mission-brief-evening': 'Evening Summary',
    'work-afternoon': 'Afternoon Update',
    'work-weekly': 'Weekly Brief',
    'work-monthly': 'Monthly Summary',
    'founder-proactive': 'Founder AI',
    'org-intelligence': 'Org Intelligence',
    'approval-needed': 'Approvals',
    'work-complete': 'Work Complete',
    'work-failed': 'Work Failed',
    'connector-issue': 'Connectors',
    'risk-signal': 'Risk',
    'meeting-soon': 'Meetings',
    'insight-monitor': 'Intelligence Monitor',
    'insight-risk-trend': 'Risk Trend',
    'knowledge-hygiene': 'Knowledge Hygiene',
    'automation-watch': 'Automation Watch',
    'operations-watch': 'Operations Watch',
    system: 'System',
  };
  return LABELS[sourceKey] ?? sourceKey;
}

/* ── Today: which brief fits this hour ───────────────────────────────────── */

/** Deterministic period pick for the Today brief tile (local hour). */
export function briefPeriodForHour(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour < 13) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

/* ── Today: meetings ─────────────────────────────────────────────────────── */

export interface MeetingRow {
  id: string;
  title: string;
  startsAt: string;
  organizer: string | null;
  /** Assistant hand-off text for the Prepare action (D-4). */
  prepareQuery: string;
}

/** Calendar entities that start today (from `nowIso` on), soonest first. */
export function meetingsToday(entities: UnifiedEntity[], nowIso: string, limit = 8): MeetingRow[] {
  const day = nowIso.slice(0, 10);
  return entities
    .filter(
      (e) =>
        (e.kind === 'calendar_event' || e.kind === 'event') &&
        e.timestamp !== null &&
        e.timestamp.slice(0, 10) === day &&
        e.timestamp >= nowIso,
    )
    .sort((a, b) => (a.timestamp as string).localeCompare(b.timestamp as string))
    .slice(0, limit)
    .map((e) => ({
      id: e.id,
      title: e.title,
      startsAt: e.timestamp as string,
      organizer: e.author,
      prepareQuery: `prepare me for the meeting ${e.title}`,
    }));
}

/* ── My Work: the task board (D-3 — sources never conflated) ─────────────── */

export interface AssistantTaskRow {
  id: string;
  title: string;
  status: string;
  due: string | null;
  priority: string;
}

export interface ConnectorTaskRow {
  id: string;
  title: string;
  connectorId: string;
  status: string | null;
}

export interface TaskBoard {
  /** Tasks the assistant recorded (memory-store lens). */
  assistant: AssistantTaskRow[];
  /** Open tasks synced from connected systems (UDM). */
  connector: ConnectorTaskRow[];
}

const OPEN_TASK_STATES = new Set(['open', 'in_progress', 'todo', 'notstarted', 'not_started', 'active']);

export function taskBoard(
  assistantTasks: AssistantTaskRow[],
  entities: UnifiedEntity[],
  limit = 12,
): TaskBoard {
  const connector = entities
    .filter((e) => {
      if (e.kind !== 'task') return false;
      const s = (e.status ?? '').toLowerCase().replace(/[\s-]/g, '_');
      return s === '' || OPEN_TASK_STATES.has(s) || (!s.includes('done') && !s.includes('complete') && !s.includes('closed') && !s.includes('cancel'));
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
    .map((e) => ({ id: e.id, title: e.title, connectorId: e.connectorId, status: e.status }));
  const assistant = assistantTasks
    .filter((t) => t.status !== 'done')
    .sort((a, b) => {
      if ((a.due === null) !== (b.due === null)) return a.due === null ? 1 : -1;
      if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
      return a.priority === b.priority ? 0 : a.priority === 'high' ? -1 : 1;
    })
    .slice(0, limit);
  return { assistant, connector };
}

/* ── My Work: email prioritization (D-5 — deterministic, no send path) ───── */

export interface EmailRow {
  id: string;
  title: string;
  author: string | null;
  at: string;
  unread: boolean;
  /** Deterministic category from existing labels/kind — never invented. */
  category: 'important' | 'unread' | 'recent';
  /** Why it ranked here (explainability on the card). */
  why: string;
}

/**
 * D-5 prioritization: unread first → then recency → sender frequency as the
 * tie-break signal ("important" = unread from a frequent sender or flagged by
 * an existing label). Pure and deterministic; sending stays impossible here.
 */
export function prioritizeEmails(entities: UnifiedEntity[], nowIso: string, limit = 10): EmailRow[] {
  const messages = entities.filter((e) => e.kind === 'message');
  const bySender = new Map<string, number>();
  for (const m of messages) {
    if (m.author) bySender.set(m.author, (bySender.get(m.author) ?? 0) + 1);
  }
  const rows = messages
    .map((m) => {
      const unread = (m.status ?? '').toLowerCase() === 'unread';
      const senderCount = m.author ? (bySender.get(m.author) ?? 0) : 0;
      const flagged = m.labels.some((l) => /important|flagged|urgent/i.test(l));
      const at = m.timestamp ?? m.updatedAt;
      const ageDays = Math.max(0, (Date.parse(nowIso) - Date.parse(at)) / 86_400_000);
      const score = (unread ? 100 : 0) + (flagged ? 40 : 0) + Math.min(senderCount, 10) * 2 + Math.max(0, 30 - ageDays);
      const category: EmailRow['category'] = flagged || (unread && senderCount >= 3) ? 'important' : unread ? 'unread' : 'recent';
      const why = [
        unread ? 'unread' : null,
        flagged ? 'flagged by a label' : null,
        senderCount >= 3 && m.author ? `frequent sender (${senderCount} messages)` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return { row: { id: m.id, title: m.title, author: m.author, at, unread, category, why: why || 'recent' }, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.row);
  return rows;
}

/* ── Recommendations (D-7 — explainability on every card) ────────────────── */

export interface RecommendationCard {
  id: string;
  kind: string;
  title: string;
  rationale: string;
  priority: string;
  suggestedAction: string | null;
  affectedSystems: string[];
  confidence: number | null;
  evidenceCount: number;
}

export function recommendationCards(recs: Recommendation[], limit = 8): RecommendationCard[] {
  return recs.slice(0, limit).map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    rationale: r.rationale,
    priority: r.priority,
    suggestedAction: r.suggestedAction ?? null,
    affectedSystems: r.affectedSystems ?? [],
    confidence: r.confidence ?? null,
    evidenceCount: r.evidence.length,
  }));
}

/* ── Today: the brief tile ───────────────────────────────────────────────── */

export interface BriefDisplay {
  headline: string;
  grounded: boolean;
  sections: { title: string; lines: string[] }[];
}

export function briefDisplay(briefing: Briefing, maxPerSection = 4): BriefDisplay {
  return {
    headline: briefing.headline,
    grounded: briefing.grounded,
    sections: briefing.sections
      .filter((s) => !s.empty && s.items.length > 0)
      .map((s) => ({
        title: s.title,
        lines: s.items.slice(0, maxPerSection).map((it) => it.text),
      })),
  };
}

/* ── Productivity Timeline (approved addition #1) ────────────────────────── */

export type TimelineEntryKind =
  | 'conversation'
  | 'execution'
  | 'approval'
  | 'notification'
  | 'briefing';

export interface ProductivityTimelineEntry {
  at: string;
  kind: TimelineEntryKind;
  title: string;
  detail: string | null;
  section: SectionId | null;
}

export interface ProductivityTimelineInputs {
  conversations: AssistantConversationSummary[];
  executions: ExecutionSession[];
  /** Workforce jobs awaiting approval (composed as 'approval' entries). */
  pendingApprovals: { id: string; title: string; createdAt: string }[];
  notifications: InboxNotification[];
}

const BRIEF_SOURCES = new Set([
  'mission-brief-morning',
  'mission-brief-evening',
  'work-afternoon',
  'work-weekly',
  'work-monthly',
]);

/**
 * Compose the chronological Productivity Timeline from EXISTING records:
 * conversations, execution sessions, approvals, notifications, and delivered
 * briefings (which arrive as inbox items from the brief sources). Pure merge +
 * sort — no new execution infrastructure, no synthesis.
 */
export function composeProductivityTimeline(
  i: ProductivityTimelineInputs,
  limit = 30,
): ProductivityTimelineEntry[] {
  const entries: ProductivityTimelineEntry[] = [];
  for (const c of i.conversations) {
    entries.push({
      at: c.updatedAt,
      kind: 'conversation',
      title: c.title,
      detail:
        (c.waitingSteps ?? 0) > 0
          ? `${c.waitingSteps} step(s) waiting for your decision`
          : `${c.messageCount} message(s)`,
      section: 'assistant',
    });
  }
  for (const s of i.executions) {
    entries.push({
      at: s.startedAt,
      kind: 'execution',
      title: s.label,
      detail: s.state + (s.resultSummary ? ` — ${s.resultSummary}` : ''),
      section: 'operations',
    });
  }
  for (const a of i.pendingApprovals) {
    entries.push({
      at: a.createdAt,
      kind: 'approval',
      title: `Awaiting approval: ${a.title}`,
      detail: null,
      section: 'workforce',
    });
  }
  for (const n of i.notifications) {
    entries.push({
      at: n.at,
      kind: BRIEF_SOURCES.has(n.sourceKey) ? 'briefing' : 'notification',
      title: n.title,
      detail: sourceLabel(n.sourceKey),
      section: sectionForDeepLink(n.deepLink),
    });
  }
  entries.sort((a, b) => b.at.localeCompare(a.at));
  return entries.slice(0, limit);
}

/* ── Executive tab (D-6 — composed from the EXISTING snapshot) ───────────── */

export interface ExecHighlight {
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'bad' | 'neutral';
  detail: string | null;
}

export function execHighlights(s: ExecutiveSnapshot): ExecHighlight[] {
  const out: ExecHighlight[] = [];
  out.push({
    label: 'Org health',
    value: `${Math.round(s.organization.healthScore * 100)}%`,
    tone: s.organization.healthScore >= 0.7 ? 'ok' : s.organization.healthScore >= 0.4 ? 'warn' : 'bad',
    detail: s.organization.healthLabel,
  });
  out.push({
    label: 'Workforce',
    value: `${s.workforce.running} running / ${s.workforce.total}`,
    tone: s.workforce.unhealthy > 0 ? 'bad' : s.workforce.degraded > 0 ? 'warn' : 'ok',
    detail: `${s.workforce.jobsRun} job(s) run · ${Math.round(s.workforce.successRate * 100)}% success`,
  });
  const oldestDays =
    s.approvals.oldestPendingAgeMs !== null
      ? Math.floor(s.approvals.oldestPendingAgeMs / 86_400_000)
      : null;
  out.push({
    label: 'Approvals',
    value: `${s.approvals.pending} pending`,
    tone: s.approvals.pending === 0 ? 'ok' : oldestDays !== null && oldestDays >= 2 ? 'bad' : 'warn',
    detail:
      oldestDays !== null
        ? `oldest waiting ${oldestDays === 0 ? '<1 day' : `${oldestDays} day(s)`}`
        : null,
  });
  out.push({
    label: 'Risk',
    value: s.risk.level,
    tone: s.risk.level === 'low' ? 'ok' : s.risk.level === 'elevated' ? 'warn' : 'bad',
    detail: `${s.risk.openFindings} open finding(s)${s.risk.criticalFindings > 0 ? `, ${s.risk.criticalFindings} critical` : ''}`,
  });
  out.push({
    label: 'Activity',
    value: `${s.activity.recentEvents} events (24h)`,
    tone: 'neutral',
    detail: `${s.activity.projects} project(s) · ${s.activity.tasks} task(s) · ${s.activity.documents} doc(s)`,
  });
  out.push({
    label: 'Operations',
    value: `${s.operations.connectedAccounts} account(s)`,
    tone: 'neutral',
    detail: `${s.operations.connectors} connector(s) · ${s.operations.installedApps} app(s)`,
  });
  return out;
}

/* ── Work Summary tile (approved addition #2 — descriptive, never a score) ── */

export interface HubWorkSummaryInputs {
  nowIso: string;
  assistantTasks: AssistantTaskRow[];
  /** UDM task entities (completed-today detection). */
  entities: UnifiedEntity[];
  executions: ExecutionSession[];
  conversations: AssistantConversationSummary[];
  pendingApprovals: number;
  meetingsToday: number;
}

export interface WorkSummaryTile {
  grounded: boolean;
  sections: { title: string; lines: string[] }[];
}

const DONE_RE = /done|complete|closed|resolved/i;

/**
 * The Hub's descriptive daily Work Summary — an aggregation of records the Hub
 * already loaded (tasks, executions, conversations, approvals, meetings). Same
 * honesty contract as the assistant's work-summary flow: only what happened,
 * no score, empty day ⇒ grounded:false.
 */
export function workSummaryTile(i: HubWorkSummaryInputs): WorkSummaryTile {
  const day = i.nowIso.slice(0, 10);
  const sections: WorkSummaryTile['sections'] = [];

  const connectorDone = i.entities.filter(
    (e) => e.kind === 'task' && DONE_RE.test(e.status ?? '') && e.updatedAt.slice(0, 10) === day,
  );
  const executionsToday = i.executions.filter((s) => s.startedAt.slice(0, 10) === day);
  const executionsDone = executionsToday.filter((s) => s.state === 'completed');
  const executionsFailed = executionsToday.filter((s) => s.state === 'failed');
  const conversationsToday = i.conversations.filter((c) => c.updatedAt.slice(0, 10) === day);
  const openAssistant = i.assistantTasks.filter((t) => t.status !== 'done');

  const completed: string[] = [];
  if (connectorDone.length > 0)
    completed.push(`${connectorDone.length} task(s) completed in connected systems.`);
  if (executionsDone.length > 0) completed.push(`${executionsDone.length} execution(s) completed.`);
  if (completed.length > 0) sections.push({ title: 'Completed today', lines: completed });

  if (i.meetingsToday > 0)
    sections.push({ title: 'Meetings', lines: [`${i.meetingsToday} meeting(s) on today's calendar.`] });

  if (conversationsToday.length > 0)
    sections.push({
      title: 'AI assistance',
      lines: [`${conversationsToday.length} assistant conversation(s) active today.`],
    });

  const open: string[] = [];
  if (i.pendingApprovals > 0) open.push(`${i.pendingApprovals} proposal(s) waiting for approval.`);
  if (openAssistant.length > 0) open.push(`${openAssistant.length} assistant task(s) still open.`);
  if (open.length > 0) sections.push({ title: 'Still open', lines: open });

  if (executionsFailed.length > 0)
    sections.push({
      title: 'Risks & blockers',
      lines: [`${executionsFailed.length} execution(s) failed today.`],
    });

  return { grounded: sections.length > 0, sections };
}

/* ── Notifications tile ──────────────────────────────────────────────────── */

export interface NotificationRowModel {
  id: string;
  title: string;
  body: string;
  at: string;
  read: boolean;
  priority: InboxNotification['priority'];
  source: string;
  section: SectionId | null;
}

export function notificationRows(items: InboxNotification[], limit = 20): NotificationRowModel[] {
  return items.slice(0, limit).map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    at: n.at,
    read: n.read,
    priority: n.priority,
    source: sourceLabel(n.sourceKey),
    section: sectionForDeepLink(n.deepLink),
  }));
}

/* ── Phase 6 Stage 6 — Executive intelligence tile (pure projection) ─────── */

export interface InsightTileModel {
  /** "82/100 (healthy)" or "unavailable" when nothing could be scored. */
  healthText: string;
  band: 'healthy' | 'watch' | 'at-risk' | 'critical' | 'unknown';
  tone: 'ok' | 'warn' | 'bad' | 'muted';
  openIncidents: number;
  predictions: number;
  /** Highest-ranked recommendation title, or null. */
  topRecommendation: string | null;
  /** Recommendations whose underlying condition verifiably cleared. */
  recentlyVerified: number;
  /** Signals available / total (the honesty strip). */
  signalsText: string;
  confidencePct: number;
}

/** Project the insight dashboard into the Hub's Executive tile. Pure. */
export function insightTile(d: InsightDashboard): InsightTileModel {
  const band = d.health.band;
  const tone = band === 'healthy' ? 'ok' : band === 'watch' ? 'warn' : band === 'unknown' ? 'muted' : 'bad';
  const available = d.signals.filter((s) => s.available).length;
  return {
    healthText: d.health.overall == null ? 'unavailable' : `${d.health.overall}/100 (${band})`,
    band,
    tone,
    openIncidents: d.activeIncidents.length,
    predictions: d.predictions.length,
    topRecommendation: d.recommendations[0]?.title ?? null,
    recentlyVerified: d.recentlyVerified.length,
    signalsText: `${available}/${d.signals.length} signals`,
    confidencePct: Math.round(d.confidence.overall * 100),
  };
}
