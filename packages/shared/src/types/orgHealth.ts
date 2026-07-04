/**
 * Organization Health Model (V2.3).
 *
 * Pure, deterministic scoring over signals that already exist elsewhere in the
 * app (connector health, license status, org size/activity, engineering signals
 * from the briefing). This module invents nothing — it is fed real inputs by the
 * desktop org-intelligence source and returns explainable 0..100 sub-scores plus
 * a weighted overall score. Every calculation is documented inline so a finding
 * can cite exactly why a score is what it is.
 */

/** Raw, already-observed inputs. All optional so partial data degrades gracefully. */
export interface OrgHealthInputs {
  /** Connectors: how many are connected vs in error/down. */
  connectorsTotal?: number;
  connectorsHealthy?: number;
  connectorsError?: number;
  /** License: days until expiry (negative = expired); null = unknown. */
  licenseDaysToExpiry?: number | null;
  licenseValid?: boolean;
  /** Org size + recent activity. */
  memberCount?: number;
  activeMemberCount?: number; // active in the trailing window
  workspaceCount?: number;
  /** Recent activity volume (timeline events in the trailing window). */
  recentEventCount?: number;
  /** AI adoption proxy: distinct AI/connector sources used recently. */
  aiSourcesUsed?: number;
  /** Engineering health 0..1 from the briefing (release/ci/pr/risk). */
  engineeringHealth01?: number;
  /** Cloud sync: recent failures. */
  syncFailures?: number;
  /** Whether the founder/executive has been active recently. */
  executiveActiveRecently?: boolean;
}

export interface OrgHealthScores {
  activity: number; // recent org activity
  adoption: number; // AI/product adoption
  engineering: number; // delivery health
  reliability: number; // sync/connector uptime
  aiUsage: number; // AI usage breadth
  connectorHealth: number; // connector uptime
  licenseHealth: number; // license validity/runway
  security: number; // security posture (heuristic today)
  operational: number; // executive presence + workspace usage
  /** Weighted overall 0..100. */
  overall: number;
}

function clamp01to100(x: number): number {
  return Math.max(0, Math.min(100, Math.round(x)));
}

/**
 * Connector health = healthy / total, penalized by errors.
 * No connectors ⇒ neutral 70 (not a failure, just unconfigured).
 */
function connectorHealthScore(i: OrgHealthInputs): number {
  const total = i.connectorsTotal ?? 0;
  if (total === 0) return 70;
  const healthy = i.connectorsHealthy ?? 0;
  const errors = i.connectorsError ?? 0;
  return clamp01to100((healthy / total) * 100 - errors * 10);
}

/**
 * License health: valid + long runway ⇒ 100; expiring soon decays linearly over
 * a 30-day window; expired/invalid ⇒ 0; unknown ⇒ neutral 60.
 */
function licenseHealthScore(i: OrgHealthInputs): number {
  if (i.licenseValid === false) return 0;
  const d = i.licenseDaysToExpiry;
  if (d == null) return 60;
  if (d <= 0) return 0;
  if (d >= 30) return 100;
  return clamp01to100((d / 30) * 100);
}

/** Activity: recent event volume, saturating at 50 events ⇒ 100. */
function activityScore(i: OrgHealthInputs): number {
  const n = i.recentEventCount ?? 0;
  return clamp01to100((Math.min(n, 50) / 50) * 100);
}

/** Adoption: active members / members, blended with workspace presence. */
function adoptionScore(i: OrgHealthInputs): number {
  const members = i.memberCount ?? 0;
  const active = i.activeMemberCount ?? 0;
  const ratio = members > 0 ? active / members : 0;
  const wsBonus = (i.workspaceCount ?? 0) > 0 ? 20 : 0;
  return clamp01to100(ratio * 80 + wsBonus);
}

/** AI usage breadth: distinct AI sources used, saturating at 5 ⇒ 100. */
function aiUsageScore(i: OrgHealthInputs): number {
  const used = i.aiSourcesUsed ?? 0;
  return clamp01to100((Math.min(used, 5) / 5) * 100);
}

/** Engineering: pass-through of the briefing's 0..1 signal; unknown ⇒ neutral 65. */
function engineeringScore(i: OrgHealthInputs): number {
  if (i.engineeringHealth01 == null) return 65;
  return clamp01to100(i.engineeringHealth01 * 100);
}

/** Reliability: starts at 100, −15 per recent sync failure. */
function reliabilityScore(i: OrgHealthInputs): number {
  const fails = i.syncFailures ?? 0;
  return clamp01to100(100 - fails * 15);
}

/** Operational: executive presence (60) + workspace usage (40). */
function operationalScore(i: OrgHealthInputs): number {
  const exec = i.executiveActiveRecently ? 60 : 0;
  const ws = (i.workspaceCount ?? 0) > 0 ? 40 : 0;
  return clamp01to100(exec + ws);
}

/**
 * Security: heuristic today — valid license + healthy connectors is a proxy for a
 * maintained, authorized posture. Placeholder-free but intentionally simple; a
 * dedicated security-signals feed is a future increment.
 */
function securityScore(i: OrgHealthInputs): number {
  const lic = licenseHealthScore(i);
  const conn = connectorHealthScore(i);
  return clamp01to100(lic * 0.5 + conn * 0.5);
}

/** Weights for the overall score. Reliability + engineering + license weigh most. */
const WEIGHTS = {
  activity: 0.12,
  adoption: 0.12,
  engineering: 0.16,
  reliability: 0.16,
  aiUsage: 0.08,
  connectorHealth: 0.1,
  licenseHealth: 0.14,
  security: 0.06,
  operational: 0.06,
} as const;

/** Compute all sub-scores and the weighted overall. */
export function computeOrgHealth(inputs: OrgHealthInputs): OrgHealthScores {
  const activity = activityScore(inputs);
  const adoption = adoptionScore(inputs);
  const engineering = engineeringScore(inputs);
  const reliability = reliabilityScore(inputs);
  const aiUsage = aiUsageScore(inputs);
  const connectorHealth = connectorHealthScore(inputs);
  const licenseHealth = licenseHealthScore(inputs);
  const security = securityScore(inputs);
  const operational = operationalScore(inputs);

  const overall = clamp01to100(
    activity * WEIGHTS.activity +
      adoption * WEIGHTS.adoption +
      engineering * WEIGHTS.engineering +
      reliability * WEIGHTS.reliability +
      aiUsage * WEIGHTS.aiUsage +
      connectorHealth * WEIGHTS.connectorHealth +
      licenseHealth * WEIGHTS.licenseHealth +
      security * WEIGHTS.security +
      operational * WEIGHTS.operational,
  );

  return {
    activity,
    adoption,
    engineering,
    reliability,
    aiUsage,
    connectorHealth,
    licenseHealth,
    security,
    operational,
    overall,
  };
}

/** A qualitative band for the overall score. */
export function orgHealthBand(overall: number): 'healthy' | 'watch' | 'at-risk' | 'critical' {
  if (overall >= 80) return 'healthy';
  if (overall >= 60) return 'watch';
  if (overall >= 40) return 'at-risk';
  return 'critical';
}
