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
  /** One-glance executive summary (V3.2). */
  executiveSummary?: ExecutiveSummary;
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
