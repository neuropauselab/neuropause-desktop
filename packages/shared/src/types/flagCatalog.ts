/**
 * Feature-flag CATALOG — the pure presentation/organization layer the Settings "Feature Flags" surface
 * renders from. It adds NOTHING to the flag domain itself: evaluation, defaults, plan gating, overrides and
 * persistence all remain owned by `featureFlags.ts` + the main `featureFlags` service + `ipc.flags.*`. This
 * module only merges the REAL evaluated `FeatureFlagState[]` (returned by `ipc.flags.get`) with the static
 * `FEATURE_FLAGS` catalog to produce sorted, grouped, searchable rows plus the small derived facts the UI
 * needs (human label, domain category, plan gate, which flags are overridden). Everything here is pure and
 * deterministic — no clock, no randomness, no I/O — so the same inputs always render the same catalog and
 * the unit tests can pin it exactly.
 *
 * Design note (honesty): the real flag model has no "maturity/stage" field (only `source: default|override|
 * plan`). Rather than invent Stable/Beta/Experimental stages that don't exist in the backend, flags are
 * grouped by their real functional DOMAIN, and each row surfaces its true `source` and plan gate.
 */
import type { PlanTier } from './ecosystem';
import {
  FEATURE_FLAGS,
  featureFlag,
  type FeatureFlagKey,
  type FeatureFlagSource,
  type FeatureFlagState,
} from './featureFlags';

/** Human-facing name for each flag key (single source of truth for the flag UI). */
export const FLAG_LABELS: Record<FeatureFlagKey, string> = {
  cloud_sync: 'Cloud Sync',
  automation_builder: 'Automation Builder',
  ai_memory_search: 'AI Memory Search',
  advanced_analytics: 'Advanced Analytics',
  multi_workspace: 'Multiple Workspaces',
};

/** Functional domain a flag belongs to. Derived from what the flag actually does — not a maturity stage. */
export type FlagCategory =
  | 'AI & Memory'
  | 'Analytics'
  | 'Automation'
  | 'Sync & Cloud'
  | 'Workspaces';

/** Stable display order for categories (also the grouping order in the UI). */
export const FLAG_CATEGORY_ORDER: readonly FlagCategory[] = [
  'AI & Memory',
  'Analytics',
  'Automation',
  'Sync & Cloud',
  'Workspaces',
];

/** Each real flag's true functional domain. */
export const FLAG_CATEGORY: Record<FeatureFlagKey, FlagCategory> = {
  ai_memory_search: 'AI & Memory',
  advanced_analytics: 'Analytics',
  automation_builder: 'Automation',
  cloud_sync: 'Sync & Cloud',
  multi_workspace: 'Workspaces',
};

/** The row model the Settings flag list renders: the real runtime state + static catalog facts. */
export interface FlagCatalogEntry {
  key: FeatureFlagKey;
  label: string;
  description: string;
  category: FlagCategory;
  /** Live evaluated value from `ipc.flags.get`. */
  enabled: boolean;
  /** Which input decided `enabled`: the built-in default, a per-install override, or the plan gate. */
  source: FeatureFlagSource;
  /** The flag's built-in default (from the static catalog). */
  default: boolean;
  /** Minimum plan tier required, or null when the flag is not plan-gated. */
  minPlan: PlanTier | null;
  /** A per-install override is the deciding source. */
  overridden: boolean;
  /** Plan-gated, no override, and currently off because the active plan doesn't meet the gate. */
  lockedByPlan: boolean;
}

/** Human label for a flag key (falls back to the raw key if somehow unknown). */
export function flagLabel(key: FeatureFlagKey): string {
  return FLAG_LABELS[key] ?? key;
}

/** Friendly one-word label for a flag's deciding source. */
export function flagSourceLabel(source: FeatureFlagSource): string {
  switch (source) {
    case 'override':
      return 'Override';
    case 'plan':
      return 'Plan';
    default:
      return 'Default';
  }
}

/** A short sentence explaining where a flag's current value came from. */
export function flagSourceHint(source: FeatureFlagSource): string {
  switch (source) {
    case 'override':
      return 'Overridden on this device';
    case 'plan':
      return 'Determined by your plan';
    default:
      return 'Using the built-in default';
  }
}

/** Capitalized plan-tier label, e.g. 'pro' → 'Pro'. */
export function planTierLabel(tier: PlanTier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

/**
 * Merge the REAL evaluated flag states with the static catalog into sorted, render-ready rows.
 * Sorted by category order, then alphabetically by label — fully deterministic.
 */
export function buildFlagCatalog(states: readonly FeatureFlagState[]): FlagCatalogEntry[] {
  const entries = states.map((s): FlagCatalogEntry => {
    const def = featureFlag(s.key);
    const minPlan = def?.minPlan ?? null;
    return {
      key: s.key,
      label: flagLabel(s.key),
      description: s.description,
      category: FLAG_CATEGORY[s.key],
      enabled: s.enabled,
      source: s.source,
      default: def?.default ?? false,
      minPlan,
      overridden: s.source === 'override',
      lockedByPlan: s.source === 'plan' && !s.enabled,
    };
  });
  return entries.sort((a, b) => {
    const byCat = categoryRank(a.category) - categoryRank(b.category);
    return byCat !== 0 ? byCat : a.label.localeCompare(b.label);
  });
}

function categoryRank(category: FlagCategory): number {
  const i = FLAG_CATEGORY_ORDER.indexOf(category);
  return i === -1 ? FLAG_CATEGORY_ORDER.length : i;
}

/**
 * Case-insensitive filter over label, description, category and key. An empty/blank query returns the
 * list unchanged (a new array). Deterministic.
 */
export function filterFlagCatalog(
  entries: readonly FlagCatalogEntry[],
  query: string,
): FlagCatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries.slice();
  return entries.filter((e) =>
    [e.label, e.description, e.category, e.key].some((f) => f.toLowerCase().includes(q)),
  );
}

/** A category with its entries, for section rendering. */
export interface FlagCatalogGroup {
  category: FlagCategory;
  entries: FlagCatalogEntry[];
}

/** Group entries by category in the stable category order, omitting empty categories. Deterministic. */
export function groupFlagCatalog(entries: readonly FlagCatalogEntry[]): FlagCatalogGroup[] {
  return FLAG_CATEGORY_ORDER.map((category) => ({
    category,
    entries: entries.filter((e) => e.category === category),
  })).filter((g) => g.entries.length > 0);
}

/** The keys currently decided by a per-install override — the targets of "reset all overrides". */
export function overriddenFlagKeys(states: readonly FeatureFlagState[]): FeatureFlagKey[] {
  return states.filter((s) => s.source === 'override').map((s) => s.key);
}

/** Small headline counts for the section header. Deterministic. */
export interface FlagCatalogSummary {
  total: number;
  enabled: number;
  overridden: number;
}

export function flagCatalogSummary(states: readonly FeatureFlagState[]): FlagCatalogSummary {
  return {
    total: states.length,
    enabled: states.filter((s) => s.enabled).length,
    overridden: states.filter((s) => s.source === 'override').length,
  };
}

/** Every known flag key, in catalog order — used to reset all overrides exhaustively. */
export function allFlagKeys(): FeatureFlagKey[] {
  return FEATURE_FLAGS.map((f) => f.key);
}
