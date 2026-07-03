/**
 * Feature flags: gate features behind defaults, per-install overrides, and plan
 * entitlements. Evaluation is pure and shared so the main process, the renderer, and
 * (later) the backend agree on whether a flag is on. A flag may require a minimum
 * plan tier, which is how flags tie into the subscription plan.
 *
 * Note: this module defines and evaluates flags. Wiring a flag to actually gate a
 * feature (reading its state at the feature's call site) is done per feature.
 */
import type { PlanTier } from './ecosystem';

export type FeatureFlagKey =
  | 'cloud_sync'
  | 'automation_builder'
  | 'ai_memory_search'
  | 'advanced_analytics'
  | 'multi_workspace';

export interface FeatureFlagDefinition {
  key: FeatureFlagKey;
  description: string;
  /** Value when no override and no plan gate apply. */
  default: boolean;
  /** If set, the flag is on only when the active plan is at least this tier. */
  minPlan?: PlanTier;
}

export const FEATURE_FLAGS: readonly FeatureFlagDefinition[] = [
  {
    key: 'cloud_sync',
    description: 'Cloud sync of org-scoped settings across devices',
    default: false,
    minPlan: 'pro',
  },
  {
    key: 'automation_builder',
    description: 'Visual automation workflow builder',
    default: true,
  },
  {
    key: 'ai_memory_search',
    description: 'Natural-language search over AI memory',
    default: true,
  },
  {
    key: 'advanced_analytics',
    description: 'Advanced productivity analytics',
    default: false,
    minPlan: 'pro',
  },
  {
    key: 'multi_workspace',
    description: 'Multiple concurrent workspaces',
    default: false,
    minPlan: 'enterprise',
  },
];

export type FeatureFlagSource = 'default' | 'override' | 'plan';

export interface FeatureFlagState {
  key: FeatureFlagKey;
  enabled: boolean;
  source: FeatureFlagSource;
  description: string;
}

const TIER_RANK: Record<PlanTier, number> = { free: 0, pro: 1, enterprise: 2 };

/** Whether `plan` meets or exceeds the minimum tier `min`. */
export function planMeetsTier(plan: PlanTier, min: PlanTier): boolean {
  return TIER_RANK[plan] >= TIER_RANK[min];
}

export interface FlagEvaluationContext {
  /** An explicit per-install override, if any. Always wins when present. */
  override?: boolean;
  /** The active plan tier for plan-gated flags (defaults to 'free'). */
  planTier?: PlanTier;
}

/**
 * Evaluate a single flag. An explicit override always wins. Otherwise a plan-gated
 * flag is on when the plan meets the minimum tier; an ungated flag uses its default.
 */
export function evaluateFlag(
  def: FeatureFlagDefinition,
  ctx: FlagEvaluationContext = {},
): FeatureFlagState {
  if (ctx.override !== undefined) {
    return {
      key: def.key,
      enabled: ctx.override,
      source: 'override',
      description: def.description,
    };
  }
  if (def.minPlan) {
    return {
      key: def.key,
      enabled: planMeetsTier(ctx.planTier ?? 'free', def.minPlan),
      source: 'plan',
      description: def.description,
    };
  }
  return { key: def.key, enabled: def.default, source: 'default', description: def.description };
}

/** Look up a flag definition by key. */
export function featureFlag(key: FeatureFlagKey): FeatureFlagDefinition | undefined {
  return FEATURE_FLAGS.find((f) => f.key === key);
}
