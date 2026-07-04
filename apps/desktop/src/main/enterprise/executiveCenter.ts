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
  };
}
