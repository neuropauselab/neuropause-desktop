/**
 * Companion briefing (Mobile M1-07) — a pure composer for the phone's
 * morning/evening executive brief. It joins three real desktop view-models
 * already trusted elsewhere in the companion: the executive KPI snapshot, the
 * cross-module approvals inbox, and the family record totals. It writes no
 * narrative prose beyond a deterministic headline — this is a summary of real
 * numbers, not an LLM-generated story (the desktop's own briefing generator is
 * connector-data-based and ERP-blind, so it is deliberately NOT used here).
 */
import type {
  CompanionApprovalItem,
  CompanionBriefing,
  CompanionDashboardSnapshot,
  CompanionFamilySummary,
  CompanionKpi,
} from '@neuropause/shared';

/** Rank KPIs so the ones needing attention lead the phone's brief. */
const BAND_RANK: Record<string, number> = { critical: 0, 'at-risk': 1, watch: 2, healthy: 3 };
const kpiRank = (k: CompanionKpi): number => (k.band ? (BAND_RANK[k.band] ?? 4) : 4);
const needsAttention = (k: CompanionKpi): boolean => k.band === 'at-risk' || k.band === 'critical';

/** Deterministic morning/evening split from an ISO timestamp (UTC hour). */
export function resolveBriefingPeriod(nowIso: string): 'morning' | 'evening' {
  const hour = new Date(nowIso).getUTCHours();
  return Number.isNaN(hour) || hour < 12 ? 'morning' : 'evening';
}

export interface CompanionBriefingInput {
  period: 'morning' | 'evening';
  nowIso: string;
  snapshot: CompanionDashboardSnapshot;
  approvals: CompanionApprovalItem[];
  families: CompanionFamilySummary[];
}

/** Compose the executive brief from real desktop state. */
export function buildCompanionBriefing(input: CompanionBriefingInput): CompanionBriefing {
  const { period, nowIso, snapshot, approvals, families } = input;

  const kpis = [...snapshot.kpis].sort((a, b) => kpiRank(a) - kpiRank(b)).slice(0, 4);
  const attention = snapshot.kpis.filter(needsAttention).length;
  const pendingApprovals = approvals.length;
  const urgentApprovals = approvals
    .slice(0, 3)
    .map((a) => ({ moduleTitle: a.moduleTitle, title: a.title }));

  const greeting = period === 'morning' ? 'Good morning.' : 'Good evening.';
  const parts: string[] = [];
  if (pendingApprovals > 0) {
    parts.push(`${pendingApprovals} approval${pendingApprovals === 1 ? '' : 's'} waiting`);
  }
  if (attention > 0) {
    parts.push(`${attention} metric${attention === 1 ? '' : 's'} need attention`);
  }
  if (parts.length === 0) parts.push('everything looks clear');

  return {
    period,
    generatedAt: nowIso,
    headline: `${greeting} ${parts.join(' · ')}`,
    kpis,
    pendingApprovals,
    urgentApprovals,
    families: families.slice(0, 4),
  };
}
