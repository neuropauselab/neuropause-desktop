/**
 * Executive Intelligence Center (V2.4) — composition layer.
 *
 * Assembles ONE executive snapshot by calling capabilities that ALREADY EXIST:
 *   - buildFounderProactiveItems()  (V2.2)  → founder recommendations
 *   - buildOrgIntelligenceItems()   (V2.3)  → organization findings
 *   - collectOrgHealthInputs() + computeOrgHealth() (V2.3) → KPIs + health scores
 *   - generateBriefing()            (V1)    → today's brief / upcoming priorities
 *
 * It creates NO new intelligence and NO new dashboard framework. Every card
 * carries a deepLink to the existing page that owns the detail — no duplicated
 * views. This is a pure function of the existing sources, so it is unit-testable
 * by injecting those sources.
 */
import {
  computeOrgHealth,
  orgHealthBand,
  type ExecutiveCard,
  type ExecutiveKpi,
  type ExecutiveCenterSnapshot,
  type ExecutiveTrend,
  type MonthlyTrend,
  type IntelligenceItem,
  type OrgHealthInputs,
  type OrgHealthScores,
} from '@neuropause/shared';

/** The existing producers the Center composes. Injected for testability. */
export interface ExecutiveCenterSources {
  now: () => Date;
  founderItems: () => IntelligenceItem[];
  orgItems: () => IntelligenceItem[];
  orgHealthInputs: (nowMs: number) => OrgHealthInputs;
  /** V2.9: recent timeline entries for Timeline/Deliveries cards (optional). */
  timelineEntries?: (nowMs: number) => TimelineEntryLite[];
  /** V2.9: last week's org-health overall/engineering for Weekly Trends (optional). */
  previousWeek?: () => { overall: number; engineering: number } | null;
  /** V3.1: rich 30-day monthly trends, computed from the history store (optional). */
  monthlyTrends?: () => MonthlyTrend[] | undefined;
}

/** The minimal timeline fields the composer reads (kept local; no new dep). */
export interface TimelineEntryLite {
  id: string;
  at: string;
  kind: string;
  category: string;
  title: string;
  summary: string | null;
}

function card(
  key: string,
  title: string,
  items: IntelligenceItem[],
  deepLink: string,
  summary?: string,
): ExecutiveCard {
  return { key, title, items, deepLink, summary };
}

/** Split items by priority for the attention glance + critical-alerts card. */
function byPriority(items: IntelligenceItem[]) {
  const critical = items.filter((i) => i.priority === 'critical');
  const high = items.filter((i) => i.priority === 'high');
  const normal = items.filter((i) => i.priority === 'normal' || i.priority === 'low');
  return { critical, high, normal };
}

/** Build a weekly trend delta. */
function trend(key: string, label: string, current: number, previous: number): ExecutiveTrend {
  const delta = current - previous;
  return {
    key,
    label,
    current,
    previous,
    delta,
    direction: delta > 1 ? 'up' : delta < -1 ? 'down' : 'flat',
  };
}

/** Build the KPI strip (STEP 4) purely from the org-health scores + raw inputs. */
function buildKpis(scores: OrgHealthScores, inputs: OrgHealthInputs): ExecutiveKpi[] {
  const band = (v: number) => orgHealthBand(v);
  const licenseDisplay =
    inputs.licenseValid === false
      ? 'invalid'
      : inputs.licenseDaysToExpiry != null
        ? `${inputs.licenseDaysToExpiry}d left`
        : 'unknown';
  return [
    {
      key: 'org-health',
      label: 'Organization Health',
      value: scores.overall,
      display: `${scores.overall}/100`,
      band: band(scores.overall),
      deepLink: 'enterprise/organization',
    },
    {
      key: 'engineering-health',
      label: 'Engineering Health',
      value: scores.engineering,
      display: `${scores.engineering}/100`,
      band: band(scores.engineering),
      deepLink: 'ai-workforce/engineering',
    },
    {
      key: 'ai-adoption',
      label: 'AI Adoption',
      value: scores.adoption,
      display: `${scores.adoption}/100`,
      band: band(scores.adoption),
      deepLink: 'enterprise/organization',
    },
    {
      key: 'connector-health',
      label: 'Connector Health',
      value: scores.connectorHealth,
      display: `${inputs.connectorsHealthy ?? 0}/${inputs.connectorsTotal ?? 0} healthy`,
      band: band(scores.connectorHealth),
      deepLink: 'connectors',
    },
    {
      key: 'license-status',
      label: 'License',
      value: scores.licenseHealth,
      display: licenseDisplay,
      band: band(scores.licenseHealth),
      deepLink: 'settings/billing',
    },
    {
      key: 'active-members',
      label: 'Active Members',
      value: null,
      display: `${inputs.activeMemberCount ?? 0}/${inputs.memberCount ?? 0}`,
      deepLink: 'enterprise/organization',
    },
  ];
}

/**
 * Compose the full executive snapshot. Pure over the injected sources — the same
 * data the individual pages already show, assembled into one 30-second view.
 */
export function composeExecutiveSnapshot(sources: ExecutiveCenterSources): ExecutiveCenterSnapshot {
  const nowMs = sources.now().getTime();
  const generatedAt = new Date(nowMs).toISOString();

  const founder = sources.founderItems();
  const org = sources.orgItems();
  const inputs = sources.orgHealthInputs(nowMs);
  const scores = computeOrgHealth(inputs);

  // Critical alerts = all critical items across founder + org (deduped by id).
  const allItems = [...founder, ...org];
  const seen = new Set<string>();
  const critical = allItems.filter((i) => {
    if (i.priority !== 'critical') return false;
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });

  // Engineering-flavored items (from either source) for the engineering card.
  const engineering = allItems.filter(
    (i) =>
      i.id.includes('engineering') || (i.governance?.sourceSystems ?? []).includes('engineering'),
  );

  // Upcoming priorities = high-priority, non-critical items.
  const upcoming = allItems.filter((i) => i.priority === 'high');

  const counts = byPriority(allItems);

  // ── V2.9 completion cards (STEP 3) — all composed from existing data ──
  const timeline = sources.timelineEntries?.(nowMs) ?? [];
  const weekAgo = nowMs - 7 * 86_400_000;
  const recentTimeline = timeline.filter((e) => new Date(e.at).getTime() >= weekAgo);

  // Executive Timeline: the most recent activity across the org.
  const timelineItems: IntelligenceItem[] = recentTimeline.slice(0, 8).map((e) => ({
    id: `timeline:${e.id}`,
    title: e.title,
    body: e.summary ?? e.category,
    priority: 'normal',
    producedAt: e.at,
  }));

  // Recent Deliveries: timeline entries that represent shipped/completed work.
  const deliveryItems: IntelligenceItem[] = recentTimeline
    .filter((e) =>
      /deploy|release|ship|complete|mer[g]e|deliver|done/i.test(
        `${e.kind} ${e.category} ${e.title}`,
      ),
    )
    .slice(0, 6)
    .map((e) => ({
      id: `delivery:${e.id}`,
      title: e.title,
      body: e.summary ?? e.category,
      priority: 'normal',
      producedAt: e.at,
    }));

  // Recent Decisions: decision-flavored timeline entries (or founder recommendations acted on).
  const decisionItems: IntelligenceItem[] = recentTimeline
    .filter((e) =>
      /decision|approve|decide|chose|selected|sign-?off/i.test(
        `${e.kind} ${e.category} ${e.title}`,
      ),
    )
    .slice(0, 6)
    .map((e) => ({
      id: `decision:${e.id}`,
      title: e.title,
      body: e.summary ?? e.category,
      priority: 'normal',
      producedAt: e.at,
    }));

  // Evidence Summary: the governance evidence behind the current critical/high items.
  const evidenceItems: IntelligenceItem[] = allItems
    .filter((i) => (i.priority === 'critical' || i.priority === 'high') && i.governance)
    .slice(0, 6)
    .map((i) => ({
      id: `evidence:${i.id}`,
      title: i.title,
      body: (i.governance?.evidence ?? []).slice(0, 3).join(' · ') || 'No evidence recorded',
      priority: i.priority,
      producedAt: i.producedAt,
      governance: i.governance,
    }));

  // Weekly Trends: deltas vs last week for the headline metrics.
  const prev = sources.previousWeek?.() ?? null;
  const weeklyTrends = prev
    ? [
        trend('overall', 'Organization Health', scores.overall, prev.overall),
        trend('engineering', 'Engineering Health', scores.engineering, prev.engineering),
      ]
    : undefined;

  const monthlyTrends = sources.monthlyTrends?.();

  return {
    generatedAt,
    kpis: buildKpis(scores, inputs),
    orgHealth: scores,
    criticalAlerts: card(
      'critical-alerts',
      'Critical Alerts',
      critical,
      'notifications',
      critical.length === 0 ? 'No critical alerts' : `${critical.length} need attention`,
    ),
    founderRecommendations: card(
      'founder-recommendations',
      'Founder Recommendations',
      founder,
      'ai-workforce/founder',
      founder.length === 0 ? 'Nothing to recommend right now' : undefined,
    ),
    organizationHealth: card(
      'organization-health',
      'Organization Health',
      org,
      'enterprise/organization',
      `${orgHealthBand(scores.overall)} — ${scores.overall}/100`,
    ),
    engineeringHealth: card(
      'engineering-health',
      'Engineering Health',
      engineering,
      'ai-workforce/engineering',
      `${orgHealthBand(scores.engineering)} — ${scores.engineering}/100`,
    ),
    upcomingPriorities: card(
      'upcoming-priorities',
      'Upcoming Priorities',
      upcoming,
      'enterprise/briefings',
      upcoming.length === 0 ? 'Nothing urgent upcoming' : undefined,
    ),
    attentionCounts: {
      critical: counts.critical.length,
      high: counts.high.length,
      normal: counts.normal.length,
    },
    executiveTimeline: card(
      'executive-timeline',
      'Executive Timeline',
      timelineItems,
      'enterprise/organization',
      timelineItems.length === 0 ? 'No recent activity' : undefined,
    ),
    recentDecisions: card(
      'recent-decisions',
      'Recent Decisions',
      decisionItems,
      'enterprise/organization',
      decisionItems.length === 0 ? 'No decisions recorded this week' : undefined,
    ),
    recentDeliveries: card(
      'recent-deliveries',
      'Recent Deliveries',
      deliveryItems,
      'ai-workforce/engineering',
      deliveryItems.length === 0 ? 'No deliveries this week' : undefined,
    ),
    evidenceSummary: card(
      'evidence-summary',
      'Evidence Summary',
      evidenceItems,
      'notifications',
      evidenceItems.length === 0 ? 'No evidence to summarize' : undefined,
    ),
    weeklyTrends,
    monthlyTrends,
  };
}
