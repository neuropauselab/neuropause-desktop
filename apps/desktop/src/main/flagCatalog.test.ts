import { describe, expect, it } from 'vitest';
import {
  FEATURE_FLAGS,
  evaluateFlag,
  buildFlagCatalog,
  filterFlagCatalog,
  groupFlagCatalog,
  overriddenFlagKeys,
  flagCatalogSummary,
  flagLabel,
  flagSourceLabel,
  flagSourceHint,
  planTierLabel,
  allFlagKeys,
  FLAG_CATEGORY,
  FLAG_CATEGORY_ORDER,
  FLAG_LABELS,
  type FeatureFlagState,
  type FeatureFlagKey,
  type PlanTier,
} from '@neuropause/shared';

/** Reproduce exactly what the main flag service returns: FEATURE_FLAGS mapped through evaluateFlag. */
function evaluate(
  planTier: PlanTier,
  overrides: Partial<Record<FeatureFlagKey, boolean>> = {},
): FeatureFlagState[] {
  return FEATURE_FLAGS.map((def) => evaluateFlag(def, { override: overrides[def.key], planTier }));
}

describe('flagCatalog — static metadata integrity', () => {
  it('labels and categorizes every real flag key', () => {
    for (const def of FEATURE_FLAGS) {
      expect(FLAG_LABELS[def.key]).toBeTruthy();
      expect(FLAG_CATEGORY[def.key]).toBeTruthy();
      expect(FLAG_CATEGORY_ORDER).toContain(FLAG_CATEGORY[def.key]);
    }
  });

  it('allFlagKeys mirrors the real catalog', () => {
    expect(allFlagKeys()).toEqual(FEATURE_FLAGS.map((f) => f.key));
    expect(allFlagKeys()).toHaveLength(5);
  });

  it('exposes friendly label/source helpers', () => {
    expect(flagLabel('ai_memory_search')).toBe('AI Memory Search');
    expect(flagSourceLabel('override')).toBe('Override');
    expect(flagSourceLabel('plan')).toBe('Plan');
    expect(flagSourceLabel('default')).toBe('Default');
    expect(flagSourceHint('override')).toBe('Overridden on this device');
    expect(planTierLabel('pro')).toBe('Pro');
  });
});

describe('flagCatalog — buildFlagCatalog', () => {
  it('produces one entry per state, category-then-label sorted, deterministically', () => {
    const states = evaluate('free');
    const catalog = buildFlagCatalog(states);
    expect(catalog).toHaveLength(states.length);
    // Category order is stable; one flag per category → this exact key order.
    expect(catalog.map((e) => e.key)).toEqual([
      'ai_memory_search',
      'advanced_analytics',
      'automation_builder',
      'cloud_sync',
      'multi_workspace',
    ]);
    // Deterministic
    expect(buildFlagCatalog(states)).toEqual(catalog);
  });

  it('reflects the real plan gate for a free plan (locked, plan-sourced)', () => {
    const catalog = buildFlagCatalog(evaluate('free'));
    const cloud = catalog.find((e) => e.key === 'cloud_sync')!;
    expect(cloud.source).toBe('plan');
    expect(cloud.enabled).toBe(false);
    expect(cloud.lockedByPlan).toBe(true);
    expect(cloud.overridden).toBe(false);
    expect(cloud.minPlan).toBe('pro');

    const automation = catalog.find((e) => e.key === 'automation_builder')!;
    expect(automation.source).toBe('default');
    expect(automation.enabled).toBe(true);
    expect(automation.lockedByPlan).toBe(false);
    expect(automation.minPlan).toBeNull();
  });

  it('unlocks a plan-gated flag when the plan meets the tier', () => {
    const catalog = buildFlagCatalog(evaluate('enterprise'));
    const multi = catalog.find((e) => e.key === 'multi_workspace')!;
    expect(multi.source).toBe('plan');
    expect(multi.enabled).toBe(true);
    expect(multi.lockedByPlan).toBe(false);
  });

  it('marks an override as the deciding source and never locked', () => {
    const catalog = buildFlagCatalog(evaluate('free', { cloud_sync: true }));
    const cloud = catalog.find((e) => e.key === 'cloud_sync')!;
    expect(cloud.source).toBe('override');
    expect(cloud.enabled).toBe(true);
    expect(cloud.overridden).toBe(true);
    expect(cloud.lockedByPlan).toBe(false);
  });
});

describe('flagCatalog — filter / group / summary', () => {
  it('filters case-insensitively across label, description, category and key', () => {
    const catalog = buildFlagCatalog(evaluate('pro'));
    expect(filterFlagCatalog(catalog, 'memory').map((e) => e.key)).toEqual(['ai_memory_search']);
    expect(filterFlagCatalog(catalog, 'ANALYTICS').map((e) => e.key)).toEqual(['advanced_analytics']);
    // key match
    expect(filterFlagCatalog(catalog, 'multi_workspace').map((e) => e.key)).toEqual([
      'multi_workspace',
    ]);
  });

  it('returns a fresh copy (not the same ref) for a blank query', () => {
    const catalog = buildFlagCatalog(evaluate('pro'));
    const out = filterFlagCatalog(catalog, '   ');
    expect(out).toEqual(catalog);
    expect(out).not.toBe(catalog);
  });

  it('groups by category in stable order with no empty groups and no lost entries', () => {
    const catalog = buildFlagCatalog(evaluate('pro'));
    const groups = groupFlagCatalog(catalog);
    expect(groups.map((g) => g.category)).toEqual([
      'AI & Memory',
      'Analytics',
      'Automation',
      'Sync & Cloud',
      'Workspaces',
    ]);
    expect(groups.every((g) => g.entries.length > 0)).toBe(true);
    expect(groups.reduce((n, g) => n + g.entries.length, 0)).toBe(catalog.length);
  });

  it('summarizes totals/enabled/overridden and lists overridden keys', () => {
    const states = evaluate('free', { cloud_sync: true, automation_builder: false });
    const summary = flagCatalogSummary(states);
    expect(summary.total).toBe(5);
    expect(summary.overridden).toBe(2);
    // free defaults: automation_builder+ai_memory_search on; here automation_builder overridden off,
    // cloud_sync overridden on → enabled = ai_memory_search + cloud_sync = 2.
    expect(summary.enabled).toBe(2);
    expect(overriddenFlagKeys(states).sort()).toEqual(['automation_builder', 'cloud_sync']);
  });

  it('reports no overrides for a clean evaluation', () => {
    expect(overriddenFlagKeys(evaluate('pro'))).toEqual([]);
  });
});
