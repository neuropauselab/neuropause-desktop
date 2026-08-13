/**
 * Dashboard view-model (Mobile M1-09) — PURE adapters that turn the desktop's
 * companion dashboard payloads (dashboard.families / dashboard.family) into the
 * chart inputs the phone renders. No RN; unit-tested in plain Node. The colours
 * come from the shared design tokens so the phone and desktop read as one system.
 */
import type { CompanionFamilySummary, CompanionKpi, FamilyDashboardData } from '@neuropause/shared';
import type { BarDatum, DonutSlice } from '../components/charts/geometry';
import { colors } from '../theme/tokens';

/** Families → ranked bars of live record counts (highest first, capped). */
export function familyBars(families: CompanionFamilySummary[], limit = 8): BarDatum[] {
  return families.slice(0, limit).map((f) => ({ label: f.group, value: f.recordCount }));
}

/** A family's per-module active counts → bars. */
export function moduleBars(family: FamilyDashboardData): BarDatum[] {
  return family.moduleBars.map((m) => ({ label: m.name, value: m.active }));
}

/** A family's 6-month record-creation trend → bars. */
export function trendBars(family: FamilyDashboardData): BarDatum[] {
  return family.creationTrend.map((t) => ({ label: t.month, value: t.count }));
}

/** A family's status distribution → donut slices (empty when the family has none). */
export function statusDonutSlices(family: FamilyDashboardData): DonutSlice[] {
  if (!family.statusDonut) return [];
  return family.statusDonut.slices.map((s) => ({ name: s.name, value: s.value }));
}

/** Colour for a KPI band, falling back to the accent when a KPI has no band. */
export function bandColor(band?: CompanionKpi['band']): string {
  return band ? colors.bands[band] : colors.accent;
}
