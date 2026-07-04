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
  /** Count of items by priority, for the "what requires attention" glance. */
  attentionCounts: { critical: number; high: number; normal: number };
}
