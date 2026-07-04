/**
 * Executive Intelligence Delivery — shared types.
 *
 * A reusable delivery layer that any AI module (Mission Brief, Founder AI,
 * Engineering AI, Organization alerts) can register with. It does NOT generate
 * intelligence — it schedules, prioritizes, and delivers intelligence that other
 * subsystems already produce. Reuses the existing task scheduler and notification
 * scheduler; introduces no second scheduler and no second notification path.
 */

/** How important a piece of intelligence is. Only high/critical get delivered by default. */
export type IntelligencePriority = 'low' | 'normal' | 'high' | 'critical';

/** The impact axes used to rank intelligence (STEP 5). */
export interface IntelligenceImpact {
  business?: number; // 0..1
  engineering?: number;
  security?: number;
  revenue?: number;
  customer?: number;
  urgency?: number;
  /** Confidence in the underlying evidence, 0..1 — low-confidence items are suppressed. */
  confidence?: number;
}

/** A single deliverable produced by a source when its schedule fires (or on demand). */
export interface IntelligenceItem {
  /** Stable id for dedupe/cancel, e.g. 'mission-brief:morning'. */
  id: string;
  title: string;
  body: string;
  priority: IntelligencePriority;
  impact?: IntelligenceImpact;
  /** Deep-link target the notification opens, e.g. a renderer route/panel id. */
  deepLink?: string;
  /** ISO timestamp the item was produced. */
  producedAt: string;
}

/** Cadence for a scheduled source. */
export type DeliveryCadence =
  | { kind: 'daily'; atMinutes: number } // minutes past local midnight (e.g. 8*60 = 08:00)
  | { kind: 'weekly'; dayOfWeek: number; atMinutes: number } // 0=Sun
  | { kind: 'monthly'; dayOfMonth: number; atMinutes: number }
  | { kind: 'interval'; everyMs: number };

/**
 * A registered intelligence source. `produce` is called when the cadence fires;
 * returning null/[] means "nothing worth delivering" (silent no-op).
 */
export interface IntelligenceSource {
  /** Unique key, e.g. 'mission-brief', 'founder-ai', 'engineering-alerts'. */
  key: string;
  label: string;
  cadence: DeliveryCadence;
  produce: () => IntelligenceItem[] | null | Promise<IntelligenceItem[] | null>;
}

/** A delivery channel (desktop today; email/slack/teams/mobile are interface-only). */
export interface DeliveryChannel {
  key: 'desktop' | 'notification-center' | 'email' | 'slack' | 'teams' | 'mobile';
  available: boolean;
  deliver: (item: IntelligenceItem) => void | Promise<void>;
}

/** User-configurable delivery preferences (STEP 4). Persisted via existing userData JSON. */
export interface DeliveryPreferences {
  enabled: boolean;
  timezoneOffsetMinutes: number | null; // null => use system
  morningBriefMinutes: number; // default 8:00
  eveningSummaryMinutes: number; // default 18:00
  weeklyReportDay: number; // 0..6, default Mon(1)
  workingHoursStartMinutes: number;
  workingHoursEndMinutes: number;
  doNotDisturb: boolean;
  /** Minimum priority to deliver. */
  minPriority: IntelligencePriority;
}

export const DEFAULT_DELIVERY_PREFERENCES: DeliveryPreferences = {
  enabled: true,
  timezoneOffsetMinutes: null,
  morningBriefMinutes: 8 * 60,
  eveningSummaryMinutes: 18 * 60,
  weeklyReportDay: 1,
  workingHoursStartMinutes: 9 * 60,
  workingHoursEndMinutes: 18 * 60,
  doNotDisturb: false,
  minPriority: 'high',
};

const PRIORITY_RANK: Record<IntelligencePriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
};

/** True if `p` meets or exceeds `min`. */
export function meetsPriority(p: IntelligencePriority, min: IntelligencePriority): boolean {
  return PRIORITY_RANK[p] >= PRIORITY_RANK[min];
}

/**
 * Weighted impact score (STEP 5). Urgency and revenue/customer weigh highest;
 * the score is scaled by evidence confidence so low-confidence items rank down.
 */
export function scoreImpact(impact: IntelligenceImpact | undefined): number {
  if (!impact) return 0;
  const w = {
    business: 0.15,
    engineering: 0.15,
    security: 0.2,
    revenue: 0.2,
    customer: 0.15,
    urgency: 0.15,
  };
  const raw =
    (impact.business ?? 0) * w.business +
    (impact.engineering ?? 0) * w.engineering +
    (impact.security ?? 0) * w.security +
    (impact.revenue ?? 0) * w.revenue +
    (impact.customer ?? 0) * w.customer +
    (impact.urgency ?? 0) * w.urgency;
  const confidence = impact.confidence ?? 1;
  return raw * confidence;
}
