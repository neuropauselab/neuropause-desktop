/**
 * Executive Recommendation Engine (V3.2).
 *
 * PURE composer: an ExecutiveCenterSnapshot → ranked ExecutiveRecommendation[] +
 * an ExecutiveSummary. It produces NO new intelligence — it explains the metrics
 * that already exist (org-health sub-scores, weekly/monthly trends, and the
 * governance-bearing critical/founder items) as decisions: problem, impact, root
 * cause, confidence, priority, action, evidence. Deterministic and unit-testable.
 */
import type {
  ExecutiveCenterSnapshot,
  ExecutiveRecommendation,
  ExecutiveSummary,
  MonthlyTrend,
  ExecRecoPriority,
} from '@neuropause/shared';

/** Priority ranking weights (STEP 3). */
const PRIORITY_RANK: Record<ExecRecoPriority, number> = {
  critical: 1000,
  high: 700,
  medium: 400,
  low: 100,
};

/** Map an org-health sub-score to a priority band. */
function scoreBand(score: number): ExecRecoPriority {
  if (score < 40) return 'critical';
  if (score < 60) return 'high';
  if (score < 80) return 'medium';
  return 'low';
}

/** Owner role by metric. */
function ownerFor(metric: string): string {
  switch (metric) {
    case 'engineering':
      return 'Engineering Lead';
    case 'license':
      return 'Operations';
    case 'adoption':
    case 'aiUsage':
      return 'Customer Success';
    case 'connectorHealth':
      return 'Platform';
    default:
      return 'Executive';
  }
}

function etaFor(priority: ExecRecoPriority): string {
  return priority === 'critical' ? 'today' : priority === 'high' ? 'this week' : 'this month';
}

/**
 * Composite score (STEP 3): business impact + urgency + confidence + risk. Built
 * from the priority band, whether a trend is declining, and confidence.
 */
function computeScore(priority: ExecRecoPriority, confidence: number, declining: boolean): number {
  return Math.round(PRIORITY_RANK[priority] + confidence * 100 + (declining ? 120 : 0));
}

/** Find a metric's monthly trend, if present. */
function monthly(snap: ExecutiveCenterSnapshot, key: string): MonthlyTrend | undefined {
  return snap.monthlyTrends?.find((t) => t.key === key);
}

/**
 * Build ranked recommendations from the snapshot. One per weak/declining KPI, plus
 * governance-critical items surfaced as recommendations.
 */
export function buildExecutiveRecommendations(
  snap: ExecutiveCenterSnapshot,
): ExecutiveRecommendation[] {
  const recs: ExecutiveRecommendation[] = [];
  const h = snap.orgHealth;

  // ── KPI-driven recommendations (only when a KPI is not healthy) ──
  const kpiSpecs: Array<{
    key: string;
    label: string;
    score: number;
    icon: string;
    impact: string;
    cause: string;
    action: string;
    outcome: string;
  }> = [
    {
      key: 'engineering',
      label: 'Engineering Health',
      score: h.engineering,
      icon: 'code',
      impact: 'Delivery risk rises and releases may slip.',
      cause: 'CI failures or open engineering risks in the current window.',
      action: 'Triage failing CI and the top engineering risks in the Mission Brief.',
      outcome: 'Restored delivery predictability and lower release risk.',
    },
    {
      key: 'licenseHealth',
      label: 'License',
      score: h.licenseHealth,
      icon: 'shield',
      impact: 'Expiry can disable paid capabilities and blocks compliance.',
      cause: 'License is near expiry or invalid.',
      action: 'Renew or re-activate the license now.',
      outcome: 'Uninterrupted service and compliance.',
    },
    {
      key: 'adoption',
      label: 'Adoption',
      score: h.adoption,
      icon: 'users',
      impact: 'Low active usage signals churn risk and weak ROI.',
      cause: 'Few members are actively using the workspace.',
      action: 'Run onboarding for inactive members; share a quick-start.',
      outcome: 'Higher active-member ratio and retention.',
    },
    {
      key: 'connectorHealth',
      label: 'Connector Health',
      score: h.connectorHealth,
      icon: 'plug',
      impact: 'Failed connectors silently stop intelligence from that source.',
      cause: 'One or more connectors are in error.',
      action: 'Reconnect the affected connectors.',
      outcome: 'Complete, trustworthy signal coverage.',
    },
    {
      key: 'reliability',
      label: 'Reliability',
      score: h.reliability,
      icon: 'activity',
      impact: 'Sync failures degrade data freshness and trust.',
      cause: 'Recent sync failures detected.',
      action: 'Investigate and clear the failing syncs.',
      outcome: 'Fresh, reliable data across the workspace.',
    },
  ];

  for (const k of kpiSpecs) {
    const band = scoreBand(k.score);
    if (band === 'low') continue; // healthy KPI → no recommendation
    const mt = monthly(snap, k.key === 'licenseHealth' ? 'overall' : k.key);
    const declining = mt ? mt.direction === 'down' : false;
    const confidence = mt
      ? mt.confidence === 'high'
        ? 0.9
        : mt.confidence === 'medium'
          ? 0.75
          : 0.6
      : 0.7;
    const evidence: string[] = [`${k.key}=${k.score}/100`];
    if (mt) evidence.push(`30d ${mt.direction} ${mt.percentChange}%`, `avg ${mt.movingAverage}`);
    recs.push({
      id: `rec:${k.key}`,
      metric: k.key,
      icon: k.icon,
      problem: `${k.label} is ${band} (${k.score}/100)${declining ? ' and declining' : ''}.`,
      businessImpact: k.impact,
      rootCause: k.cause,
      priority: band,
      confidence,
      expectedOutcome: k.outcome,
      evidence,
      sourceSystems: ['organization', 'timeline'],
      recommendedAction: k.action,
      owner: ownerFor(k.key),
      eta: etaFor(band),
      status: 'open',
      score: computeScore(band, confidence, declining),
    });
  }

  // ── Governance-critical items surfaced as recommendations ──
  for (const item of snap.criticalAlerts.items) {
    if (!item.governance) continue;
    recs.push({
      id: `rec:alert:${item.id}`,
      metric: 'governance',
      icon: 'alert-triangle',
      problem: item.title,
      businessImpact: 'A critical governance gap undermines trust and compliance.',
      rootCause: item.governance.reasoning,
      priority: 'critical',
      confidence: item.governance.confidence,
      expectedOutcome: 'Closed compliance gap and restored governance coverage.',
      evidence: item.governance.evidence,
      sourceSystems: item.governance.sourceSystems,
      recommendedAction: item.governance.recommendedAction,
      owner: 'Executive',
      eta: 'today',
      status: 'open',
      score: computeScore('critical', item.governance.confidence, false),
    });
  }

  // Rank (STEP 3): highest composite score first; dedupe by id.
  const seen = new Set<string>();
  return recs
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .sort((a, b) => b.score - a.score);
}

/** Build the one-glance executive summary (STEP 6). */
export function buildExecutiveSummary(
  snap: ExecutiveCenterSnapshot,
  recs: ExecutiveRecommendation[],
): ExecutiveSummary {
  const topRec = recs[0];
  const topRiskRec = recs.find((r) => r.priority === 'critical' || r.priority === 'high');

  // Wins/losses from monthly trend direction.
  const up = (snap.monthlyTrends ?? []).filter((t) => t.direction === 'up');
  const down = (snap.monthlyTrends ?? []).filter((t) => t.direction === 'down');
  const topWin = up[0]
    ? `${up[0].label} up ${up[0].percentChange}% over 30 days`
    : 'No standout gains this month';
  const topLoss = down[0]
    ? `${down[0].label} down ${Math.abs(down[0].percentChange)}% over 30 days`
    : 'No significant declines this month';

  // Opportunity = the best medium-band KPI to push to healthy.
  const opp = recs.find((r) => r.priority === 'medium');

  // Executive score: org-health overall, tempered by open critical risks.
  const openCriticals = recs.filter((r) => r.priority === 'critical').length;
  const executiveScore = Math.max(0, Math.min(100, snap.orgHealth.overall - openCriticals * 8));

  return {
    topOpportunity: opp
      ? `Improve ${opp.metric} — ${opp.recommendedAction}`
      : 'Maintain current healthy metrics',
    topRisk: topRiskRec ? topRiskRec.problem : 'No material risks detected',
    topWin,
    topLoss,
    topRecommendation: topRec ? topRec.recommendedAction : 'No action required',
    executiveScore,
  };
}
