/**
 * Executive Intelligence Center (V2.4) — shared types.
 *
 * A PRESENTATION/COMPOSITION layer over existing intelligence. The snapshot below
 * is assembled from capabilities that already exist (Mission Brief, Founder AI
 * proactive, Organization Intelligence, org-health KPIs, timeline). It introduces
 * NO new intelligence — it is the shape the executive dashboard renders, and every
 * card carries a `deepLink` back to the existing detail page (no duplicated views).
 */
import type { IntelligenceItem } from './delivery';
import type { OrgHealthScores } from './orgHealth';
import type { EnterpriseInsights } from './enterpriseIntelligence';

/** A KPI with a value, a qualitative band, and a trend indicator. */
export interface ExecutiveKpi {
  key: string;
  label: string;
  /** Numeric 0..100 where applicable, or null when the metric is a status/string. */
  value: number | null;
  /** Human-readable value (e.g. "valid", "3 connectors"). */
  display: string;
  band?: 'healthy' | 'watch' | 'at-risk' | 'critical';
  trend?: 'up' | 'down' | 'flat';
  /** Where clicking the KPI navigates in the existing app. */
  deepLink?: string;
}

/** One card in the Center. Items are existing IntelligenceItems; detail lives elsewhere. */
/** A weekly trend delta for a metric (STEP 3 — Weekly Trends). */
export interface ExecutiveTrend {
  key: string;
  label: string;
  current: number;
  previous: number;
  /** current - previous. */
  delta: number;
  direction: 'up' | 'down' | 'flat';
}

/** A rich 30-day trend for a metric (V3.1 — Monthly Executive Trends). */
export interface MonthlyTrend {
  key: string;
  label: string;
  current: number;
  /** Value ~30 days ago (closest available). */
  monthAgo: number;
  delta: number;
  /** Percentage change vs monthAgo (0 when monthAgo is 0). */
  percentChange: number;
  direction: 'up' | 'down' | 'flat';
  /** Mean over the window. */
  movingAverage: number;
  highest: number;
  lowest: number;
  /** 'stable' | 'volatile' — based on spread around the average. */
  stability: 'stable' | 'volatile';
  /** Ordered oldest→newest values for a sparkline. */
  sparkline: number[];
  /** 'low' | 'medium' | 'high' — grows with the number of datapoints. */
  confidence: 'low' | 'medium' | 'high';
}

export interface ExecutiveCard {
  key: string;
  title: string;
  /** Governance-complete items already produced by existing sources. */
  items: IntelligenceItem[];
  /** Deep-link to the existing page that owns this data. */
  deepLink: string;
  /** Optional one-line summary for the card header. */
  summary?: string;
}

/** The full executive snapshot the dashboard renders. */
export interface ExecutiveCenterSnapshot {
  generatedAt: string;
  /** KPI strip (STEP 4) — all reuse existing calculations. */
  kpis: ExecutiveKpi[];
  /** Raw org-health sub-scores, for the health cards. */
  orgHealth: OrgHealthScores;
  /** Section cards (STEP 2). */
  criticalAlerts: ExecutiveCard;
  founderRecommendations: ExecutiveCard;
  organizationHealth: ExecutiveCard;
  engineeringHealth: ExecutiveCard;
  upcomingPriorities: ExecutiveCard;
  /** V2.9 completion cards (STEP 3). Optional so older callers still typecheck. */
  executiveTimeline?: ExecutiveCard;
  recentDecisions?: ExecutiveCard;
  recentDeliveries?: ExecutiveCard;
  evidenceSummary?: ExecutiveCard;
  /** Weekly trend deltas for the KPI-style header (STEP 3). */
  weeklyTrends?: ExecutiveTrend[];
  /** Rich 30-day trends per metric (V3.1). */
  monthlyTrends?: MonthlyTrend[];
  /** Ranked executive recommendations (V3.2). */
  recommendations?: ExecutiveRecommendation[];
  /** Enterprise insights snapshot (V8.5). */
  enterprise?: EnterpriseInsights;
  /** One-glance executive summary (V3.2). */
  executiveSummary?: ExecutiveSummary;
  /** Executive decisions overview (V3.3). */
  decisions?: DecisionSummaryView;
  /** Unified executive event stream (V3.8): decisions + org + delivery + recs. */
  unifiedTimeline?: ExecutiveTimelineEntry[];
  /** Aggregate AI-workforce health (V8.1). */
  workforceHealth?: WorkforceHealthSummary;
  /** Count of items by priority, for the "what requires attention" glance. */
  attentionCounts: { critical: number; high: number; normal: number };
}

/** Priority tier for an executive recommendation (V3.2). */
export type ExecRecoPriority = 'critical' | 'high' | 'medium' | 'low';

/** Lifecycle status of a recommendation. */
export type ExecRecoStatus = 'open' | 'acknowledged' | 'resolved';

/**
 * An executive recommendation (V3.2) — the decision-support unit. Composed purely
 * from existing snapshot data (org-health scores, trends, governance-bearing
 * items); it explains a KPI rather than producing new intelligence.
 */
export interface ExecutiveRecommendation {
  id: string;
  /** The KPI/metric this concerns (e.g. 'engineering', 'license', 'adoption'). */
  metric: string;
  /** Icon name (NPDS IconName). */
  icon: string;
  /** What changed / the problem, in one line. */
  problem: string;
  /** Business impact statement. */
  businessImpact: string;
  /** Why it changed / root cause. */
  rootCause: string;
  priority: ExecRecoPriority;
  /** 0..1 confidence in the recommendation. */
  confidence: number;
  /** What resolving it is expected to achieve. */
  expectedOutcome: string;
  /** Evidence references backing the recommendation. */
  evidence: string[];
  /** Systems the evidence came from. */
  sourceSystems: string[];
  /** The recommended action. */
  recommendedAction: string;
  /** Suggested owner role. */
  owner: string;
  /** Rough ETA label (e.g. 'today', 'this week'). */
  eta: string;
  status: ExecRecoStatus;
  /** Composite ranking score (higher = more urgent). Internal, for ordering. */
  score: number;
}

/** One-glance executive summary derived from the recommendations + snapshot (V3.2). */
export interface ExecutiveSummary {
  topOpportunity: string;
  topRisk: string;
  topWin: string;
  topLoss: string;
  topRecommendation: string;
  /** 0..100 composite executive score (org health tempered by open critical risks). */
  executiveScore: number;
}

/** Executive decision category (V3.3). */
export type DecisionCategory =
  'engineering' | 'organization' | 'governance' | 'operations' | 'growth' | 'other';

/** Decision lifecycle status (V3.3). */
export type DecisionStatus =
  | 'draft'
  | 'suggested'
  | 'accepted'
  | 'in_progress'
  | 'blocked'
  | 'completed'
  | 'rejected'
  | 'archived';

/** A single decision history event (V3.6). */
export interface DecisionEvent {
  /** ISO timestamp of the event. */
  at: string;
  /** Who caused it (role/name or 'system'). */
  actor: string;
  /** Machine event kind. */
  kind:
    'created' | 'owner_assigned' | 'status_changed' | 'due_set' | 'blocked' | 'resumed' | 'note';
  previousState?: DecisionStatus;
  newState?: DecisionStatus;
  /** Optional human-readable reason/detail. */
  reason?: string;
}

/** Decision priority tier (reuses the exec priority vocabulary). */
export type DecisionPriority = ExecRecoPriority;

/**
 * A first-class executive decision (V3.3). Persisted, lifecycle-tracked, and
 * traceable back to the recommendation it originated from (if any). Reuses the
 * recommendation vocabulary rather than inventing a parallel model.
 */
export interface ExecutiveDecision {
  id: string;
  title: string;
  category: DecisionCategory;
  description: string;
  reasoning: string;
  evidence: string[];
  sourceSystems: string[];
  /** 0..1 confidence. */
  confidence: number;
  businessImpact: string;
  expectedOutcome: string;
  owner: string;
  priority: DecisionPriority;
  status: DecisionStatus;
  /** ISO created timestamp. */
  createdAt: string;
  /** ISO last-updated timestamp. */
  updatedAt: string;
  /** Back-reference to the originating recommendation id, for traceability. */
  fromRecommendationId?: string;
  // ── V3.6 additions (all optional → backward compatible) ──
  /** Who assigned the owner (role/name). */
  assignedBy?: string;
  /** ISO due date. */
  dueDate?: string;
  /** Why the decision is blocked (set when status === 'blocked'). */
  blockedReason?: string;
  /** ISO completion timestamp. */
  completedAt?: string;
  /** ISO archival timestamp. */
  archivedAt?: string;
  /** Append-only status/assignment history. */
  history?: DecisionEvent[];
  /** Related recommendation ids beyond the originating one. */
  relatedRecommendations?: string[];
  /** Related metric keys. */
  relatedMetrics?: string[];
}

/** Compact decision view for the Executive Center section (V3.3; V3.6 counts). */
export interface DecisionSummaryView {
  total: number;
  pending: number;
  accepted: number;
  completed: number;
  rejected: number;
  /** V3.6: decisions past their due date and not completed/archived. */
  overdue: number;
  /** V3.6: decisions currently blocked. */
  blocked: number;
  /** V3.6: active decisions with no update for a long time. */
  stale: number;
  /** The most impactful recent decisions, ranked. */
  top: ExecutiveDecision[];
}

/**
 * The primary "next step" transition for a decision, for a one-click CTA on the
 * card (V3.5). Pure + shared so main and renderer agree. Returns null when the
 * decision is terminal (only archival remains, offered as a secondary action).
 */
export function primaryNextStatus(status: DecisionStatus): {
  to: DecisionStatus;
  label: string;
} | null {
  switch (status) {
    case 'draft':
    case 'suggested':
      return { to: 'accepted', label: 'Accept' };
    case 'accepted':
      return { to: 'in_progress', label: 'Start' };
    case 'in_progress':
      return { to: 'completed', label: 'Complete' };
    case 'blocked':
      return { to: 'in_progress', label: 'Resume' };
    default:
      return null; // completed / rejected / archived → no forward step
  }
}

/** Active (non-terminal) statuses for overdue/stale checks (V3.6). */
const ACTIVE_STATUSES: DecisionStatus[] = [
  'draft',
  'suggested',
  'accepted',
  'in_progress',
  'blocked',
];

export function isActiveDecision(d: ExecutiveDecision): boolean {
  return ACTIVE_STATUSES.includes(d.status);
}

/** True if the decision has a due date in the past and is still active (V3.6). */
export function isOverdue(d: ExecutiveDecision, nowMs: number): boolean {
  if (!isActiveDecision(d) || !d.dueDate) return false;
  return Date.parse(d.dueDate) < nowMs;
}

/** True if an active decision hasn't been updated in `staleDays` (V3.6). */
export function isStale(d: ExecutiveDecision, nowMs: number, staleDays = 14): boolean {
  if (!isActiveDecision(d)) return false;
  return nowMs - Date.parse(d.updatedAt) > staleDays * 86_400_000;
}

/**
 * A flattened Executive Timeline entry (V3.7) — one decision history event with
 * enough decision context to render + filter without re-joining. Derived purely
 * from ExecutiveDecision.history[]; no separate persistence.
 */
export interface ExecutiveTimelineEntry {
  /** Stable id: decisionId + event index, or item id. */
  id: string;
  /** ISO timestamp of the event. */
  at: string;
  /** Origin system of the event (V3.8 unified stream). */
  source: 'decision' | 'organization' | 'delivery' | 'recommendation';
  kind: DecisionEvent['kind'] | 'item';
  previousState?: DecisionStatus;
  newState?: DecisionStatus;
  actor: string;
  reason?: string;
  // ── decision context (for filtering + card display) ──
  decisionId?: string;
  title: string;
  category?: DecisionCategory;
  owner: string;
  priority: DecisionPriority;
  status?: DecisionStatus;
  businessImpact: string;
  evidenceCount: number;
  fromRecommendationId?: string;
  /** Deep-link target for the entry, when it originates from an intelligence item. */
  deepLink?: string;
}

/** Human label for a timeline event kind + state transition (V3.7). */
export function timelineEventLabel(e: {
  kind: DecisionEvent['kind'] | 'item';
  newState?: DecisionStatus;
  source?: ExecutiveTimelineEntry['source'];
}): string {
  if (e.kind === 'item') {
    switch (e.source) {
      case 'organization':
        return 'Organization';
      case 'delivery':
        return 'Delivery';
      case 'recommendation':
        return 'Recommendation';
      default:
        return 'Event';
    }
  }
  switch (e.kind) {
    case 'created':
      return 'Decision created';
    case 'owner_assigned':
      return 'Owner assigned';
    case 'due_set':
      return 'Due date set';
    case 'blocked':
      return 'Blocked';
    case 'resumed':
      return 'Resumed';
    case 'note':
      return 'Note added';
    case 'status_changed':
      switch (e.newState) {
        case 'accepted':
          return 'Accepted';
        case 'in_progress':
          return 'Started';
        case 'completed':
          return 'Completed';
        case 'rejected':
          return 'Rejected';
        case 'archived':
          return 'Archived';
        default:
          return 'Status changed';
      }
    default:
      return 'Event';
  }
}

/**
 * Build the Executive Timeline from decisions (V3.7). Flattens every decision's
 * history into chronological entries, newest first. Pure + shared.
 */
export function buildDecisionTimeline(decisions: ExecutiveDecision[]): ExecutiveTimelineEntry[] {
  const entries: ExecutiveTimelineEntry[] = [];
  for (const d of decisions) {
    const history = d.history ?? [];
    history.forEach((ev, i) => {
      entries.push({
        id: `${d.id}#${i}`,
        at: ev.at,
        source: 'decision',
        kind: ev.kind,
        previousState: ev.previousState,
        newState: ev.newState,
        actor: ev.actor,
        reason: ev.reason,
        decisionId: d.id,
        title: d.title,
        category: d.category,
        owner: d.owner,
        priority: d.priority,
        status: d.status,
        businessImpact: d.businessImpact,
        evidenceCount: d.evidence.length,
        fromRecommendationId: d.fromRecommendationId,
      });
    });
  }
  return entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** A lightweight intelligence-item shape the unified builder ingests (V3.8). */
export interface UnifiedItemLite {
  id: string;
  title: string;
  body: string;
  priority: DecisionPriority;
  producedAt: string;
  deepLink?: string;
  owner?: string;
  evidenceCount?: number;
  fromRecommendationId?: string;
}

/**
 * Build the UNIFIED executive event stream (V3.8). Composes decision history with
 * organization / delivery / recommendation intelligence items into ONE
 * chronological stream. Pure; each source's data is passed in (no persistence
 * here). Newest first.
 */
export function buildUnifiedTimeline(input: {
  decisions: ExecutiveDecision[];
  organization?: UnifiedItemLite[];
  delivery?: UnifiedItemLite[];
  recommendations?: UnifiedItemLite[];
}): ExecutiveTimelineEntry[] {
  const entries: ExecutiveTimelineEntry[] = buildDecisionTimeline(input.decisions);

  const mapItems = (
    items: UnifiedItemLite[] | undefined,
    source: 'organization' | 'delivery' | 'recommendation',
  ): void => {
    (items ?? []).forEach((it) => {
      entries.push({
        id: `${source}:${it.id}`,
        at: it.producedAt,
        source,
        kind: 'item',
        actor: 'system',
        reason: it.body,
        title: it.title,
        owner: it.owner ?? 'System',
        priority: it.priority,
        businessImpact: it.body,
        evidenceCount: it.evidenceCount ?? 0,
        fromRecommendationId: it.fromRecommendationId,
        deepLink: it.deepLink,
      });
    });
  };

  mapItems(input.organization, 'organization');
  mapItems(input.delivery, 'delivery');
  mapItems(input.recommendations, 'recommendation');

  return entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** Timeline filter predicate inputs (V3.7). */
export interface TimelineFilter {
  owner?: string;
  priority?: DecisionPriority;
  status?: DecisionStatus;
  /** Free-text over title + owner + label. */
  query?: string;
  /** Only entries at/after this ISO date. */
  since?: string;
}

/** Apply timeline filters purely (V3.7). */
export function filterTimeline(
  entries: ExecutiveTimelineEntry[],
  f: TimelineFilter,
): ExecutiveTimelineEntry[] {
  const q = f.query?.trim().toLowerCase();
  const sinceMs = f.since ? Date.parse(f.since) : undefined;
  return entries.filter((e) => {
    if (f.owner && e.owner !== f.owner) return false;
    if (f.priority && e.priority !== f.priority) return false;
    if (f.status && e.status !== f.status) return false;
    if (sinceMs !== undefined && Date.parse(e.at) < sinceMs) return false;
    if (q) {
      const hay = `${e.title} ${e.owner} ${timelineEventLabel(e)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* --------------------------- Workforce health (V8.1) --------------------------- */

/** Health state of a worker / the workforce overall. Mirrors WorkerHealthState. */
export type WorkforceHealthState = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

/**
 * Aggregate operational health of the AI workforce, rolled up from the worker
 * registry's per-worker health for the Executive Center. Structured data only;
 * introduces no new intelligence.
 */
/** Per-worker health projection the registry exposes for aggregation (V8.1). */
export interface WorkforceHealthInput {
  id: string;
  name: string;
  state: WorkforceHealthState;
  successRate: number;
  jobsRun: number;
  jobsFailed: number;
}

export interface WorkforceHealthSummary {
  totalWorkers: number;
  healthy: number;
  degraded: number;
  unhealthy: number;
  /** Workers with no recorded jobs yet. */
  unknown: number;
  /** Mean success rate across workers that have run jobs, 0..1 (1 when none have). */
  meanSuccessRate: number;
  totalJobsRun: number;
  totalJobsFailed: number;
  /** Overall band, using the registry's own thresholds. */
  state: WorkforceHealthState;
}
